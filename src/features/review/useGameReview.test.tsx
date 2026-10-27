// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type {
  AnalysisSettings,
  Classification,
  GameRecord,
  GameReview,
  MoveReview,
  ParsedGame,
  PositionAnalysis,
} from '@/core/types';
import type { AnalyzeGameOptions, AnalyzePositionsOptions } from '@/engine/analyzeGame';
import type { CachedAnalyses } from '@/engine/cache';
import { QUICK_PASS } from '@/engine/presets';
import type { Engine } from '@/engine/stockfish';
import type { LibraryEntry } from '@/library/library';
import { NotFoundError } from '@/sources/http';
import { useSettings } from '@/state/settings';
import { setEngineFactoryForTests } from './engine';
import { ENGINE_START_ERROR, useGameReview, type AnalysisPhase } from './useGameReview';

// The hook is tested against fakes of everything it orchestrates, so these tests
// cover the data flow (load → cache → engine passes → review → library) and not the
// chess logic.
vi.mock('@/sources/resolveGame', () => ({ resolveGame: vi.fn() }));
vi.mock('@/core/pgn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/pgn')>()),
  parsePgn: vi.fn(),
}));
vi.mock('@/core/openings', () => ({
  loadOpeningBook: vi.fn(async () => ({ has: () => false, lookup: () => null })),
}));
vi.mock('@/core/review', () => ({ buildGameReview: vi.fn() }));
vi.mock('@/engine/analyzeGame', () => ({ analyzeGame: vi.fn(), analyzePositions: vi.fn() }));
vi.mock('@/engine/cache', () => ({
  analysisCacheKey: (id: string, engine: string, s: AnalysisSettings) =>
    `${id}|${engine}|${s.depth}`,
  loadCachedAnalyses: vi.fn(),
  saveAnalyses: vi.fn(async () => undefined),
}));
const releaseEngine = vi.fn();
vi.mock('@/features/insights/analysisJob', () => ({
  holdInsightsJob: vi.fn(() => releaseEngine),
}));
vi.mock('@/library/library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/library/library')>()),
  getLibraryEntry: vi.fn(async () => null),
  saveToLibrary: vi.fn(async () => undefined),
}));

const { resolveGame } = await import('@/sources/resolveGame');
const { parsePgn } = await import('@/core/pgn');
const { buildGameReview } = await import('@/core/review');
const { analyzeGame, analyzePositions } = await import('@/engine/analyzeGame');
const { loadCachedAnalyses, saveAnalyses } = await import('@/engine/cache');
const { getLibraryEntry, saveToLibrary } = await import('@/library/library');
const { holdInsightsJob } = await import('@/features/insights/analysisJob');

const GAME_ID = 'lichess/abcd1234';
const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ENGINE = 'Stockfish 19 lite';
const FULL_KEY = `${GAME_ID}|${ENGINE}|16`;
const QUICK_KEY = `${GAME_ID}|${ENGINE}|${QUICK_PASS.depth}`;

const record: GameRecord = {
  id: GAME_ID,
  source: 'lichess',
  white: { name: 'Alice' },
  black: { name: 'Bob' },
  result: '1-0',
  timeClass: 'blitz',
  variant: 'standard',
  pgn: '1. e4 e5 *',
};

const game: ParsedGame = {
  headers: {},
  initialFen: FEN,
  moves: [
    {
      ply: 1,
      moveNumber: 1,
      color: 'w',
      san: 'e4',
      uci: 'e2e4',
      from: 'e2',
      to: 'e4',
      piece: 'p',
      fenBefore: FEN,
      fenAfter: FEN,
      isCheck: false,
      isCheckmate: false,
    },
    {
      ply: 2,
      moveNumber: 1,
      color: 'b',
      san: 'e5',
      uci: 'e7e5',
      from: 'e7',
      to: 'e5',
      piece: 'p',
      fenBefore: FEN,
      fenAfter: FEN,
      isCheck: false,
      isCheckmate: false,
    },
  ],
};

