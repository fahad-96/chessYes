import { describe, expect, it } from 'vitest';
import { squareAtPoint, squareCell } from './boardGeometry';

describe('squareCell', () => {
  it('places squares for both orientations', () => {
    expect(squareCell('a1', 'white')).toEqual({ column: 0, row: 7 });
    expect(squareCell('h8', 'white')).toEqual({ column: 7, row: 0 });
    expect(squareCell('a1', 'black')).toEqual({ column: 7, row: 0 });
    expect(squareCell('e4', 'black')).toEqual({ column: 3, row: 3 });
  });
});

describe('squareAtPoint', () => {
  const rect = { left: 100, top: 50, width: 400, height: 400 };

  it('finds the square under a point', () => {
    expect(squareAtPoint(rect, 101, 449, 'white')).toBe('a1');
    expect(squareAtPoint(rect, 499, 51, 'white')).toBe('h8');
    expect(squareAtPoint(rect, 101, 449, 'black')).toBe('h8');
    expect(squareAtPoint(rect, 325, 225, 'white')).toBe('e5');
  });

  it('returns null outside the board', () => {
    expect(squareAtPoint(rect, 99, 100, 'white')).toBeNull();
    expect(squareAtPoint(rect, 200, 451, 'white')).toBeNull();
    expect(squareAtPoint({ ...rect, width: 0 }, 200, 100, 'white')).toBeNull();
  });
});
