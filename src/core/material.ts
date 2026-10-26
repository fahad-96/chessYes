import { Chess } from 'chess.js';
import type { Move } from 'chess.js';
import { parseUci } from './notation';
import { PIECE_VALUES, THRESHOLDS } from './thresholds';
import type { PieceSymbol, SacrificeInfo, Square } from './types';

/**
 * Material and sacrifice detection. Uses chess.js legal moves (so pins and checks
 * are respected) rather than pseudo-legal attack maps.
 */

/** What a move puts on offer, before the sacrifice threshold is applied. */
export interface MaterialOffer {
  /** Net material (pawn units) the opponent can win because of the move; can be <= 0. */
  material: number;
  /** Square of the mover's piece that is most exposed after the move. */
  square: Square;
  /** The piece on that square. */
  piece: PieceSymbol;
}

const PIECE_BY_CHAR: Record<string, { white: boolean; value: number }> = {};
for (const [piece, value] of Object.entries(PIECE_VALUES)) {
  PIECE_BY_CHAR[piece] = { white: false, value };
  PIECE_BY_CHAR[piece.toUpperCase()] = { white: true, value };
}

/** Material balance in pawn units, White minus Black. */
export function materialBalance(fen: string): number {
  const placement = fen.split(' ')[0] ?? '';
  let balance = 0;
  for (const char of placement) {
    const piece = PIECE_BY_CHAR[char];
    if (piece) balance += piece.white ? piece.value : -piece.value;
  }
  return balance;
}

/**
 * Static exchange evaluation on `square` for the side to move in `fen`:
 * the most material (pawn units, >= 0) the side to move can win by starting a
 * capture sequence on that square, always recapturing with the least valuable
 * legal piece, and with either side free to stop the sequence.
 * Returns 0 when there is no legal capture on the square or capturing loses material.
 */
export function staticExchange(fen: string, square: Square): number {
  const chess = loadPosition(fen);
  return chess ? exchangeGain(chess, square) : 0;
}

/**
 * Detects whether the move `uci` played in `fenBefore` offers material.
 *
 * Definition (see docs/CLASSIFICATION.md):
 *   For each of the mover's pieces (not the king) after the move, compute how much
 *   the opponent could win on its square (staticExchange with the opponent to move),
 *   minus how much the opponent could already win on that piece's previous square
 *   before the move (a "null move" view of the position before, also when the mover
 *   was in check: a piece that was already hanging, such as one caught in a fork, is
 *   not offered by moving out of check). The offered amount is the largest of these,
 *   minus the value of anything the move itself captured and any promotion gain.
 *   It is a sacrifice when the offered amount is >= THRESHOLDS.brilliant.minSacrifice.
 *   A move that ends the game on the board (checkmate, stalemate or insufficient
 *   material) offers nothing: no capture can follow it.
 *
 * @returns SacrificeInfo for the offered piece, or null.
 */
export function detectSacrifice(fenBefore: string, uci: string): SacrificeInfo | null {
  const offer = measureOffer(fenBefore, uci);
  return offer && offer.material >= THRESHOLDS.brilliant.minSacrifice ? offer : null;
}

/**
 * The measurement behind {@link detectSacrifice}, without the threshold, so callers
 * and tests can see small or negative offers too.
 * Returns null for illegal or malformed moves, for a move that ends the game, or when
 * the mover only has a king.
 */
export function measureOffer(fenBefore: string, uci: string): MaterialOffer | null {
  const parsed = parseUci(uci);
  const chess = loadPosition(fenBefore);
  if (!parsed || !chess) return null;

  const mover = chess.turn();
  // The opponent to move in the position before. When the mover is in check this is not
  // a legal position, but chess.js still generates the opponent's captures, and the
  // impossible king captures do not matter: exchangeGain never targets the king.
  const before = loadPosition(nullMoveFen(fenBefore));

  let move: Move;
  try {
    move = chess.move(parsed);
  } catch {
    return null; // chess.js throws on illegal moves
  }
  // chess.js would still let the opponent capture after the game has ended on the board.
  if (chess.isCheckmate() || chess.isStalemate() || chess.isInsufficientMaterial()) return null;
  const rook = castlingRookMove(move);

  let best: { offered: number; square: Square; piece: PieceSymbol } | null = null;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== mover || cell.type === 'k') continue;
      const origin =
        cell.square === move.to ? move.from : cell.square === rook?.to ? rook.from : cell.square;
      const gainAfter = exchangeGain(chess, cell.square);
      const gainBefore = before ? exchangeGain(before, origin) : 0;
      const offered = gainAfter - gainBefore;
      if (!best || offered > best.offered) {
        best = { offered, square: cell.square, piece: cell.type };
      }
    }
  }
  if (!best) return null;

  // chess.js reports en passant captures with captured = 'p', so this covers them too.
  const captured = move.captured ? PIECE_VALUES[move.captured] : 0;
  const promotionGain = move.promotion ? PIECE_VALUES[move.promotion] - PIECE_VALUES.p : 0;
  return {
    material: best.offered - captured - promotionGain,
    square: best.square,
    piece: best.piece,
  };
}

