import { describe, expect, it } from 'vitest';
import type { PositionAnalysis, Score } from './types';
import {
  CP_CEILING,
  cpToWinPercent,
  formatScore,
  positionWhiteWinPercent,
  scoreToWinPercent,
  winPercentFor,
} from './winPercent';

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
// Fool's mate: White to move and checkmated.
const WHITE_MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
// Scholar's mate: Black to move and checkmated.
const BLACK_MATED = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';

function analysis(fen: string, scores: Score[], terminal?: PositionAnalysis['terminal']) {
  const result: PositionAnalysis = {
    fen,
    depth: 18,
    lines: scores.map((score, i) => ({ pv: [i === 0 ? 'e7e5' : 'c7c5'], score, depth: 18 })),
  };
  if (terminal) result.terminal = terminal;
  return result;
}

describe('cpToWinPercent', () => {
  it('matches the Lichess curve at known points', () => {
    expect(cpToWinPercent(0)).toBe(50);
    expect(cpToWinPercent(100)).toBeCloseTo(59.1026, 4);
    expect(cpToWinPercent(300)).toBeCloseTo(75.1126, 4);
    expect(cpToWinPercent(-200)).toBeCloseTo(32.3788, 4);
    expect(cpToWinPercent(1000)).toBeCloseTo(97.5447, 4);
  });

  it('is symmetric around 50 and increasing', () => {
    for (const value of [10, 55, 250, 999]) {
      expect(cpToWinPercent(value) + cpToWinPercent(-value)).toBeCloseTo(100, 10);
      expect(cpToWinPercent(value + 1)).toBeGreaterThan(cpToWinPercent(value));
    }
  });

  it('clamps scores beyond ±1000 centipawns', () => {
    expect(cpToWinPercent(5000)).toBe(cpToWinPercent(CP_CEILING));
    expect(cpToWinPercent(-5000)).toBe(cpToWinPercent(-CP_CEILING));
  });
});

describe('scoreToWinPercent', () => {
  it('converts centipawn scores', () => {
    expect(scoreToWinPercent(cp(100))).toBe(cpToWinPercent(100));
  });

  it('treats mates as ±1000 centipawns regardless of distance', () => {
    expect(scoreToWinPercent(mate(1))).toBe(cpToWinPercent(1000));
    expect(scoreToWinPercent(mate(12))).toBe(cpToWinPercent(1000));
    expect(scoreToWinPercent(mate(-3))).toBe(cpToWinPercent(-1000));
  });
});

describe('winPercentFor', () => {
  it('returns White win % for White and its complement for Black', () => {
    expect(winPercentFor(70, 'w')).toBe(70);
    expect(winPercentFor(70, 'b')).toBe(30);
  });
});

describe('positionWhiteWinPercent', () => {
  it('uses the best line only', () => {
    expect(positionWhiteWinPercent(analysis(AFTER_E4, [cp(30), cp(400)]))).toBe(cpToWinPercent(30));
  });

  it('scores checkmate for the side that delivered it', () => {
    expect(positionWhiteWinPercent(analysis(WHITE_MATED, [], 'checkmate'))).toBe(0);
    expect(positionWhiteWinPercent(analysis(BLACK_MATED, [], 'checkmate'))).toBe(100);
  });

  it('scores every other terminal state as a draw, even if lines are present', () => {
    for (const terminal of ['stalemate', 'insufficient', 'threefold', 'fifty-move'] as const) {
      expect(positionWhiteWinPercent(analysis(AFTER_E4, [cp(500)], terminal))).toBe(50);
    }
  });

  it('throws when there is nothing to evaluate', () => {
    expect(() => positionWhiteWinPercent(analysis(AFTER_E4, []))).toThrow(AFTER_E4);
  });
});

describe('formatScore', () => {
  it('formats centipawns as signed pawns with one decimal', () => {
    expect(formatScore(cp(130))).toBe('+1.3');
    expect(formatScore(cp(-40))).toBe('-0.4');
    expect(formatScore(cp(100))).toBe('+1.0');
    expect(formatScore(cp(1532))).toBe('+15.3');
    expect(formatScore(cp(-1000))).toBe('-10.0');
  });

  it('prints zero without a sign, including values that round to zero', () => {
    expect(formatScore(cp(0))).toBe('0.0');
    expect(formatScore(cp(4))).toBe('0.0');
    expect(formatScore(cp(-4))).toBe('0.0');
  });

  it('rounds halves away from zero on both sides', () => {
    expect(formatScore(cp(5))).toBe('+0.1');
    expect(formatScore(cp(-5))).toBe('-0.1');
    expect(formatScore(cp(-149))).toBe('-1.5');
  });

  it('formats mates from White point of view', () => {
    expect(formatScore(mate(3))).toBe('M3');
    expect(formatScore(mate(-2))).toBe('-M2');
  });
});
