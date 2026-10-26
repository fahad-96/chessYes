import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  baseClassification,
  classifyMove,
  mateSwingClassification,
  type ClassifyInput,
} from './classify';
import { THRESHOLDS } from './thresholds';
import type { SacrificeInfo } from './types';

const EPS = 1e-6;
const {
  loss: LOSS,
  brilliant: BRILLIANT,
  great: GREAT,
  missedWin: MISSED,
  mate: MATE,
} = THRESHOLDS;

/** A quiet, non-book move with many alternatives that loses nothing. */
const QUIET: ClassifyInput = {
  color: 'w',
  uci: 'g1f3',
  winBefore: 60,
  winAfter: 60,
  legalMoveCount: 30,
  inBook: false,
  isCapture: false,
  to: 'f3',
  inCheck: false,
  isCheckmate: false,
  sacrifice: null,
};

const KNIGHT_SAC: SacrificeInfo = { material: 3, square: 'f7', piece: 'n' };

function classify(overrides: Partial<ClassifyInput>) {
  return classifyMove({ ...QUIET, ...overrides });
}

/** Loses `loss` win % from a 60% position with a move that is not the engine's choice. */
function withLoss(loss: number, overrides: Partial<ClassifyInput> = {}) {
  return classify({ winBefore: 60, winAfter: 60 - loss, bestUci: 'd2d4', ...overrides });
}

/** Engine's top move with a sacrifice: satisfies every Brilliant condition. */
const BRILLIANT_INPUT: Partial<ClassifyInput> = {
  uci: 'c4f7',
  bestUci: 'c4f7',
  to: 'f7',
  isCapture: true,
  winBefore: 65,
  winAfter: 65,
  sacrifice: KNIGHT_SAC,
};

/** Engine's top move whose alternative is clearly worse: satisfies every Great condition. */
const GREAT_INPUT: Partial<ClassifyInput> = {
  uci: 'd2d4',
  bestUci: 'd2d4',
  to: 'd4',
  winBefore: 55,
  winAfter: 55,
  winSecondBest: 35,
};

describe('baseClassification', () => {
  it('labels a move that loses nothing as Best', () => {
    expect(baseClassification(0, false)).toBe('best');
  });

  it("labels the engine's top move as Best whatever the measured loss", () => {
    expect(baseClassification(30, true)).toBe('best');
  });

  it('uses inclusive upper bounds for each label', () => {
    expect(baseClassification(EPS, false)).toBe('excellent');
    expect(baseClassification(LOSS.excellent, false)).toBe('excellent');
    expect(baseClassification(LOSS.excellent + EPS, false)).toBe('good');
    expect(baseClassification(LOSS.good, false)).toBe('good');
    expect(baseClassification(LOSS.good + EPS, false)).toBe('inaccuracy');
    expect(baseClassification(LOSS.inaccuracy, false)).toBe('inaccuracy');
    expect(baseClassification(LOSS.inaccuracy + EPS, false)).toBe('mistake');
    expect(baseClassification(LOSS.mistake, false)).toBe('mistake');
    expect(baseClassification(LOSS.mistake + EPS, false)).toBe('blunder');
    expect(baseClassification(100, false)).toBe('blunder');
  });

  it('keeps the documented thresholds', () => {
    // Changing these changes every review: update docs/CLASSIFICATION.md too.
    expect(LOSS).toEqual({ excellent: 2, good: 5, inaccuracy: 10, mistake: 20 });
  });
});

