import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  AnalysisProgress,
  AnalysisSettings,
  GameRecord,
  GameReview,
  ParsedGame,
  PositionAnalysis,
} from '@/core/types';
import { parsePgn } from '@/core/pgn';
import { buildGameReview } from '@/core/review';
import { loadOpeningBook, type OpeningBook } from '@/core/openings';
import { analyzeGame, analyzePositions } from '@/engine/analyzeGame';
import {
  analysisCacheKey,
  loadCachedAnalyses,
  saveAnalyses,
  type CachedAnalyses,
} from '@/engine/cache';
import { PRESETS, QUICK_PASS, type Preset, type PresetId } from '@/engine/presets';
import {
  isBetterAnalysis,
  positionsToRefine,
  refineSettings,
  selectMovesToRefine,
  verifiedAnalysis,
} from '@/engine/refine';
import { ENGINE_NAME, type Engine } from '@/engine/stockfish';
import { holdInsightsJob } from '@/features/insights/analysisJob';
import { getLibraryEntry, saveToLibrary, type Perspective } from '@/library/library';
import { resolveGame } from '@/sources/resolveGame';
import { resolvePreset, useSettings } from '@/state/settings';
import { getSharedEngine, prepareEngineForGame } from './engine';
import {
  contiguousCount,
  deeperPreset,
  deeperPresets,
  describeLoadError,
  errorMessage,
  isAbortError,
  isAnalysisComplete,
  isReviewableVariant,
  libraryEntryToSave,
  mergeAnalyses,
  rebuildInterval,
  resolvePerspective,
  shallowerPresets,
  variantError,
  type ReviewLoadError,
} from './reviewHelpers';

/**
 * While analysis streams in, rebuild the review at most this often (it is O(moves)), and less
 * often when a build is slow (see rebuildInterval).
 */
const REBUILD_INTERVAL_MS = 750;
/**
 * The same during the quick pass. It takes a second or two on a desktop, so the review is
 * built once, when it ends; a slow phone still sees the review fill in.
 */
const QUICK_REBUILD_INTERVAL_MS = 2000;
/** Save partial results this often so a closed tab loses little work. */
const SAVE_EVERY_POSITIONS = 5;
/** Progress events can arrive per search depth; the UI does not need more than this. */
const PROGRESS_INTERVAL_MS = 200;

export const ENGINE_START_ERROR =
  'Your browser could not start the chess engine (WebAssembly is required).';

export type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: ReviewLoadError }
  | { status: 'ready'; record: GameRecord; game: ParsedGame };

export type AnalysisStatus =
  /** Reading the cache / starting the engine. */
  | 'preparing'
  | 'running'
  /** Stopped by the user; resumable. */
  | 'paused'
  | 'done'
  /** The engine could not start (no WebAssembly, worker failed to load). */
  | 'engine-error'
  /** The analysis failed part-way; resumable. */
  | 'failed';

/**
 * The passes of an analysis, in order:
 * - 'quick': a shallow pass over every position, so a complete provisional review appears
 *   within seconds (skipped when a complete review is already available);
 * - 'full': the preset's depth, replacing quick results position by position;
 * - 'refining': deeper searches around the labels that matter most (engine/refine.ts);
 * - 'done': nothing left to run.
 */
export type AnalysisPhase = 'quick' | 'full' | 'refining' | 'done';

/** Positions finished in one pass. */
export interface PassProgress {
  done: number;
  total: number;
}

export interface AnalysisPasses {
  /** Null when the quick pass is not part of this analysis. */
  quick: PassProgress | null;
  full: PassProgress;
  /** Null until the positions to verify are known. */
  refining: PassProgress | null;
}

export interface AnalysisState {
  status: AnalysisStatus;
  /** Live progress of the current pass (its positions, search depth, time estimate). */
  progress: AnalysisProgress | null;
  preset: Preset;
  /** Error details for 'engine-error' and 'failed'. */
  message?: string;
  /** The pass that is running, paused or failed ('done' once every pass has finished). */
  phase: AnalysisPhase;
  passes: AnalysisPasses;
  /** Target search depth of the current pass. */
  phaseDepth: number;
  /** Moves the verification pass re-checks (0 until known). */
  refineMoves: number;
}

