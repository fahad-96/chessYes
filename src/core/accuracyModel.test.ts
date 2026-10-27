/**
 * Keeps the calibrated accuracy model calibrated: on rated games from the fitting dataset
 * (src/core/__fixtures__/rated.ts), with Kibitz's own analyses, the accuracies must stay
 * within the error the model was reported with on held-out games. A change to the win %
 * curve, the move curve or the averaging that moves the numbers away from the published
 * figures fails here.
 */
import { describe, expect, it } from 'vitest';
import { RATED_GAMES, USER_GAME_ID } from './__fixtures__/rated';
import {
  ACCURACY_MODELS,
  CALIBRATED,
  DEFAULT_ACCURACY_MODEL,
  type AccuracyModel,
} from './accuracyModel';
import { buildGameReview } from './review';

/** The held-out error reported for the fit (450 player-games, 5-fold cross-validation). */
const HELD_OUT = {
  /** Mean absolute error, in accuracy points. */
  mae: 2.95,
  /** 95 % of held-out players were within this many points. */
  p95: 8.2,
};

const ENGINE = { name: 'Stockfish 19 lite', depth: 16, multiPv: 2 };

interface Comparison {
  id: string;
  side: 'white' | 'black';
  published: number;
  kibitz: number;
  error: number;
}

function compare(model: AccuracyModel): Comparison[] {
  return RATED_GAMES.flatMap(({ id, game, analyses, published }) => {
    const review = buildGameReview(game, analyses, {
      book: null,
      engine: ENGINE,
      accuracyModel: model,
    });
    expect(review.moves).toHaveLength(game.moves.length);
    return (['white', 'black'] as const).map((side) => ({
      id,
      side,
      published: published[side],
      kibitz: review[side].accuracy,
      error: review[side].accuracy - published[side],
    }));
  });
}

const meanAbsoluteError = (rows: Comparison[]) =>
  rows.reduce((sum, row) => sum + Math.abs(row.error), 0) / rows.length;

describe('the calibrated accuracy model', () => {
  it('is the default, and the Lichess formulas stay available', () => {
    expect(DEFAULT_ACCURACY_MODEL).toBe('calibrated');
    expect(ACCURACY_MODELS).toEqual(['calibrated', 'lichess']);
  });

  it('keeps the fitted constants', () => {
    // Changing these changes every accuracy: refit, then update this test and the docs.
    expect(CALIBRATED).toEqual({
      winSlope: 0.0019874203842195413,
      moveScale: 78.9620092371643,
      moveDecay: 0.13101142766742344,
    });
  });

  it('has rated games from every rating band to check against', () => {
    expect(RATED_GAMES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(RATED_GAMES.map((game) => game.ratingBand)).size).toBe(RATED_GAMES.length);
    expect(RATED_GAMES[0]?.id).toBe(USER_GAME_ID);
  });

  it('stays within the held-out error of the published accuracies', () => {
    const rows = compare('calibrated');
    expect(meanAbsoluteError(rows)).toBeLessThanOrEqual(HELD_OUT.mae);
    for (const row of rows) expect(Math.abs(row.error)).toBeLessThanOrEqual(HELD_OUT.p95);
  });

  it('is closer to the published accuracies than the Lichess formulas', () => {
    const calibrated = meanAbsoluteError(compare('calibrated'));
    const lichess = meanAbsoluteError(compare('lichess'));
    expect(lichess).toBeGreaterThan(calibrated + 1);
  });

  it('rates the game that started the calibration close to its published figures', () => {
    // Published 73.2 / 56.6; the Lichess formulas give 81.8 / 70.3 on this analysis.
    const rows = compare('calibrated').filter((row) => row.id === USER_GAME_ID);
    const [white, black] = rows;
    expect(white?.kibitz).toBeCloseTo(68.9, 1);
    expect(black?.kibitz).toBeCloseTo(59.2, 1);
    const lichess = compare('lichess').filter((row) => row.id === USER_GAME_ID);
    expect(lichess[0]?.kibitz).toBeCloseTo(81.8, 1);
    expect(lichess[1]?.kibitz).toBeCloseTo(70.3, 1);
  });
});
