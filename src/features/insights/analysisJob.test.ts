import { Chess } from 'chess.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccuracyModel } from '@/core/accuracyModel';
import type { GameRecord, PositionAnalysis } from '@/core/types';
import type { AnalyzeRequest, Engine } from '@/engine/stockfish';
import {
  analysisCacheKey,
  clearAnalysisCache,
  loadAnalyses,
  loadCachedAnalyses,
} from '@/engine/cache';
import { PRESETS } from '@/engine/presets';
import { ENGINE_NAME } from '@/engine/stockfish';
import { setEngineFactoryForTests } from '@/features/review/engine';
import {
  clearLibrary,
  getLibraryEntry,
  getPlayerEntries,
  saveToLibrary,
  type LibraryEntry,
} from '@/library/library';
import {
  cancelInsightsJob,
  emptyTiming,
  estimateRemainingMs,
  getInsightsJob,
  holdInsightsJob,
  jobFraction,
  jobLanes,
  resetInsightsJobForTests,
  setJobLanesForTests,
  startInsightsJob,
  subscribeInsightsJob,
  type JobPhase,
  type InsightsJob,
} from './analysisJob';

// The job runs the real pipeline (analyzeGame, buildGameReview, opening book, library and
// analysis cache in fake-indexeddb) against a fake engine that answers instantly.

const PGNS = [
  '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0',
  '1. d4 d5 2. c4 e6 3. Nc3 Nf6 0-1',
  '1. c4 e5 2. g3 Nf6 3. Bg2 d5 1/2-1/2',
];

function record(index: number, pgn = PGNS[index]!): GameRecord {
  const result = pgn.split(' ').at(-1) as GameRecord['result'];
  const asWhite = index % 2 === 0;
  return {
    id: `lichess/game000${index}`,
    source: 'lichess',
    white: { name: asWhite ? 'DrNykterstein' : `opponent${index}` },
    black: { name: asWhite ? `opponent${index}` : 'DrNykterstein' },
    result,
    timeClass: 'blitz',
    variant: 'standard',
    endTime: 1_000 * (10 - index),
    pgn: `[White "w"]\n[Black "b"]\n[Result "${result}"]\n\n${pgn}`,
  };
}

interface FakeEngine extends Engine {
  /** Every search, in order. */
  searches: { fen: string; depth: number }[];
}

interface FakeOptions {
  /** Can hold a search back. */
  gate?: (request: AnalyzeRequest) => Promise<void>;
  /** Evaluation of the best line in centipawns, White's point of view (default 0). */
  score?: (request: AnalyzeRequest) => number;
}

/**
 * Answers every search with the first legal moves: the best line scores `score`, each
 * further line 40 centipawns worse for the side to move.
 */
function fakeEngine({ gate, score }: FakeOptions = {}): FakeEngine {
  const searches: FakeEngine['searches'] = [];
  return {
    name: 'fake',
    searches,
    init: async () => undefined,
    newGame: async () => undefined,
    terminate: () => undefined,
    async analyze(request): Promise<PositionAnalysis> {
      searches.push({ fen: request.fen, depth: request.depth });
      await gate?.(request);
      if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const chess = new Chess(request.fen);
      const worse = chess.turn() === 'w' ? -40 : 40;
      const best = score?.(request) ?? 0;
      const moves = chess.moves({ verbose: true }).slice(0, request.multiPv);
      return {
        fen: request.fen,
        depth: request.depth,
        lines: moves.map((move, i) => ({
          pv: [move.lan],
          score: { type: 'cp', value: best + i * worse },
          depth: request.depth,
        })),
      };
    },
  };
}

/** Searches of the fast preset's full pass (verification searches go deeper). */
const fullSearches = (engine: FakeEngine) =>
  engine.searches.filter((search) => search.depth === PRESETS.fast.depth);
const verifySearches = (engine: FakeEngine) =>
  engine.searches.filter((search) => search.depth > PRESETS.fast.depth);

function waitForJob(predicate: (job: InsightsJob) => boolean): Promise<InsightsJob> {
  return new Promise((resolve) => {
    const check = () => {
      const job = getInsightsJob();
      if (job && predicate(job)) {
        unsubscribe();
        resolve(job);
      }
    };
    const unsubscribe = subscribeInsightsJob(check);
    check();
  });
}

