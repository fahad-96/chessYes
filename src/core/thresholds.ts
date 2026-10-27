/**
 * Every tunable number behind move classification lives here, so the rules are
 * easy to find, discuss and change. All values are in win-percentage points
 * (0-100) from the moving player's point of view unless noted otherwise, on the
 * calibrated win % scale (winPercent.ts; +1.0 is 55.0 %, +3.0 is 64.5 %, a forced
 * mate 100 %). "About +2.3" gives the evaluation a win % stands for, in pawns.
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
   * These are the published bounds of Chess.com's expected-points labels (0.02 / 0.05 /
   * 0.10 / 0.20), used here on Chess Yes's own calibrated win % scale.
   */
  loss: {
    excellent: 2,
    good: 5,
    inaccuracy: 10,
    mistake: 20,
  },

  /**
   * "Great": the engine's top move when every alternative is clearly worse.
   * The numbers were first tuned on the Lichess win % scale (gap 15, second best 70 %, loss 5)
   * and carried over to the calibrated scale so that the same moves stay Great: on 225 rated
   * games 95 % of the earlier Great moves still are, at about the same rate per game.
   */
  great: {
    /** The best move must beat the second-best move by at least this much. */
    minGapToSecond: 9,
    /** If the second-best move still keeps at least this (about +2.3), the move was not critical. */
    maxSecondBestWin: 61,
    /** The search after the move must confirm it: at most this much lost. */
    maxLoss: 3,
    /**
     * A capture that wins at least this much material outright (static exchange before
     * the move, pawn units) takes something that was simply hanging: obvious, not Great.
     */
    obviousCaptureGain: 2,
  },

  /** "Brilliant": a sound sacrifice. */
  brilliant: {
    /** The move must lose at most this much (Best or Excellent). */
    maxLoss: 2,
    /** Material offered, in pawn units (2 = exchange sacrifice or more). */
    minSacrifice: 2,
    /** After the sacrifice the mover must not be worse than equal. */
    minWinAfter: 50,
    /**
     * If even the second-best move keeps at least this (about +9.5, or a forced mate), the
     * sacrifice was unnecessary.
     */
    maxSecondBestWin: 87,
  },

  /**
   * "Miss" (key 'missedWin'): an error made when there was a real chance to punish the
   * opponent or cash in, which lets most of it slip. The chance is one of: the engine's best
   * move starts a forced mate; its line wins at least `minMaterialWon` more than the line
   * after the move played; or the opponent's previous move was an error that gave away at least `minGift`, of which this move gives
   * back at least `minShareGivenBack`.
   */
  miss: {
    /**
     * Pawn units the engine's best line must win beyond what the line after the move played
     * wins anyway (2 = the exchange, a piece for a pawn, ...).
     */
    minMaterialWon: 2,
    /** Win % the opponent's previous error must have given away (a Mistake's worth). */
    minGift: 10,
    /** Share of that gift the move must give back. */
    minShareGivenBack: 0.5,
    /**
     * A move that leaves the mover clearly worse (below about −2.0) is a plain Mistake or
     * Blunder: what matters most is the position it throws away, not the chance it missed.
     */
    minWinAfter: 40,
  },
} as const;

/** Material values in pawn units used for sacrifice detection and explanations. */
export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 } as const;
