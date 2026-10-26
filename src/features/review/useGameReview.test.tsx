// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type {
  AnalysisSettings,
  GameRecord,
  GameReview,
  ParsedGame,
  PositionAnalysis,
} from '@/core/types';
import type { AnalyzeGameOptions } from '@/engine/analyzeGame';
import type { Engine } from '@/engine/stockfish';
import { NotFoundError } from '@/sources/http';
import { useSettings } from '@/state/settings';
import { setEngineFactoryForTests } from './engine';
import { ENGINE_START_ERROR, useGameReview } from './useGameReview';

// The hook is tested against fakes of everything it orchestrates, so these tests
// cover the data flow (load → cache → engine → review) and not the chess logic.
vi.mock('@/sources/resolveGame', () => ({ resolveGame: vi.fn() }));
vi.mock('@/core/pgn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/pgn')>()),
  parsePgn: vi.fn(),
}));
vi.mock('@/core/openings', () => ({
  loadOpeningBook: vi.fn(async () => ({ has: () => false, lookup: () => null })),
}));
vi.mock('@/core/review', () => ({ buildGameReview: vi.fn() }));
vi.mock('@/engine/analyzeGame', () => ({ analyzeGame: vi.fn() }));
vi.mock('@/engine/cache', () => ({
  analysisCacheKey: (id: string, engine: string, s: AnalysisSettings) =>
    `${id}|${engine}|${s.depth}`,
  loadAnalyses: vi.fn(),
  saveAnalyses: vi.fn(async () => undefined),
}));

const { resolveGame } = await import('@/sources/resolveGame');
const { parsePgn } = await import('@/core/pgn');
const { buildGameReview } = await import('@/core/review');
const { analyzeGame } = await import('@/engine/analyzeGame');
const { loadAnalyses, saveAnalyses } = await import('@/engine/cache');

const GAME_ID = 'lichess/abcd1234';
const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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

const positions: PositionAnalysis[] = [10, 20, 30].map((cp) => ({
  fen: FEN,
  depth: 16,
  lines: [{ pv: ['e2e4'], score: { type: 'cp', value: cp }, depth: 16 }],
}));

function fakeEngine(init: () => Promise<void> = async () => undefined): Engine {
  return {
    name: 'fake',
    init,
    analyze: vi.fn(),
    newGame: vi.fn(async () => undefined),
    terminate: vi.fn(),
  };
}

/** Analyses every position immediately, like a very fast engine. */
async function analyseAll(_game: ParsedGame, options: AnalyzeGameOptions) {
  positions.forEach((analysis, index) => {
    options.onProgress?.({ done: index, total: positions.length, currentDepth: 16 });
    options.onPosition?.(index, analysis);
  });
  return positions;
}