describe('classifyMove: base labels', () => {
  it('maps the win % lost to the base label', () => {
    expect(withLoss(0)).toBe('best');
    expect(withLoss(1.5)).toBe('excellent');
    expect(withLoss(4)).toBe('good');
    expect(withLoss(8)).toBe('inaccuracy');
    expect(withLoss(15)).toBe('mistake');
    expect(withLoss(35)).toBe('blunder');
  });

  it('treats a win % gain as no loss', () => {
    expect(classify({ winBefore: 40, winAfter: 55, bestUci: 'd2d4' })).toBe('best');
  });

  it("labels the engine's top move Best even when the next search sees a drop", () => {
    expect(withLoss(15, { uci: 'd2d4' })).toBe('best');
  });

  it('only counts a move as the engine move when bestUci is known', () => {
    expect(classify({ winAfter: 55, bestUci: undefined })).toBe('good');
  });
});

describe('classifyMove: Book and Forced', () => {
  it('labels book moves Book, whatever the evaluation says', () => {
    expect(withLoss(35, { inBook: true })).toBe('book');
    expect(classify({ ...BRILLIANT_INPUT, inBook: true })).toBe('book');
  });

  it('labels the only legal move Forced, whatever the evaluation says', () => {
    expect(withLoss(35, { legalMoveCount: 1 })).toBe('forced');
    expect(classify({ ...GREAT_INPUT, legalMoveCount: 1 })).toBe('forced');
    expect(classify({ ...BRILLIANT_INPUT, legalMoveCount: 1 })).toBe('forced');
  });

  it('does not treat two legal moves as forced', () => {
    expect(classify({ ...GREAT_INPUT, legalMoveCount: 2 })).toBe('great');
  });

  it('gives Book precedence over Forced', () => {
    expect(classify({ inBook: true, legalMoveCount: 1 })).toBe('book');
  });
});

describe('classifyMove: Brilliant', () => {
  it('labels a sound, necessary sacrifice Brilliant', () => {
    expect(classify(BRILLIANT_INPUT)).toBe('brilliant');
  });

  it('allows a sacrifice that is not the engine move if it loses at most maxLoss', () => {
    const notEngine = { ...BRILLIANT_INPUT, bestUci: 'd2d4' };
    expect(classify({ ...notEngine, winAfter: 65 - BRILLIANT.maxLoss })).toBe('brilliant');
    expect(classify({ ...notEngine, winAfter: 65 - BRILLIANT.maxLoss - EPS })).toBe('good');
  });

  it('requires a sacrifice of at least minSacrifice', () => {
    expect(classify({ ...BRILLIANT_INPUT, sacrifice: null })).toBe('best');
    const small = { ...KNIGHT_SAC, material: BRILLIANT.minSacrifice - 1 };
    expect(classify({ ...BRILLIANT_INPUT, sacrifice: small })).toBe('best');
    const exchange = { ...KNIGHT_SAC, material: BRILLIANT.minSacrifice };
    expect(classify({ ...BRILLIANT_INPUT, sacrifice: exchange })).toBe('brilliant');
  });

  it('requires the mover to be at least equal after the sacrifice', () => {
    const at = (win: number) => classify({ ...BRILLIANT_INPUT, winBefore: win, winAfter: win });
    expect(at(BRILLIANT.minWinAfter)).toBe('brilliant');
    expect(at(BRILLIANT.minWinAfter - EPS)).toBe('best');
  });

  it('is not Brilliant when the second-best move also keeps a decisive advantage', () => {
    const atSecond = (winSecondBest: number) =>
      classify({ ...BRILLIANT_INPUT, winBefore: 99, winAfter: 99, winSecondBest });
    expect(atSecond(BRILLIANT.maxSecondBestWin)).toBe('best');
    expect(atSecond(BRILLIANT.maxSecondBestWin - EPS)).toBe('brilliant');
  });

  it('gives the sacrifice the benefit of the doubt without a second line', () => {
    expect(classify({ ...BRILLIANT_INPUT, winBefore: 99, winAfter: 99 })).toBe('brilliant');
  });

  it('takes precedence over Great', () => {
    expect(classify({ ...BRILLIANT_INPUT, winSecondBest: 30 })).toBe('brilliant');
  });
});

