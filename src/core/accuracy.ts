import { CALIBRATED, DEFAULT_ACCURACY_MODEL, type AccuracyModel } from './accuracyModel';
import type { Color } from './types';
import { winPercentFor } from './winPercent';

/**
 * Accuracy per move and per game, for both models (see accuracyModel.ts).
 *
 * Calibrated (default):
 *   per move: CALIBRATED.moveScale * exp(-CALIBRATED.moveDecay * winDiff) + (100 - moveScale),
 *             100 when the move did not lose win %;
 *   per game and player: the harmonic mean of the move accuracies.
 *
 * Lichess (lila: AccuracyPercent.scala):
 *   per move: 103.1668100711649 * exp(-0.04354415386753951 * winDiff) - 3.166924740191411,
 *             plus a +1 "uncertainty bonus", clamped to [0, 100]; 100 when the move did not lose win %;
 *   per game and player: the average of (a) the mean of move accuracies weighted by position
 *             volatility (std-dev of win % over a sliding window, clamped to [0.5, 12]) and
 *             (b) the harmonic mean of move accuracies.
 *
 * The win % series must come from the same model (winPercent.ts).
 */

const CURVE_SCALE = 103.1668100711649;
const CURVE_DECAY = -0.04354415386753951;
const CURVE_OFFSET = -3.166924740191411;
/** Lichess adds one point because engine evaluations at limited depth are imperfect. */
const UNCERTAINTY_BONUS = 1;

const MIN_WINDOW = 2;
const MAX_WINDOW = 8;
const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Accuracy of one move from the mover's win % before and after it (0-100). */
export function moveAccuracy(
  winBefore: number,
  winAfter: number,
  model: AccuracyModel = DEFAULT_ACCURACY_MODEL,
): number {
  if (winAfter >= winBefore) return 100;
  const winDiff = winBefore - winAfter;
  if (model === 'calibrated') {
    // Never below 100 - moveScale (about 21), so no clamp is needed.
    const { moveScale, moveDecay } = CALIBRATED;
    return moveScale * Math.exp(-moveDecay * winDiff) + (100 - moveScale);
  }
  const raw = CURVE_SCALE * Math.exp(CURVE_DECAY * winDiff) + CURVE_OFFSET;
  return clamp(raw + UNCERTAINTY_BONUS, 0, 100);
}

function populationStdDev(values: number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * One volatility weight per move. Mirrors lila: the first window is repeated
 * (windowSize - 2) times so that the sliding windows line up one-to-one with the
 * moves; calm positions get a low weight, sharp ones a high weight.
 */
function volatilityWeights(winPercents: number[], windowSize: number): number[] {
  const windows: number[][] = [];
  const head = winPercents.slice(0, windowSize);
  const padding = Math.min(windowSize, winPercents.length) - 2;
  for (let i = 0; i < padding; i++) windows.push(head);

  if (winPercents.length <= windowSize) {
    windows.push(winPercents); // Scala's sliding() yields the whole list when it is short
  } else {
    for (let start = 0; start + windowSize <= winPercents.length; start++) {
      windows.push(winPercents.slice(start, start + windowSize));
    }
  }
  return windows.map((window) => clamp(populationStdDev(window), MIN_WEIGHT, MAX_WEIGHT));
}

interface WeightedAccuracy {
  accuracy: number;
  weight: number;
}

/** Lichess: the average of the volatility-weighted mean and the harmonic mean. */
function lichessPlayerAccuracy(moves: WeightedAccuracy[]): number {
  if (moves.length === 0) return 100;

  let weightedSum = 0;
  let weightTotal = 0;
  let inverseSum = 0;
  for (const { accuracy, weight } of moves) {
    weightedSum += accuracy * weight;
    weightTotal += weight;
    // Flooring at 1 keeps a single 0% move from collapsing the harmonic mean to 0.
    inverseSum += 1 / Math.max(1, accuracy);
  }
  const weightedMean = weightedSum / weightTotal;
  const harmonicMean = moves.length / inverseSum;
  return (weightedMean + harmonicMean) / 2;
}

/**
 * Calibrated: the harmonic mean of the move accuracies. Like a chain, a game is judged by its
 * weak links: a few very bad moves weigh more than in an ordinary average.
 */
function harmonicMean(accuracies: number[]): number {
  if (accuracies.length === 0) return 100;
  return accuracies.length / accuracies.reduce((sum, accuracy) => sum + 1 / accuracy, 0);
}

/**
 * Game accuracy for both players.
 * @param whiteWinPercents White's win % for every position, index 0 = start position, from
 *        the same model (winPercent.ts positionWhiteWinPercent with `model`).
 * @param firstMover The colour that made the first move of the game (usually 'w').
 * @returns Accuracy per player; a player who made no moves gets 100 (the UI shows "—"
 *          for a player whose move counts are all zero).
 */
export function gameAccuracy(
  whiteWinPercents: number[],
  firstMover: Color,
  model: AccuracyModel = DEFAULT_ACCURACY_MODEL,
): { white: number; black: number } {
  const moveCount = whiteWinPercents.length - 1;
  if (moveCount < 1) return { white: 100, black: 100 };
  const secondMover: Color = firstMover === 'w' ? 'b' : 'w';

  if (model === 'calibrated') {
    const byColor: Record<Color, number[]> = { w: [], b: [] };
    for (let i = 0; i < moveCount; i++) {
      const whiteBefore = whiteWinPercents[i];
      const whiteAfter = whiteWinPercents[i + 1];
      if (whiteBefore === undefined || whiteAfter === undefined) break;
      const color = i % 2 === 0 ? firstMover : secondMover;
      const before = winPercentFor(whiteBefore, color);
      byColor[color].push(moveAccuracy(before, winPercentFor(whiteAfter, color), model));
    }
    return { white: harmonicMean(byColor.w), black: harmonicMean(byColor.b) };
  }

  const windowSize = clamp(Math.floor(moveCount / 10), MIN_WINDOW, MAX_WINDOW);
  const weights = volatilityWeights(whiteWinPercents, windowSize);
  const byColor: Record<Color, WeightedAccuracy[]> = { w: [], b: [] };

  for (let i = 0; i < moveCount; i++) {
    const weight = weights[i];
    const whiteBefore = whiteWinPercents[i];
    const whiteAfter = whiteWinPercents[i + 1];
    if (weight === undefined || whiteBefore === undefined || whiteAfter === undefined) break;

    const color = i % 2 === 0 ? firstMover : secondMover;
    const accuracy =
      color === 'w'
        ? moveAccuracy(whiteBefore, whiteAfter, model)
        : moveAccuracy(100 - whiteBefore, 100 - whiteAfter, model);
    byColor[color].push({ accuracy, weight });
  }

  return { white: lichessPlayerAccuracy(byColor.w), black: lichessPlayerAccuracy(byColor.b) };
}
