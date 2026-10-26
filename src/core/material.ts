import type { SacrificeInfo, Square } from './types';

/**
 * Material and sacrifice detection. Uses chess.js legal moves (so pins and checks
 * are respected) rather than pseudo-legal attack maps.
 */

/** Material balance in pawn units, White minus Black. */
export function materialBalance(_fen: string): number {
  throw new Error('not implemented');
}

/**
 * Static exchange evaluation on `square` for the side to move in `fen`:
 * the most material (pawn units, >= 0) the side to move can win by starting a
 * capture sequence on that square, always recapturing with the least valuable
 * legal piece, and with either side free to stop the sequence.
 * Returns 0 when there is no legal capture on the square or capturing loses material.
 */
export function staticExchange(_fen: string, _square: Square): number {
  throw new Error('not implemented');
}

/**
 * Detects whether the move `uci` played in `fenBefore` offers material.
 *
 * Definition (see docs/CLASSIFICATION.md):
 *   For each of the mover's pieces (not the king) after the move, compute how much
 *   the opponent could win on its square (staticExchange with the opponent to move),
 *   minus how much the opponent could already win on that piece's previous square
 *   before the move (a "null move" view of the position before; skipped = 0 when
 *   the mover was in check). The offered amount is the largest of these, minus the
 *   value of anything the move itself captured and any promotion gain.
 *   It is a sacrifice when the offered amount is >= THRESHOLDS.brilliant.minSacrifice.
 *
 * @returns SacrificeInfo for the offered piece, or null.
 */
export function detectSacrifice(_fenBefore: string, _uci: string): SacrificeInfo | null {
  throw new Error('not implemented');
}