/** Analyses of the three positions at a depth (scores tell the passes apart in failures). */
function positionsAt(depth: number): PositionAnalysis[] {
  return [10, 20, 30].map((cp) => ({
    fen: FEN,
    depth,
    lines: [{ pv: ['e2e4'], score: { type: 'cp', value: cp + depth }, depth }],
  }));
}

const quickPositions = positionsAt(QUICK_PASS.depth);
const positions = positionsAt(16);
const verified = positionsAt(20);
/** Position `index` once verified: the deeper analysis, keeping the one it replaced. */
const checked = (index: number): PositionAnalysis => ({
  ...verified[index]!,
  unverified: positions[index]!,
});

function fakeEngine(init: () => Promise<void> = async () => undefined): Engine {
  return {
    name: 'fake',
    init,
    analyze: vi.fn(),
    newGame: vi.fn(async () => undefined),
    terminate: vi.fn(),
  };
}

/** Analyses every position immediately at the requested depth, like a very fast engine. */
async function analyseAll(_game: ParsedGame, options: AnalyzeGameOptions) {
  const results = positionsAt(options.settings.depth);
  results.forEach((analysis, index) => {
    options.onProgress?.({ done: index, total: results.length, currentDepth: 16 });
    options.onPosition?.(index, options.existing?.[index] ?? analysis);
  });
  return results.map((analysis, index) => options.existing?.[index] ?? analysis);
}

/** Verifies the requested positions immediately at the requested depth. */
async function verifyAll(_game: ParsedGame, options: AnalyzePositionsOptions) {
  const results = new Map<number, PositionAnalysis>();
  options.indices.forEach((index, done) => {
    const analysis = positionsAt(options.settings.depth)[index]!;
    results.set(index, analysis);
    options.onPosition?.(index, analysis);
    options.onProgress?.({ done: done + 1, total: options.indices.length });
  });
  return results;
}

/** Labels for the fake review, by ply. Ply 2 is a blunder unless a test says otherwise. */
let labels: Record<number, Classification> = {};

function fakeReview(
  analyses: (PositionAnalysis | null)[],
  engine: GameReview['engine'],
  accuracyModel: GameReview['accuracyModel'] = 'calibrated',
): GameReview {
  const moves: MoveReview[] = [];
  for (let ply = 1; analyses[ply - 1] && analyses[ply]; ply++) {
    const winLoss = labels[ply] === 'blunder' ? 30 : 0;
    moves.push({
      ply,
      color: ply % 2 ? 'w' : 'b',
      san: game.moves[ply - 1]!.san,
      uci: game.moves[ply - 1]!.uci,
      classification: labels[ply] ?? 'best',
      winBefore: 50,
      winAfter: 50 - winLoss,
      winLoss,
      accuracy: 100,
      evalAfter: null,
      whiteWinAfter: 50,
      explanation: '',
    });
  }
  const accuracy = accuracyModel === 'lichess' ? 95 : 90;
  const player = { accuracy, counts: {} as GameReview['white']['counts'] };
  return {
    version: 2,
    engine,
    accuracyModel,
    moves,
    white: player,
    black: player,
    whiteWinPercents: [],
    keyMoments: [],
  };
}

/** Cache contents by key; anything else is a miss. */
let cache: Record<string, CachedAnalyses> = {};

function wrapperFor(entry = `/review/${GAME_ID}`) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };
}

function renderReview(entry?: string) {
  return renderHook(() => useGameReview(GAME_ID), { wrapper: wrapperFor(entry) });
}

/** A promise with its resolve function, to hold a pass open while a test looks around. */
function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function quickCalls() {
  return vi
    .mocked(analyzeGame)
    .mock.calls.filter(([, options]) => options.settings.depth === QUICK_PASS.depth);
}

function fullCalls() {
  return vi
    .mocked(analyzeGame)
    .mock.calls.filter(([, options]) => options.settings.depth !== QUICK_PASS.depth);
}

