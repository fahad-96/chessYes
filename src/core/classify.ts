import type { Classification, Color, SacrificeInfo, Square } from './types';

export interface ClassifyInput {
  color: Color;
  uci: string;
  /** Mover's win % before the move (engine's best line). */
  winBefore: number;
  /** Mover's win % after the move played. */
  winAfter: number;
  /** Mover's win % for the engine's second choice, when MultiPV 2 found one. */
  winSecondBest?: number;
  /** Engine's top move (UCI) in the position before the move. */
  bestUci?: string;
  /** Number of legal moves the mover had. */
  legalMoveCount: number;
  /** True while the game is still following the opening book (this move included). */
  inBook: boolean;
  /** Destination square of the opponent's previous move and whether it captured (recapture detection). */
  previousMove?: { to: Square; wasCapture: boolean };
  /** Whether this move captures something, and on which square it lands. */
  isCapture: boolean;
  to: Square;
  /** Result of material.detectSacrifice for this move. */
  sacrifice: SacrificeInfo | null;
}

/**
 * Classifies one move. Rules, in order of precedence (see docs/CLASSIFICATION.md):
 *  1. Book      – inBook.
 *  2. Forced    – legalMoveCount === 1.
 *  3. Base label from the win % lost (THRESHOLDS.loss): Best when the move is the
 *     engine's top move or loses nothing, then Excellent / Good / Inaccuracy / Mistake / Blunder.
 *  4. Brilliant – base is Best/Excellent, loss <= brilliant.maxLoss, a sacrifice of at least
 *     brilliant.minSacrifice, winAfter >= brilliant.minWinAfter, and the second-best move
 *     does not also keep >= brilliant.maxSecondBestWin.
 *  5. Great     – base is Best and the move equals bestUci, a second-best move exists that is
 *     at least great.minGapToSecond worse and keeps < great.maxSecondBestWin, and the move is
 *     not a simple recapture on the square the opponent just captured on.
 *  6. Missed Win – base is Inaccuracy/Mistake/Blunder, winBefore >= missedWin.minWinBefore,
 *     missedWin.minWinAfter <= winAfter < missedWin.maxWinAfter, loss >= missedWin.minLoss.
 */
export function classifyMove(_input: ClassifyInput): Classification {
  throw new Error('not implemented');
}

/** Base label from win % loss only (rule 3), exported for tests and docs. */
export function baseClassification(_loss: number, _isEngineBest: boolean): Classification {
  throw new Error('not implemented');
}
