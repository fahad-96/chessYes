import type { OpeningBook } from './openings';
import type { GameReview, ParsedGame, PositionAnalysis } from './types';

/** Bump when GameReview's shape or the classification rules change. */
export const REVIEW_FORMAT_VERSION = 1;

export interface BuildReviewOptions {
  book: OpeningBook | null;
  engine: { name: string; depth: number; multiPv: number };
}

/**
 * Turns engine analyses into a full game review. Pure and synchronous.
 *
 * @param analyses analyses[i] is the position BEFORE move i+1 (index 0 = start
 *   position, index moves.length = final position). The array may be shorter than
 *   moves.length + 1 (analysis still running) or contain nulls (not analysed yet):
 *   a move is reviewed only when both the position before and after it are
 *   available, and reviewing stops at the first gap. `whiteWinPercents` likewise
 *   covers the contiguous analysed prefix.
 */
export function buildGameReview(
  _game: ParsedGame,
  _analyses: (PositionAnalysis | null)[],
  _options: BuildReviewOptions,
): GameReview {
  throw new Error('not implemented');
}
