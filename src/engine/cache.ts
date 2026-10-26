import type { AnalysisSettings, PositionAnalysis } from '@/core/types';

/**
 * IndexedDB cache of engine analyses (idb-keyval, store "kibitz-analysis").
 * We cache raw analyses, not reviews: classification rules can change without
 * invalidating anything, and partial runs can resume where they stopped.
 */

/** Cache key: game id + engine + settings that affect the result. */
export function analysisCacheKey(
  _gameId: string,
  _engineName: string,
  _settings: AnalysisSettings,
): string {
  throw new Error('not implemented');
}

/** Returns cached (possibly partial) analyses, or null. Never throws (storage may be unavailable). */
export function loadAnalyses(_key: string): Promise<(PositionAnalysis | null)[] | null> {
  throw new Error('not implemented');
}

/** Saves analyses. Never throws. */
export function saveAnalyses(_key: string, _analyses: (PositionAnalysis | null)[]): Promise<void> {
  throw new Error('not implemented');
}

/** Removes every cached analysis (Settings → "Clear analysis cache"). */
export function clearAnalysisCache(): Promise<void> {
  throw new Error('not implemented');
}
