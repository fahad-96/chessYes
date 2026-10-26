import { clear, createStore, get, set, type UseStore } from 'idb-keyval';
import type { AnalysisSettings, PositionAnalysis, TerminalState } from '@/core/types';

/**
 * IndexedDB cache of engine analyses (idb-keyval, store "kibitz-analysis").
 * We cache raw analyses, not reviews: classification rules can change without
 * invalidating anything, and partial runs can resume where they stopped.
 */

/**
 * Bump when the stored shape changes, or when stored analyses are known to be wrong;
 * older entries are then ignored.
 * 2: the engine wrapper no longer mixes MultiPV lines from different iterations, which
 *    could store the same move as both line 1 and line 2.
 */
const CACHE_VERSION = 2;

interface CacheEntry {
  v: typeof CACHE_VERSION;
  savedAt: number;
  analyses: (PositionAnalysis | null)[];
}

const TERMINAL_STATES: readonly TerminalState[] = [
  'checkmate',
  'stalemate',
  'insufficient',
  'threefold',
  'fifty-move',
];

let store: UseStore | undefined;

/** Created on first use: some browsers (private modes, locked-down webviews) lack IndexedDB. */
function analysisStore(): UseStore {
  store ??= createStore('kibitz-analysis', 'analyses');
  return store;
}

/** Cache key: game id + engine + settings that affect the result. */
export function analysisCacheKey(
  gameId: string,
  engineName: string,
  settings: AnalysisSettings,
): string {
  const { depth, multiPv, maxTimeMs } = settings;
  return `${gameId}|${engineName}|d${depth}|pv${multiPv}|t${maxTimeMs}`;
}

/** Returns cached (possibly partial) analyses, or null. Never throws (storage may be unavailable). */
export async function loadAnalyses(key: string): Promise<(PositionAnalysis | null)[] | null> {
  try {
    const entry: unknown = await get(key, analysisStore());
    if (!isCacheEntry(entry)) return null;
    // Structured clone keeps holes in sparse arrays; callers expect explicit nulls.
    return Array.from(entry.analyses, (analysis) => analysis ?? null);
  } catch {
    return null;
  }
}

/** Saves analyses. Never throws. */
export async function saveAnalyses(
  key: string,
  analyses: (PositionAnalysis | null)[],
): Promise<void> {
  try {
    const entry: CacheEntry = {
      v: CACHE_VERSION,
      savedAt: Date.now(),
      analyses: Array.from(analyses, (analysis) => analysis ?? null),
    };
    await set(key, entry, analysisStore());
  } catch {
    // Quota exceeded or storage unavailable: the analysis still works, it just is not cached.
  }
}

/** Removes every cached analysis (Settings → "Clear analysis cache"). */
export async function clearAnalysisCache(): Promise<void> {
  try {
    await clear(analysisStore());
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

// ---------------------------------------------------------------------------
// Validation: stored data may come from an older build or be corrupted, and the
// review code trusts these shapes, so anything unexpected is treated as a miss.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isScore(value: unknown): boolean {
  return (
    isRecord(value) && (value.type === 'cp' || value.type === 'mate') && isFiniteNumber(value.value)
  );
}

function isEngineLine(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.pv) &&
    value.pv.every((move) => typeof move === 'string') &&
    isScore(value.score) &&
    isFiniteNumber(value.depth)
  );
}

function isPositionAnalysis(value: unknown): value is PositionAnalysis {
  return (
    isRecord(value) &&
    typeof value.fen === 'string' &&
    isFiniteNumber(value.depth) &&
    Array.isArray(value.lines) &&
    value.lines.every(isEngineLine) &&
    (value.terminal === undefined || TERMINAL_STATES.includes(value.terminal as TerminalState)) &&
    (value.nodes === undefined || isFiniteNumber(value.nodes)) &&
    (value.timeMs === undefined || isFiniteNumber(value.timeMs))
  );
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    isRecord(value) &&
    value.v === CACHE_VERSION &&
    Array.isArray(value.analyses) &&
    value.analyses.every((analysis: unknown) => analysis == null || isPositionAnalysis(analysis))
  );
}
