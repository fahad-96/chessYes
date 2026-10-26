/**
 * Pure geometry for the evaluation graph, kept apart from React so it can be
 * unit-tested. Coordinates are in CSS pixels with the origin at the top-left:
 * White's win % of 100 is the top edge, 0 (Black winning) the bottom edge.
 */

export interface GraphSize {
  width: number;
  height: number;
}

/** Horizontal position of a ply (0 = start position) across the whole game. */
export function plyToX(ply: number, totalPlies: number, width: number): number {
  if (totalPlies <= 0) return 0;
  return (Math.min(Math.max(ply, 0), totalPlies) / totalPlies) * width;
}

/** Vertical position of White's win % (100 at the top, 0 at the bottom). */
export function winToY(whiteWinPercent: number, height: number): number {
  return (1 - clampWin(whiteWinPercent) / 100) * height;
}

/** Nearest ply to a horizontal position, clamped to the game. */
export function xToPly(x: number, totalPlies: number, width: number): number {
  if (totalPlies <= 0 || width <= 0) return 0;
  return Math.min(totalPlies, Math.max(0, Math.round((x / width) * totalPlies)));
}

function clampWin(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

const fmt = (value: number) => Number(value.toFixed(2));

function points(values: readonly number[], totalPlies: number, size: GraphSize): string[] {
  return values.map(
    (value, ply) =>
      `${fmt(plyToX(ply, totalPlies, size.width))},${fmt(winToY(value, size.height))}`,
  );
}

/**
 * Closed path of White's area: from the bottom edge up to the win % line and back
 * down. Covers only the analysed prefix; empty when fewer than two points exist.
 */
export function buildAreaPath(
  values: readonly number[],
  totalPlies: number,
  size: GraphSize,
): string {
  if (values.length < 2 || totalPlies <= 0) return '';
  const pts = points(values, totalPlies, size);
  const lastX = fmt(plyToX(values.length - 1, totalPlies, size.width));
  const bottom = fmt(size.height);
  return `M0,${bottom}L${pts.join('L')}L${lastX},${bottom}Z`;
}

/** Open path along the win % values (the edge between the two areas). */
export function buildLinePath(
  values: readonly number[],
  totalPlies: number,
  size: GraphSize,
): string {
  if (values.length < 2 || totalPlies <= 0) return '';
  return `M${points(values, totalPlies, size).join('L')}`;
}

/** Width covered by analysed positions (where the dark background is drawn). */
export function analysedWidth(valueCount: number, totalPlies: number, width: number): number {
  if (valueCount < 2) return 0;
  return plyToX(valueCount - 1, totalPlies, width);
}

/** Keyboard handling for the graph slider: the new ply, or null if the key is not ours. */
export function plyForKey(key: string, current: number, totalPlies: number): number | null {
  const clamp = (ply: number) => Math.min(totalPlies, Math.max(0, ply));
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(current - 1);
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(current + 1);
    case 'PageDown':
      return clamp(current - 10);
    case 'PageUp':
      return clamp(current + 10);
    case 'Home':
      return 0;
    case 'End':
      return totalPlies;
    default:
      return null;
  }
}
