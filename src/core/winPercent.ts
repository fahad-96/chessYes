import { sideToMove } from './notation';
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
export function cpToWinPercent(cp: number): number {
  // Beyond ±10 pawns the game is decided either way; clamping also keeps
  // engine noise in lost positions from moving the graph or the accuracy.
  const clamped = Math.min(CP_CEILING, Math.max(-CP_CEILING, cp));
  return 50 + 50 * (2 / (1 + Math.exp(WIN_PERCENT_MULTIPLIER * clamped)) - 1);
}

/** White's win % for a score (White POV). Mates map to the ±CP_CEILING value. */
export function scoreToWinPercent(score: Score): number {
  if (score.type === 'mate') return cpToWinPercent(score.value > 0 ? CP_CEILING : -CP_CEILING);
  return cpToWinPercent(score.value);
}

/** Converts White's win % to the given player's win %. */
export function winPercentFor(whiteWinPercent: number, color: Color): number {
  return color === 'w' ? whiteWinPercent : 100 - whiteWinPercent;
}

/**
 * White's win % for an analysed position, using the best line.
 * Terminal positions: checkmate → 0 or 100 for the side to move being mated
 * (side to move is read from the FEN); every other terminal state → 50.
 * Throws if the position has neither lines nor a terminal state.
 */
export function positionWhiteWinPercent(analysis: PositionAnalysis): number {
  if (analysis.terminal === 'checkmate') return sideToMove(analysis.fen) === 'w' ? 0 : 100;
  if (analysis.terminal !== undefined) return 50;

  const best = analysis.lines[0];
  if (!best) throw new Error(`No engine line for position: ${analysis.fen}`);
  return scoreToWinPercent(best.score);
}

/** Short human label for a score, e.g. "+1.3", "-0.4", "M3", "-M2" (White POV). */
export function formatScore(score: Score): string {
  if (score.type === 'mate') {
    return score.value < 0 ? `-M${-score.value}` : `M${score.value}`;
  }
  // Round to tenths of a pawn symmetrically (half away from zero) and build the
  // string from integers, so -0.04 prints as "0.0" rather than "-0.0".
  const tenths = Math.round(Math.abs(score.value) / 10);
  if (tenths === 0) return '0.0';
  const sign = score.value > 0 ? '+' : '-';
  return `${sign}${Math.floor(tenths / 10)}.${tenths % 10}`;
}
