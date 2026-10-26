import { describe, expect, it } from 'vitest';
import { parsePgn } from '@/core/pgn';
import {
  applyBoardMove,
  currentVariationMove,
  extendVariation,
  gameFenAt,
  lineMoves,
  lineVariation,
  numberedMoves,
  playInVariation,
  playUciMove,
  seekVariation,
  variationFen,
  type Variation,
} from './variation';

const game = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');

function explore(startPly: number, ucis: string[], index = ucis.length): Variation {
  const startFen = gameFenAt(game, startPly);
  return { kind: 'explore', startPly, startFen, moves: lineMoves(startFen, ucis), index };
}

describe('playUciMove', () => {
  it('plays legal moves with SAN, numbers and check', () => {
    const move = playUciMove(game.initialFen, 'e2e4');
    expect(move).toMatchObject({ san: 'e4', from: 'e2', to: 'e4', moveNumber: 1, color: 'w' });
    expect(move?.check).toBe(false);
    const check = playUciMove(gameFenAt(game, 4), 'f1b5');
    expect(check?.san).toBe('Bb5');
  });

  it('rejects illegal and malformed moves', () => {
    expect(playUciMove(game.initialFen, 'e2e5')).toBeNull();
    expect(playUciMove(game.initialFen, 'nonsense')).toBeNull();
    expect(playUciMove('not a fen', 'e2e4')).toBeNull();
  });

  it('handles promotion and castling', () => {
    expect(playUciMove('7k/P7/8/8/8/8/8/K7 w - - 0 1', 'a7a8Q')).toMatchObject({
      san: 'a8=Q+',
      uci: 'a7a8q',
      check: true,
    });
    expect(playUciMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1')?.san).toBe('O-O');
  });
});

describe('lineMoves', () => {
  it('stops at the first illegal move', () => {
    expect(lineMoves(game.initialFen, ['e2e4', 'e7e5', 'e4e5', 'g1f3']).map((m) => m.san)).toEqual([
      'e4',
      'e5',
    ]);
  });
});

describe('applyBoardMove', () => {
  it('steps forward when the move is the game move', () => {
    expect(applyBoardMove(game, 2, null, 'g1f3')).toEqual({ type: 'game', ply: 3 });
  });

  it('starts a variation from the shown position otherwise', () => {
    const result = applyBoardMove(game, 2, null, 'f1c4');
    expect(result.type).toBe('variation');
    if (result.type !== 'variation') return;
    expect(result.variation).toMatchObject({ kind: 'explore', startPly: 2, index: 1 });
    expect(result.variation.moves.map((m) => m.san)).toEqual(['Bc4']);
    expect(result.variation.startFen).toBe(gameFenAt(game, 2));
  });

  it('rejects illegal moves', () => {
    expect(applyBoardMove(game, 0, null, 'e2e5')).toEqual({ type: 'illegal' });
  });

  it('extends, steps along and truncates a variation', () => {
    const variation = explore(2, ['f1c4', 'g8f6', 'd2d3'], 1);
    const along = applyBoardMove(game, 2, variation, 'g8f6');
    expect(along.type === 'variation' && along.variation.index).toBe(2);
    expect(along.type === 'variation' && along.variation.moves).toHaveLength(3);

    const other = applyBoardMove(game, 2, variation, 'f8c5');
    expect(other.type).toBe('variation');
    if (other.type !== 'variation') return;
    expect(other.variation.moves.map((m) => m.san)).toEqual(['Bc4', 'Bc5']);
    expect(other.variation.index).toBe(2);
  });

  it('returns to the game from the start of a variation with the game move', () => {
    const variation = explore(2, ['f1c4'], 0);
    expect(applyBoardMove(game, 2, variation, 'g1f3')).toEqual({ type: 'game', ply: 3 });
  });

  it('uses the variation start, not the game ply, as the branch point', () => {
    // An engine line opened from move 3 starts at ply 2 while the game shows ply 3.
    const variation = explore(2, ['f1c4'], 0);
    expect(applyBoardMove(game, 3, variation, 'g1f3')).toEqual({ type: 'game', ply: 3 });
    const result = applyBoardMove(game, 3, variation, 'd2d4');
    expect(result.type === 'variation' && result.variation.startPly).toBe(2);
  });

  it('follows an engine line whose first move is the game move', () => {
    const line = lineVariation(game, 2, ['g1f3', 'b8c6'], 'Engine line');
    expect(line).not.toBeNull();
    const result = applyBoardMove(game, 2, line, 'g1f3');
    expect(result.type === 'variation' && result.variation).toMatchObject({
      kind: 'line',
      index: 1,
    });
  });
});

describe('variation navigation', () => {
  it('seeks within bounds and reports the position', () => {
    const variation = explore(0, ['d2d4', 'd7d5', 'c2c4']);
    expect(seekVariation(variation, 10).index).toBe(3);
    expect(seekVariation(variation, -1).index).toBe(0);
    expect(variationFen(seekVariation(variation, 0))).toBe(game.initialFen);
    expect(currentVariationMove(seekVariation(variation, 2))?.san).toBe('d5');
    expect(currentVariationMove(seekVariation(variation, 0))).toBeUndefined();
  });

  it('turns an engine line into the user’s variation on a different move', () => {
    const line = lineVariation(game, 0, ['d2d4', 'd7d5', 'c2c4'], 'Best line')!;
    const next = playInVariation(seekVariation(line, 1), 'g8f6');
    expect(next).toMatchObject({ kind: 'explore', index: 2 });
    expect(next?.title).toBeUndefined();
    expect(next?.moves.map((m) => m.san)).toEqual(['d4', 'Nf6']);
  });

  it('plays an engine line from the shown position and steps one move', () => {
    const variation = explore(0, ['d2d4', 'd7d5', 'c2c4'], 1);
    const extended = extendVariation(variation, ['g8f6', 'c2c4', 'e7e6']);
    expect(extended.moves.map((m) => m.san)).toEqual(['d4', 'Nf6', 'c4', 'e6']);
    expect(extended.index).toBe(2);
    expect(extendVariation(variation, ['e2e4'])).toBe(variation);
  });

  it('returns null for an empty or illegal line', () => {
    expect(lineVariation(game, 0, [], 'Best line')).toBeNull();
    expect(lineVariation(game, 0, ['e2e5'], 'Best line')).toBeNull();
  });
});

describe('numberedMoves', () => {
  it('numbers White moves and a first Black move', () => {
    const fromBlack = lineMoves(gameFenAt(game, 1), ['e7e5', 'g1f3', 'b8c6']);
    expect(numberedMoves(fromBlack)).toEqual([
      { index: 1, number: '1...', san: 'e5' },
      { index: 2, number: '2.', san: 'Nf3' },
      { index: 3, number: null, san: 'Nc6' },
    ]);
  });
});
