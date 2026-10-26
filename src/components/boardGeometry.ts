import type { Square } from '@/core/types';
import type { BoardOrientation } from './Board';

const FILES = 'abcdefgh';

/** Column (0 = left) and row (0 = top) of a square as drawn for `orientation`. */
export function squareCell(
  square: Square,
  orientation: BoardOrientation,
): { column: number; row: number } {
  const file = FILES.indexOf(square[0] ?? 'a');
  const rank = Number(square[1]) - 1;
  return orientation === 'white'
    ? { column: file, row: 7 - rank }
    : { column: 7 - file, row: rank };
}

/** The square under a point (client coordinates) on a board drawn in `rect`; null outside. */
export function squareAtPoint(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  orientation: BoardOrientation,
): Square | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const column = Math.floor(((x - rect.left) / rect.width) * 8);
  const row = Math.floor(((y - rect.top) / rect.height) * 8);
  if (column < 0 || column > 7 || row < 0 || row > 7) return null;
  const file = orientation === 'white' ? column : 7 - column;
  const rank = orientation === 'white' ? 7 - row : row;
  return `${FILES[file]}${rank + 1}` as Square;
}
