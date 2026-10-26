/** Small, pure helpers for the insights charts (scales, ticks, paths, hit-testing). */

export interface NiceScale {
  /** Domain rounded outwards to whole ticks. */
  min: number;
  max: number;
  ticks: number[];
}

/**
 * Round tick values ("nice numbers": steps of 1, 2, 2.5 or 5 times a power of ten) that cover
 * [min, max] with about `count` intervals. A flat range is widened so it still has height.
 * With `integer`, steps are whole numbers (no 2.5 or 0.5), for values shown without decimals
 * such as ratings: a tick at 82.5 would otherwise be labelled "83".
 */
export function niceScale(min: number, max: number, count = 4, integer = false): NiceScale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  let low = Math.min(min, max);
  let high = Math.max(min, max);
  if (high - low < 1e-9) {
    const pad = Math.abs(low) > 1 ? Math.abs(low) * 0.01 : 1;
    low -= pad;
    high += pad;
  }
  const rough = Math.max(integer ? 1 : 0, (high - low) / Math.max(1, count));
  const power = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((m) => m * power)
      .find((candidate) => candidate >= rough && (!integer || Number.isInteger(candidate))) ??
    10 * power;
  const start = Math.floor(low / step) * step;
  const end = Math.ceil(high / step) * step;
  // Enough decimals for steps such as 0.25; toFixed keeps 3 * 0.2 = 0.6000000000000001 out.
  const decimals = Math.max(0, 1 - Math.floor(Math.log10(step)));
  const clean = (value: number) => Number(value.toFixed(decimals));
  const ticks: number[] = [];
  for (let i = 0; start + i * step <= end + step / 2; i++) ticks.push(clean(start + i * step));
  return { min: clean(start), max: clean(end), ticks };
}

/** Maps a value from [d0, d1] to [r0, r1]; a zero-width domain maps to the middle. */
export function scaleLinear(
  [d0, d1]: readonly [number, number],
  [r0, r1]: readonly [number, number],
): (value: number) => number {
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** "M x y L x y ..." through the points, rounded to 0.1 px. */
export function linePath(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`).join(' ');
}

/** Index of the value in an ascending list closest to `target` (binary search), or -1. */
export function nearestIndex(sorted: readonly number[], target: number): number {
  if (sorted.length === 0) return -1;
  let low = 0;
  let high = sorted.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! < target) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && target - sorted[low - 1]! <= sorted[low]! - target) return low - 1;
  return low;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
