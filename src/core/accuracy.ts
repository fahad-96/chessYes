import type { Color } from './types';

/**
 * Accuracy, ported from Lichess (lila: AccuracyPercent.scala).
 *
 * Per move: 103.1668100711649 * exp(-0.04354415386753951 * winDiff) - 3.166924740191411,
 * plus a +1 "uncertainty bonus", clamped to [0, 100]; 100 when the move did not lose win %.
 *
 * Per game and player: the average of (a) the mean of move accuracies weighted by
 * position volatility (std-dev of win % over a sliding window, clamped to [0.5, 12])
 * and (b) the harmonic mean of move accuracies.
 */

/** Accuracy of one move from the mover's win % before and after it. */
export function moveAccuracy(_winBefore: number, _winAfter: number): number {
  throw new Error('not implemented');
}

/**
 * Game accuracy for both players.
 * @param whiteWinPercents White's win % for every position, index 0 = start position.
 * @param firstMover The colour that made the first move of the game (usually 'w').
 * @returns Accuracy per player; a player who made no moves gets 100 (the UI shows "—"
 *          for a player whose move counts are all zero).
 */
export function gameAccuracy(
  _whiteWinPercents: number[],
  _firstMover: Color,
): { white: number; black: number } {
  throw new Error('not implemented');
}
