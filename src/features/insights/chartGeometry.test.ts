import { describe, expect, it } from 'vitest';
import { linePath, nearestIndex, niceScale, scaleLinear } from './chartGeometry';

describe('niceScale', () => {
  it('covers the range with round steps', () => {
    expect(niceScale(2873, 3012, 4)).toEqual({
      min: 2850,
      max: 3050,
      ticks: [2850, 2900, 2950, 3000, 3050],
    });
    expect(niceScale(0, 100, 4).ticks).toEqual([0, 25, 50, 75, 100]);
    expect(niceScale(61.3, 94.8, 4).ticks).toEqual([60, 70, 80, 90, 100]);
  });

  it('widens a flat range and survives bad input', () => {
    const flat = niceScale(1500, 1500);
    expect(flat.min).toBeLessThan(1500);
    expect(flat.max).toBeGreaterThan(1500);
    expect(niceScale(NaN, 3)).toEqual({ min: 0, max: 1, ticks: [0, 1] });
  });

  it('keeps to whole-number steps when asked', () => {
    // 2.5 would be the nice step here; labelled without decimals it would show 78 for 77.5.
    expect(niceScale(75.4, 84.2, 4).ticks).toEqual([75, 77.5, 80, 82.5, 85]);
    expect(niceScale(75.4, 84.2, 4, true).ticks).toEqual([75, 80, 85]);
    expect(niceScale(1500, 1502, 4, true).ticks).toEqual([1500, 1501, 1502]);
    expect(niceScale(2873, 3012, 4, true).ticks).toEqual([2850, 2900, 2950, 3000, 3050]);
  });

  it('keeps float noise out of the ticks', () => {
    expect(niceScale(0.1, 0.7, 3).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(niceScale(0.1, 0.95, 4).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('scaleLinear', () => {
  it('maps the domain onto the range, also inverted', () => {
    const y = scaleLinear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(25)).toBe(150);
    expect(scaleLinear([5, 5], [0, 10])(5)).toBe(5);
  });
});

describe('linePath and nearestIndex', () => {
  it('draws a polyline', () => {
    expect(
      linePath([
        [0, 1],
        [10.04, 2.06],
      ]),
    ).toBe('M0 1 L10 2.1');
    expect(linePath([])).toBe('');
  });

  it('finds the closest x, preferring the earlier point on a tie', () => {
    const xs = [0, 10, 20, 40];
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 14)).toBe(1);
    expect(nearestIndex(xs, 15)).toBe(1);
    expect(nearestIndex(xs, 31)).toBe(3);
    expect(nearestIndex(xs, 99)).toBe(3);
    expect(nearestIndex([], 3)).toBe(-1);
  });
});
