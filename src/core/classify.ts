import { THRESHOLDS } from './thresholds';
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
  /**
   * Forced mate from the mover's point of view as signed moves to mate (positive: the mover
   * mates, negative: the mover gets mated), from the engine's best line before the move.
   * Undefined when the engine saw no forced mate.
   */
  mateBefore?: number;
  /** The same for the position after the move; 0 when the move itself is checkmate. */
  mateAfter?: number;
}

/**
 * Classifies one move. Rules, in order of precedence (see docs/CLASSIFICATION.md):
 *  1. Book      – inBook.
 *  2. Forced    – legalMoveCount === 1.
 *  3. Base label from the win % lost (THRESHOLDS.loss): Best when the move is the
 *     engine's top move or loses nothing, then Excellent / Good / Inaccuracy / Mistake / Blunder.
 *     For any other move, a mate swing (THRESHOLDS.mate) can make the base label worse:
 *     allowing a forced mate, or letting the mover's own forced mate slip.
 *  4. Brilliant – base is Best/Excellent, loss <= brilliant.maxLoss, a sacrifice of at least
 *     brilliant.minSacrifice, winAfter >= brilliant.minWinAfter, and the second-best move
 *     does not also keep >= brilliant.maxSecondBestWin.
 *  5. Great     – base is Best and the move equals bestUci, a second-best move exists that is
 *     at least great.minGapToSecond worse and keeps < great.maxSecondBestWin, and the move is
 *     not a simple recapture on the square the opponent just captured on.
 *  6. Missed Win – base is Inaccuracy/Mistake/Blunder, winBefore >= missedWin.minWinBefore,
 *     missedWin.minWinAfter <= winAfter < missedWin.maxWinAfter, loss >= missedWin.minLoss.
 */
export function classifyMove(input: ClassifyInput): Classification {
  if (input.inBook) return 'book';
  if (input.legalMoveCount === 1) return 'forced';

  const loss = Math.max(0, input.winBefore - input.winAfter);
  const isEngineBest = input.bestUci !== undefined && input.uci === input.bestUci;
  const lossLabel = baseClassification(loss, isEngineBest);
  const mateLabel = isEngineBest ? null : mateSwingClassification(input);
  const base = mateLabel ? worseOf(lossLabel, mateLabel) : lossLabel;

  if (isBrilliant(input, base, loss)) return 'brilliant';
  if (isGreat(input, base, isEngineBest)) return 'great';
  if (isMissedWin(input, base, loss)) return 'missedWin';
  return base;
}

/** Base label from win % loss only (rule 3), exported for tests and docs. */
export function baseClassification(loss: number, isEngineBest: boolean): Classification {
  const { excellent, good, inaccuracy, mistake } = THRESHOLDS.loss;
  if (isEngineBest || loss <= 0) return 'best';
  if (loss <= excellent) return 'excellent';
  if (loss <= good) return 'good';
  if (loss <= inaccuracy) return 'inaccuracy';
  if (loss <= mistake) return 'mistake';
  return 'blunder';
}

/**
 * The label a mate swing deserves at least (part of rule 3), or null when there is none:
 * - allowing a forced mate the mover was not already facing, graded by how bad winBefore was;
 * - letting the mover's own forced mate slip (no mate and no checkmate after the move),
 *   graded by how much of the advantage winAfter still keeps.
 * Exported for tests and docs.
 */
export function mateSwingClassification(
  input: Pick<ClassifyInput, 'winBefore' | 'winAfter' | 'mateBefore' | 'mateAfter'>,
): Classification | null {
  const rule = THRESHOLDS.mate;
  const { winBefore, winAfter, mateBefore, mateAfter } = input;
  const matedBefore = mateBefore !== undefined && mateBefore < 0;
  const matingBefore = mateBefore !== undefined && mateBefore > 0;
  const matedAfter = mateAfter !== undefined && mateAfter < 0;
  const matingAfter = mateAfter !== undefined && mateAfter >= 0;

  let label: Classification | null = null;
  if (matedAfter && !matedBefore) {
    if (winBefore > rule.allowedBlunderAbove) label = 'blunder';
    else if (winBefore > rule.allowedMistakeAbove) label = 'mistake';
    else label = 'inaccuracy';
  }
  if (matingBefore && !matingAfter) {
    let lost: Classification = 'blunder';
    if (winAfter >= rule.lostInaccuracyFrom) lost = 'inaccuracy';
    else if (winAfter >= rule.lostMistakeFrom) lost = 'mistake';
    label = label ? worseOf(label, lost) : lost;
  }
  return label;
}

/** Base labels from least to most severe. */
const SEVERITY: readonly Classification[] = [
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
];

/** The more severe of two base labels. */
function worseOf(a: Classification, b: Classification): Classification {
  return SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b;
}

/** Rule 4: a sound sacrifice that was also necessary. */
function isBrilliant(input: ClassifyInput, base: Classification, loss: number): boolean {
  const rule = THRESHOLDS.brilliant;
  if (base !== 'best' && base !== 'excellent') return false;
  if (loss > rule.maxLoss) return false;
  if (input.sacrifice === null || input.sacrifice.material < rule.minSacrifice) return false;
  if (input.winAfter < rule.minWinAfter) return false;
  // When a quiet alternative wins just as easily, the sacrifice is flashy but not needed.
  // Without a second line we cannot tell, so we give the sacrifice the benefit of the doubt.
  const secondBestAlsoWins =
    input.winSecondBest !== undefined && input.winSecondBest >= rule.maxSecondBestWin;
  return !secondBestAlsoWins;
}

/** Rule 5: the engine's top move when every alternative is clearly worse. */
function isGreat(input: ClassifyInput, base: Classification, isEngineBest: boolean): boolean {
  const rule = THRESHOLDS.great;
  if (base !== 'best' || !isEngineBest) return false;
  if (input.winSecondBest === undefined) return false;
  // Compare with winBefore, not winAfter: both come from the same MultiPV search, so the
  // gap is not distorted by the different depth of the search after the move.
  if (input.winBefore - input.winSecondBest < rule.minGapToSecond) return false;
  if (input.winSecondBest >= rule.maxSecondBestWin) return false;
  // Taking back a piece is usually the only move, but it is obvious, not great.
  const isRecapture =
    input.previousMove !== undefined &&
    input.previousMove.wasCapture &&
    input.isCapture &&
    input.to === input.previousMove.to;
  return !isRecapture;
}

/** Rule 6: the player had a winning position and let it slip to roughly equal. */
function isMissedWin(input: ClassifyInput, base: Classification, loss: number): boolean {
  const rule = THRESHOLDS.missedWin;
  if (base !== 'inaccuracy' && base !== 'mistake' && base !== 'blunder') return false;
  return (
    input.winBefore >= rule.minWinBefore &&
    input.winAfter >= rule.minWinAfter &&
    input.winAfter < rule.maxWinAfter &&
    loss >= rule.minLoss
  );
}
