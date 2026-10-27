import { describe, expect, it } from 'vitest';
import { gameAccuracy, moveAccuracy } from './accuracy';
import { CALIBRATED } from './accuracyModel';
import type { Color } from './types';

/**
 * Independent reference of lila's AccuracyPercent.gameAccuracy (the Lichess model), written to mirror
 * the Scala code (List.fill + sliding + zip) rather than the production loop.
 */
function referenceGameAccuracy(winPercents: number[], startColor: Color) {
  const perMove = (before: number, after: number) => {
    if (after >= before) return 100;
    const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after));
    return Math.min(100, Math.max(0, raw - 3.166924740191411 + 1));
  };
  const stdDev = (xs: number[]) => {
    const mean = xs.reduce((a, b) => a + b) / xs.length;
    return Math.sqrt(xs.map((x) => (x - mean) ** 2).reduce((a, b) => a + b) / xs.length);
  };
  const sliding = (xs: number[], size: number) =>
    xs.length <= size
      ? [xs]
      : Array.from({ length: xs.length - size + 1 }, (_, i) => xs.slice(i, i + size));

  const size = Math.min(8, Math.max(2, Math.trunc((winPercents.length - 1) / 10)));
  const fill = Math.max(0, Math.min(size, winPercents.length) - 2);
  const windows = [
    ...Array<number[]>(fill).fill(winPercents.slice(0, size)),
    ...sliding(winPercents, size),
  ];
  const weights = windows.map((w) => Math.min(12, Math.max(0.5, stdDev(w))));

  const pairs = winPercents.slice(1).map((next, i) => [winPercents[i] as number, next] as const);
  const scored = pairs.slice(0, weights.length).map(([prev, next], i) => {
    const isWhite = (i % 2 === 0) === (startColor === 'w');
    const accuracy = isWhite ? perMove(prev, next) : perMove(100 - prev, 100 - next);
    return { isWhite, accuracy, weight: weights[i] as number };
  });

  const forColor = (isWhite: boolean) => {
    const own = scored.filter((s) => s.isWhite === isWhite);
    if (own.length === 0) return 100;
    const weighted =
      own.reduce((a, s) => a + s.accuracy * s.weight, 0) / own.reduce((a, s) => a + s.weight, 0);
    const harmonic = own.length / own.reduce((a, s) => a + 1 / Math.max(1, s.accuracy), 0);
    return (weighted + harmonic) / 2;
  };
  return { white: forColor(true), black: forColor(false) };
}

/** Deterministic pseudo-random win % sequence (mulberry32). */
function randomWinPercents(length: number, seed: number): number[] {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const values = [50];
  for (let i = 1; i < length; i++) {
    const previous = values[i - 1] as number;
    // Mostly small drifts with occasional large swings, like a real game.
    const swing = next() < 0.15 ? (next() - 0.5) * 60 : (next() - 0.5) * 8;
    values.push(Math.min(100, Math.max(0, previous + swing)));
  }
  return values;
}

/** Independent reference of the calibrated model, written from docs/CLASSIFICATION.md. */
function referenceCalibrated(winPercents: number[], startColor: Color) {
  const perMove = (before: number, after: number) =>
    after >= before
      ? 100
      : 78.9620092371643 * Math.exp(-0.13101142766742344 * (before - after)) + 21.0379907628357;
  const own = (isWhite: boolean) =>
    winPercents.slice(1).flatMap((next, i) => {
      const prev = winPercents[i] as number;
      const white = (i % 2 === 0) === (startColor === 'w');
      if (white !== isWhite) return [];
      return [white ? perMove(prev, next) : perMove(100 - prev, 100 - next)];
    });
  const harmonic = (xs: number[]) =>
    xs.length === 0 ? 100 : xs.length / xs.reduce((sum, x) => sum + 1 / x, 0);
  return { white: harmonic(own(true)), black: harmonic(own(false)) };
}