describe('classifyMove: Great', () => {
  it('labels the only good move Great', () => {
    expect(classify(GREAT_INPUT)).toBe('great');
  });

  it('requires a second-best line', () => {
    expect(classify({ ...GREAT_INPUT, winSecondBest: undefined })).toBe('best');
  });

  it("requires the move to be the engine's top move", () => {
    expect(classify({ ...GREAT_INPUT, bestUci: 'e2e4' })).toBe('best');
    expect(classify({ ...GREAT_INPUT, bestUci: undefined })).toBe('best');
  });

  it('requires a gap of at least minGapToSecond to the second-best move', () => {
    const gap = (g: number) => classify({ ...GREAT_INPUT, winSecondBest: 55 - g });
    expect(gap(GREAT.minGapToSecond)).toBe('great');
    expect(gap(GREAT.minGapToSecond - EPS)).toBe('best');
  });

  it('measures the gap from the best line before the move', () => {
    // The search after the move saw less, but both lines of the same search still differ by 15.
    expect(classify({ ...GREAT_INPUT, winBefore: 55, winAfter: 51, winSecondBest: 40 })).toBe(
      'great',
    );
  });

  it('requires the search after the move to confirm it (loss <= maxLoss)', () => {
    const after = (loss: number) => classify({ ...GREAT_INPUT, winAfter: 55 - loss });
    expect(after(GREAT.maxLoss)).toBe('great');
    // Still the engine's top move, so still Best.
    expect(after(GREAT.maxLoss + EPS)).toBe('best');
  });

  it('is never Great when answering a check', () => {
    expect(classify({ ...GREAT_INPUT, inCheck: true })).toBe('best');
  });

  it('is never Great for the move that delivers checkmate', () => {
    expect(classify({ ...GREAT_INPUT, isCheckmate: true, mateAfter: 0 })).toBe('best');
    // Brilliant still takes precedence (a mating move cannot offer material in practice).
    expect(classify({ ...BRILLIANT_INPUT, winSecondBest: 30, isCheckmate: true })).toBe(
      'brilliant',
    );
  });

  it('is not Great for a capture that simply wins material', () => {
    const capture = { ...GREAT_INPUT, isCapture: true };
    expect(classify({ ...capture, captureGain: GREAT.obviousCaptureGain })).toBe('best');
    expect(classify({ ...capture, captureGain: GREAT.obviousCaptureGain - 1 })).toBe('great');
    expect(classify({ ...capture, captureGain: 0 })).toBe('great');
    // The gain only matters for captures.
    expect(classify({ ...GREAT_INPUT, captureGain: 5 })).toBe('great');
  });

  it('keeps the documented thresholds', () => {
    expect(GREAT).toEqual({
      minGapToSecond: 15,
      maxSecondBestWin: 70,
      maxLoss: 5,
      obviousCaptureGain: 2,
    });
  });

  it('is not Great when the second-best move still keeps maxSecondBestWin', () => {
    const second = (win: number) =>
      classify({ ...GREAT_INPUT, winBefore: 95, winAfter: 95, winSecondBest: win });
    expect(second(GREAT.maxSecondBestWin)).toBe('best');
    expect(second(GREAT.maxSecondBestWin - EPS)).toBe('great');
  });

  it('excludes a simple recapture on the square the opponent just captured on', () => {
    const recapture = {
      ...GREAT_INPUT,
      to: 'd5' as const,
      isCapture: true,
      previousMove: { to: 'd5' as const, wasCapture: true },
    };
    expect(classify(recapture)).toBe('best');
    // Not a recapture: the previous move was quiet, or this capture is elsewhere.
    expect(classify({ ...recapture, previousMove: { to: 'd5', wasCapture: false } })).toBe('great');
    expect(classify({ ...recapture, to: 'e5' })).toBe('great');
    expect(classify({ ...recapture, isCapture: false })).toBe('great');
  });

  it('allows a capture that is not a recapture', () => {
    expect(classify({ ...GREAT_INPUT, isCapture: true, previousMove: undefined })).toBe('great');
  });
});

