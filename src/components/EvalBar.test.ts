import { describe, expect, it } from 'vitest';
import { evalBarFill, evalBarLabel } from './EvalBar';

describe('evalBarFill', () => {
  it('is half full for equal or unknown positions', () => {
    expect(evalBarFill(null)).toBe(50);
    expect(evalBarFill({ kind: 'score', score: { type: 'cp', value: 0 } })).toBe(50);
  });

  it('follows the win % model for centipawn scores', () => {
    const white = evalBarFill({ kind: 'score', score: { type: 'cp', value: 300 } });
    const black = evalBarFill({ kind: 'score', score: { type: 'cp', value: -300 } });
    expect(white).toBeGreaterThan(70);
    expect(white).toBeLessThan(100);
    expect(white + black).toBeCloseTo(100, 6);
  });

  it('fills completely for a forced mate', () => {
    expect(evalBarFill({ kind: 'score', score: { type: 'mate', value: 3 } })).toBe(100);
    expect(evalBarFill({ kind: 'score', score: { type: 'mate', value: -1 } })).toBe(0);
  });

  it('shows finished games', () => {
    expect(evalBarFill({ kind: 'final', whiteWinPercent: 100, label: '1-0' })).toBe(100);
    expect(evalBarFill({ kind: 'final', whiteWinPercent: 50, label: '½-½' })).toBe(50);
  });
});

describe('evalBarLabel', () => {
  it('drops the sign, since the side of the bar shows who is ahead', () => {
    expect(evalBarLabel({ kind: 'score', score: { type: 'cp', value: 130 } })).toBe('1.3');
    expect(evalBarLabel({ kind: 'score', score: { type: 'cp', value: -250 } })).toBe('2.5');
    expect(evalBarLabel({ kind: 'score', score: { type: 'mate', value: -2 } })).toBe('M2');
    expect(evalBarLabel({ kind: 'final', whiteWinPercent: 0, label: '0-1' })).toBe('0-1');
    expect(evalBarLabel(null)).toBe('');
  });
});
