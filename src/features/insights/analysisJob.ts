import { useSyncExternalStore } from 'react';
import type { AccuracyModel } from '@/core/accuracyModel';
import { loadOpeningBook, type OpeningBook } from '@/core/openings';
import { parsePgn } from '@/core/pgn';
import { buildGameReview } from '@/core/review';
import type {
  AnalysisSettings,
  GameRecord,
  GameReview,
  ParsedGame,
  PositionAnalysis,
} from '@/core/types';
import { analyzeGame, analyzePositions } from '@/engine/analyzeGame';
import { analysisCacheKey, loadCachedAnalyses, saveAnalyses } from '@/engine/cache';
import { PRESETS, type Preset, type PresetId } from '@/engine/presets';
import {
  isBetterAnalysis,
  positionsToRefine,
  refineSettings,
  selectMovesToRefine,
  verifiedAnalysis,
} from '@/engine/refine';
import { ENGINE_NAME, type Engine } from '@/engine/stockfish';
import { cacheKey } from '@/features/games/playerGames';
import { playerColor } from '@/features/games/gameList';
import { getSharedEngine, prepareEngineForGame, startExtraEngine } from '@/features/review/engine';
import { libraryEntryToSave } from '@/features/review/reviewHelpers';
import {
  getLibraryEntry,
  saveToLibrary,
  type LibraryEntry,
  type Perspective,
} from '@/library/library';
import { resolveGame } from '@/sources/resolveGame';
import type { Platform } from '@/state/settings';

/**
 * "Analyse my recent games": a batch job that reviews several games one after another and
 * saves each to the library. It lives at module level, so it keeps running while the user
 * browses elsewhere, and the insights page reconnects to it when it mounts again.
 *
 * Each game gets the same analysis as the review screen: the preset's full pass, then the
 * verification pass (engine/refine.ts) that re-checks the labels that matter most with a
 * deeper search. The library then holds the labels a review of the game shows, and opening
 * one of these games later needs no engine at all.
 *
 * The engine build is single-threaded, so the job runs several engines side by side (see
 * jobLanes): the shared engine plus extra ones that are stopped when the job ends. The games
 * still go one after another, but every engine works on the current game, taking the next
 * few positions whenever it is free (searchOnLanes). Each position gets the same search as
 * before, only sooner.
 *
 * Only one job runs at a time. Games already in the library
 * are skipped (unless their accuracies are on another scale than the one asked for: those
 * are reviewed again), and engine results are cached per position (engine/cache.ts), so a
 * cancelled job resumes almost where it stopped when it is started again.
 */

export type JobStatus =
  /** Looking up which games are already reviewed. */
  | 'checking'
  | 'running'
  | 'done'
  | 'cancelled'
  /** The engine could not start; nothing was analysed. */
  | 'failed';

/** 'analysing': the preset's pass over every position; 'verifying': the deeper re-checks. */
export type JobPhase = 'analysing' | 'verifying';

export interface JobFailure {
  gameId: string;
  label: string;
  message: string;
}

export interface JobGameProgress {
  gameId: string;
  /** "vs MagnusCarlsen", for the progress line. */
  label: string;
  phase: JobPhase;
  /** Positions finished in this phase. */
  done: number;
  /** Positions this phase searches (every position of the game when analysing). */
  total: number;
  /** Moves in the game. */
  moves: number;
}

export interface InsightsJob {
  status: JobStatus;
  /** cacheKey(platform, username) of the player the job is for. */
  playerKey: string;
  platform: Platform;
  username: string;
  presetId: PresetId;
  /** Games that were selected. */
  selected: number;
  /** Games that needed the engine (selected minus already reviewed minus unreadable). */
  queued: number;
  /** 1-based queue number of `current` (0 before the first game). */
  gameNumber: number;
  /** Games of the queue that are finished (analysed, skipped or failed). */
  finished: number;
  /** The games being analysed right now, oldest first (several engines run side by side). */
  active: JobGameProgress[];
  /** The newest game being analysed (the last of `active`), for the progress line. */
  current: JobGameProgress | null;
  /** Saved to the library by this job. */
  analysed: number;
  /** Already in the library when the job started (or reviewed elsewhere meanwhile). */
  skipped: number;
  failures: JobFailure[];
  /** Rough time left in ms, once a few positions have been timed. */
  etaMs: number | null;
  /** Cancel was pressed; the job stops after the position being searched. */
  stopping: boolean;
  /** Waiting while something else uses the engine (see holdInsightsJob). */
  paused: boolean;
  /** Error shown when status is 'failed'. */
  message?: string;
}