describe('moveAccuracy (calibrated, the default)', () => {
  it('is 100 when the move keeps or improves the win %', () => {
    expect(moveAccuracy(50, 50)).toBe(100);
    expect(moveAccuracy(40, 65)).toBe(100);
  });

  it('matches the documented curve', () => {
    // 78.9620092371643 * e^(-0.13101142766742344 * loss) + (100 - 78.9620092371643)
    expect(moveAccuracy(50, 49)).toBeCloseTo(90.304077213, 8);
    expect(moveAccuracy(50, 48)).toBeCloseTo(81.7987386018, 8);
    expect(moveAccuracy(50, 45)).toBeCloseTo(62.0518361771, 8);
    expect(moveAccuracy(50, 40)).toBeCloseTo(42.341089961, 8);
    expect(moveAccuracy(50, 30)).toBeCloseTo(26.7853373645, 8);
    expect(moveAccuracy(70, 40)).toBeCloseTo(22.5885629426, 8);
  });

  it('is the default model', () => {
    expect(moveAccuracy(50, 40)).toBe(moveAccuracy(50, 40, 'calibrated'));
  });

  it('depends only on the size of the drop', () => {
    expect(moveAccuracy(90, 80)).toBe(moveAccuracy(30, 20));
  });

  it('decreases as the loss grows, towards a floor of 100 - moveScale', () => {
    let previous = 100;
    for (const loss of [0.5, 2, 5, 10, 20, 40, 60]) {
      const accuracy = moveAccuracy(80, 80 - loss);
      expect(accuracy).toBeLessThan(previous);
      previous = accuracy;
    }
    const floor = 100 - CALIBRATED.moveScale;
    expect(moveAccuracy(100, 0)).toBeGreaterThan(floor);
    expect(moveAccuracy(100, 0)).toBeCloseTo(floor, 3);
  });
});

describe('moveAccuracy (Lichess)', () => {
  it('is 100 when the move keeps or improves the win %', () => {
    expect(moveAccuracy(50, 50, 'lichess')).toBe(100);
    expect(moveAccuracy(40, 65, 'lichess')).toBe(100);
  });

  it('matches hand-computed values of the Lichess curve (with the +1 bonus)', () => {
    // 103.1668100711649 * e^(-0.04354415386753951 * 10) - 3.166924740191411 + 1
    expect(moveAccuracy(50, 40, 'lichess')).toBeCloseTo(64.5798284537, 9);
    expect(moveAccuracy(50, 30, 'lichess')).toBeCloseTo(41.0168187414, 9);
    expect(moveAccuracy(70, 40, 'lichess')).toBeCloseTo(25.7720477469, 9);
  });

  it('depends only on the size of the drop', () => {
    expect(moveAccuracy(90, 80, 'lichess')).toBe(moveAccuracy(30, 20, 'lichess'));
  });

  it('clamps to [0, 100]', () => {
    // Tiny losses would exceed 100 because of the bonus.
    expect(moveAccuracy(50, 49.99, 'lichess')).toBe(100);
    expect(moveAccuracy(100, 0, 'lichess')).toBe(0);
  });
});

