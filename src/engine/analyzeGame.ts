import type { AnalysisProgress, AnalysisSettings, ParsedGame, PositionAnalysis } from '@/core/types';
import type { Engine } from './stockfish';

export interface AnalyzeGameOptions {
  engine: Engine;
  settings: AnalysisSettings;
  /** Previously finished analyses (e.g. from cache); non-null entries are not re-searched. */
  existing?: (PositionAnalysis | null)[];
  signal?: AbortSignal;
  /** Called once per finished position (including terminal ones), in order. */
  onPosition?: (index: number, analysis: PositionAnalysis) => void;
  onProgress?: (progress: AnalysisProgress) => void;
}

/**
 * Analyses every position of a game: index 0 = start, index i = after move i.
 * - Positions are searched in order so the UI can stream results.
 * - The final position is not searched when game.finalState is set; it gets
 *   { fen, depth: 0, lines: [], terminal }.
 * - MultiPV is capped at the number of legal moves.
 * - The engine receives the move history (repetition-aware evaluation).
 * - ETA is estimated from the average time of positions searched in this run.
 * - Rejects with an AbortError when the signal aborts; results reported via
 *   onPosition so far remain valid (callers cache them for resuming).
 */
export function analyzeGame(
  _game: ParsedGame,
  _options: AnalyzeGameOptions,
): Promise<PositionAnalysis[]> {
  throw new Error('not implemented');
}