export interface StartJobOptions {
  platform: Platform;
  username: string;
  /** The games to review, newest first. Other variants are ignored. */
  records: readonly GameRecord[];
  presetId: PresetId;
  /** The scale of the accuracies saved to the library (the Settings choice). */
  accuracyModel: AccuracyModel;
}

/** Positions to analyse before partial results are written to the cache. */
const SAVE_EVERY_POSITIONS = 5;
/** Progress listeners are told at most this often (status changes are immediate). */
const NOTIFY_INTERVAL_MS = 250;

interface JobStore {
  state: InsightsJob | null;
  controller: AbortController | null;
  /** Identifies the current run, so a run that was replaced can no longer change the state. */
  runId: number;
  listeners: Set<() => void>;
  lastNotifyAt: number;
  notifyTimer: ReturnType<typeof setTimeout> | undefined;
  /** See holdInsightsJob. */
  holds: number;
  holdWaiters: (() => void)[];
}

/**
 * Everything the job keeps between calls. During development a hot update of this module (or
 * of one it imports) runs a fresh copy of it, whose page could no longer see the job still
 * running in the old copy; import.meta.hot hands both copies this same object.
 */
const store: JobStore = (import.meta.hot?.data.store as JobStore | undefined) ?? {
  state: null,
  controller: null,
  runId: 0,
  listeners: new Set(),
  lastNotifyAt: 0,
  notifyTimer: undefined,
  holds: 0,
  holdWaiters: [],
};
if (import.meta.hot) import.meta.hot.data.store = store;

function emit(): void {
  clearTimeout(store.notifyTimer);
  store.notifyTimer = undefined;
  store.lastNotifyAt = Date.now();
  for (const listener of store.listeners) listener();
}

/** Replaces the state of run `id`; `throttle` batches frequent progress updates. */
function update(id: number, patch: Partial<InsightsJob>, throttle = false): void {
  if (!store.state || id !== store.runId) return;
  store.state = { ...store.state, ...patch };
  if (!throttle) return emit();
  if (store.notifyTimer !== undefined) return;
  store.notifyTimer = setTimeout(
    emit,
    Math.max(0, NOTIFY_INTERVAL_MS - (Date.now() - store.lastNotifyAt)),
  );
}

export function getInsightsJob(): InsightsJob | null {
  return store.state;
}

export function subscribeInsightsJob(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

/** The current job (or null), re-rendering on every change. */
export function useInsightsJob(): InsightsJob | null {
  return useSyncExternalStore(subscribeInsightsJob, getInsightsJob, getInsightsJob);
}

export function isJobActive(job: InsightsJob | null): boolean {
  return job?.status === 'checking' || job?.status === 'running';
}

/** Share of one game that is finished: its full pass is the first half, verification the second. */
function gameFraction(game: JobGameProgress): number {
  const share = game.total > 0 ? Math.min(1, game.done / game.total) : 1;
  return game.phase === 'analysing' ? share / 2 : 0.5 + share / 2;
}

/** Share of the job that is finished, 0-1: whole games done plus the games in progress. */
export function jobFraction(job: InsightsJob): number {
  if (job.queued === 0) return job.status === 'done' ? 1 : 0;
  const inProgress = job.active.reduce((sum, game) => sum + gameFraction(game), 0);
  return Math.min(1, (job.finished + inProgress) / job.queued);
}

// ---------------------------------------------------------------------------
// Engines side by side
// ---------------------------------------------------------------------------

/** Most engines one job runs at once. */
const MAX_LANES = 4;
let lanesForTests: number | null = null;

/**
 * How many engines the job runs side by side. Each is single-threaded and takes one core, so
 * two cores are left for the page itself; phones and low-memory devices run at most two (each
 * engine has its own memory and they heat a phone quickly).
 */
export function jobLanes(): number {
  if (lanesForTests !== null) return lanesForTests;
  if (typeof navigator === 'undefined' || !navigator) return 1;
  const nav = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
    deviceMemory?: number;
  };
  const cores = nav.hardwareConcurrency || 2;
  let lanes = Math.max(1, Math.min(MAX_LANES, cores - 2));
  const mobile =
    nav.userAgentData?.mobile === true || /Mobi|Android|iPhone|iPad/.test(nav.userAgent ?? '');
  if (mobile || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4)) {
    lanes = Math.min(lanes, 2);
  }
  return lanes;
}