beforeEach(() => {
  useSettings.setState({ preset: 'standard' });
  setEngineFactoryForTests(() => fakeEngine());
  vi.mocked(resolveGame).mockResolvedValue(record);
  vi.mocked(parsePgn).mockReturnValue(game);
  vi.mocked(loadAnalyses).mockResolvedValue(null);
  vi.mocked(analyzeGame).mockImplementation(analyseAll);
  vi.mocked(buildGameReview).mockImplementation(
    (_game, analyses) =>
      ({ moves: analyses.slice(1).filter(Boolean), keyMoments: [] }) as unknown as GameReview,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setEngineFactoryForTests(null);
});

describe('useGameReview', () => {
  it('loads the game, analyses it and builds the review', async () => {
    const { result } = renderHook(() => useGameReview(GAME_ID));

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.load.status).toBe('ready');
    expect(result.current.analyses).toEqual(positions);
    expect(result.current.review?.moves).toHaveLength(2);
    expect(result.current.analysis.preset.id).toBe('standard');
    expect(result.current.canAnalyseDeeper).toBe(true);
    expect(saveAnalyses).toHaveBeenLastCalledWith(`${GAME_ID}|Stockfish 19 lite|16`, positions);
    expect(buildGameReview).toHaveBeenLastCalledWith(game, positions, {
      book: expect.anything(),
      engine: { name: 'Stockfish 19 lite', depth: 16, multiPv: 2 },
    });
  });

  it('uses a complete cache without starting the engine', async () => {
    vi.mocked(loadAnalyses).mockResolvedValue(positions);
    const { result } = renderHook(() => useGameReview(GAME_ID));

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(analyzeGame).not.toHaveBeenCalled();
    expect(result.current.review?.moves).toHaveLength(2);
  });

  it('prefers a complete deeper analysis from an earlier visit', async () => {
    vi.mocked(loadAnalyses).mockImplementation(async (key) =>
      key.endsWith('|20') ? positions : null,
    );
    const { result } = renderHook(() => useGameReview(GAME_ID));

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.analysis.preset.id).toBe('deep');
    expect(result.current.canAnalyseDeeper).toBe(false);
    expect(analyzeGame).not.toHaveBeenCalled();
  });

  it('passes partial cached results to the engine so it resumes', async () => {
    vi.mocked(loadAnalyses).mockResolvedValue([positions[0]!, null]);
    const { result } = renderHook(() => useGameReview(GAME_ID));

    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(vi.mocked(analyzeGame).mock.calls[0]![1].existing).toEqual([positions[0], null]);
  });

  it('stops and resumes, keeping finished positions', async () => {
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
    const { result } = renderHook(() => useGameReview(GAME_ID));
    await waitFor(() => expect(result.current.analysis.status).toBe('running'));

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.analysis.status).toBe('paused'));
    expect(saveAnalyses).toHaveBeenCalledWith(expect.any(String), [positions[0], positions[1]]);
    // The paused run restores the finished positions (from memory) right after stopping.
    await waitFor(() => expect(result.current.analyses).toEqual([positions[0], positions[1]]));

    act(() => result.current.resume());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(vi.mocked(analyzeGame).mock.calls[1]![1].existing).toEqual([positions[0], positions[1]]);
  });

  it('keeps the previous review visible while analysing deeper', async () => {
    const { result } = renderHook(() => useGameReview(GAME_ID));
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));

    let finishDeep: () => void = () => undefined;
    vi.mocked(analyzeGame).mockImplementationOnce(
      (_game, options) =>
        new Promise((resolve) => {
          finishDeep = () => resolve(analyseAll(_game, options));
        }),
    );
    act(() => result.current.analyseDeeper());

    await waitFor(() => expect(result.current.analysis.status).toBe('running'));
    expect(result.current.analysis.preset.id).toBe('deep');
    expect(result.current.showingPreviousAnalysis).toBe(true);
    expect(result.current.review?.moves).toHaveLength(2);
    // The numbers on screen still come from the earlier preset.
    expect(result.current.reviewPreset.id).not.toBe('deep');

    await act(async () => finishDeep());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(result.current.showingPreviousAnalysis).toBe(false);
    expect(result.current.reviewPreset.id).toBe('deep');
  });

  it('reports an engine that cannot start', async () => {
    setEngineFactoryForTests(() => fakeEngine(() => Promise.reject(new Error('no wasm'))));
    const { result } = renderHook(() => useGameReview(GAME_ID));

    await waitFor(() => expect(result.current.analysis.status).toBe('engine-error'));
    expect(result.current.analysis.message).toBe(ENGINE_START_ERROR);
  });

  it('reports a failed analysis and can retry it', async () => {
    vi.mocked(analyzeGame).mockRejectedValueOnce(new Error('worker crashed'));
    const { result } = renderHook(() => useGameReview(GAME_ID));

    await waitFor(() => expect(result.current.analysis.status).toBe('failed'));
    expect(result.current.analysis.message).toBe('worker crashed');

    act(() => result.current.resume());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
  });

  it('refuses variants', async () => {
    vi.mocked(resolveGame).mockResolvedValue({ ...record, variant: 'chess960' });
    const { result } = renderHook(() => useGameReview(GAME_ID));

    await waitFor(() => expect(result.current.load.status).toBe('error'));
    const { load } = result.current;
    expect(load.status === 'error' && load.error.kind).toBe('variant');
    expect(analyzeGame).not.toHaveBeenCalled();
  });

  it('explains a missing game and retries on request', async () => {
    vi.mocked(resolveGame).mockRejectedValueOnce(new NotFoundError('404'));
    const { result } = renderHook(() => useGameReview(GAME_ID));

    await waitFor(() => expect(result.current.load.status).toBe('error'));
    const { load } = result.current;
    expect(load.status === 'error' && load.error.kind).toBe('not-found');

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.analysis.status).toBe('done'));
    expect(resolveGame).toHaveBeenCalledTimes(2);
  });
});
