import { Chess } from 'chess.js';
import { parseUci } from '@/core/notation';
import { THRESHOLDS } from '@/core/thresholds';

/**
 * Judges a move the user tries when retrying a mistake or solving a puzzle.
 * Uses the same win % scale and thresholds as the review, so "good enough" here
 * means what Excellent means in a game review.
 */

export type MoveVerdict =
  /** The engine's top move. */
  | 'best'
  /** Another move that keeps (almost) everything: loses at most THRESHOLDS.loss.excellent. */
  | 'excellent'
  /** Keeps most of the advantage, but there is clearly something better. */
  | 'good'
  /** Loses too much, or is illegal. */
  | 'wrong';

export interface CheckMoveInput {
  /** Position before the move. */
  fen: string;
  /** The move the user tried, in UCI. */
  uci: string;
  /** The engine's top move in this position. */
  bestUci: string;
  /** Mover's win % after the best move (0-100). */
  winBest: number;
  /** Moves whose evaluation is already known (e.g. the MultiPV lines), as mover win %. */
  known?: readonly { uci: string; win: number }[];
  /**
   * Evaluates an unknown move: receives the FEN after the move and returns the
   * mover's win %. Without it, unknown moves count as wrong.
   */
  evaluate?: (fenAfter: string, signal?: AbortSignal) => Promise<number>;
  signal?: AbortSignal;
}

export interface CheckMoveResult {
  verdict: MoveVerdict;
  legal: boolean;
  /** Mover's win % after the move, when known. */
  winAfter: number | null;
  /** max(0, winBest - winAfter), when known. */
  loss: number | null;
  /** SAN of the tried move (null if illegal). */
  san: string | null;
}

/** Maps a win % loss to a verdict (exported for tests and the UI legend). */
export function verdictForLoss(loss: number): Exclude<MoveVerdict, 'best'> {
  if (loss <= THRESHOLDS.loss.excellent) return 'excellent';
  if (loss <= THRESHOLDS.loss.good) return 'good';
  return 'wrong';
}

export async function checkMove(input: CheckMoveInput): Promise<CheckMoveResult> {
  const chess = new Chess(input.fen);
  const parsed = parseUci(input.uci);
  let san: string | null;
  try {
    san = parsed ? chess.move(parsed).san : null;
  } catch {
    san = null; // chess.js throws on illegal moves
  }
  if (!san) return { verdict: 'wrong', legal: false, winAfter: null, loss: null, san: null };

  // Promotions are compared without caring about case ("e7e8Q" vs "e7e8q").
  const uci = input.uci.toLowerCase();
  if (uci === input.bestUci.toLowerCase()) {
    return { verdict: 'best', legal: true, winAfter: input.winBest, loss: 0, san };
  }

  let winAfter: number | null = null;
  if (chess.isCheckmate()) {
    winAfter = 100;
  } else if (chess.isStalemate() || chess.isInsufficientMaterial()) {
    winAfter = 50;
  } else {
    const known = input.known?.find((line) => line.uci.toLowerCase() === uci);
    if (known) winAfter = known.win;
    else if (input.evaluate) winAfter = await input.evaluate(chess.fen(), input.signal);
  }

  if (winAfter === null) return { verdict: 'wrong', legal: true, winAfter: null, loss: null, san };
  const loss = Math.max(0, input.winBest - winAfter);
  return { verdict: verdictForLoss(loss), legal: true, winAfter, loss, san };
}
