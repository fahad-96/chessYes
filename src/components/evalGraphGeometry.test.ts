import { describe, expect, it } from 'vitest';
import {
  analysedWidth,
  buildAreaPath,
  buildLinePath,
  plyForKey,
  plyToX,
  winToY,
  xToPly,
} from './evalGraphGeometry';

const size = { width: 100, height: 50 };

describe('plyToX / xToPly', () => {
  it('spreads plies across the full width of the game', () => {
    expect(plyToX(0, 4, 100)).toBe(0);
    expect(plyToX(2, 4, 100)).toBe(50);
    expect(plyToX(4, 4, 100)).toBe(100);
  });

  it('clamps out-of-range plies and handles games without moves', () => {
    expect(plyToX(-3, 4, 100)).toBe(0);
    expect(plyToX(9, 4, 100)).toBe(100);
    expect(plyToX(0, 0, 100)).toBe(0);
  });

  it('rounds a position to the nearest ply', () => {
    expect(xToPly(0, 4, 100)).toBe(0);
    expect(xToPly(37, 4, 100)).toBe(1);
    expect(xToPly(38, 4, 100)).toBe(2);
    expect(xToPly(100, 4, 100)).toBe(4);
  });

  it('clamps positions outside the chart', () => {
    expect(xToPly(-20, 4, 100)).toBe(0);
    expect(xToPly(140, 4, 100)).toBe(4);
    expect(xToPly(50, 0, 100)).toBe(0);
    expect(xToPly(50, 4, 0)).toBe(0);
  });
});

describe('winToY', () => {
  it('puts White winning at the top and Black winning at the bottom', () => {
    expect(winToY(100, 50)).toBe(0);
    expect(winToY(50, 50)).toBe(25);
    expect(winToY(0, 50)).toBe(50);
  });

  it('clamps and tolerates bad values', () => {
    expect(winToY(140, 50)).toBe(0);
    expect(winToY(-5, 50)).toBe(50);
    expect(winToY(Number.NaN, 50)).toBe(25);
  });
});

describe('buildAreaPath', () => {
  it('closes the White area along the bottom edge', () => {
    expect(buildAreaPath([50, 100, 0], 2, size)).toBe('M0,50L0,25L50,0L100,50L100,50Z');
  });

  it('covers only the analysed prefix of the game', () => {
    // 2 of 4 plies analysed: the area stops at x = 25 (ply 1).
    expect(buildAreaPath([50, 60], 4, size)).toBe('M0,50L0,25L25,20L25,50Z');
  });

  it('is empty until there is a segment to draw', () => {
    expect(buildAreaPath([], 4, size)).toBe('');
    expect(buildAreaPath([50], 4, size)).toBe('');
    expect(buildAreaPath([50, 50], 0, size)).toBe('');
  });
});

describe('buildLinePath', () => {
  it('connects the points in order', () => {
    expect(buildLinePath([50, 100, 0], 2, size)).toBe('M0,25L50,0L100,50');
  });

  it('rounds coordinates to two decimals', () => {
    expect(buildLinePath([50, 33.3333], 3, size)).toBe('M0,25L33.33,33.33');
  });

  it('is empty for fewer than two points', () => {
    expect(buildLinePath([42], 3, size)).toBe('');
  });
});

describe('analysedWidth', () => {
  it('is the x of the last analysed position', () => {
    expect(analysedWidth(0, 4, 100)).toBe(0);
    expect(analysedWidth(1, 4, 100)).toBe(0);
    expect(analysedWidth(3, 4, 100)).toBe(50);
    expect(analysedWidth(5, 4, 100)).toBe(100);
  });
});

describe('plyForKey', () => {
  it('steps like a slider', () => {
    expect(plyForKey('ArrowRight', 3, 10)).toBe(4);
    expect(plyForKey('ArrowUp', 3, 10)).toBe(4);
    expect(plyForKey('ArrowLeft', 3, 10)).toBe(2);
    expect(plyForKey('ArrowDown', 3, 10)).toBe(2);
    expect(plyForKey('PageUp', 3, 10)).toBe(10);
    expect(plyForKey('PageDown', 3, 10)).toBe(0);
    expect(plyForKey('Home', 3, 10)).toBe(0);
    expect(plyForKey('End', 3, 10)).toBe(10);
  });

  it('stays inside the game', () => {
    expect(plyForKey('ArrowLeft', 0, 10)).toBe(0);
    expect(plyForKey('ArrowRight', 10, 10)).toBe(10);
  });

  it('ignores other keys', () => {
    expect(plyForKey('Enter', 3, 10)).toBeNull();
    expect(plyForKey('f', 3, 10)).toBeNull();
  });
});
