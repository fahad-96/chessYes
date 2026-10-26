import { describe, expect, it } from 'vitest';
import { detectSwipe } from './swipe';

const at = (x: number, y: number, time: number) => ({ x, y, time });

describe('detectSwipe', () => {
  it('recognises quick horizontal swipes', () => {
    expect(detectSwipe(at(200, 100, 0), at(120, 110, 180))).toBe('left');
    expect(detectSwipe(at(100, 100, 0), at(180, 95, 180))).toBe('right');
  });

  it('ignores taps and short movements', () => {
    expect(detectSwipe(at(100, 100, 0), at(102, 101, 80))).toBeNull();
    expect(detectSwipe(at(100, 100, 0), at(130, 100, 80))).toBeNull();
  });

  it('ignores mostly vertical gestures (scrolling)', () => {
    expect(detectSwipe(at(100, 100, 0), at(150, 220, 200))).toBeNull();
    // Diagonal but not horizontal enough: |dx| must exceed 1.5 x |dy|.
    expect(detectSwipe(at(100, 100, 0), at(160, 145, 200))).toBeNull();
  });

  it('ignores slow drags', () => {
    expect(detectSwipe(at(100, 100, 0), at(250, 100, 1200))).toBeNull();
  });

  it('respects custom options', () => {
    expect(detectSwipe(at(100, 100, 0), at(130, 100, 100), { minDistance: 20 })).toBe('right');
    expect(detectSwipe(at(100, 100, 0), at(250, 100, 1200), { maxDuration: 2000 })).toBe('right');
  });

  it('rejects inconsistent timestamps', () => {
    expect(detectSwipe(at(100, 100, 500), at(20, 100, 100))).toBeNull();
  });
});