beforeEach(() => {
  labels = { 2: 'blunder' };
  cache = {};
  useSettings.setState({ preset: 'standard', accuracyModel: 'calibrated' });
  setEngineFactoryForTests(() => fakeEngine());
  vi.mocked(resolveGame).mockResolvedValue(record);
  vi.mocked(parsePgn).mockReturnValue(game);
  vi.mocked(loadCachedAnalyses).mockImplementation(async (key) => cache[key] ?? null);
  vi.mocked(analyzeGame).mockImplementation(analyseAll);
  vi.mocked(analyzePositions).mockImplementation(verifyAll);
  vi.mocked(buildGameReview).mockImplementation((_game, analyses, options) =>
    fakeReview(analyses, options.engine, options.accuracyModel),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setEngineFactoryForTests(null);
});

describe('useGameReview', () => {
  it('runs a quick pass, the full pass and the verification, then saves to the library', async () => {
    const holdFull = deferred();
    const holdVerify = deferred();
    vi.mocked(analyzeGame).mockImplementation(async (g, options) => {
      if (options.settings.depth !== QUICK_PASS.depth) await holdFull.promise;
      return analyseAll(g, options);
    });
    vi.mocked(analyzePositions).mockImplementation(async (g, options) => {
      await holdVerify.promise;
      return verifyAll(g, options);
    });
    const phases: AnalysisPhase[] = [];
    const { result } = renderHook(
      () => {
        const state = useGameReview(GAME_ID);
        if (phases.at(-1) !== state.analysis.phase) phases.push(state.analysis.phase);
        return state;
      },
      { wrapper: wrapperFor() },
    );

    // Quick review ready: complete but provisional, while the full pass runs.
    await waitFor(() => expect(result.current.analysis.phase).toBe('full'));
    await waitFor(() => expect(result.current.review?.moves).toHaveLength(2));
    expect(result.current.analysis.status).toBe('running');
    expect(result.current.provisional).toBe(true);
    expect(result.current.analyses).toEqual(quickPositions);
    expect(result.current.reviewPreset).toMatchObject({ label: 'Quick', depth: QUICK_PASS.depth });
    expect(result.current.analysis.passes.quick).toEqual({ done: 3, total: 3 });
    expect(result.current.analysis.phaseDepth).toBe(16);
    expect(result.current.canAnalyseDeeper).toBe(false);
    expect(saveAnalyses).toHaveBeenCalledWith(QUICK_KEY, quickPositions, { refined: false });
    expect(saveToLibrary).not.toHaveBeenCalled();

    // Full pass done: the blunder at ply 2 is verified at depth 16 + 4.
    await act(async () => holdFull.resolve());
    await waitFor(() => expect(result.current.analysis.phase).toBe('refining'));
    expect(result.current.provisional).toBe(false);
    expect(result.current.analyses).toEqual(positions);
    expect(result.current.analysis.refineMoves).toBe(1);
    expect(result.current.analysis.passes.refining).toEqual({ done: 0, total: 2 });
    expect(result.current.analysis.phaseDepth).toBe(20);
    const verify = vi.mocked(analyzePositions).mock.calls[0]![1];
    expect(verify.indices).toEqual([1, 2]);
    expect(verify.settings).toEqual({ depth: 20, multiPv: 2, maxTimeMs: 8000 });

    await act(async () => holdVerify.resolve());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.analysis.phase).toBe('done');
    expect(result.current.analyses).toEqual([positions[0], checked(1), checked(2)]);
    expect(result.current.reviewPreset.id).toBe('standard');
    expect(result.current.canAnalyseDeeper).toBe(true);
    expect(phases).toEqual(['quick', 'full', 'refining', 'done']);
    expect(saveAnalyses).toHaveBeenLastCalledWith(
      FULL_KEY,
      [positions[0], checked(1), checked(2)],
      { refined: true },
    );
    expect(buildGameReview).toHaveBeenLastCalledWith(game, [positions[0], checked(1), checked(2)], {
      book: expect.anything(),
      engine: { name: ENGINE, depth: 16, multiPv: 2 },
      accuracyModel: 'calibrated',
    });

    await waitFor(() => expect(saveToLibrary).toHaveBeenCalledTimes(1));
    const entry = vi.mocked(saveToLibrary).mock.calls[0]![0];
    expect(entry).toMatchObject({ gameId: GAME_ID, engine: { depth: 16 }, record });
    expect(entry.moves.map((move) => move.classification)).toEqual(['best', 'blunder']);
    expect(entry.perspective).toBeUndefined();
  });

  it('holds a background insights job while its engine passes run', async () => {
    const holdFull = deferred();
    vi.mocked(analyzeGame).mockImplementation(async (g, options) => {
      if (options.settings.depth !== QUICK_PASS.depth) await holdFull.promise;
      return analyseAll(g, options);
    });
    const { result, unmount } = renderReview();
    await waitFor(() => expect(result.current.analysis.phase).toBe('full'));
    expect(holdInsightsJob).toHaveBeenCalledTimes(1);
    expect(releaseEngine).not.toHaveBeenCalled();
    await act(async () => holdFull.resolve());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(releaseEngine).toHaveBeenCalled();
    unmount();
  });

  it('releases the insights job when the review closes mid-analysis', async () => {
    vi.mocked(analyzeGame).mockImplementation(() => new Promise(() => undefined));
    const { result, unmount } = renderReview();
    await waitFor(() => expect(result.current.analysis.status).toBe('running'));
    expect(releaseEngine).not.toHaveBeenCalled();
    unmount();
    expect(releaseEngine).toHaveBeenCalled();
  });

  it('skips the quick pass and the verification when a verified analysis is cached', async () => {
    cache[FULL_KEY] = { analyses: positions, refined: true };
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(analyzeGame).not.toHaveBeenCalled();
    expect(analyzePositions).not.toHaveBeenCalled();
    expect(loadCachedAnalyses).not.toHaveBeenCalledWith(QUICK_KEY);
    expect(result.current.analysis.phase).toBe('done');
    expect(result.current.analysis.passes.quick).toBeNull();
    expect(result.current.provisional).toBe(false);
    expect(result.current.review?.moves).toHaveLength(2);
    // Revisiting a finished game keeps the library in step with the current rules.
    await waitFor(() => expect(saveToLibrary).toHaveBeenCalledTimes(1));
  });

  it('rebuilds the review on another accuracy scale without the engine, and saves it', async () => {
    cache[FULL_KEY] = { analyses: positions, refined: true };
    const { result } = renderReview();
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.review).toMatchObject({ accuracyModel: 'calibrated' });
    await waitFor(() => expect(saveToLibrary).toHaveBeenCalledTimes(1));
    const labelsBefore = result.current.review?.moves.map((move) => move.classification);

    act(() => useSettings.setState({ accuracyModel: 'lichess' }));
    await waitFor(() => expect(result.current.review?.accuracyModel).toBe('lichess'));
    expect(result.current.review?.white.accuracy).toBe(95);
    expect(result.current.review?.moves.map((move) => move.classification)).toEqual(labelsBefore);
    expect(analyzeGame).not.toHaveBeenCalled();
    expect(analyzePositions).not.toHaveBeenCalled();
    await waitFor(() => expect(saveToLibrary).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveToLibrary).mock.calls[1]![0]).toMatchObject({ accuracyModel: 'lichess' });
  });

  it('only verifies a cached full analysis that was never verified', async () => {
    cache[FULL_KEY] = { analyses: positions, refined: false };
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(analyzeGame).not.toHaveBeenCalled();
    expect(analyzePositions).toHaveBeenCalledTimes(1);
    expect(result.current.analysis.passes.quick).toBeNull();
    expect(saveAnalyses).toHaveBeenLastCalledWith(FULL_KEY, expect.any(Array), { refined: true });
  });

  it('marks the analysis verified even when no move needs checking', async () => {
    labels = {};
    cache[FULL_KEY] = { analyses: positions, refined: false };
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(analyzePositions).not.toHaveBeenCalled();
    expect(saveAnalyses).toHaveBeenLastCalledWith(FULL_KEY, positions, { refined: true });
  });

  it('reuses a cached quick pass and only runs the full pass', async () => {
    cache[QUICK_KEY] = { analyses: quickPositions, refined: false };
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(quickCalls()).toHaveLength(0);
    expect(fullCalls()).toHaveLength(1);
    expect(result.current.analysis.passes.quick).toEqual({ done: 3, total: 3 });
  });

  it('gives the quick pass only the positions the full pass has not reached', async () => {
    cache[FULL_KEY] = { analyses: [positions[0]!, null], refined: false };
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    const quick = quickCalls()[0]![1];
    expect(quick.existing).toEqual([positions[0], null, null]);
    // Only the new quick results are cached under the quick key.
    expect(saveAnalyses).toHaveBeenCalledWith(
      QUICK_KEY,
      [null, quickPositions[1], quickPositions[2]],
      { refined: false },
    );
    expect(fullCalls()[0]![1].existing).toEqual([positions[0], null]);
  });

  it('prefers a complete deeper analysis from an earlier visit', async () => {
    cache[`${GAME_ID}|${ENGINE}|20`] = { analyses: positions, refined: true };
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.analysis.preset.id).toBe('deep');
    expect(result.current.canAnalyseDeeper).toBe(false);
    expect(analyzeGame).not.toHaveBeenCalled();
  });

  it('shows a complete shallower analysis instead of a quick pass while the preset runs', async () => {
    cache[`${GAME_ID}|${ENGINE}|12`] = { analyses: positionsAt(12), refined: true };
    const holdFull = deferred();
    vi.mocked(analyzeGame).mockImplementation(async (g, options) => {
      await holdFull.promise;
      return analyseAll(g, options);
    });
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('running'));
    await waitFor(() => expect(result.current.showingPreviousAnalysis).toBe(true));
    expect(result.current.reviewPreset.id).toBe('fast');
    expect(result.current.analysis.passes.quick).toBeNull();
    expect(quickCalls()).toHaveLength(0);

    await act(async () => holdFull.resolve());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.showingPreviousAnalysis).toBe(false);
    expect(result.current.reviewPreset.id).toBe('standard');
  });

  it('passes engine progress on at a calm pace, ending with the latest', async () => {
    cache[QUICK_KEY] = { analyses: quickPositions, refined: false };
    const holdFull = deferred();
    vi.mocked(analyzeGame).mockImplementationOnce(async (g, options) => {
      // Like a search reporting every depth, each in its own worker message.
      for (let depth = 1; depth <= 20; depth++) {
        options.onProgress?.({ done: 1, total: 3, currentDepth: depth });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await holdFull.promise;
      return analyseAll(g, options);
    });
    const depths: number[] = [];
    const { result } = renderHook(
      () => {
        const state = useGameReview(GAME_ID);
        const depth = state.analysis.progress?.currentDepth;
        if (depth !== undefined && depths.at(-1) !== depth) depths.push(depth);
        return state;
      },
      { wrapper: wrapperFor() },
    );

    await waitFor(() => expect(result.current.analysis.progress?.currentDepth).toBe(20));
    expect(result.current.analysis.passes.full).toEqual({ done: 1, total: 3 });
    // Every update would re-render the review screen; most of the burst is skipped.
    expect(depths.length).toBeLessThanOrEqual(5);
    await act(async () => holdFull.resolve());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
  });

  it('stops and resumes the full pass, keeping finished positions', async () => {
    cache[QUICK_KEY] = { analyses: quickPositions, refined: false };
    vi.mocked(analyzeGame).mockImplementationOnce(
      (_game, { onPosition, signal }) =>
        new Promise((_resolve, reject) => {
          onPosition?.(0, positions[0]!);
          onPosition?.(1, positions[1]!);
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const { result } = renderReview();
    await waitFor(() => expect(result.current.analysis.status).toBe('running'));

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.analysis.status).toBe('paused'));
    expect(result.current.analysis.phase).toBe('full');
    expect(saveAnalyses).toHaveBeenCalledWith(FULL_KEY, [positions[0], positions[1]], {
      refined: false,
    });
    // The paused run restores the finished positions (from memory) right after stopping,
    // with the quick pass filling in the rest.
    await waitFor(() =>
      expect(result.current.analyses).toEqual([positions[0], positions[1], quickPositions[2]]),
    );
    expect(result.current.provisional).toBe(true);

    act(() => result.current.resume());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(fullCalls()[1]![1].existing).toEqual([positions[0], positions[1]]);
  });

  it('stops during verification and resumes it, re-checking only what is left', async () => {
    cache[FULL_KEY] = { analyses: positions, refined: false };
    labels = { 1: 'blunder', 2: 'blunder' };
    vi.mocked(analyzePositions).mockImplementationOnce(
      (_game, { onPosition, signal }) =>
        new Promise((_resolve, reject) => {
          onPosition?.(0, verified[0]!);
          onPosition?.(1, verified[1]!);
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const { result } = renderReview();
    await waitFor(() => expect(result.current.analysis.phase).toBe('refining'));
    await waitFor(() => expect(analyzePositions).toHaveBeenCalledTimes(1));
    expect(vi.mocked(analyzePositions).mock.calls[0]![1].indices).toEqual([0, 1, 2]);

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.analysis.status).toBe('paused'));
    expect(result.current.analysis.phase).toBe('refining');

    act(() => result.current.resume());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    // Move 1 (positions 0 and 1) was verified before the stop.
    expect(vi.mocked(analyzePositions).mock.calls[1]![1].indices).toEqual([2]);
    expect(result.current.analyses).toEqual([checked(0), checked(1), checked(2)]);
  });

  it('never shows a move with only one of its positions verified', async () => {
    cache[FULL_KEY] = { analyses: positions, refined: false };
    labels = { 2: 'blunder' };
    const holdVerify = deferred();
    vi.mocked(analyzePositions).mockImplementationOnce(async (_game, { onPosition }) => {
      onPosition?.(1, verified[1]!);
      await holdVerify.promise;
      onPosition?.(2, verified[2]!);
      return new Map();
    });
    const { result } = renderReview();
    await waitFor(() => expect(result.current.analysis.phase).toBe('refining'));
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(result.current.analyses).toEqual(positions);

    await act(async () => holdVerify.resolve());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.analyses).toEqual([positions[0], checked(1), checked(2)]);
  });

  it('keeps an analysis when its verification stopped at a lower depth', async () => {
    cache[FULL_KEY] = { analyses: positions, refined: false };
    vi.mocked(analyzePositions).mockImplementationOnce(async (_game, { onPosition }) => {
      onPosition?.(1, positionsAt(14)[1]!);
      onPosition?.(2, verified[2]!);
      return new Map();
    });
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.analyses).toEqual([positions[0], positions[1], checked(2)]);
  });

  it('keeps the previous review visible while analysing deeper, then saves the deeper one', async () => {
    const { result } = renderReview();
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    await waitFor(() => expect(saveToLibrary).toHaveBeenCalledTimes(1));

    const holdDeep = deferred();
    vi.mocked(analyzeGame).mockImplementationOnce(async (g, options) => {
      await holdDeep.promise;
      return analyseAll(g, options);
    });
    act(() => result.current.analyseDeeper());

    await waitFor(() => expect(result.current.analysis.status).toBe('running'));
    expect(result.current.analysis.preset.id).toBe('deep');
    expect(result.current.analysis.passes.quick).toBeNull();
    expect(result.current.showingPreviousAnalysis).toBe(true);
    expect(result.current.review?.moves).toHaveLength(2);
    // The numbers on screen still come from the earlier preset.
    expect(result.current.reviewPreset.id).not.toBe('deep');

    await act(async () => holdDeep.resolve());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.showingPreviousAnalysis).toBe(false);
    expect(result.current.reviewPreset.id).toBe('deep');
    // Verified at 20 + 2 for the deep preset.
    expect(vi.mocked(analyzePositions).mock.lastCall![1].settings.depth).toBe(22);
    await waitFor(() => expect(saveToLibrary).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveToLibrary).mock.lastCall![0].engine.depth).toBe(20);
  });

  it('reports an engine that cannot start', async () => {
    setEngineFactoryForTests(() => fakeEngine(() => Promise.reject(new Error('no wasm'))));
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('engine-error'));
    expect(result.current.analysis.message).toBe(ENGINE_START_ERROR);
  });

  it('reports a failed analysis and can retry it', async () => {
    vi.mocked(analyzeGame).mockRejectedValueOnce(new Error('worker crashed'));
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('failed'));
    expect(result.current.analysis.message).toBe('worker crashed');
    expect(result.current.analysis.phase).toBe('quick');

    act(() => result.current.resume());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
  });

  it('refuses variants', async () => {
    vi.mocked(resolveGame).mockResolvedValue({ ...record, variant: 'chess960' });
    const { result } = renderReview();

    await waitFor(() => expect(result.current.load.status).toBe('error'));
    const { load } = result.current;
    expect(load.status === 'error' && load.error.kind).toBe('variant');
    expect(analyzeGame).not.toHaveBeenCalled();
  });

  it('explains a missing game and retries on request', async () => {
    vi.mocked(resolveGame).mockRejectedValueOnce(new NotFoundError('404'));
    const { result } = renderReview();

    await waitFor(() => expect(result.current.load.status).toBe('error'));
    const { load } = result.current;
    expect(load.status === 'error' && load.error.kind).toBe('not-found');

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(resolveGame).toHaveBeenCalledTimes(2);
  });
});