/** Tests only: fixes the number of engines a job runs (null: from the device again). */
export function setJobLanesForTests(lanes: number | null): void {
  lanesForTests = lanes;
}

// ---------------------------------------------------------------------------
// Holds: other engine users pause the job
// ---------------------------------------------------------------------------

/**
 * Pauses the job between two engine searches while something else needs the engine, such
 * as the review screen analysing a game: both would otherwise share one engine and each
 * run at half speed. Returns the function that releases the hold; the job continues once
 * every hold is released. Safe to call when no job runs.
 */
export function holdInsightsJob(): () => void {
  store.holds += 1;
  if (store.holds === 1 && isJobActive(store.state)) update(store.runId, { paused: true });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    store.holds -= 1;
    if (store.holds > 0) return;
    const waiters = store.holdWaiters;
    store.holdWaiters = [];
    for (const resume of waiters) resume();
    if (isJobActive(store.state)) update(store.runId, { paused: false });
  };
}

/** Resolves at once without holds (false), else once they are released (true). */
function waitWhileHeld(signal: AbortSignal): Promise<boolean> {
  if (store.holds === 0) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    store.holdWaiters.push(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    });
  });
}

/**
 * The shared engine as the job uses it: every search first waits for holds to be released,
 * and then clears the hash table again if another game was analysed meanwhile.
 */
function heldEngine(engine: Engine, gameId: string, signal: AbortSignal): Engine {
  return {
    name: engine.name,
    init: () => engine.init(),
    newGame: () => engine.newGame(),
    // The engine is shared with the review screen; the job never stops it.
    terminate: () => undefined,
    analyze: async (request) => {
      if (await waitWhileHeld(signal)) await prepareEngineForGame(engine, gameId);
      return engine.analyze(request);
    },
  };
}

/**
 * An extra engine as the job uses it: nobody else touches it, but its searches still wait
 * while a review holds the engine, so that review gets the processor to itself.
 */
function heldExtraEngine(engine: Engine, signal: AbortSignal): Engine {
  return {
    name: engine.name,
    init: () => engine.init(),
    newGame: () => engine.newGame(),
    terminate: () => undefined,
    analyze: async (request) => {
      await waitWhileHeld(signal);
      return engine.analyze(request);
    },
  };
}

// ---------------------------------------------------------------------------
// Time estimate
// ---------------------------------------------------------------------------

/** Engine time measured so far in this job. */
export interface JobTiming {
  /** Time and searches of full passes (positions restored from the cache do not count). */
  fullMs: number;
  fullSearches: number;
  /** Time and searches of verification passes. */
  refineMs: number;
  refineSearches: number;
  /** Positions of the games whose verification was planned, and how many it re-checks. */
  plannedPositions: number;
  plannedRefine: number;
}

export interface RemainingWork {
  /** Full-pass positions left in the current game. */
  full: number;
  /** Verification searches left in the current game; null before they are planned. */
  refine: number | null;
  /** Positions in the current game (estimates its verification before it is planned). */
  positions: number;
  /** Positions in the games after the current one. */
  later: number;
}

/** Searches timed before an estimate is shown. */
const ETA_MIN_SAMPLES = 3;
/**
 * A verification search goes 4 plies deeper with twice the time cap. Measured at about 8
 * times a full-pass search; the guess is only used until real ones have been timed.
 */
