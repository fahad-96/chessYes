import type { Color } from './types';

/**
 * Accuracy, ported from Lichess (lila: AccuracyPercent.scala).
 *
 * Per move: 103.1668100711649 * exp(-0.04354415386753951 * winDiff) - 3.166924740191411,
 * plus a +1 "uncertainty bonus", clamped to [0, 100]; 100 when the move did not lose win %.
 *
 * Per game and player: the average of (a) the mean of move accuracies weighted by
 * position volatility (std-dev of win % over a sliding window, clamped to [0.5, 12])
 * and (b) the harmonic mean of move accuracies.
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

/** Accuracy of one move from the mover's win % before and after it. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const winDiff = winBefore - winAfter;
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

function playerAccuracy(moves: WeightedAccuracy[]): number {
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
 * Game accuracy for both players.
 * @param whiteWinPercents White's win % for every position, index 0 = start position.
 * @param firstMover The colour that made the first move of the game (usually 'w').
 * @returns Accuracy per player; a player who made no moves gets 100 (the UI shows "—"
 *          for a player whose move counts are all zero).
 */
export function gameAccuracy(
  whiteWinPercents: number[],
  firstMover: Color,
): { white: number; black: number } {
  const moveCount = whiteWinPercents.length - 1;
  if (moveCount < 1) return { white: 100, black: 100 };

  const windowSize = clamp(Math.floor(moveCount / 10), MIN_WINDOW, MAX_WINDOW);
  const weights = volatilityWeights(whiteWinPercents, windowSize);
  const secondMover: Color = firstMover === 'w' ? 'b' : 'w';
  const byColor: Record<Color, WeightedAccuracy[]> = { w: [], b: [] };

  for (let i = 0; i < moveCount; i++) {
    const weight = weights[i];
    const whiteBefore = whiteWinPercents[i];
    const whiteAfter = whiteWinPercents[i + 1];
    if (weight === undefined || whiteBefore === undefined || whiteAfter === undefined) break;

    const color = i % 2 === 0 ? firstMover : secondMover;
    const accuracy =
      color === 'w'
        ? moveAccuracy(whiteBefore, whiteAfter)
        : moveAccuracy(100 - whiteBefore, 100 - whiteAfter);
    byColor[color].push({ accuracy, weight });
  }

  return { white: playerAccuracy(byColor.w), black: playerAccuracy(byColor.b) };
}
