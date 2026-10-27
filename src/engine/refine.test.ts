import { describe, expect, it } from 'vitest';
import type { Classification, MoveReview, PositionAnalysis } from '@/core/types';
import { PRESETS } from './presets';
import {
  REFINE_MAX_MOVES,
  isBetterAnalysis,
  isSuspiciousTopMove,
  positionsToRefine,
  refineSettings,
  selectMovesToRefine,
  verifiedAnalysis,
} from './refine';

/** A reviewed move with just the fields the selection reads. */
function move(
  ply: number,
  classification: Classification,
  winLoss = 0,
  options: { topMove?: boolean } = {},
): MoveReview {
  const uci = `m${ply}`;
  return {
    ply,
    color: ply % 2 === 1 ? 'w' : 'b',
    san: uci,
    uci,
    classification,
    winBefore: 50,
    winAfter: 50 - winLoss,
    winLoss,
    accuracy: 100,
    evalAfter: null,
    whiteWinAfter: 50,
    best: {
      uci: options.topMove ? uci : 'other',
      san: 'x',
      score: { type: 'cp', value: 0 },
      pvUci: [],
      pvSan: [],
    },
    explanation: '',
  };
}

function analysis(depth: number, extra: Partial<PositionAnalysis> = {}): PositionAnalysis {
  return {
    fen: 'fen',
    depth,
    lines: [{ pv: ['e2e4'], score: { type: 'cp', value: 0 }, depth }],
    ...extra,
  };
}

describe('refineSettings', () => {
  it('searches 4 plies deeper with double the time cap', () => {
    expect(refineSettings(PRESETS.fast)).toEqual({ depth: 16, multiPv: 2, maxTimeMs: 3000 });
    expect(refineSettings(PRESETS.standard)).toEqual({ depth: 20, multiPv: 2, maxTimeMs: 8000 });
  });

  it('adds only 2 plies to the deep preset, which is already slow', () => {
    expect(refineSettings(PRESETS.deep)).toEqual({ depth: 22, multiPv: 2, maxTimeMs: 24000 });
  });
});

describe('isSuspiciousTopMove', () => {
  it('flags the engine top move when it lost more than an Inaccuracy', () => {
    expect(isSuspiciousTopMove(move(1, 'best', 25, { topMove: true }))).toBe(true);
    expect(isSuspiciousTopMove(move(1, 'best', 10.5, { topMove: true }))).toBe(true);
  });

  it('accepts search noise up to the Inaccuracy bound, and other moves', () => {
    expect(isSuspiciousTopMove(move(1, 'best', 10, { topMove: true }))).toBe(false);
    expect(isSuspiciousTopMove(move(1, 'blunder', 25))).toBe(false);
    expect(isSuspiciousTopMove({ ...move(1, 'best', 25), best: undefined })).toBe(false);
  });
});

