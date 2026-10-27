import { THRESHOLDS } from './thresholds';
import type { Classification, Color, SacrificeInfo, Square } from './types';

export interface ClassifyInput {
  color: Color;
  uci: string;
  /** Mover's win % before the move (engine's best line), calibrated scale (winPercent.ts). */
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
  /**
   * For a capture: the material the mover could win on `to` in the position before the
   * move (material.staticExchange). Undefined or 0 when nothing could be won there.
   */
  captureGain?: number;
  /** The mover was in check before the move. */
  inCheck: boolean;
  /** The move delivers checkmate. */
  isCheckmate: boolean;
  /** Result of material.detectSacrifice for this move. */
  sacrifice: SacrificeInfo | null;
  /**
   * Forced mate from the mover's point of view as signed moves to mate (positive: the mover
   * mates, negative: the mover gets mated), from the engine's best line before the move.
   * Undefined when the engine saw no forced mate.
   */
  mateBefore?: number;
  /**
   * Material in pawn units the engine's best line wins for the mover (the 'missed' story's
   * materialSwing, see tactics.describeLine). Only needed for errors that are not the
   * engine's move; undefined when not computed.
   */
  bestLineGain?: number;
  /**
   * Material in pawn units the mover ends up with over the engine line after the move played
   * (the refutation story's materialSwing, counted from the position before the move), so
   * that material the move played wins too is not counted as missed. Undefined: 0.
   */
  playedLineGain?: number;
  /**
   * Win % the opponent gave away with their previous move, when that move was graded an
   * error (Inaccuracy or worse); undefined otherwise or for the first move.
   */
  opponentGift?: number;
}

/**
 * Classifies one move. Rules, in order of precedence (see docs/CLASSIFICATION.md):
 *  1. Book      – inBook.
 *  2. Forced    – legalMoveCount === 1.
 *  3. Base label from the win % lost (THRESHOLDS.loss): Best when the move is the
 *     engine's top move or loses nothing, then Excellent / Good / Inaccuracy / Mistake / Blunder.
 *     A forced mate counts as 100 % (0 % for the side being mated), so letting one slip or
 *     walking into one costs win % like any other move.
 *  4. Brilliant – base is Best/Excellent, loss <= brilliant.maxLoss, a sacrifice of at least
 *     brilliant.minSacrifice, winAfter >= brilliant.minWinAfter, and the second-best move
 *     does not also keep >= brilliant.maxSecondBestWin.
 *  5. Great     – base is Best and the move equals bestUci, loss <= great.maxLoss, a second-best
 *     move exists that is at least great.minGapToSecond worse and keeps < great.maxSecondBestWin,
 *     and the move is not obvious: not an answer to a check, not checkmate itself, not a simple
 *     recapture on the square the opponent just captured on, and not a capture that wins at
 *     least great.obviousCaptureGain outright.
 *  6. Miss ('missedWin') – base is Inaccuracy/Mistake/Blunder, winAfter >= miss.minWinAfter,
 *     and there was a chance: the best move starts a forced mate (mateBefore > 0), or the best
 *     line wins at least miss.minMaterialWon more than the line after the move played
 *     (bestLineGain - max(0, playedLineGain)), or the opponent's previous error
 *     gave away at least miss.minGift (opponentGift) and this move gives back at least
 *     miss.minShareGivenBack of it.
 */
export function classifyMove(input: ClassifyInput): Classification {
  if (input.inBook) return 'book';
  if (input.legalMoveCount === 1) return 'forced';

  const loss = Math.max(0, input.winBefore - input.winAfter);
  const isEngineBest = input.bestUci !== undefined && input.uci === input.bestUci;
  const base = baseClassification(loss, isEngineBest);

  if (isBrilliant(input, base, loss)) return 'brilliant';
  if (isGreat(input, base, isEngineBest, loss)) return 'great';
  if (isMiss(input, base, loss)) return 'missedWin';
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
function isGreat(
  input: ClassifyInput,
  base: Classification,
  isEngineBest: boolean,
  loss: number,
): boolean {
  const rule = THRESHOLDS.great;
  if (base !== 'best' || !isEngineBest) return false;
  if (input.winSecondBest === undefined) return false;
  // Compare with winBefore, not winAfter: both come from the same MultiPV search, so the
  // gap is not distorted by the different depth of the search after the move.
  if (input.winBefore - input.winSecondBest < rule.minGapToSecond) return false;
  if (input.winSecondBest >= rule.maxSecondBestWin) return false;
  // The top move of a search that the search after it refutes was not a great find.
  if (loss > rule.maxLoss) return false;
  return !isObvious(input);
}

/**
 * Moves that are often the only good move but take no finding: answering a check (there
 * are few options), delivering checkmate (the end of a mate, not the decision that won),
 * taking back a piece on the square the opponent just captured on, and capturing a piece
 * that was simply hanging.
 */
function isObvious(input: ClassifyInput): boolean {
  if (input.inCheck || input.isCheckmate) return true;
  if (!input.isCapture) return false;
  const isRecapture =
    input.previousMove !== undefined &&
    input.previousMove.wasCapture &&
    input.to === input.previousMove.to;
  return isRecapture || (input.captureGain ?? 0) >= THRESHOLDS.great.obviousCaptureGain;
}

/**
 * Rule 6: an error made when there was a real chance (a forced mate, material to win, or a
 * fresh mistake by the opponent), which lets that chance slip without throwing the
 * position away.
 */
function isMiss(input: ClassifyInput, base: Classification, loss: number): boolean {
  const rule = THRESHOLDS.miss;
  if (base !== 'inaccuracy' && base !== 'mistake' && base !== 'blunder') return false;
  if (input.winAfter < rule.minWinAfter) return false;
  const hadMate = input.mateBefore !== undefined && input.mateBefore > 0;
  // Material is only missed when the move played does not win it (or most of it) as well:
  // taking with the other piece, or winning the same piece a move later, misses nothing.
  const materialMissed = (input.bestLineGain ?? 0) - Math.max(0, input.playedLineGain ?? 0);
  const couldWinMaterial = materialMissed >= rule.minMaterialWon;
  const gift = input.opponentGift ?? 0;
  const gaveBackGift = gift >= rule.minGift && loss >= gift * rule.minShareGivenBack;
  return hadMate || couldWinMaterial || gaveBackGift;
}
