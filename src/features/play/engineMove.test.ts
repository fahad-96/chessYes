import { describe, expect, it } from 'vitest';
import type { EngineLine, Score } from '@/core/types';
import { chooseEngineMove } from './engineMove';
import {
  DEFAULT_LEVEL_ID,
  ENGINE_LEVELS,
  MAX_LEVEL_ID,
  engineLevel,
  engineName,
  isLevelId,
  type EngineLevel,
} from './levels';

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });
const line = (move: string, score: Score): EngineLine => ({ pv: [move], score, depth: 10 });

/** A random source that returns these numbers in turn (then repeats the last). */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

const LEGAL = ['e2e4', 'd2d4', 'g1f3', 'b1c3', 'a2a3'];

const level = (patch: Partial<EngineLevel>): EngineLevel => ({
  ...engineLevel(4),
  randomMoveChance: 0,
  ...patch,
});

describe('levels', () => {
  it('has eight levels, weakest first, with ids 1 to 8', () => {
    expect(ENGINE_LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < ENGINE_LEVELS.length; i++) {
      const weaker = ENGINE_LEVELS[i - 1]!;
      const stronger = ENGINE_LEVELS[i]!;
      expect(stronger.depth).toBeGreaterThan(weaker.depth);
      expect(stronger.temperature).toBeLessThanOrEqual(weaker.temperature);
      expect(stronger.maxLoss).toBeLessThanOrEqual(weaker.maxLoss);
      expect(stronger.randomMoveChance).toBeLessThanOrEqual(weaker.randomMoveChance);
      expect(stronger.mateVision).toBeGreaterThanOrEqual(weaker.mateVision);
    }
  });

  it('makes the strongest level play the engine move', () => {
    const top = engineLevel(MAX_LEVEL_ID);
    expect(top.temperature).toBe(0);
    expect(top.multiPv).toBe(1);
    expect(top.randomMoveChance).toBe(0);
  });

  it('clamps unknown level ids to a real level', () => {
    expect(engineLevel(0).id).toBe(1);
    expect(engineLevel(99).id).toBe(MAX_LEVEL_ID);
    expect(engineLevel(Number.NaN).id).toBe(DEFAULT_LEVEL_ID);
    expect(engineLevel(2.6).id).toBe(3);
  });

  it('recognises level ids', () => {
    expect(isLevelId(1)).toBe(true);
    expect(isLevelId(8)).toBe(true);
    expect(isLevelId(0)).toBe(false);
    expect(isLevelId(9)).toBe(false);
    expect(isLevelId(2.5)).toBe(false);
    expect(isLevelId('3')).toBe(false);
  });

  it('names the engine player after its level', () => {
    expect(engineName(5)).toBe('Stockfish level 5');
  });
});

describe('chooseEngineMove', () => {
  const lines = [line('e2e4', cp(40)), line('d2d4', cp(30)), line('g1f3', cp(-300))];

  it('plays the best line with no temperature', () => {
    const move = chooseEngineMove({ lines }, LEGAL, 'w', level({ temperature: 0 }), () => 0.99);
    expect(move).toBe('e2e4');
  });

  it('picks among close candidates by weight', () => {
    // e4 and d4 are worth about the same; a high roll lands on the second one. Nf3 gives
    // up about 16 win % points, more than maxLoss.
    const strong = level({ temperature: 5, maxLoss: 10 });
    expect(chooseEngineMove({ lines }, LEGAL, 'w', strong, () => 0)).toBe('e2e4');
    expect(chooseEngineMove({ lines }, LEGAL, 'w', strong, () => 0.99)).toBe('d2d4');
  });

  it('never picks a move that gives up more than maxLoss', () => {
    const strict = level({ temperature: 50, maxLoss: 5 });
    for (const roll of [0, 0.3, 0.6, 0.999]) {
      expect(chooseEngineMove({ lines }, LEGAL, 'w', strict, () => roll)).not.toBe('g1f3');
    }
  });

  it('can pick a blunder at a loose level', () => {
    const loose = level({ temperature: 1000, maxLoss: 100 });
    expect(chooseEngineMove({ lines }, LEGAL, 'w', loose, () => 0.999)).toBe('g1f3');
  });

  it('judges the lines from the side it plays', () => {
    // Scores are from White's side: for Black, -300 is the best line.
    const strict = level({ temperature: 0.01, maxLoss: 1 });
    const black = [line('e7e5', cp(40)), line('g8f6', cp(-300))];
    expect(chooseEngineMove({ lines: black }, ['e7e5', 'g8f6'], 'b', strict, () => 0.5)).toBe(
      'g8f6',
    );
  });

  it('always plays a mate it can see', () => {
    const mating = [line('d2d4', cp(900)), line('e2e4', mate(2))];
    const sees = level({ temperature: 1000, maxLoss: 100, mateVision: 2 });
    // Lines come best first from the engine; the mate is first here.
    const ordered = [mating[1]!, mating[0]!];
    expect(chooseEngineMove({ lines: ordered }, LEGAL, 'w', sees, () => 0.999)).toBe('e2e4');
  });

  it('can miss a mate that is too long for its level', () => {
    const ordered = [line('e2e4', mate(4)), line('d2d4', cp(900))];
    const blind = level({ temperature: 1000, maxLoss: 100, mateVision: 2 });
    expect(chooseEngineMove({ lines: ordered }, LEGAL, 'w', blind, () => 0.999)).toBe('d2d4');
  });

  it("does not treat the opponent's mate as its own", () => {
    const ordered = [line('e2e4', mate(-3)), line('d2d4', mate(-2))];
    const sees = level({ temperature: 0, mateVision: 99 });
    expect(chooseEngineMove({ lines: ordered }, LEGAL, 'w', sees, () => 0.5)).toBe('e2e4');
  });

  it('sometimes plays a random legal move at beginner levels', () => {
    const beginner = level({ randomMoveChance: 0.5, temperature: 0 });
    // First roll (0.1) triggers the random move, the second picks the third legal move.
    expect(chooseEngineMove({ lines }, LEGAL, 'w', beginner, sequence(0.1, 0.5))).toBe('g1f3');
    // A roll above the chance plays the engine's choice.
    expect(chooseEngineMove({ lines }, LEGAL, 'w', beginner, sequence(0.9))).toBe('e2e4');
  });

  it('ignores lines with an illegal first move', () => {
    const stale = [line('e7e5', cp(500)), line('d2d4', cp(20))];
    expect(chooseEngineMove({ lines: stale }, LEGAL, 'w', level({ temperature: 0 }))).toBe('d2d4');
  });

  it('plays a legal move when the engine gave no line', () => {
    expect(LEGAL).toContain(chooseEngineMove({ lines: [] }, LEGAL, 'w', level({}), () => 0.5));
  });

  it('throws when there is no legal move', () => {
    expect(() => chooseEngineMove({ lines: [] }, [], 'w', level({}))).toThrow();
  });
});