const REFINE_COST_GUESS = 8;
/** Share of a game's positions the verification re-checks (typically 15-25%). */
const REFINE_SHARE_GUESS = 0.2;

export function emptyTiming(): JobTiming {
  return {
    fullMs: 0,
    fullSearches: 0,
    refineMs: 0,
    refineSearches: 0,
    plannedPositions: 0,
    plannedRefine: 0,
  };
}

/** Rough time left in ms, from the searches timed so far; null until there are enough. */
export function estimateRemainingMs(timing: JobTiming, work: RemainingWork): number | null {
  const fullKnown = timing.fullSearches >= ETA_MIN_SAMPLES;
  const refineKnown = timing.refineSearches >= ETA_MIN_SAMPLES;
  if (!fullKnown && !refineKnown) return null;
  const perRefine = refineKnown
    ? timing.refineMs / timing.refineSearches
    : (timing.fullMs / timing.fullSearches) * REFINE_COST_GUESS;
  const perFull = fullKnown ? timing.fullMs / timing.fullSearches : perRefine / REFINE_COST_GUESS;
  const share =
    timing.plannedPositions > 0
      ? timing.plannedRefine / timing.plannedPositions
      : REFINE_SHARE_GUESS;
  const refineNow = work.refine ?? work.positions * share;
  return Math.round(
    work.full * perFull + refineNow * perRefine + work.later * (perFull + share * perRefine),
  );
}

// ---------------------------------------------------------------------------
// Starting and stopping
// ---------------------------------------------------------------------------

/**
 * Starts a job. Returns false (and does nothing) while another job is still running.
 * Progress arrives via the store (useInsightsJob).
 */
export function startInsightsJob(options: StartJobOptions): boolean {
  if (isJobActive(store.state)) return false;
  const records = options.records.filter((record) => record.variant === 'standard');
  const id = ++store.runId;
  store.controller = new AbortController();
  store.state = {
    status: 'checking',
    playerKey: cacheKey(options.platform, options.username),
    platform: options.platform,
    username: options.username,
    presetId: options.presetId,
    selected: records.length,
    queued: 0,
    gameNumber: 0,
    finished: 0,
    active: [],
    current: null,
    analysed: 0,
    skipped: 0,
    failures: [],
    etaMs: null,
    stopping: false,
    paused: store.holds > 0,
  };
  emit();
  void runJob(id, options, records, store.controller.signal);
  return true;
}

/** Stops the running job after the current position; finished work is kept. */
export function cancelInsightsJob(): void {
  if (!store.controller || !isJobActive(store.state)) return;
  store.controller.abort();
  update(store.runId, { stopping: true });
}

