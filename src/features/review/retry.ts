/**
 * Pure helpers for "Retry" and "Learn from your mistakes": which moves can be retried,
 * what the engine already knows about a position, and the score of a session.
 */
import type { Classification, Color, GameReview, MoveReview, SuggestedLine } from '@/core/types';
import { scoreToWinPercent, winPercentFor } from '@/core/winPercent';

/** Labels worth a second try. Book, forced and the good labels have nothing to fix. */
export const RETRYABLE: ReadonlySet<Classification> = new Set([
  'inaccuracy',
  'mistake',
  'blunder',
  'missedWin',
]);

/** A move can be retried when it was an error and the engine had a better move. */
export function isRetryable(move: MoveReview | undefined): move is MoveReview & {
  best: SuggestedLine;
} {
  return !!move && RETRYABLE.has(move.classification) && !!move.best && move.best.uci !== move.uci;
}

/** Plies of the retryable moves, in game order; only `color`'s moves when given. */
export function retryablePlies(review: GameReview | null, color: Color | null = null): number[] {
  if (!review) return [];
  return review.moves
    .filter((move) => isRetryable(move) && (color === null || move.color === color))
    .map((move) => move.ply);
}

/** Mover's win % for an engine line from the position before `move`. */
function lineWin(line: SuggestedLine, color: Color): number {
  return winPercentFor(scoreToWinPercent(line.score), color);
}

/**
 * Moves whose outcome the review already knows, as the mover's win %: the engine's two
 * choices and the move that was played. checkMove then needs the engine only for others.
 */
export function knownMoves(move: MoveReview): { uci: string; win: number }[] {
  const known: { uci: string; win: number }[] = [];
  if (move.best) known.push({ uci: move.best.uci, win: lineWin(move.best, move.color) });
  if (move.secondBest) {
    known.push({ uci: move.secondBest.uci, win: lineWin(move.secondBest, move.color) });
  }
  if (!known.some((line) => line.uci === move.uci)) {
    known.push({ uci: move.uci, win: move.winAfter });
  }
  return known;
}

export function colorName(color: Color): 'White' | 'Black' {
  return color === 'w' ? 'White' : 'Black';
}

export type RetryResult = 'solved' | 'revealed' | 'skipped';

/** "You found 3 of 5 better moves" style numbers for the end of a session. */
export function sessionScore(results: readonly RetryResult[]): { solved: number; total: number } {
  return { solved: results.filter((r) => r === 'solved').length, total: results.length };
}
