import type { Color, PieceSymbol, Square } from './types';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Side to move from a FEN. */
export function sideToMove(_fen: string): Color {
  throw new Error('not implemented');
}

/** Splits a UCI move ("e7e8q") into parts. Returns null if malformed. */
export function parseUci(_uci: string): { from: Square; to: Square; promotion?: PieceSymbol } | null {
  throw new Error('not implemented');
}

/** SAN for a UCI move in a position, or null if the move is illegal there. */
export function uciToSan(_fen: string, _uci: string): string | null {
  throw new Error('not implemented');
}

/**
 * Converts a UCI principal variation into SAN, starting from `fen`.
 * Stops (returning what it has) at the first illegal or malformed move.
 */
export function pvToSan(_fen: string, _pv: string[]): string[] {
  throw new Error('not implemented');
}

/** Number of legal moves for the side to move. */
export function legalMoveCount(_fen: string): number {
  throw new Error('not implemented');
}

/** FEN after playing a UCI move, or null if illegal. */
export function fenAfterUci(_fen: string, _uci: string): string | null {
  throw new Error('not implemented');
}

/**
 * Position key used by the opening book: piece placement, side to move and
 * castling rights (the first three FEN fields). The en passant field is dropped
 * on purpose so transpositions match regardless of how a pawn arrived.
 */
export function positionKey(_fen: string): string {
  throw new Error('not implemented');
}

/** Formats a move number prefix: "12." for White, "12..." for Black. */
export function moveNumberLabel(_moveNumber: number, _color: Color): string {
  throw new Error('not implemented');
}
