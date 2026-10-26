import { Chess } from 'chess.js';
import { parseUci } from '@/core/notation';
import type { PieceSymbol, Square } from '@/core/types';

/**
 * Hints for finding a move: first the piece to move, then (in the UI) the arrow.
 */

export const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

export interface PieceHint {
  piece: PieceSymbol;
  /** Square the piece moves from. */
  square: Square;
  /** Whether the player has other pieces of this kind (the hint then names the square). */
  ambiguous: boolean;
  /** Ready-to-show sentence, e.g. "Move your queen." or "Move your knight on f3." */
  text: string;
}

/**
 * Names the piece that makes the move `uci` in `fen`, without saying where it goes
 * (the same help as highlighting the piece). When the player has several pieces of that
 * kind the square is named too, otherwise "one of your pawns" would barely help.
 * Castling counts as a king move. Returns null for an invalid position or an empty square.
 */
export function pieceHint(fen: string, uci: string): PieceHint | null {
  const parsed = parseUci(uci);
  if (!parsed) return null;
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null; // invalid FEN
  }
  const mover = chess.get(parsed.from);
  if (!mover) return null;
  let count = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === mover.color && cell.type === mover.type) count++;
    }
  }
  const name = PIECE_NAMES[mover.type];
  const ambiguous = count > 1;
  const text = ambiguous ? `Move your ${name} on ${parsed.from}.` : `Move your ${name}.`;
  return { piece: mover.type, square: parsed.from, ambiguous, text };
}
