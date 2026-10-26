/**
 * Every tunable number behind move classification lives here, so the rules are
 * easy to find, discuss and change. All values are in win-percentage points
 * (0-100) from the moving player's point of view unless noted otherwise.
 *
 * The full rules, with examples, are documented in docs/CLASSIFICATION.md.
 * If you change a number here, update that document and the tests.
 */
export const THRESHOLDS = {
  /**
   * Upper bounds of win % lost by a move for the base labels.
   * loss <= excellent → Excellent, <= good → Good, <= inaccuracy → Inaccuracy,
   * <= mistake → Mistake, anything larger → Blunder.
   * (The engine's own top move, or any move that loses nothing, is Best.)
   */
  loss: {
    excellent: 2,
    good: 5,
    inaccuracy: 10,
    mistake: 20,
  },

  /** "Great": the engine's top move when every alternative is clearly worse. */
  great: {
    /** The best move must beat the second-best move by at least this much. */
    minGapToSecond: 10,
    /** If the second-best move still keeps at least this, the move was not critical. */
    maxSecondBestWin: 70,
  },

  /** "Brilliant": a sound sacrifice. */
  brilliant: {
    /** The move must lose at most this much (Best or Excellent). */
    maxLoss: 2,
    /** Material offered, in pawn units (2 = exchange sacrifice or more). */
    minSacrifice: 2,
    /** After the sacrifice the mover must not be worse than equal. */
    minWinAfter: 50,
    /** If even the second-best move keeps at least this, the sacrifice was unnecessary. */
    maxSecondBestWin: 97,
  },

  /** "Missed Win": a winning move was available and the player let it slip. */
  missedWin: {
    /** The best move kept at least this (a clearly winning position). */
    minWinBefore: 70,
    /** After the move played the position is no longer winning. */
    maxWinAfter: 60,
    /** ...but not lost either (otherwise it is simply a Blunder). */
    minWinAfter: 40,
    /** Minimum loss for the label (Inaccuracy-sized or larger). */
    minLoss: 10,
  },
} as const;

/** Material values in pawn units used for sacrifice detection and explanations. */
export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 } as const;
