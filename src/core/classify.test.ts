import { describe, expect, it } from 'vitest';
import { baseClassification, classifyMove, type ClassifyInput } from './classify';
import { THRESHOLDS } from './thresholds';
import type { SacrificeInfo } from './types';

const EPS = 1e-6;
const { loss: LOSS, brilliant: BRILLIANT, great: GREAT, miss: MISS } = THRESHOLDS;

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
    // The search after the move saw less, but both lines of the same search still differ by 10.
    expect(classify({ ...GREAT_INPUT, winBefore: 55, winAfter: 53, winSecondBest: 45 })).toBe(
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
    expect(classify({ ...GREAT_INPUT, isCheckmate: true })).toBe('best');
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
      minGapToSecond: 9,
      maxSecondBestWin: 61,
      maxLoss: 3,
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

describe('classifyMove: Miss', () => {
  /** An error of `loss` from a 65% position with a move that is not the engine's choice. */
  const error = (loss: number, overrides: Partial<ClassifyInput> = {}) =>
    classify({ winBefore: 65, winAfter: 65 - loss, bestUci: 'd2d4', ...overrides });

  it('is a plain error when there was no particular chance', () => {
    expect(error(8)).toBe('inaccuracy');
    expect(error(15)).toBe('mistake');
    // Even from a winning position: being clearly better is not a chance missed.
    expect(classify({ winBefore: 85, winAfter: 55, bestUci: 'd2d4' })).toBe('blunder');
  });

  it('labels an error Miss when the best move started a forced mate', () => {
    // Mate → +10 (87.9 %) loses 12 points: a Mistake that lets the mate slip.
    expect(classify({ winBefore: 100, winAfter: 87.9, bestUci: 'd2d4', mateBefore: 3 })).toBe(
      'missedWin',
    );
    // The opponent's mate is no chance.
    expect(error(15, { mateBefore: -3 })).toBe('mistake');
  });

  it('labels an error Miss when the best line wins material', () => {
    expect(error(8, { bestLineGain: MISS.minMaterialWon })).toBe('missedWin');
    expect(error(15, { bestLineGain: 9 })).toBe('missedWin');
    expect(error(8, { bestLineGain: MISS.minMaterialWon - 1 })).toBe('inaccuracy');
  });

  it('does not count material that the move played wins as well', () => {
    // Both lines win the piece (taking with the other piece, or a move later): nothing missed.
    expect(error(8, { bestLineGain: 3, playedLineGain: 3 })).toBe('inaccuracy');
    expect(error(8, { bestLineGain: 3, playedLineGain: 2 })).toBe('inaccuracy');
    expect(error(8, { bestLineGain: 3, playedLineGain: 1 })).toBe('missedWin');
    // Material the move played loses is the refutation's business, not a missed chance.
    expect(error(8, { bestLineGain: 1, playedLineGain: -3 })).toBe('inaccuracy');
    expect(error(8, { bestLineGain: 2, playedLineGain: -3 })).toBe('missedWin');
  });

  it("labels an error Miss when it gives back most of the opponent's mistake", () => {
    // The opponent gave away 15 points; giving back half of them or more is a Miss.
    expect(error(7.5, { opponentGift: 15 })).toBe('missedWin');
    expect(error(7.4, { opponentGift: 15 })).toBe('inaccuracy');
    // A gift smaller than a Mistake's worth is no real chance.
    expect(error(8, { opponentGift: MISS.minGift })).toBe('missedWin');
    expect(error(8, { opponentGift: MISS.minGift - EPS })).toBe('inaccuracy');
  });

  it('keeps a plain Mistake or Blunder when the move leaves the mover clearly worse', () => {
    const chance = { mateBefore: 2, bestLineGain: 3, opponentGift: 30 };
    expect(error(65 - MISS.minWinAfter, chance)).toBe('missedWin');
    expect(error(65 - MISS.minWinAfter + EPS, chance)).toBe('blunder');
  });

  it('never replaces Best, Excellent or Good', () => {
    const chance = { mateBefore: 2, bestLineGain: 3, opponentGift: 30 };
    expect(error(4, chance)).toBe('good');
    expect(error(1, chance)).toBe('excellent');
    expect(error(15, { ...chance, uci: 'd2d4' })).toBe('best');
  });

  it('gives Book and Forced precedence', () => {
    expect(error(15, { mateBefore: 2, inBook: true })).toBe('book');
    expect(error(15, { mateBefore: 2, legalMoveCount: 1 })).toBe('forced');
  });

  it('keeps the documented thresholds', () => {
    expect(MISS).toEqual({
      minMaterialWon: 2,
      minGift: 10,
      minShareGivenBack: 0.5,
      minWinAfter: 40,
    });
  });
});

describe('classifyMove: forced mates', () => {
  /** A move other than the engine's choice. */
  const move = (overrides: Partial<ClassifyInput>) => classify({ bestUci: 'd2d4', ...overrides });

  it('grades walking into a forced mate by the win % it costs (a mate is 0 %)', () => {
    expect(move({ winBefore: 27, winAfter: 0 })).toBe('blunder'); // about -5.0 → mated
    expect(move({ winBefore: 12.1, winAfter: 0 })).toBe('mistake'); // -10.0 → mated
    expect(move({ winBefore: 8, winAfter: 0 })).toBe('inaccuracy');
  });

  it('grades letting a forced mate slip by the advantage that is left (a mate is 100 %)', () => {
    expect(move({ winBefore: 100, winAfter: 92 })).toBe('inaccuracy');
    expect(move({ winBefore: 100, winAfter: 87.9 })).toBe('mistake'); // mate → +10
    expect(move({ winBefore: 100, winAfter: 64.5 })).toBe('blunder'); // mate → +3
  });

  it('accepts a slower mate or delivering checkmate', () => {
    expect(move({ winBefore: 100, winAfter: 100, mateBefore: 2 })).toBe('best');
    expect(move({ winBefore: 100, winAfter: 100, mateBefore: 1, isCheckmate: true })).toBe('best');
  });

  it('is not Brilliant when the sacrifice lets a forced mate slip', () => {
    const sacrifice = { ...BRILLIANT_INPUT, bestUci: 'd2d4', winBefore: 100, winAfter: 100 };
    expect(classify(sacrifice)).toBe('brilliant');
    expect(classify({ ...sacrifice, winAfter: 87.9, mateBefore: 4 })).toBe('missedWin');
  });
});