describe('useGameReview perspective', () => {
  it('reads ?as=<username>, case-insensitively, and saves it with the review', async () => {
    const { result } = renderReview(`/review/${GAME_ID}?as=BOB`);

    await waitFor(() => expect(result.current.load.status).toBe('ready'));
    expect(result.current.perspective).toEqual({
      platform: 'lichess',
      username: 'bob',
      color: 'b',
    });
    await waitFor(() => expect(saveToLibrary).toHaveBeenCalled());
    expect(vi.mocked(saveToLibrary).mock.lastCall![0].perspective).toEqual({
      platform: 'lichess',
      username: 'bob',
      color: 'b',
    });
  });

  it('is null when nobody in the game is named', async () => {
    const { result } = renderReview(`/review/${GAME_ID}?as=carol`);
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.perspective).toBeNull();
  });

  it('keeps the perspective a stored entry already has', async () => {
    const stored = {
      gameId: GAME_ID,
      engine: { name: ENGINE, depth: 16, multiPv: 2 },
      reviewedAt: 123,
      perspective: { platform: 'lichess', username: 'alice', color: 'w' },
    } as LibraryEntry;
    vi.mocked(getLibraryEntry).mockResolvedValue(stored);
    const { result } = renderReview();

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    await waitFor(() => expect(saveToLibrary).toHaveBeenCalled());
    expect(vi.mocked(saveToLibrary).mock.lastCall![0]).toMatchObject({
      perspective: stored.perspective,
      reviewedAt: 123,
    });
  });

  it('swallows library errors', async () => {
    vi.mocked(getLibraryEntry).mockRejectedValue(new Error('quota'));
    const { result } = renderReview();
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    await waitFor(() => expect(getLibraryEntry).toHaveBeenCalled());
    expect(saveToLibrary).not.toHaveBeenCalled();
  });
});