export interface GameReviewState {
  load: LoadState;
  /** Analyses behind `review` (index = ply). */
  analyses: readonly (PositionAnalysis | null)[];
  review: GameReview | null;
  /** True while a deeper analysis runs and the previous, complete review is still shown. */
  showingPreviousAnalysis: boolean;
  /**
   * True while some of the analyses behind `review` come from the quick pass. The review is
   * complete but shallow; the full pass replaces it position by position.
   */
  provisional: boolean;
  /**
   * The preset of the analyses behind `review` (the previous one while a deeper run catches
   * up). While the review is provisional it describes the quick pass: label "Quick" and the
   * quick depth.
   */
  reviewPreset: Preset;
  /** Analyses exist but turning them into a review threw (details are in the console). */
  reviewFailed: boolean;
  analysis: AnalysisState;
  /** Whose game this is, from ?as=<username> or a Chess.com archive id; null when unknown. */
  perspective: Perspective | null;
  canAnalyseDeeper: boolean;
  /** Reloads the game after a load error. */
  retry: () => void;
  stop: () => void;
  /** Continues a paused or failed analysis. */
  resume: () => void;
  /** Re-analyses this game with the next deeper preset. */
  analyseDeeper: () => void;
}

type Analyses = (PositionAnalysis | null)[];

interface Layers {
  /** The preset these analyses belong to (state from the previous preset is ignored). */
  presetId: PresetId | null;
  /** The preset's analyses (full pass, refined in place by the verification pass). */
  full: Analyses;
  /** Quick-pass analyses, shown where the full pass has not reached yet. */
  quick: Analyses;
}

interface Track {
  phase: AnalysisPhase;
  progress: AnalysisProgress | null;
  passes: AnalysisPasses;
  refineMoves: number;
}

const NO_LAYERS: Layers = { presetId: null, full: [], quick: [] };
const INITIAL_TRACK: Track = {
  phase: 'quick',
  progress: null,
  passes: { quick: null, full: { done: 0, total: 0 }, refining: null },
  refineMoves: 0,
};

function safeResolvePreset(preset: Parameters<typeof resolvePreset>[0]): PresetId {
  try {
    return resolvePreset(preset);
  } catch {
    return 'standard';
  }
}

function safeCacheKey(gameId: string, settings: AnalysisSettings): string | null {
  try {
    return analysisCacheKey(gameId, ENGINE_NAME, settings);
  } catch {
    return null;
  }
}

async function safeLoad(key: string | null): Promise<CachedAnalyses | null> {
  if (!key) return null;
  try {
    return await loadCachedAnalyses(key);
  } catch {
    return null;
  }
}

function safeSave(key: string | null, analyses: Analyses, refined = false): void {
  if (!key) return;
  try {
    saveAnalyses(key, analyses, { refined }).catch(() => undefined);
  } catch {
    // Storage is optional: the review works without a cache.
  }
}

/** The deepest preset in `candidates` whose cached analysis of this game is complete. */
async function findCompletePreset(
  gameId: string,
  candidates: readonly PresetId[],
  totalPositions: number,
): Promise<{ id: PresetId; analyses: Analyses } | null> {
  for (const id of candidates) {
    const cached = await safeLoad(safeCacheKey(gameId, PRESETS[id]));
    if (cached && isAnalysisComplete(cached.analyses, totalPositions)) {
      return { id, analyses: cached.analyses };
    }
  }
  return null;
}

/** Describes the quick pass as a preset, for the engine label of a provisional review. */
function quickPresetFor(preset: Preset): Preset {
  return {
    ...preset,
    ...QUICK_PASS,
    label: 'Quick',
    description: 'A quick first look while the full analysis runs.',
  };
}

interface BuiltReview {
  review: GameReview | null;
  failed: boolean;
}

const NO_REVIEW: BuiltReview = { review: null, failed: false };

/**
 * How long the latest review build took, in ms. Module state rather than React state: it only
 * paces the rebuilds while analysis streams in (see rebuildInterval) and must not re-render.
 */
let lastBuildMs = 0;