const finished = (job: InsightsJob) => ['done', 'cancelled', 'failed'].includes(job.status);
const start = (records: GameRecord[], accuracyModel: AccuracyModel = 'calibrated') =>
  startInsightsJob({
    platform: 'lichess',
    username: 'drnykterstein',
    records,
    presetId: 'fast',
    accuracyModel,
  });

beforeEach(async () => {
  resetInsightsJobForTests();
  await clearLibrary();
  await clearAnalysisCache();
});

afterEach(() => {
  resetInsightsJobForTests();
  setEngineFactoryForTests(null);
});

describe('insights analysis job', () => {
  it('reviews each game in turn and saves it with the player’s perspective', async () => {
    const engine = fakeEngine();
    setEngineFactoryForTests(() => engine);
    expect(start([record(0), record(1)])).toBe(true);
    const job = await waitForJob(finished);
    expect(job).toMatchObject({ status: 'done', selected: 2, queued: 2, analysed: 2, skipped: 0 });
    expect(job.failures).toEqual([]);
    // 7 positions per game (6 moves + start); book moves leave nothing to verify.
    expect(fullSearches(engine)).toHaveLength(14);
    expect(verifySearches(engine)).toHaveLength(0);
    const key = analysisCacheKey('lichess/game0000', ENGINE_NAME, PRESETS.fast);
    expect((await loadCachedAnalyses(key))?.refined).toBe(true);

    const first = await getLibraryEntry('lichess/game0000');
    expect(first?.perspective).toEqual({
      platform: 'lichess',
      username: 'drnykterstein',
      color: 'w',
    });
    expect(first?.moves).toHaveLength(6);
    expect(first?.opening?.name).toMatch(/Ruy Lopez/);
    const second = await getLibraryEntry('lichess/game0001');
    expect(second?.perspective?.color).toBe('b');
    expect(await getPlayerEntries('lichess', 'DrNykterstein')).toHaveLength(2);
  });

  it('skips games already in the library and adds a missing perspective', async () => {
    const engine = fakeEngine();
    setEngineFactoryForTests(() => engine);
    start([record(0)]);
    await waitForJob(finished);
    const saved = (await getLibraryEntry('lichess/game0000'))!;
    const { perspective: _perspective, ...withoutPerspective } = saved;
    await saveToLibrary(withoutPerspective as LibraryEntry);
    engine.searches.length = 0;

    start([record(0), record(2)]);
    const job = await waitForJob(finished);
    expect(job).toMatchObject({ status: 'done', selected: 2, queued: 1, skipped: 1, analysed: 1 });
    expect(fullSearches(engine)).toHaveLength(7);
    expect((await getLibraryEntry('lichess/game0000'))?.perspective?.username).toBe(
      'drnykterstein',
    );
  });

  it('reviews games again when their accuracies are on another scale', async () => {
    // White keeps a small edge, so the two scales give different accuracies.
    const engine = fakeEngine({ score: (request) => (request.fen.includes(' w ') ? 60 : 20) });
    setEngineFactoryForTests(() => engine);
    start([record(0)]);
    await waitForJob(finished);
    const calibrated = (await getLibraryEntry('lichess/game0000'))!;
    expect(calibrated.accuracyModel).toBe('calibrated');
    engine.searches.length = 0;

    start([record(0)], 'lichess');
    const job = await waitForJob(finished);
    expect(job).toMatchObject({ status: 'done', queued: 1, skipped: 0, analysed: 1 });
    // Rebuilt from the analysis cache: no new searches.
    expect(engine.searches).toHaveLength(0);
    const lichess = (await getLibraryEntry('lichess/game0000'))!;
    expect(lichess.accuracyModel).toBe('lichess');
    expect(lichess.white.accuracy).not.toBe(calibrated.white.accuracy);
    expect(lichess.moves.map((move) => move.classification)).toEqual(
      calibrated.moves.map((move) => move.classification),
    );

    start([record(0)], 'lichess');
    expect(await waitForJob(finished)).toMatchObject({ queued: 0, skipped: 1 });
  });

  it('can be cancelled and resumes from the analysis cache', async () => {
    let release: (() => void) | null = null;
    let held = false;
    const engine = fakeEngine({
      gate: async () => {
        // Hold the 6th search of the run until the test cancels.
        if (engine.searches.length === 6 && !held) {
          held = true;
          await new Promise<void>((resolve) => (release = resolve));
        }
      },
    });
    setEngineFactoryForTests(() => engine);
    start([record(0)]);
    await waitForJob((job) => job.status === 'running' && held);
    // A second job cannot start while one runs.
    expect(start([record(1)])).toBe(false);
    cancelInsightsJob();
    expect(getInsightsJob()?.stopping).toBe(true);
    release!();
    const cancelled = await waitForJob(finished);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.analysed).toBe(0);
    expect(await getLibraryEntry('lichess/game0000')).toBeNull();
    const key = analysisCacheKey('lichess/game0000', ENGINE_NAME, PRESETS.fast);
    expect((await loadAnalyses(key))?.filter(Boolean)).toHaveLength(5);

    engine.searches.length = 0;
    start([record(0)]);
    const done = await waitForJob(finished);
    expect(done).toMatchObject({ status: 'done', analysed: 1 });
    // Only the two positions that were not cached yet are searched again.
    expect(fullSearches(engine)).toHaveLength(2);
  });

  it('reports unreadable games and carries on', async () => {
    setEngineFactoryForTests(() => fakeEngine());
    start([record(0, '1. e4 e5 2. Qxf7 1-0'), record(1)]);
    const job = await waitForJob(finished);
    expect(job.status).toBe('done');
    expect(job.analysed).toBe(1);
    expect(job.failures).toHaveLength(1);
    expect(job.failures[0]).toMatchObject({ gameId: 'lichess/game0000', label: 'vs opponent0' });
  });

  it('fails cleanly when the engine cannot start', async () => {
    setEngineFactoryForTests(() => ({
      ...fakeEngine(),
      init: () => Promise.reject(new Error('no wasm')),
    }));
    start([record(0)]);
    const job = await waitForJob(finished);
    expect(job.status).toBe('failed');
    expect(job.message).toMatch(/engine/);
  });

  // 2.Ke2 is still book; 3.Kd3 is not, so a shallow search can call it a blunder.
  const KING_WALK = '1. e4 e5 2. Ke2 Ke7 3. Kd3 Kd6 1/2-1/2';
  const afterKd3 = (() => {
    const chess = new Chess();
    for (const san of ['e4', 'e5', 'Ke2', 'Ke7', 'Kd3']) chess.move(san);
    return chess.fen();
  })();
  const ply5 = async () =>
    (await getLibraryEntry('lichess/game0000'))?.moves.find((move) => move.ply === 5);

  it('re-checks a blunder with a deeper search before saving the review', async () => {
    // The shallow search thinks 3.Kd3 loses; the deeper one sees that it does not.
    const engine = fakeEngine({
      score: (request) =>
        request.fen === afterKd3 && request.depth === PRESETS.fast.depth ? -600 : 0,
    });
    setEngineFactoryForTests(() => engine);
    start([record(0, KING_WALK)]);
    expect(await waitForJob(finished)).toMatchObject({ status: 'done', analysed: 1 });

    expect(verifySearches(engine).map((search) => search.fen)).toContain(afterKd3);
    expect((await ply5())?.classification).not.toBe('blunder');
    const key = analysisCacheKey('lichess/game0000', ENGINE_NAME, PRESETS.fast);
    const cached = await loadCachedAnalyses(key);
    expect(cached?.refined).toBe(true);
    expect(cached?.analyses[5]?.depth).toBeGreaterThan(PRESETS.fast.depth);
  });

  it('keeps a blunder the deeper search confirms', async () => {
    const engine = fakeEngine({ score: (request) => (request.fen === afterKd3 ? -600 : 0) });
    setEngineFactoryForTests(() => engine);
    start([record(0, KING_WALK)]);
    await waitForJob(finished);
    expect(verifySearches(engine).length).toBeGreaterThan(0);
    expect((await ply5())?.classification).toBe('blunder');
  });

  it('pauses while the engine is held elsewhere and continues on release', async () => {
    const engine = fakeEngine();
    setEngineFactoryForTests(() => engine);
    const release = holdInsightsJob();
    start([record(0)]);
    await waitForJob((job) => job.status === 'running');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getInsightsJob()?.paused).toBe(true);
    expect(engine.searches).toHaveLength(0);

    release();
    release(); // Releasing twice is harmless.
    const job = await waitForJob(finished);
    expect(job).toMatchObject({ status: 'done', analysed: 1, paused: false });
    expect(fullSearches(engine)).toHaveLength(7);
  });

  it('can be cancelled while paused', async () => {
    setEngineFactoryForTests(() => fakeEngine());
    const release = holdInsightsJob();
    start([record(0)]);
    await waitForJob((job) => job.status === 'running');
    cancelInsightsJob();
    expect((await waitForJob(finished)).status).toBe('cancelled');
    release();
  });

  it('skips a game that was reviewed elsewhere while the job ran', async () => {
    setEngineFactoryForTests(() => fakeEngine());
    start([record(2)]);
    await waitForJob(finished);
    const { perspective: _perspective, ...reviewed } = (await getLibraryEntry('lichess/game0002'))!;
    await clearLibrary();

    let saved = false;
    const engine = fakeEngine({
      gate: async () => {
        // The review screen finishes game 2 while the job is busy with game 0.
        if (!saved) {
          saved = true;
          await saveToLibrary(reviewed);
        }
      },
    });
    setEngineFactoryForTests(() => engine);
    start([record(0), record(2)]);
    const job = await waitForJob(finished);
    expect(job).toMatchObject({ status: 'done', queued: 2, analysed: 1, skipped: 1 });
    expect(fullSearches(engine)).toHaveLength(7);
    // The job still records whose game it is.
    expect((await getLibraryEntry('lichess/game0002'))?.perspective?.color).toBe('w');
  });

  it('shares each game between the engines and stops the extra ones afterwards', async () => {
    setJobLanesForTests(3);
    const engines: FakeEngine[] = [];
    let terminated = 0;
    setEngineFactoryForTests(() => {
      const engine = { ...fakeEngine(), terminate: () => void (terminated += 1) };
      engines.push(engine);
      return engine;
    });
    // The progress line's number and opponent always belong to the same game.
    const mismatches: string[] = [];
    const unsubscribe = subscribeInsightsJob(() => {
      const state = getInsightsJob();
      if (state?.current && state.current.gameId !== `lichess/game000${state.gameNumber - 1}`) {
        mismatches.push(`${state.gameNumber}: ${state.current.gameId}`);
      }
    });
    start([record(0), record(1), record(2)]);
    const job = await waitForJob(finished);
    unsubscribe();
    expect(mismatches).toEqual([]);
    expect(job).toMatchObject({ status: 'done', queued: 3, analysed: 3, finished: 3 });
    expect(job.active).toEqual([]);
    // The shared engine and two extra ones split the positions: each searched once.
    expect(engines).toHaveLength(3);
    const counts = engines.map((engine) => fullSearches(engine).length);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(21);
    expect(counts.filter((count) => count > 0).length).toBeGreaterThan(1);
    // The extra engines are stopped; the shared one stays for the review screen.
    expect(terminated).toBe(2);
    expect(await getPlayerEntries('lichess', 'DrNykterstein')).toHaveLength(3);
  });

  it('gives the same review on several engines as on one', async () => {
    // A longer game, so every engine gets positions; the deeper re-check also runs.
    const pgn =
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 8. O-O ' +
      'Bxc3 9. bxc3 d5 10. Ba3 dxc4 11. Re1 Be6 12. Rxe4 Qd5 1/2-1/2';
    const score = (request: AnalyzeRequest) =>
      request.depth === PRESETS.fast.depth && request.fen.includes(' b ') ? -300 : 0;
    const reviewOn = async (lanes: number) => {
      await clearLibrary();
      await clearAnalysisCache();
      resetInsightsJobForTests();
      setJobLanesForTests(lanes);
      const engines: FakeEngine[] = [];
      setEngineFactoryForTests(() => {
        const engine = fakeEngine({ score });
        engines.push(engine);
        return engine;
      });
      start([record(0, pgn)]);
      expect(await waitForJob(finished)).toMatchObject({ status: 'done', analysed: 1 });
      return { entry: (await getLibraryEntry('lichess/game0000'))!, engines };
    };
    const one = await reviewOn(1);
    const four = await reviewOn(4);
    expect(four.engines).toHaveLength(4);
    expect(four.engines.every((engine) => engine.searches.length > 0)).toBe(true);
    expect(verifySearches(one.engines[0]!).length).toBeGreaterThan(0);
    expect(four.entry.moves).toEqual(one.entry.moves);
    expect(four.entry.white.accuracy).toBe(one.entry.white.accuracy);
    expect(four.entry.black.accuracy).toBe(one.entry.black.accuracy);
  });

  it('carries on with fewer engines when an extra one cannot start', async () => {
    setJobLanesForTests(3);
    const shared = fakeEngine();
    let created = 0;
    setEngineFactoryForTests(() => {
      created += 1;
      return created === 1
        ? shared
        : { ...fakeEngine(), init: () => Promise.reject(new Error('no')) };
    });
    start([record(0), record(1)]);
    const job = await waitForJob(finished);
    expect(job).toMatchObject({ status: 'done', analysed: 2 });
    expect(fullSearches(shared)).toHaveLength(14);
  });

  it('stops every engine’s work when cancelled', async () => {
    setJobLanesForTests(2);
    // Every search runs until it is aborted, as a long engine search would.
    const gate = (request: AnalyzeRequest) =>
      new Promise<void>((resolve) => {
        request.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    setEngineFactoryForTests(() => fakeEngine({ gate }));
    start([record(0), record(1), record(2)]);
    await waitForJob((job) => job.status === 'running');
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelInsightsJob();
    const job = await waitForJob(finished);
    expect(job.status).toBe('cancelled');
    expect(job.analysed).toBe(0);
  });
});

