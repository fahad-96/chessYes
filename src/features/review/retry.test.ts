import { describe, expect, it } from 'vitest';
import type { Classification, GameReview, MoveReview, Score } from '@/core/types';
import { scoreToWinPercent } from '@/core/winPercent';
import { isRetryable, knownMoves, retryablePlies, sessionScore } from './retry';

const cp = (value: number): Score => ({ type: 'cp', value });

function moveReview(
  ply: number,
  classification: Classification,
  overrides: Partial<MoveReview> = {},
): MoveReview {
  return {
    ply,
    color: ply % 2 === 1 ? 'w' : 'b',
    san: 'Nf3',
    uci: 'g1f3',
    classification,
    winBefore: 60,
    winAfter: 40,
    winLoss: 20,
    accuracy: 40,
    evalAfter: cp(0),
    whiteWinAfter: 50,
    best: { uci: 'e2e4', san: 'e4', score: cp(80), pvUci: ['e2e4'], pvSan: ['e4'] },
    explanation: '',
    ...overrides,
  };
}

function review(moves: MoveReview[]): GameReview {
  return { moves } as GameReview;
}

describe('isRetryable', () => {
  it('accepts errors with a different best move', () => {
    expect(isRetryable(moveReview(1, 'mistake'))).toBe(true);
    expect(isRetryable(moveReview(1, 'missedWin'))).toBe(true);
    expect(isRetryable(moveReview(1, 'good'))).toBe(false);
    expect(isRetryable(moveReview(1, 'blunder', { best: undefined }))).toBe(false);
    expect(
      isRetryable(
        moveReview(1, 'inaccuracy', {
          best: { uci: 'g1f3', san: 'Nf3', score: cp(0), pvUci: [], pvSan: [] },
        }),
      ),
    ).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });
});

describe('retryablePlies', () => {
  const moves = [
    moveReview(1, 'book'),
    moveReview(2, 'blunder'),
    moveReview(3, 'inaccuracy'),
    moveReview(4, 'best'),
    moveReview(5, 'mistake'),
  ];

  it('lists retryable moves in order, optionally for one side', () => {
    expect(retryablePlies(review(moves))).toEqual([2, 3, 5]);
    expect(retryablePlies(review(moves), 'w')).toEqual([3, 5]);
    expect(retryablePlies(review(moves), 'b')).toEqual([2]);
    expect(retryablePlies(null)).toEqual([]);
  });
});

describe('knownMoves', () => {
  it('converts the engine lines to the mover’s win % and adds the played move', () => {
    const black = moveReview(2, 'mistake', {
      winAfter: 30,
      best: { uci: 'e7e5', san: 'e5', score: cp(-50), pvUci: [], pvSan: [] },
      secondBest: { uci: 'c7c5', san: 'c5', score: cp(20), pvUci: [], pvSan: [] },
      uci: 'g8f6',
    });
    expect(knownMoves(black)).toEqual([
      { uci: 'e7e5', win: 100 - scoreToWinPercent(cp(-50)) },
      { uci: 'c7c5', win: 100 - scoreToWinPercent(cp(20)) },
      { uci: 'g8f6', win: 30 },
    ]);
  });

  it('does not list the played move twice', () => {
    const move = moveReview(1, 'inaccuracy', {
      secondBest: { uci: 'g1f3', san: 'Nf3', score: cp(10), pvUci: [], pvSan: [] },
    });
    expect(knownMoves(move).map((line) => line.uci)).toEqual(['e2e4', 'g1f3']);
  });
});

describe('sessionScore', () => {
  it('counts solved moves', () => {
    expect(sessionScore(['solved', 'revealed', 'skipped', 'solved'])).toEqual({
      solved: 2,
      total: 4,
    });
  });
});