describe('classifyMove: Missed Win', () => {
  const missed = (winBefore: number, winAfter: number) =>
    classify({ winBefore, winAfter, bestUci: 'd2d4' });

  it('labels letting a winning position slip to roughly equal a Missed Win', () => {
    expect(missed(85, 50)).toBe('missedWin');
    expect(missed(75, 55)).toBe('missedWin');
  });

  it('requires a winning position before the move', () => {
    expect(missed(MISSED.minWinBefore, MISSED.maxWinAfter - EPS)).toBe('missedWin');
    expect(missed(MISSED.minWinBefore - EPS, MISSED.maxWinAfter - EPS)).toBe('mistake');
    // About +2.5 slipping to +0.8 is not a winning position thrown away.
    expect(missed(72.8, 57.5)).toBe('mistake');
  });

  it('keeps the documented thresholds', () => {
    expect(MISSED).toEqual({ minWinBefore: 75, maxWinAfter: 60, minWinAfter: 40, minLoss: 10 });
  });

  it('uses a half-open interval [minWinAfter, maxWinAfter) for the position after', () => {
    expect(missed(75, MISSED.minWinAfter)).toBe('missedWin');
    expect(missed(75, MISSED.minWinAfter - EPS)).toBe('blunder');
    expect(missed(75, MISSED.maxWinAfter - EPS)).toBe('missedWin');
    expect(missed(75, MISSED.maxWinAfter)).toBe('mistake');
  });

  it('keeps Blunder when the position becomes lost', () => {
    expect(missed(90, 20)).toBe('blunder');
  });

  it('never replaces Best, Excellent or Good', () => {
    expect(classify({ winBefore: 80, winAfter: 50, uci: 'd2d4', bestUci: 'd2d4' })).toBe('best');
  });

  it('gives Book and Forced precedence', () => {
    expect(classify({ winBefore: 85, winAfter: 50, inBook: true })).toBe('book');
    expect(classify({ winBefore: 85, winAfter: 50, legalMoveCount: 1 })).toBe('forced');
  });
});