describe('engines side by side', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const device = (patch: Record<string, unknown>) => {
    setJobLanesForTests(null);
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', ...patch });
    return jobLanes();
  };

  it('leaves two cores for the page and runs at most four engines', () => {
    expect(device({ hardwareConcurrency: 2 })).toBe(1);
    expect(device({ hardwareConcurrency: 4 })).toBe(2);
    expect(device({ hardwareConcurrency: 8 })).toBe(4);
    expect(device({ hardwareConcurrency: 16 })).toBe(4);
  });

  it('runs at most two on phones and low-memory devices', () => {
    expect(
      device({ hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' }),
    ).toBe(2);
    expect(device({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe(2);
    expect(device({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(4);
  });
});

describe('job progress', () => {
  const job = (patch: Partial<InsightsJob>): InsightsJob => ({
    status: 'running',
    playerKey: 'lichess:x',
    platform: 'lichess',
    username: 'x',
    presetId: 'fast',
    selected: 4,
    queued: 4,
    gameNumber: 1,
    finished: 0,
    active: [],
    current: null,
    analysed: 0,
    skipped: 0,
    failures: [],
    etaMs: null,
    stopping: false,
    paused: false,
    ...patch,
  });
  const current = (phase: JobPhase, done: number, total: number) => ({
    gameId: 'g',
    label: 'vs y',
    phase,
    done,
    total,
    moves: 40,
  });

  it('counts the full pass as the first half of a game and verification as the second', () => {
    expect(jobFraction(job({ active: [current('analysing', 0, 41)] }))).toBe(0);
    expect(jobFraction(job({ active: [current('analysing', 41, 41)] }))).toBeCloseTo(0.125);
    expect(jobFraction(job({ active: [current('verifying', 5, 10)] }))).toBeCloseTo(0.1875);
    expect(jobFraction(job({ finished: 3, active: [current('verifying', 0, 0)] }))).toBe(1);
    expect(jobFraction(job({ queued: 0, status: 'done' }))).toBe(1);
  });

  it('adds up every game in progress when several engines run', () => {
    const active = [current('verifying', 5, 10), current('analysing', 41, 41)];
    // One game finished, plus three quarters and a half of the two in progress.
    expect(jobFraction(job({ finished: 1, active }))).toBeCloseTo((1 + 0.75 + 0.5) / 4);
  });

  it('estimates the time left from the searches timed so far', () => {
    const timing = { ...emptyTiming(), fullMs: 200, fullSearches: 2 };
    const work = { full: 10, refine: null, positions: 50, later: 100 };
    expect(estimateRemainingMs(timing, work)).toBeNull();

    // 100 ms a full search; verification guessed at 8 times that, for 20% of the positions.
    timing.fullMs = 1000;
    timing.fullSearches = 10;
    expect(estimateRemainingMs(timing, work)).toBe(10 * 100 + 10 * 800 + 100 * (100 + 160));

    // Once measured, the real verification cost and share are used.
    Object.assign(timing, {
      refineMs: 3000,
      refineSearches: 5,
      plannedPositions: 100,
      plannedRefine: 10,
    });
    expect(estimateRemainingMs(timing, { ...work, full: 0, refine: 4 })).toBe(
      4 * 600 + 100 * (100 + 60),
    );
  });
});
