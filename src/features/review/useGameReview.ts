import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnalysisProgress,
  GameRecord,
  GameReview,
  ParsedGame,
  PositionAnalysis,
} from '@/core/types';
import { parsePgn } from '@/core/pgn';
import { buildGameReview } from '@/core/review';
import { loadOpeningBook, type OpeningBook } from '@/core/openings';
import { analyzeGame } from '@/engine/analyzeGame';
import { analysisCacheKey, loadAnalyses, saveAnalyses } from '@/engine/cache';
import { PRESETS, type Preset, type PresetId } from '@/engine/presets';
import { ENGINE_NAME, type Engine } from '@/engine/stockfish';
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
  mergeAnalyses,
  variantError,
  type ReviewLoadError,
} from './reviewHelpers';

/** While analysis streams in, rebuild the review at most this often (it is O(moves)). */
const REBUILD_INTERVAL_MS = 750;
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

export interface AnalysisState {
  status: AnalysisStatus;
  progress: AnalysisProgress | null;
  preset: Preset;
  /** Error details for 'engine-error' and 'failed'. */
  message?: string;
}

export interface GameReviewState {
  load: LoadState;
  /** Analyses behind `review` (index = ply). */
  analyses: readonly (PositionAnalysis | null)[];
  review: GameReview | null;
  /** True while a deeper analysis runs and the previous, complete review is still shown. */
  showingPreviousAnalysis: boolean;
  /** Analyses exist but turning them into a review threw (details are in the console). */
  reviewFailed: boolean;
  analysis: AnalysisState;
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

function safeResolvePreset(preset: Parameters<typeof resolvePreset>[0]): PresetId {
  try {
    return resolvePreset(preset);
  } catch {
    return 'standard';
  }
}

function safeCacheKey(gameId: string, preset: Preset): string | null {
  try {
    return analysisCacheKey(gameId, ENGINE_NAME, preset);
  } catch {
    return null;
  }
}

async function safeLoad(key: string | null): Promise<Analyses | null> {
  if (!key) return null;
  try {
    return await loadAnalyses(key);
  } catch {
    return null;
  }
}

function safeSave(key: string | null, analyses: Analyses): void {
  if (!key) return;
  try {
    saveAnalyses(key, analyses).catch(() => undefined);
  } catch {
    // Storage is optional: the review works without a cache.
  }
}

/** A deeper analysis finished on an earlier visit beats re-analysing at the default depth. */
async function findCompleteDeeperPreset(
  gameId: string,
  presetId: PresetId,
  totalPositions: number,
): Promise<PresetId | null> {
  for (const candidate of deeperPresets(presetId)) {
    const cached = await safeLoad(safeCacheKey(gameId, PRESETS[candidate]));
    if (isAnalysisComplete(cached, totalPositions)) return candidate;
  }
  return null;
}

interface BuiltReview {
  review: GameReview | null;
  failed: boolean;
}

const NO_REVIEW: BuiltReview = { review: null, failed: false };

function buildReviewSafely(
  game: ParsedGame,
  analyses: readonly (PositionAnalysis | null)[],
  book: OpeningBook | null,
  preset: Preset,
): BuiltReview {
  if (!analyses[0]) return NO_REVIEW;
  try {
    const review = buildGameReview(game, analyses as Analyses, {
      book,
      engine: { name: ENGINE_NAME, depth: preset.depth, multiPv: preset.multiPv },
    });
    return { review, failed: false };
  } catch (error) {
    // A bug in the review rules must not take the board and move list down with it.
    console.error('Could not build the game review', error);
    return { review: null, failed: true };
  }
}

/**
 * Everything the review screen needs for one game: loads the game, restores cached
 * analysis, runs Stockfish for the rest (streaming results), and turns analyses into
 * a GameReview. Mount it with `key={gameId}` so a new game starts from a clean state.
 */
export function useGameReview(gameId: string): GameReviewState {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [book, setBook] = useState<{ ready: boolean; book: OpeningBook | null }>({
    ready: false,
    book: null,
  });

  const settingsPreset = useSettings((state) => state.preset);
  const basePresetId = useMemo(() => safeResolvePreset(settingsPreset), [settingsPreset]);
  const [presetOverride, setPresetOverride] = useState<PresetId | null>(null);
  const presetId = presetOverride ?? basePresetId;
  const preset = PRESETS[presetId];

  const [analyses, setAnalyses] = useState<Analyses>([]);
  const [paused, setPaused] = useState(false);
  const [runAttempt, setRunAttempt] = useState(0);
  const [status, setStatus] = useState<{ status: AnalysisStatus; message?: string }>({
    status: 'preparing',
  });
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  /** The previous preset's analyses, shown until a deeper run catches up. */
  const [previous, setPrevious] = useState<{ analyses: Analyses; preset: Preset } | null>(null);
  /** Analyses per cache key that are newer than what may have reached IndexedDB. */
  const memoryRef = useRef(new Map<string, Analyses>());

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

  // 2. The opening book loads in parallel with everything else; the review works without it.
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(loadOpeningBook)
      .then(
        (loaded) => active && setBook({ ready: true, book: loaded }),
        (error: unknown) => {
          console.warn('Opening book unavailable; reviewing without book moves.', error);
          if (active) setBook({ ready: true, book: null });
        },
      );
    return () => {
      active = false;
    };
  }, []);

  // 3. Restore cached analyses and analyse whatever is missing.
  useEffect(() => {
    if (load.status !== 'ready') return;
    const { record, game } = load;
    const totalPositions = game.moves.length + 1;
    const controller = new AbortController();
    const { signal } = controller;
    const cacheKey = safeCacheKey(record.id, preset);
    const memoryKey = cacheKey ?? `${record.id}|${presetId}`;

    let working: Analyses = [];
    let unsaved = 0;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let lastFlushAt = 0;
    let lastProgressAt = 0;
    let lastProgressDone = -1;

    const flush = () => {
      flushTimer = undefined;
      lastFlushAt = Date.now();
      setAnalyses(working.slice());
    };
    const flushNow = () => {
      clearTimeout(flushTimer);
      flush();
    };
    const scheduleFlush = () => {
      if (flushTimer !== undefined) return;
      flushTimer = setTimeout(flush, Math.max(0, REBUILD_INTERVAL_MS - (Date.now() - lastFlushAt)));
    };
    const persist = () => {
      if (unsaved === 0) return;
      unsaved = 0;
      safeSave(cacheKey, working.slice());
    };

    const run = async () => {
      if (!paused) setStatus({ status: 'preparing' });
      if (presetOverride === null) {
        const deeper = await findCompleteDeeperPreset(record.id, presetId, totalPositions);
        if (signal.aborted) return;
        if (deeper) {
          // Re-runs this effect with the deeper preset, whose cache is complete.
          setPresetOverride(deeper);
          return;
        }
      }

      const cached = await safeLoad(cacheKey);
      if (signal.aborted) return;
      working = mergeAnalyses(memoryRef.current.get(memoryKey) ?? null, cached, totalPositions);
      // Shared by reference so results that land after an abort are not lost.
      memoryRef.current.set(memoryKey, working);
      flushNow();
      setProgress({ done: contiguousCount(working), total: totalPositions });

      if (isAnalysisComplete(working, totalPositions)) {
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

      try {
        await prepareEngineForGame(engine, record.id);
        if (signal.aborted) return;
        const result = await analyzeGame(game, {
          engine,
          settings: preset,
          existing: working.slice(),
          signal,
          onPosition: (index, analysis) => {
            working[index] = analysis;
            if (signal.aborted) return;
            if (++unsaved >= SAVE_EVERY_POSITIONS) persist();
            scheduleFlush();
          },
          onProgress: (next) => {
            if (signal.aborted) return;
            const now = Date.now();
            if (next.done === lastProgressDone && now - lastProgressAt < PROGRESS_INTERVAL_MS)
              return;
            lastProgressDone = next.done;
            lastProgressAt = now;
            setProgress(next);
          },
        });
        result.forEach((analysis, index) => {
          if (analysis && !working[index]) {
            working[index] = analysis;
            unsaved++;
          }
        });
        persist();
        if (signal.aborted) return;
        flushNow();
        setProgress({ done: totalPositions, total: totalPositions });
        setPrevious(null);
        setStatus({ status: 'done' });
      } catch (error) {
        persist();
        if (signal.aborted || isAbortError(error)) return;
        console.error('Analysis failed', error);
        flushNow();
        setStatus({ status: 'failed', message: errorMessage(error) });
      }
    };

    void run();
    return () => {
      controller.abort();
      clearTimeout(flushTimer);
      persist();
    };
  }, [load, preset, presetId, presetOverride, paused, runAttempt]);

  // 4. Analyses → review. Throttled upstream: `analyses` changes at most every 750 ms.
  const game = load.status === 'ready' ? load.game : null;
  const live = useMemo(
    () => (game && book.ready ? buildReviewSafely(game, analyses, book.book, preset) : NO_REVIEW),
    [game, analyses, book, preset],
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

  return {
    load,
    analyses: showingPreviousAnalysis && previous ? previous.analyses : analyses,
    review: showingPreviousAnalysis ? previousReview : liveReview,
    showingPreviousAnalysis,
    reviewFailed: showingPreviousAnalysis ? previousBuilt.failed : live.failed,
    analysis: { status: status.status, progress, preset, message: status.message },
    canAnalyseDeeper:
      nextPreset !== null && (status.status === 'done' || status.status === 'paused'),
    retry,
    stop,
    resume,
    analyseDeeper,
  };
}