/**
 * Whether the material a capturing or checking move puts on offer comes straight back,
 * which makes it a trick rather than a sacrifice: in `line` (the engine line after the
 * move, starting with the opponent's reply) the opponent captures, and after the mover's
 * next move the mover is down less than THRESHOLDS.brilliant.minSacrifice compared with
 * the position before the move. Typical cases: a rook check that is taken but uncovers an
 * attack on the queen, or a capture that is taken back and then wins the piece back.
 * Quiet moves always return false, as do lines too short to tell.
 */
export function isRegainedAtOnce(fenBefore: string, uci: string, line: readonly string[]): boolean {
  const parsed = parseUci(uci);
  const chess = loadPosition(fenBefore);
  const [reply, answer] = line.map(parseUci);
  if (!parsed || !chess || !reply || !answer) return false;
  const mover = chess.turn();
  try {
    const move = chess.move(parsed);
    if (!move.captured && !chess.inCheck()) return false;
    if (!chess.move(reply).captured) return false; // the offer is declined
    chess.move(answer);
  } catch {
    return false; // chess.js throws on illegal moves
  }
  const change = materialBalance(chess.fen()) - materialBalance(fenBefore);
  const net = mover === 'w' ? change : -change;
  return net > -THRESHOLDS.brilliant.minSacrifice;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function loadPosition(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null; // invalid FEN
  }
}

/** The same position with the other side to move (and no en passant right). */
function nullMoveFen(fen: string): string {
  const fields = fen.split(' ');
  fields[1] = fields[1] === 'w' ? 'b' : 'w';
  fields[3] = '-';
  return fields.join(' ');
}

/** Where the rook went for a castling move, so its new square maps back to its old one. */
function castlingRookMove(move: Move): { from: Square; to: Square } | null {
  const rank = move.color === 'w' ? '1' : '8';
  if (move.isKingsideCastle()) return { from: `h${rank}` as Square, to: `f${rank}` as Square };
  if (move.isQueensideCastle()) return { from: `a${rank}` as Square, to: `d${rank}` as Square };
  return null;
}

/** Order in which pieces are sent into an exchange: cheapest first, the king last. */
function captureOrder(piece: PieceSymbol): number {
  return piece === 'k' ? Number.POSITIVE_INFINITY : PIECE_VALUES[piece];
}

/**
 * Recursive exchange evaluation on `chess` (left unchanged on return):
 * gain = max(0, value of the target [+ promotion gain] - the opponent's gain after recapturing).
 */
function exchangeGain(chess: Chess, square: Square): number {
  const target = chess.get(square);
  if (!target || target.color === chess.turn()) return 0;

  const capture = playCheapestCapture(chess, square);
  if (!capture) return 0;
  const promotionGain = capture.promotion ? PIECE_VALUES[capture.promotion] - PIECE_VALUES.p : 0;
  const reply = exchangeGain(chess, square);
  chess.undo();
  return Math.max(0, PIECE_VALUES[target.type] + promotionGain - reply);
}

/**
 * Plays the least valuable legal capture onto `square` and returns it, or null when
 * there is none. Attackers come from chess.js's attack map; trying each one as a real
 * move filters out pinned pieces and a king stepping onto a defended square.
 */
function playCheapestCapture(chess: Chess, square: Square): Move | null {
  const attackers = chess
    .attackers(square, chess.turn())
    .map((from) => ({ from, order: captureOrder(chess.get(from)?.type ?? 'k') }))
    .sort((a, b) => a.order - b.order);

  for (const { from } of attackers) {
    try {
      // `promotion` is ignored by chess.js unless this is a pawn reaching the last rank.
      return chess.move({ from, to: square, promotion: 'q' });
    } catch {
      // Not a legal capture (pinned piece or king walking into check): try the next attacker.
    }
  }
  return null;
}
