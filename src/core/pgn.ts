import type { ParsedGame } from './types';

export class PgnError extends Error {
  override name = 'PgnError';
}

/**
 * Parses a single-game PGN with chess.js.
 * - Handles headers, comments, NAGs, variations (ignored; main line only), FEN/SetUp starts.
 * - Extracts `[%clk h:mm:ss(.f)]` clock comments into ParsedMove.clock (seconds).
 * - Sets finalState when the last position is checkmate, stalemate, insufficient
 *   material, threefold repetition or the fifty-move rule.
 * @throws PgnError with a readable message when the PGN cannot be parsed.
 */
export function parsePgn(_pgn: string): ParsedGame {
  throw new Error('not implemented');
}

/** Splits a text containing several PGN games into individual PGN strings. */
export function splitPgnGames(_text: string): string[] {
  throw new Error('not implemented');
}

/** Reads the PGN header tags without parsing moves (fast; used for listing pasted games). */
export function readPgnHeaders(_pgn: string): Record<string, string> {
  throw new Error('not implemented');
}