function buildReviewSafely(
  game: ParsedGame,
  analyses: readonly (PositionAnalysis | null)[],
  book: OpeningBook | null,
  settings: AnalysisSettings,
): BuiltReview {
  if (!analyses[0]) return NO_REVIEW;
  const startedAt = performance.now();
  try {
    const review = buildGameReview(game, analyses as Analyses, {
      book,
      engine: { name: ENGINE_NAME, depth: settings.depth, multiPv: settings.multiPv },
    });
    return { review, failed: false };
  } catch (error) {
    // A bug in the review rules must not take the board and move list down with it.
    console.error('Could not build the game review', error);
    return { review: null, failed: true };
  } finally {
    lastBuildMs = performance.now() - startedAt;
  }
}

/** Stores a finished review in the library. Never throws: the library is optional. */
async function saveReviewToLibrary(
  record: GameRecord,
  game: ParsedGame,
  review: GameReview,
  perspective: Perspective | null,
): Promise<void> {
  try {
    const existing = await getLibraryEntry(record.id);
    const entry = libraryEntryToSave(record, game, review, perspective, existing);
    if (entry) await saveToLibrary(entry);
  } catch {
    // Storage unavailable: insights and puzzles simply do not include this game.
  }
}

/** Replaces the progress of one pass. */
function withPass(passes: AnalysisPasses, phase: AnalysisPhase, pass: PassProgress) {
  if (phase === 'quick') return { ...passes, quick: pass };
  if (phase === 'full') return { ...passes, full: pass };
  if (phase === 'refining') return { ...passes, refining: pass };
  return passes;
}

/**
 * Everything the review screen needs for one game: loads the game, restores cached
 * analysis, runs Stockfish for the rest (streaming results), and turns analyses into
 * a GameReview. Mount it with `key={gameId}` so a new game starts from a clean state.
 *
 * Analysis runs in up to three passes (see AnalysisPhase): a quick pass so a complete
 * review appears within seconds, the preset's full pass, and a verification pass for the
 * labels that matter most. Each is cached, so a closed tab resumes where it stopped, and a
 * finished review is saved to the library.
 */
