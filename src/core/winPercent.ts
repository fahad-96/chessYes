import type { Color, PositionAnalysis, Score } from './types';

/**
 * Win-percentage model used by Lichess (lila: WinPercent.scala).
 * Maps an engine evaluation to the expected chance of winning, 0-100.
 *
 * winPercent(cp) = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 * with cp clamped to [-1000, 1000]; a forced mate counts as ±1000.
 */
export const WIN_PERCENT_MULTIPLIER = -0.00368208;
export const CP_CEILING = 1000;

/** White's win % for a centipawn score from White's point of view. */
export function cpToWinPercent(_cp: number): number {
  throw new Error('not implemented');
}

/** White's win % for a score (White POV). Mates map to the ±CP_CEILING value. */
export function scoreToWinPercent(_score: Score): number {
  throw new Error('not implemented');
}

/** Converts White's win % to the given player's win %. */
export function winPercentFor(_whiteWinPercent: number, _color: Color): number {
  throw new Error('not implemented');
}

/**
 * White's win % for an analysed position, using the best line.
 * Terminal positions: checkmate → 0 or 100 for the side to move being mated
 * (side to move is read from the FEN); every other terminal state → 50.
 * Throws if the position has neither lines nor a terminal state.
 */
export function positionWhiteWinPercent(_analysis: PositionAnalysis): number {
  throw new Error('not implemented');
}

/** Short human label for a score, e.g. "+1.3", "-0.4", "M3", "-M2" (White POV). */
export function formatScore(_score: Score): string {
  throw new Error('not implemented');
}
