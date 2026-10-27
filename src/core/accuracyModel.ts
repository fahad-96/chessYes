/**
 * The two scales Kibitz can judge moves on. Each one is a complete model: how an engine
 * evaluation becomes a win %, how the win % a move loses becomes that move's accuracy, and
 * how move accuracies become a game accuracy.
 *
 * - 'calibrated' (the default): Kibitz's own model, calibrated against the accuracy figures
 *   published by Chess.com game reviews. It is not Chess.com's model (that one is not public);
 *   it is an open model whose three numbers were fitted so that its accuracies land close to
 *   the published ones. Labels and the eval graph use its win % too.
 * - 'lichess': the open Lichess formulas (lila WinPercent.scala and AccuracyPercent.scala),
 *   kept for anyone who prefers that scale. Only accuracy changes; labels stay calibrated.
 *
 * See docs/CLASSIFICATION.md (sections 1 and 2) for the formulas side by side.
 */
export type AccuracyModel = 'calibrated' | 'lichess';

export const ACCURACY_MODELS: readonly AccuracyModel[] = ['calibrated', 'lichess'];

export const DEFAULT_ACCURACY_MODEL: AccuracyModel = 'calibrated';

/**
 * The fitted constants of the calibrated model, in one place.
 *
 * How they were fitted: 225 rated games from the public Chess.com API that carry published
 * accuracies, 45 in each average-rating band (under 1000, 1000-1400, 1400-1800, 1800-2200,
 * 2200 and up; blitz, rapid and daily). Every game was analysed by Kibitz itself (Stockfish 19
 * lite at depth 16, MultiPV 2, the Standard preset), and the three numbers below were chosen
 * to minimise the mean absolute error against the published accuracies, with 5-fold
 * cross-validation by game (9 games per band in each fold).
 *
 * Result on held-out games (450 player-games): mean absolute error 2.95 accuracy points
 * (the Lichess formulas: 6.31), RMSE 4.01, bias +0.37; 85 % of players within 5 points.
 * Per band the error is 2.5 to 3.6 points. The per-fold fits were stable (K 0.00196-0.00205,
 * A 78.1-80.2, B 0.127-0.133). Making the model depend on the players' ratings improved the
 * error by only 0.13, so the model does not use ratings.
 *
 * The remaining error is partly engine noise (another engine, another depth) and partly the
 * difference between this simple model and the real one. src/core/accuracyModel.test.ts
 * keeps the model inside that error band on games from the dataset.
 */
export const CALIBRATED = {
  /**
   * Win % slope per centipawn: White's win % = 100 / (1 + e^(−winSlope × cp)), with cp
   * clamped to ±1000. About half as steep as Lichess's 0.00368208: +3.0 is 64.5 %, not 75.1 %.
   */
  winSlope: 0.0019874203842195413,
  /**
   * Move accuracy = moveScale × e^(−moveDecay × win % lost) + (100 − moveScale): 100 for a
   * move that loses nothing, falling towards a floor of about 21 for a move that throws
   * the game away.
   */
  moveScale: 78.9620092371643,
  moveDecay: 0.13101142766742344,
} as const;