/** Forgets a finished job (the page then shows the start controls again). */
export function dismissInsightsJob(): void {
  if (isJobActive(store.state)) return;
  store.state = null;
  emit();
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

interface QueuedGame {
  record: GameRecord;
  game: ParsedGame;
  label: string;
  perspective: Perspective;
}

function opponentLabel(record: GameRecord, username: string): string {
  const color = playerColor(record, username);
  const opponent = color === 'b' ? record.white : record.black;
  return `vs ${opponent.name}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown error';
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

async function runJob(
  id: number,
  options: StartJobOptions,
  records: readonly GameRecord[],
  signal: AbortSignal,
): Promise<void> {
  const set = (patch: Partial<InsightsJob>, throttle = false) => update(id, patch, throttle);
  const finish = (status: 'done' | 'cancelled' | 'failed', message?: string) => {
    if (id === store.runId) store.controller = null;
    set({
      status,
      current: null,
      active: [],
      etaMs: null,
      stopping: false,
      paused: false,
      ...(message ? { message } : {}),
    });
  };
  const { platform, username, accuracyModel } = options;
  const preset = PRESETS[options.presetId];
  const failures: JobFailure[] = [];
  /** A stored review counts as done when its accuracies are on the scale asked for. */
  const isDone = (entry: LibraryEntry | null): entry is LibraryEntry =>
    entry?.accuracyModel === accuracyModel;

  // 1. Which games still need the engine? Reading the library and parsing is quick.
  const queue: QueuedGame[] = [];
  let skipped = 0;
  for (const listed of records) {
    if (signal.aborted) return finish('cancelled');
    const label = opponentLabel(listed, username);
    const color = playerColor(listed, username);
    if (!color) continue;
    const perspective: Perspective = { platform, username: username.trim().toLowerCase(), color };
    const existing = await getLibraryEntry(listed.id);
    if (isDone(existing)) {
      skipped += 1;
      // Reviews opened without a perspective learn whose game this is (puzzles use it).
      if (!existing.perspective) await saveToLibrary({ ...existing, perspective });
      continue;
    }
    try {
      const record = listed.pgn ? listed : await resolveGame(listed.id, signal);
      queue.push({ record, game: parsePgn(record.pgn), label, perspective });
    } catch (error) {
      if (isAbort(error, signal)) return finish('cancelled');
      failures.push({ gameId: listed.id, label, message: errorMessage(error) });
    }
  }
  set({ skipped, failures: [...failures], queued: queue.length });
  if (queue.length === 0) return finish('done');

  // 2. Engine and opening book (the review works without the book).
  let engine: Engine;
  try {
    engine = await getSharedEngine();
  } catch (error) {
    console.error('Stockfish failed to start', error);
    return finish(
      'failed',
      'Your browser could not start the chess engine (WebAssembly is required).',
    );
  }
  let book: OpeningBook | null = null;
  try {
    book = await loadOpeningBook();
  } catch (error) {
    console.warn('Opening book unavailable; reviewing without book moves.', error);
  }
  if (signal.aborted) return finish('cancelled');

  // Extra engines, which share the work on each game. One that fails to start only means
  // fewer lanes: the shared engine alone can do all the work.
  const extraCount = jobLanes() - 1;
  const extras = (
    await Promise.all(
      Array.from({ length: Math.max(0, extraCount) }, () =>
        startExtraEngine().catch((error: unknown) => {
          console.warn('An extra engine could not start; analysing with fewer.', error);
          return null;
        }),
      ),
    )
  ).filter((extra): extra is Engine => extra !== null);
  const stopExtras = () => {
    for (const extra of extras) {
      try {
        extra.terminate();
      } catch {
        // Already gone.
      }
    }
  };
  if (signal.aborted) {
    stopExtras();
    return finish('cancelled');
  }
  set({ status: 'running' });

  // 3. Analyse the games one after another, every engine working on the same game.
  const timing = emptyTiming();
  const positionsAfter = (index: number) =>
    queue.slice(index + 1).reduce((sum, item) => sum + item.game.moves.length + 1, 0);
  /** Each extra engine as the job uses it (the shared one is wrapped per game, below). */
  const extraLanes: Lane[] = extras.map((extra) => ({
    engine: heldExtraEngine(extra, signal),
    prepare: () => extra.newGame(),
  }));

  try {
    for (const [index, item] of queue.entries()) {
      if (signal.aborted) break;
      const { record, label, perspective } = item;
      try {
        // The game may have been reviewed on the review screen since the job started.
        const existing = await getLibraryEntry(record.id);
        if (isDone(existing)) {
          if (!existing.perspective) await saveToLibrary({ ...existing, perspective });
          skipped += 1;
          set({ skipped, finished: index + 1, gameNumber: index + 1, active: [], current: null });
          continue;
        }
        const lanes: Lane[] = [
          {
            engine: heldEngine(engine, record.id, signal),
            prepare: () => prepareEngineForGame(engine, record.id),
          },
          ...extraLanes,
        ];
        const review = await analyseOne(item, {
          lanes,
          preset,
          accuracyModel,
          book,
          signal,
          timing,
          onProgress: (progress, remaining, throttle) => {
            if (signal.aborted) return;
            const current = { gameId: record.id, label, ...progress };
            const left = estimateRemainingMs(timing, {
              ...remaining,
              later: positionsAfter(index),
            });
            set(
              {
                finished: index,
                gameNumber: index + 1,
                active: [current],
                current,
                etaMs: left === null ? null : Math.round(left / lanes.length),
              },
              throttle,
            );
          },
        });
        const entry = libraryEntryToSave(
          record,
          item.game,
          review,
          perspective,
          await getLibraryEntry(record.id),
        );
        if (entry) await saveToLibrary(entry);
        set({ analysed: (store.state?.analysed ?? 0) + 1, finished: index + 1 });
      } catch (error) {
        if (isAbort(error, signal)) break;
        console.error('Batch analysis failed for', record.id, error);
        failures.push({ gameId: record.id, label, message: errorMessage(error) });
        set({ failures: [...failures], finished: index + 1 });
      }
    }
  } finally {
    stopExtras();
  }
  finish(signal.aborted ? 'cancelled' : 'done');
}

/** One engine as a game uses it, and how to clear its hash table for that game. */
interface Lane {
  engine: Engine;
  prepare: () => Promise<void>;
}

/** Positions one engine takes at a time in the full pass (neighbours share the hash table). */
const FULL_BLOCK = 4;
/** Verification positions one engine takes at a time: the two positions around one move. */
const REFINE_BLOCK = 2;

/**
 * Searches `indices` of a game on every lane at once: each lane takes the next block of
 * `blockSize` positions whenever it is free, so all engines stay busy until the end.
 * `onPosition` gets each result with the time its search took. Waits for every lane before
 * settling and rejects with the first error (an AbortError once the signal aborts).
 */
async function searchOnLanes(
  game: ParsedGame,
  lanes: readonly Lane[],
  options: {
    settings: AnalysisSettings;
    indices: readonly number[];
    blockSize: number;
    signal: AbortSignal;
    onPosition: (index: number, analysis: PositionAnalysis, ms: number) => void;
  },
): Promise<void> {
  const { settings, blockSize, signal, onPosition } = options;
  const sorted = [...new Set(options.indices)].sort((a, b) => a - b);
  const blocks: number[][] = [];
  for (let i = 0; i < sorted.length; i += blockSize) blocks.push(sorted.slice(i, i + blockSize));
  let next = 0;
  const outcomes = await Promise.allSettled(
    lanes.map(async (lane) => {
      while (next < blocks.length) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const block = blocks[next++]!;
        let mark = Date.now();
        await analyzePositions(game, {
          engine: lane.engine,
          settings,
          indices: block,
          signal,
          onPosition: (index, analysis) => {
            const now = Date.now();
            onPosition(index, analysis, now - mark);
            mark = now;
          },
        });
      }
    }),
  );
  const failed = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failed) throw failed.reason;
}

interface AnalyseOneOptions {
  /** The engines that share the game: the first is the shared engine. */
  lanes: readonly Lane[];
  preset: Preset;
  accuracyModel: AccuracyModel;
  book: OpeningBook | null;
  signal: AbortSignal;
  /** Updated with the time of every search. */
  timing: JobTiming;
  onProgress: (
    current: Omit<JobGameProgress, 'gameId' | 'label'>,
    remaining: Omit<RemainingWork, 'later'>,
    throttle: boolean,
  ) => void;
}

/**
 * One game: the preset's full pass, then the verification pass, both resumed from and saved
 * to the analysis cache under the key the review screen uses. Every lane works on the game
 * at once (searchOnLanes). Resolves with the review.
 */
async function analyseOne(item: QueuedGame, options: AnalyseOneOptions): Promise<GameReview> {
  const { lanes, preset, accuracyModel, book, signal, timing, onProgress } = options;
  const { record, game } = item;
  const positions = game.moves.length + 1;
  const moves = game.moves.length;
  const key = analysisCacheKey(record.id, ENGINE_NAME, preset);
  const cached = await loadCachedAnalyses(key);
  const working: (PositionAnalysis | null)[] = Array.from(
    { length: positions },
    (_, index) => cached?.analyses[index] ?? null,
  );
  // A verified flag only means something for a complete analysis.
  let refined = cached?.refined === true && working.every(Boolean);
  let unsaved = 0;
  const persist = () => {
    if (unsaved === 0) return;
    unsaved = 0;
    void saveAnalyses(key, working.slice(), { refined });
  };
  const engineInfo = { name: ENGINE_NAME, depth: preset.depth, multiPv: preset.multiPv };

  // Full pass.
  const fullDone = () => working.filter(Boolean).length;
  onProgress(
    { phase: 'analysing', done: fullDone(), total: positions, moves },
    { full: positions - fullDone(), refine: null, positions },
    false,
  );
  const missing = working.flatMap((analysis, index) => (analysis ? [] : [index]));
  if (missing.length > 0) await Promise.all(lanes.map((lane) => lane.prepare()));
  let full: PositionAnalysis[];
  try {
    await searchOnLanes(game, lanes, {
      settings: preset,
      indices: missing,
      blockSize: FULL_BLOCK,
      signal,
      onPosition: (index, analysis, ms) => {
        if (!working[index]) {
          working[index] = analysis;
          timing.fullMs += ms;
          timing.fullSearches += 1;
          if (++unsaved >= SAVE_EVERY_POSITIONS) persist();
        }
        const done = fullDone();
        onProgress(
          { phase: 'analysing', done, total: positions, moves },
          { full: positions - done, refine: null, positions },
          true,
        );
      },
    });
    // Fills in the positions where the game is over (nothing to search) and checks that
    // every position is there; anything still missing is searched on the shared engine.
    full = await analyzeGame(game, {
      engine: lanes[0]!.engine,
      settings: preset,
      existing: working.slice(),
      signal,
    });
  } finally {
    persist();
  }
  full.forEach((analysis, index) => (working[index] = analysis));

  // Verification pass, unless an earlier run (or the review screen) already did it.
  if (!refined) {
    const settings = refineSettings(preset);
    // Only the labels matter here, and they do not depend on the accuracy scale.
    const plies = selectMovesToRefine(buildGameReview(game, full, { book, engine: engineInfo }));
    const indices = positionsToRefine(plies, working, settings.depth);
    timing.plannedPositions += positions;
    timing.plannedRefine += indices.length;
    // As on the review screen, verified results only replace analyses once both positions of
    // every selected move are verified (or neither is), so a move is never judged by one
    // verified and one unverified position, even when the job stops half-way.
    const pending = new Set(indices);
    const staged = new Map<number, PositionAnalysis>();
    const commitIfConsistent = () => {
      if (plies.some((ply) => pending.has(ply - 1) !== pending.has(ply))) return;
      for (const [index, analysis] of staged) {
        const original = working[index];
        if (original && isBetterAnalysis(analysis, original)) {
          working[index] = verifiedAnalysis(analysis, original);
          unsaved += 1;
        }
      }
      staged.clear();
      // Each verification search takes a while, so every consistent result is worth saving.
      persist();
    };
    const report = (throttle: boolean) => {
      const done = indices.length - pending.size;
      onProgress(
        { phase: 'verifying', done, total: indices.length, moves },
        { full: 0, refine: pending.size, positions },
        throttle,
      );
    };
    report(false);
    try {
      if (indices.length > 0) {
        await searchOnLanes(game, lanes, {
          settings,
          indices,
          blockSize: REFINE_BLOCK,
          signal,
          onPosition: (index, analysis, ms) => {
            timing.refineMs += ms;
            timing.refineSearches += 1;
            pending.delete(index);
            staged.set(index, analysis);
            commitIfConsistent();
            report(true);
          },
        });
      }
      commitIfConsistent();
      refined = true;
      unsaved += 1;
    } finally {
      persist();
    }
  }

  return buildGameReview(game, working as PositionAnalysis[], {
    book,
    engine: engineInfo,
    accuracyModel,
  });
}

/** Tests only: drops the job without waiting for it. */
export function resetInsightsJobForTests(): void {
  store.controller?.abort();
  store.controller = null;
  store.runId += 1;
  store.state = null;
  clearTimeout(store.notifyTimer);
  store.notifyTimer = undefined;
  store.holds = 0;
  store.holdWaiters = [];
  lanesForTests = 1;
}