describe('selectMovesToRefine', () => {
  it('picks Brilliant, Great, Miss, Mistake and Blunder moves, in game order', () => {
    const moves = [
      move(1, 'book'),
      move(2, 'blunder', 30),
      move(3, 'best', 0, { topMove: true }),
      move(4, 'mistake', 12),
      move(5, 'great', 0, { topMove: true }),
      move(6, 'inaccuracy', 7),
      move(7, 'brilliant', 1),
      move(8, 'excellent', 1),
      move(9, 'missedWin', 15),
      move(10, 'good', 4),
      move(11, 'forced', 0, { topMove: true }),
    ];
    expect(selectMovesToRefine({ moves })).toEqual([2, 4, 5, 7, 9]);
  });

  it('adds top moves that lost more than an Inaccuracy, whatever their label', () => {
    const moves = [
      move(1, 'best', 25, { topMove: true }),
      move(2, 'forced', 40, { topMove: true }),
      move(3, 'best', 9, { topMove: true }),
    ];
    expect(selectMovesToRefine({ moves })).toEqual([1, 2]);
  });

  it('selects nothing in a clean game', () => {
    expect(selectMovesToRefine({ moves: [move(1, 'best'), move(2, 'excellent', 1)] })).toEqual([]);
    expect(selectMovesToRefine({ moves: [] })).toEqual([]);
  });

  it('keeps at most 16 moves: suspicious top moves, Brilliant, Great, then the costliest', () => {
    const errors = Array.from({ length: 20 }, (_, i) =>
      move(i + 10, i % 2 ? 'mistake' : 'blunder', 11 + i),
    );
    const moves = [
      move(1, 'great', 0, { topMove: true }),
      move(2, 'brilliant', 0),
      move(3, 'best', 12, { topMove: true }),
      ...errors,
    ];
    const selected = selectMovesToRefine({ moves });

    expect(REFINE_MAX_MOVES).toBe(16);
    expect(selected).toHaveLength(16);
    expect(selected.slice(0, 3)).toEqual([1, 2, 3]);
    // The 13 errors that cost the most (plies 17-29 lost 18-30 points).
    expect(selected.slice(3)).toEqual(Array.from({ length: 13 }, (_, i) => i + 17));
  });

  it('honours a custom limit', () => {
    const moves = [move(1, 'blunder', 30), move(2, 'blunder', 40), move(3, 'mistake', 15)];
    expect(selectMovesToRefine({ moves }, 2)).toEqual([1, 2]);
    expect(selectMovesToRefine({ moves }, 0)).toEqual([]);
  });
});

describe('positionsToRefine', () => {
  const analyses = [analysis(16), analysis(16), analysis(16), analysis(16), analysis(16)];

  it('returns the positions before and after each move, once, in order', () => {
    expect(positionsToRefine([3, 1, 2], analyses, 20)).toEqual([0, 1, 2, 3]);
    expect(positionsToRefine([4], analyses, 20)).toEqual([3, 4]);
  });

  it('skips positions already searched to the target depth', () => {
    const partlyDone = [...analyses];
    partlyDone[2] = analysis(20);
    partlyDone[3] = analysis(21);
    expect(positionsToRefine([2, 3, 4], partlyDone, 20)).toEqual([1, 4]);
  });

  it('skips positions where the game is over and positions without an analysis', () => {
    const ended = [analysis(16), analysis(0, { lines: [], terminal: 'checkmate' })];
    expect(positionsToRefine([1], ended, 20)).toEqual([0]);
    expect(positionsToRefine([5], analyses, 20)).toEqual([4]);
  });
});

describe('isBetterAnalysis', () => {
  it('accepts a result at least as deep as the original', () => {
    expect(isBetterAnalysis(analysis(20), analysis(16))).toBe(true);
    expect(isBetterAnalysis(analysis(16), analysis(16))).toBe(true);
    expect(isBetterAnalysis(analysis(20), null)).toBe(true);
  });

  it('keeps the original when the time cap stopped the new search earlier', () => {
    expect(isBetterAnalysis(analysis(14), analysis(16))).toBe(false);
  });

  it('never replaces a finished game or a different position, nor with an empty result', () => {
    const over = analysis(0, { lines: [], terminal: 'stalemate' });
    expect(isBetterAnalysis(analysis(20), over)).toBe(false);
    expect(isBetterAnalysis(analysis(20, { fen: 'other' }), analysis(16))).toBe(false);
    expect(isBetterAnalysis(analysis(20, { lines: [] }), analysis(16))).toBe(false);
  });
});

describe('verifiedAnalysis', () => {
  it('keeps the analysis it replaces, one level deep', () => {
    const original = analysis(16);
    const verified = verifiedAnalysis(analysis(20), original);
    expect(verified).toEqual({ ...analysis(20), unverified: original });
    // Verifying again keeps the full pass's analysis, not the first verification.
    expect(verifiedAnalysis(analysis(22), verified).unverified).toEqual(original);
  });
});