describe('gameAccuracy (calibrated, the default)', () => {
  it('gives 100 to players who made no moves', () => {
    expect(gameAccuracy([], 'w')).toEqual({ white: 100, black: 100 });
    expect(gameAccuracy([50], 'w')).toEqual({ white: 100, black: 100 });
  });

  it('gives 100 for a game in which every move kept or improved the win %', () => {
    expect(gameAccuracy([50, 55, 50, 58, 52], 'w')).toEqual({ white: 100, black: 100 });
  });

  it('equals the move accuracy when a player made a single move', () => {
    const result = gameAccuracy([50, 40, 40], 'w');
    expect(result.white).toBeCloseTo(42.341089961, 8);
    expect(result.black).toBe(100);
  });

  it('is the harmonic mean of the move accuracies, without volatility weights', () => {
    // White loses 20 and 40 points: 2 / (1 / 26.7853 + 1 / 21.4396) = 23.8265.
    const result = gameAccuracy([50, 30, 60, 20], 'w');
    expect(result.white).toBeCloseTo(23.826492613172032, 9);
    expect(result.black).toBeCloseTo(22.58856294259542, 9);
  });

  it('assigns the first move to Black when Black starts', () => {
    const result = gameAccuracy([50, 60, 40], 'b');
    expect(result.black).toBeCloseTo(42.341089961, 8);
    expect(result.white).toBeCloseTo(26.7853373645, 8);
  });

  it('matches the reference implementation on random games', () => {
    for (const [index, moves] of [1, 2, 3, 20, 45, 121].entries()) {
      const winPercents = randomWinPercents(moves + 1, index + 1);
      for (const firstMover of ['w', 'b'] as const) {
        const actual = gameAccuracy(winPercents, firstMover);
        const expected = referenceCalibrated(winPercents, firstMover);
        expect(actual.white).toBeCloseTo(expected.white, 9);
        expect(actual.black).toBeCloseTo(expected.black, 9);
        expect(actual.white).toBeGreaterThan(100 - CALIBRATED.moveScale);
        expect(actual.white).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('gameAccuracy (Lichess)', () => {
  const lichess = (winPercents: number[], firstMover: Color) =>
    gameAccuracy(winPercents, firstMover, 'lichess');

  it('gives 100 to players who made no moves', () => {
    expect(lichess([], 'w')).toEqual({ white: 100, black: 100 });
    expect(lichess([50], 'w')).toEqual({ white: 100, black: 100 });
  });

  it('gives 100 for a game in which every move kept or improved the win %', () => {
    // Each side's moves move the win % in its own favour.
    expect(lichess([50, 55, 50, 58, 52], 'w')).toEqual({ white: 100, black: 100 });
  });

  it('equals the move accuracy when a player made a single move', () => {
    const result = lichess([50, 40, 40], 'w');
    expect(result.white).toBeCloseTo(64.5798284537, 9);
    expect(result.black).toBe(100);
  });

  it('weights moves by volatility and averages with the harmonic mean', () => {
    // Window size 2: weights are |a - b| / 2 clamped to [0.5, 12] → 10, 12, 12.
    // White: weighted (41.0168 * 10 + 15.9090 * 12) / 22 = 27.3216,
    //        harmonic 2 / (1 / 41.0168 + 1 / 15.9090) = 22.9259 → 25.1238.
    const result = lichess([50, 30, 60, 20], 'w');
    expect(result.white).toBeCloseTo(25.12375216342925, 9);
    expect(result.black).toBeCloseTo(25.772047746869696, 9);
  });

  it('assigns the first move to Black when Black starts', () => {
    const result = lichess([50, 60, 40], 'b');
    expect(result.black).toBeCloseTo(64.57982845372067, 9);
    expect(result.white).toBeCloseTo(41.016818741417126, 9);
  });

  it('matches values computed independently for a 32-move game (window size 3)', () => {
    const winPercents = [
      50, 52, 48, 55, 45, 60, 30, 35, 33, 40, 38, 50, 52, 49, 70, 65, 66, 20, 25, 22, 24, 23, 10,
      12, 11, 15, 14, 13, 5, 6, 4, 3, 2,
    ];
    const result = lichess(winPercents, 'w');
    expect(result.white).toBeCloseTo(73.9125048772014, 9);
    expect(result.black).toBeCloseTo(88.1824399840699, 9);
  });

  it('matches the reference implementation for every window size', () => {
    const moveCounts = [1, 2, 3, 9, 19, 20, 29, 30, 45, 59, 79, 80, 121, 200];
    for (const [index, moves] of moveCounts.entries()) {
      const winPercents = randomWinPercents(moves + 1, index + 1);
      for (const firstMover of ['w', 'b'] as const) {
        const actual = lichess(winPercents, firstMover);
        const expected = referenceGameAccuracy(winPercents, firstMover);
        expect(actual.white).toBeCloseTo(expected.white, 9);
        expect(actual.black).toBeCloseTo(expected.black, 9);
        expect(actual.white).toBeGreaterThanOrEqual(0);
        expect(actual.white).toBeLessThanOrEqual(100);
      }
    }
  });
});