describe('classifyMove: mate swings', () => {
  /** A move other than the engine's choice. */
  const swing = (overrides: Partial<ClassifyInput>) => classify({ bestUci: 'd2d4', ...overrides });

  it('grades allowing a forced mate by how bad the position already was', () => {
    // -7.0 → mated: 7.1 % → 2.5 % loses only 4.6 points, yet the game is now lost by force.
    expect(swing({ winBefore: 7.1, winAfter: 2.5, mateAfter: -3 })).toBe('blunder');
    expect(swing({ winBefore: MATE.allowedBlunderAbove, winAfter: 2.5, mateAfter: -3 })).toBe(
      'mistake',
    );
    expect(swing({ winBefore: 5, winAfter: 2.5, mateAfter: -3 })).toBe('mistake');
    expect(swing({ winBefore: MATE.allowedMistakeAbove, winAfter: 2.5, mateAfter: -3 })).toBe(
      'inaccuracy',
    );
    expect(swing({ winBefore: 2.5, winAfter: 2.5, mateAfter: -1 })).toBe('inaccuracy');
  });

  it('does not punish a mate that was already coming', () => {
    expect(swing({ winBefore: 2.5, winAfter: 2.5, mateBefore: -5, mateAfter: -2 })).toBe('best');
  });

  it('grades letting a forced mate slip by the advantage that is left', () => {
    // Mate → +10 or more: still 97.5 %, so the win % alone sees no loss at all.
    expect(swing({ winBefore: 97.5, winAfter: 97.54, mateBefore: 3 })).toBe('inaccuracy');
    expect(swing({ winBefore: 97.5, winAfter: MATE.lostInaccuracyFrom, mateBefore: 3 })).toBe(
      'inaccuracy',
    );
    expect(swing({ winBefore: 97.5, winAfter: 95, mateBefore: 3 })).toBe('mistake');
    expect(swing({ winBefore: 97.5, winAfter: MATE.lostMistakeFrom, mateBefore: 3 })).toBe(
      'mistake',
    );
    expect(swing({ winBefore: 97.5, winAfter: 90, mateBefore: 3 })).toBe('blunder');
  });

  it('accepts a slower mate or delivering checkmate', () => {
    expect(swing({ winBefore: 97.5, winAfter: 97.5, mateBefore: 2, mateAfter: 4 })).toBe('best');
    expect(swing({ winBefore: 97.5, winAfter: 100, mateBefore: 1, mateAfter: 0 })).toBe('best');
  });

  it('keeps the worse of the mate label and the win % label', () => {
    // Mate → about +2.0 loses 30 points: a Blunder either way.
    expect(swing({ winBefore: 97.5, winAfter: 67.5, mateBefore: 2 })).toBe('blunder');
    // Mate → equal is still a Missed Win.
    expect(swing({ winBefore: 97.5, winAfter: 50, mateBefore: 2 })).toBe('missedWin');
    // Turning your own mate into the opponent's.
    expect(swing({ winBefore: 97.5, winAfter: 2.5, mateBefore: 2, mateAfter: -2 })).toBe('blunder');
  });

  it("exempts the engine's top move, Book and Forced", () => {
    expect(swing({ winBefore: 30, winAfter: 2.5, mateAfter: -2, uci: 'd2d4' })).toBe('best');
    expect(swing({ winBefore: 97.5, winAfter: 97.5, mateBefore: 2, inBook: true })).toBe('book');
    expect(swing({ winBefore: 7.1, winAfter: 2.5, mateAfter: -1, legalMoveCount: 1 })).toBe(
      'forced',
    );
  });

  it('is not Brilliant when the sacrifice lets a forced mate slip', () => {
    const sacrifice = { ...BRILLIANT_INPUT, bestUci: 'd2d4', winBefore: 97.5, winAfter: 97.5 };
    expect(classify(sacrifice)).toBe('brilliant');
    expect(classify({ ...sacrifice, mateBefore: 4 })).toBe('inaccuracy');
  });

  it('returns null when no mate appears or disappears', () => {
    expect(mateSwingClassification({ winBefore: 60, winAfter: 40 })).toBeNull();
    expect(
      mateSwingClassification({ winBefore: 97.5, winAfter: 97.5, mateBefore: 3, mateAfter: 2 }),
    ).toBeNull();
  });

  it('keeps the documented thresholds', () => {
    expect(MATE).toEqual({
      allowedBlunderAbove: 7,
      allowedMistakeAbove: 2.5,
      lostInaccuracyFrom: 97.5,
      lostMistakeFrom: 93,
    });
  });
});

describe('classifyMove: Missed Win minimum loss', () => {
  afterEach(() => {
    vi.doUnmock('./thresholds');
    vi.resetModules();
  });

  it('requires a loss of at least minLoss (only reachable with tuned thresholds)', async () => {
    // With the shipped numbers the interval rules already imply loss > minLoss,
    // so widen the window to check that minLoss is enforced on its own.
    vi.resetModules();
    vi.doMock('./thresholds', async (importOriginal) => {
      const original = await importOriginal<typeof import('./thresholds')>();
      const missedWin = { ...original.THRESHOLDS.missedWin, maxWinAfter: 72, minLoss: 15 };
      return { ...original, THRESHOLDS: { ...original.THRESHOLDS, missedWin } };
    });
    const tuned = await import('./classify');
    const input = { ...QUIET, bestUci: 'd2d4', winBefore: 80 };
    expect(tuned.classifyMove({ ...input, winAfter: 66 })).toBe('mistake'); // loss 14
    expect(tuned.classifyMove({ ...input, winAfter: 65 })).toBe('missedWin'); // loss 15
  });
});