export function useGameReview(gameId: string): GameReviewState {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [book, setBook] = useState<{ ready: boolean; book: OpeningBook | null }>({
    ready: false,
    book: null,
  });
  const [searchParams] = useSearchParams();
  const asUsername = searchParams.get('as');

  const settingsPreset = useSettings((state) => state.preset);
  const basePresetId = useMemo(() => safeResolvePreset(settingsPreset), [settingsPreset]);
  const [presetOverride, setPresetOverride] = useState<PresetId | null>(null);
  const presetId = presetOverride ?? basePresetId;
  const preset = PRESETS[presetId];

  const [layers, setLayers] = useState<Layers>(NO_LAYERS);
  const [paused, setPaused] = useState(false);
  const [runAttempt, setRunAttempt] = useState(0);
  const [status, setStatus] = useState<{ status: AnalysisStatus; message?: string }>({
    status: 'preparing',
  });
  const [track, setTrack] = useState<Track>(INITIAL_TRACK);
  /** The previous preset's analyses, shown until a deeper run catches up. */
  const [previous, setPrevious] = useState<{ analyses: Analyses; preset: Preset } | null>(null);
  /** Analyses per cache key that are newer than what may have reached IndexedDB. */
  const memoryRef = useRef(new Map<string, Analyses>());
  /** Cache keys verified in this session (in case IndexedDB is unavailable). */
  const refinedRef = useRef(new Set<string>());
  /**
   * Verification results per cache key that are not applied yet (see runRefinement), kept
   * so that stopping and resuming the verification does not repeat finished searches.
   */
  const stagedRef = useRef(new Map<string, Map<number, PositionAnalysis>>());
  const bookRef = useRef<Promise<OpeningBook | null> | null>(null);

  /** The opening book, loaded once; null when it cannot load (the review works without it). */
  const getBook = useCallback(() => {
    bookRef.current ??= Promise.resolve()
      .then(loadOpeningBook)
      .catch((error: unknown) => {
        console.warn('Opening book unavailable; reviewing without book moves.', error);
        return null;
      });
    return bookRef.current;
  }, []);

  // 1. Resolve and parse the game.
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: 'loading' });
    (async () => {
      try {
        const record = await resolveGame(gameId, controller.signal);
        if (controller.signal.aborted) return;
        if (!isReviewableVariant(record.variant)) {
          setLoad({ status: 'error', error: variantError(record.variant) });
          return;
        }
        setLoad({ status: 'ready', record, game: parsePgn(record.pgn) });
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return;
        setLoad({ status: 'error', error: describeLoadError(error, gameId) });
      }
    })();
    return () => controller.abort();
  }, [gameId, loadAttempt]);

  // 2. The opening book loads in parallel with everything else.
  useEffect(() => {
    let active = true;
    void getBook().then((loaded) => active && setBook({ ready: true, book: loaded }));
    return () => {
      active = false;
    };
  }, [getBook]);

  // 3. Restore cached analyses and run whatever passes are missing.
  useEffect(() => {
    if (load.status !== 'ready') return;
    const { record, game } = load;
    const totalPositions = game.moves.length + 1;
    const controller = new AbortController();
    const { signal } = controller;
    const fullKey = safeCacheKey(record.id, preset);
    const quickKey = safeCacheKey(record.id, QUICK_PASS);
    const fullMemoryKey = fullKey ?? `${record.id}|${presetId}`;
    const quickMemoryKey = quickKey ?? `${record.id}|quick`;
    const memory = memoryRef.current;

    // Shared by reference with memoryRef, so results that land after an abort are not lost.
    let full: Analyses = [];
    let quick: Analyses = [];
    let refined = false;
    let unsavedFull = 0;
    let unsavedQuick = 0;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let lastFlushAt = 0;
    let rebuildEveryMs = REBUILD_INTERVAL_MS;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    /** Releases the engine to a background insights job (see holdInsightsJob). */
    let releaseEngine: (() => void) | undefined;
    let pendingProgress: { phase: AnalysisPhase; progress: AnalysisProgress } | null = null;
    let lastProgressAt = 0;

    const flush = () => {
      flushTimer = undefined;
      lastFlushAt = Date.now();
      setLayers({ presetId, full: full.slice(), quick: quick.slice() });
    };
    const flushNow = () => {
      clearTimeout(flushTimer);
      flush();
    };
    const scheduleFlush = () => {
      if (flushTimer !== undefined) return;
      const interval = rebuildInterval(lastBuildMs, rebuildEveryMs);
      flushTimer = setTimeout(flush, Math.max(0, interval - (Date.now() - lastFlushAt)));
    };
    const persist = () => {
      if (unsavedFull > 0) {
        unsavedFull = 0;
        safeSave(fullKey, full.slice(), refined);
      }
      if (unsavedQuick > 0) {
        unsavedQuick = 0;
        safeSave(quickKey, quick.slice());
      }
    };
    /** Full analyses, with quick ones where the full pass has not been yet. */
    const layered = () => mergeAnalyses(full, quick, totalPositions);

    // Progress arrives dozens of times a second (a quick-pass position takes milliseconds, and
    // every search depth reports), and each update re-renders the screen, so updates are
    // delivered at most every PROGRESS_INTERVAL_MS, the latest one last.
    const applyProgress = () => {
      progressTimer = undefined;
      const update = pendingProgress;
      pendingProgress = null;
      if (!update || signal.aborted) return;
      lastProgressAt = Date.now();
      const { phase, progress } = update;
      setTrack((current) => ({
        ...current,
        phase,
        progress,
        passes: withPass(current.passes, phase, { done: progress.done, total: progress.total }),
      }));
    };
    /** Drops a progress update that is still waiting, so it cannot undo a phase change. */
    const cancelProgress = () => {
      clearTimeout(progressTimer);
      progressTimer = undefined;
      pendingProgress = null;
    };
    const reportProgress = (phase: AnalysisPhase) => (progress: AnalysisProgress) => {
      if (signal.aborted) return;
      pendingProgress = { phase, progress };
      if (progressTimer !== undefined) return;
      const wait = PROGRESS_INTERVAL_MS - (Date.now() - lastProgressAt);
      progressTimer = setTimeout(applyProgress, Math.max(0, wait));
    };

    const enterPhase = (phase: AnalysisPhase, pass: PassProgress, refineMoves?: number) => {
      cancelProgress();
      setTrack((current) => ({
        phase,
        progress: { done: pass.done, total: pass.total },
        passes: withPass(current.passes, phase, pass),
        refineMoves: refineMoves ?? current.refineMoves,
      }));
    };
    const completePass = (phase: AnalysisPhase, total: number) => {
      cancelProgress();
      setTrack((current) => ({
        ...current,
        passes: withPass(current.passes, phase, { done: total, total }),
      }));
    };

    const runQuickPass = async (engine: Engine) => {
      enterPhase('quick', { done: contiguousCount(layered()), total: totalPositions });
      rebuildEveryMs = QUICK_REBUILD_INTERVAL_MS;
      try {
        await analyzeGame(game, {
          engine,
          settings: QUICK_PASS,
          // Positions the full pass already finished need no quick look.
          existing: layered(),
          signal,
          onPosition: (index, analysis) => {
            if (full[index] || quick[index] === analysis) return;
            quick[index] = analysis;
            if (signal.aborted) return;
            if (++unsavedQuick >= SAVE_EVERY_POSITIONS) persist();
            scheduleFlush();
          },
          onProgress: reportProgress('quick'),
        });
      } finally {
        rebuildEveryMs = REBUILD_INTERVAL_MS;
      }
      persist();
      // Show the finished pass at once rather than at the next throttled rebuild.
      flushNow();
      completePass('quick', totalPositions);
    };

    const runFullPass = async (engine: Engine) => {
      enterPhase('full', { done: contiguousCount(full), total: totalPositions });
      const result = await analyzeGame(game, {
        engine,
        settings: preset,
        existing: full.slice(),
        signal,
        onPosition: (index, analysis) => {
          if (full[index] === analysis) return;
          full[index] = analysis;
          if (signal.aborted) return;
          if (++unsavedFull >= SAVE_EVERY_POSITIONS) persist();
          scheduleFlush();
        },
        onProgress: reportProgress('full'),
      });
      result.forEach((analysis, index) => {
        if (analysis && !full[index]) {
          full[index] = analysis;
          unsavedFull++;
        }
      });
      persist();
      flushNow();
      completePass('full', totalPositions);
    };

    const runRefinement = async (engine: Engine) => {
      const settings = refineSettings(preset);
      const book = await getBook();
      if (signal.aborted) return;
      const { review } = buildReviewSafely(game, full, book, preset);
      // Without a review there is nothing to select from; the next visit tries again.
      if (!review) return;
      const plies = selectMovesToRefine(review);
      const indices = positionsToRefine(plies, full, settings.depth);

      // A move is judged by the positions before and after it, so verified results are only
      // applied once both of every selected move's positions are verified (or neither is):
      // the review never compares a verified position with an unverified partner. Results
      // waiting for their partner survive a stop (shared by reference with stagedRef).
      const carried = stagedRef.current.get(fullMemoryKey);
      const staged = new Map([...(carried ?? [])].filter(([index]) => indices.includes(index)));
      stagedRef.current.set(fullMemoryKey, staged);
      const pending = new Set(indices.filter((index) => !staged.has(index)));
      const reportRefining = reportProgress('refining');
      const commitIfConsistent = () => {
        if (plies.some((ply) => pending.has(ply - 1) !== pending.has(ply))) return;
        for (const [position, verified] of staged) {
          const original = full[position];
          if (original && isBetterAnalysis(verified, original)) {
            full[position] = verifiedAnalysis(verified, original);
            unsavedFull++;
          }
        }
        staged.clear();
      };

      const total = indices.length;
      const alreadyDone = total - pending.size;
      enterPhase('refining', { done: alreadyDone, total }, plies.length);
      if (pending.size > 0) {
        await analyzePositions(game, {
          engine,
          settings,
          indices: [...pending],
          signal,
          onPosition: (index, analysis) => {
            pending.delete(index);
            staged.set(index, analysis);
            commitIfConsistent();
            if (signal.aborted) return;
            // Each verification search takes seconds, so every result is worth saving.
            persist();
            scheduleFlush();
          },
          onProgress: (progress) =>
            reportRefining({ ...progress, done: alreadyDone + progress.done, total }),
        });
      }
      commitIfConsistent();
      stagedRef.current.delete(fullMemoryKey);
      completePass('refining', total);
      refined = true;
      refinedRef.current.add(fullMemoryKey);
      unsavedFull++;
      persist();
    };

    const run = async () => {
      if (!paused) setStatus({ status: 'preparing' });
      if (presetOverride === null) {
        const deeper = await findCompletePreset(record.id, deeperPresets(presetId), totalPositions);
        if (signal.aborted) return;
        if (deeper) {
          // Re-runs this effect with the deeper preset, whose cache is complete.
          setPresetOverride(deeper.id);
          return;
        }
      }

      const cached = await safeLoad(fullKey);
      if (signal.aborted) return;
      full = mergeAnalyses(
        memory.get(fullMemoryKey) ?? null,
        cached?.analyses ?? null,
        totalPositions,
      );
      memory.set(fullMemoryKey, full);
      refined = cached?.refined === true || refinedRef.current.has(fullMemoryKey);
      const fullDone = isAnalysisComplete(full, totalPositions);

      // The quick pass only runs when there is no complete review to show meanwhile: not when
      // this preset's analysis is cached, nor while a deeper run replaces a finished review.
      let usesQuick = false;
      if (!fullDone && presetOverride === null) {
        const shallower = await findCompletePreset(
          record.id,
          shallowerPresets(presetId),
          totalPositions,
        );
        if (signal.aborted) return;
        if (shallower) {
          const shown = { analyses: shallower.analyses, preset: PRESETS[shallower.id] };
          setPrevious((current) => current ?? shown);
        } else {
          const cachedQuick = await safeLoad(quickKey);
          if (signal.aborted) return;
          const restored = mergeAnalyses(
            memory.get(quickMemoryKey) ?? null,
            cachedQuick?.analyses ?? null,
            totalPositions,
          );
          // One slot per position: the quick pass skips (and leaves null) what the full pass
          // already has, so the array would otherwise have holes.
          quick = Array.from({ length: totalPositions }, (_, index) => restored[index] ?? null);
          memory.set(quickMemoryKey, quick);
          usesQuick = true;
        }
      }
      const quickDone = !usesQuick || isAnalysisComplete(layered(), totalPositions);
      flushNow();

      const phase: AnalysisPhase = !quickDone
        ? 'quick'
        : !fullDone
          ? 'full'
          : !refined
            ? 'refining'
            : 'done';
      const quickPass = usesQuick
        ? { done: contiguousCount(layered()), total: totalPositions }
        : null;
      const fullPass = { done: contiguousCount(full), total: totalPositions };
      setTrack((current) => {
        const refining = phase === 'refining' ? current.passes.refining : null;
        const pass = phase === 'quick' ? quickPass : phase === 'refining' ? refining : fullPass;
        return {
          phase,
          progress: pass ? { done: pass.done, total: pass.total } : null,
          passes: { quick: quickPass, full: fullPass, refining },
          refineMoves: phase === 'refining' ? current.refineMoves : 0,
        };
      });

      if (phase === 'done') {
        setPrevious(null);
        setStatus({ status: 'done' });
        return;
      }
      if (paused) {
        setStatus({ status: 'paused' });
        return;
      }

      let engine: Engine;
      try {
        engine = await getSharedEngine();
      } catch (error) {
        console.error('Stockfish failed to start', error);
        if (!signal.aborted) setStatus({ status: 'engine-error', message: ENGINE_START_ERROR });
        return;
      }
      if (signal.aborted) return;
      setStatus({ status: 'running' });
      // One engine serves both: an insights job running in the background waits while this
      // review is analysed, instead of both running at half speed.
      releaseEngine = holdInsightsJob();

      try {
        await prepareEngineForGame(engine, record.id);
        if (signal.aborted) return;
        if (!quickDone) await runQuickPass(engine);
        if (signal.aborted) return;
        if (!fullDone) await runFullPass(engine);
        if (signal.aborted) return;
        if (!refined) await runRefinement(engine);
        persist();
        if (signal.aborted) return;
        flushNow();
        cancelProgress();
        setTrack((current) => ({
          ...current,
          phase: 'done',
          progress: { done: totalPositions, total: totalPositions },
          passes: { ...current.passes, full: { done: totalPositions, total: totalPositions } },
        }));
        setPrevious(null);
        setStatus({ status: 'done' });
      } catch (error) {
        persist();
        if (signal.aborted || isAbortError(error)) return;
        console.error('Analysis failed', error);
        flushNow();
        setStatus({ status: 'failed', message: errorMessage(error) });
      } finally {
        releaseEngine();
      }
    };

    void run();
    return () => {
      controller.abort();
      clearTimeout(flushTimer);
      cancelProgress();
      releaseEngine?.();
      persist();
    };
  }, [load, preset, presetId, presetOverride, paused, runAttempt, getBook]);

  // 4. Analyses → review. Throttled upstream: `layers` changes at most every 750 ms.
  const game = load.status === 'ready' ? load.game : null;
  const totalPositions = game ? game.moves.length + 1 : 0;
  // Right after the preset changes, `layers` still holds the previous preset's analyses.
  const { full, quick } = layers.presetId === presetId ? layers : NO_LAYERS;
  const analyses = useMemo(
    () => (quick.length > 0 ? mergeAnalyses(full, quick, totalPositions) : full),
    [full, quick, totalPositions],
  );
  const provisional = useMemo(
    () => analyses.some((analysis, index) => !!analysis && !full[index]),
    [analyses, full],
  );
  const livePreset = useMemo(
    () => (provisional ? quickPresetFor(preset) : preset),
    [provisional, preset],
  );
  const live = useMemo(
    () =>
      game && book.ready ? buildReviewSafely(game, analyses, book.book, livePreset) : NO_REVIEW,
    [game, analyses, book, livePreset],
  );
  const previousBuilt = useMemo(
    () =>
      game && book.ready && previous
        ? buildReviewSafely(game, previous.analyses, book.book, previous.preset)
        : NO_REVIEW,
    [game, previous, book],
  );
  const liveReview = live.review;
  const previousReview = previousBuilt.review;
  const showingPreviousAnalysis =
    !!previous &&
    !!previousReview &&
    (!liveReview || liveReview.moves.length < previousReview.moves.length);

  const perspective = useMemo(
    () => (load.status === 'ready' ? resolvePerspective(load.record, asUsername) : null),
    [load, asUsername],
  );

  // 5. A finished review goes to the library (again after a deeper analysis finishes).
  const finishedReview =
    status.status === 'done' &&
    !provisional &&
    !showingPreviousAnalysis &&
    game !== null &&
    game.moves.length > 0 &&
    liveReview?.moves.length === game.moves.length
      ? liveReview
      : null;
  useEffect(() => {
    if (!finishedReview || load.status !== 'ready') return;
    void saveReviewToLibrary(load.record, load.game, finishedReview, perspective);
  }, [finishedReview, load, perspective]);

  const retry = useCallback(() => setLoadAttempt((n) => n + 1), []);
  const stop = useCallback(() => {
    setPaused(true);
    setStatus({ status: 'paused' });
  }, []);
  const resume = useCallback(() => {
    setPaused(false);
    setRunAttempt((n) => n + 1);
  }, []);
  const nextPreset = deeperPreset(presetId);
  const analyseDeeper = useCallback(() => {
    if (!nextPreset) return;
    // Keep showing the current review until the deeper one covers as many moves.
    const keep = showingPreviousAnalysis && previous ? previous : { analyses, preset };
    setPrevious(keep);
    setPresetOverride(nextPreset);
    setPaused(false);
  }, [nextPreset, showingPreviousAnalysis, previous, analyses, preset]);

  const phaseDepth =
    track.phase === 'quick'
      ? QUICK_PASS.depth
      : track.phase === 'refining'
        ? refineSettings(preset).depth
        : preset.depth;

  return {
    load,
    analyses: showingPreviousAnalysis && previous ? previous.analyses : analyses,
    review: showingPreviousAnalysis ? previousReview : liveReview,
    showingPreviousAnalysis,
    provisional: !showingPreviousAnalysis && provisional,
    reviewPreset: showingPreviousAnalysis && previous ? previous.preset : livePreset,
    reviewFailed: showingPreviousAnalysis ? previousBuilt.failed : live.failed,
    analysis: {
      status: status.status,
      progress: track.progress,
      preset,
      message: status.message,
      phase: track.phase,
      passes: track.passes,
      phaseDepth,
      refineMoves: track.refineMoves,
    },
    perspective,
    canAnalyseDeeper:
      nextPreset !== null &&
      !provisional &&
      (status.status === 'done' || status.status === 'paused'),
    retry,
    stop,
    resume,
    analyseDeeper,
  };
}
