import { Chess } from 'chess.js';
import { parseUci } from '@/core/notation';
import type { Color, Square } from '@/core/types';

/**
 * Helpers for showing an engine line move by move on the board (puzzle solutions,
 * retried mistakes). Pure functions on top of chess.js.
 */

/** One position of a line, ready to hand to the Board component. */
export interface LineFrame {
  /** Position after the move. */
  fen: string;
  uci: string;
  san: string;
  /** Origin and destination of the move, for the board's last-move highlight. */
  lastMove: [Square, Square];
  /** Whether the side to move in `fen` is in check. */
  check: boolean;
}

/**
 * Plays a UCI line from `fen` and returns every position along it.
 * Stops (returning what it has) at the first illegal or malformed move, so a stale or
 * truncated engine line never throws.
 */
export function playLine(fen: string, line: readonly string[]): LineFrame[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return []; // invalid FEN
  }
  const frames: LineFrame[] = [];
  for (const uci of line) {
    const parsed = parseUci(uci);
    if (!parsed) break;
    try {
      const move = chess.move(parsed);
      frames.push({
        fen: chess.fen(),
        uci,
        san: move.san,
        lastMove: [move.from, move.to],
        check: chess.inCheck(),
      });
    } catch {
      break; // chess.js throws on illegal moves
    }
  }
  return frames;
}

/**
 * Move-number labels for the plies of a line starting at `fen`: "12." before White's
 * moves, "12..." before the first move when Black starts, and "" otherwise.
 */
export function lineMoveLabels(fen: string, plies: number): string[] {
  const fields = fen.split(' ');
  let side: Color = fields[1] === 'b' ? 'b' : 'w';
  let number = Number(fields[5]) || 1;
  const labels: string[] = [];
  for (let index = 0; index < plies; index++) {
    if (side === 'w') labels.push(`${number}.`);
    else labels.push(index === 0 ? `${number}...` : '');
    if (side === 'b') number++;
    side = side === 'w' ? 'b' : 'w';
  }
  return labels;
}

/**
 * Formats SAN moves with move numbers, taking the numbering from the FEN they start
 * from: "12. Nf5 Qd7 13. Qg4" or "12... Qd7 13. Qg4".
 */
export function formatLineFrom(fen: string, sans: readonly string[], maxPlies = 6): string {
  const shown = sans.slice(0, maxPlies);
  const labels = lineMoveLabels(fen, shown.length);
  return shown.map((san, index) => (labels[index] ? `${labels[index]} ${san}` : san)).join(' ');
}

/** Move number label of the move to play in `fen`: "12." for White, "12..." for Black. */
export function moveLabelAt(fen: string): string {
  return lineMoveLabels(fen, 1)[0] ?? '';
}
