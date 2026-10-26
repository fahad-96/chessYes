import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from './types';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

/** Side to move from a FEN. */
export function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Splits a UCI move ("e7e8q") into parts. Returns null if malformed. */
export function parseUci(uci: string): { from: Square; to: Square; promotion?: PieceSymbol } | null {
  const match = UCI_RE.exec(uci);
  if (!match) return null;
  const [, from, to, promotion] = match;
  return promotion
    ? { from: from as Square, to: to as Square, promotion: promotion as PieceSymbol }
    : { from: from as Square, to: to as Square };
}

/** Plays a UCI move on a board; returns the chess.js move or null if illegal/malformed. */
function playUci(chess: Chess, uci: string) {
  const parsed = parseUci(uci);
  if (!parsed) return null;
  try {
    return chess.move(parsed);
  } catch {
    return null; // chess.js throws on illegal moves
  }
}

/** SAN for a UCI move in a position, or null if the move is illegal there. */
export function uciToSan(fen: string, uci: string): string | null {
  return playUci(new Chess(fen), uci)?.san ?? null;
}

/**
 * Converts a UCI principal variation into SAN, starting from `fen`.
 * Stops (returning what it has) at the first illegal or malformed move.
 */
export function pvToSan(fen: string, pv: string[]): string[] {
  const chess = new Chess(fen);
  const sans: string[] = [];
  for (const uci of pv) {
    const move = playUci(chess, uci);
    if (!move) break;
    sans.push(move.san);
  }
  return sans;
}

/** Number of legal moves for the side to move. */
export function legalMoveCount(fen: string): number {
  return new Chess(fen).moves().length;
}

/** FEN after playing a UCI move, or null if illegal. */
export function fenAfterUci(fen: string, uci: string): string | null {
  const chess = new Chess(fen);
  return playUci(chess, uci) ? chess.fen() : null;
}

/**
 * Position key used by the opening book: piece placement, side to move and
 * castling rights (the first three FEN fields). The en passant field is dropped
 * on purpose so transpositions match regardless of how a pawn arrived.
 */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 3).join(' ');
}

/** Formats a move number prefix: "12." for White, "12..." for Black. */
export function moveNumberLabel(moveNumber: number, color: Color): string {
  return color === 'w' ? `${moveNumber}.` : `${moveNumber}...`;
}
