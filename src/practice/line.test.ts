import { describe, expect, it } from 'vitest';
import { START_FEN } from '@/core/notation';
import { formatLineFrom, lineMoveLabels, moveLabelAt, playLine } from './line';

const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('playLine', () => {
  it('returns every position along the line', () => {
    const frames = playLine(START_FEN, ['e2e4', 'e7e5', 'd1h5']);
    expect(frames.map((f) => f.san)).toEqual(['e4', 'e5', 'Qh5']);
    expect(frames[0]).toMatchObject({ uci: 'e2e4', lastMove: ['e2', 'e4'], check: false });
    expect(frames[2]?.fen).toBe('rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2');
  });

  it('reports checks and stops at the first illegal move', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    const frames = playLine(fen, ['a1a8', 'e8e7', 'a8a1', 'zz']);
    expect(frames.map((f) => f.check)).toEqual([true, false, false]);
    expect(playLine(START_FEN, ['e2e5', 'e2e4'])).toEqual([]);
    expect(playLine('bad fen', ['e2e4'])).toEqual([]);
  });
});

describe('move numbers', () => {
  it('numbers a line from the position it starts in', () => {
    expect(formatLineFrom(START_FEN, ['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
    expect(formatLineFrom(BLACK_TO_MOVE, ['e5', 'Nf3', 'Nc6'])).toBe('1... e5 2. Nf3 Nc6');
    expect(formatLineFrom(START_FEN, ['e4', 'e5', 'Nf3'], 2)).toBe('1. e4 e5');
    expect(lineMoveLabels(BLACK_TO_MOVE, 3)).toEqual(['1...', '2.', '']);
    expect(moveLabelAt('8/8/8/8/8/8/8/K1k5 w - - 3 42')).toBe('42.');
    expect(moveLabelAt(BLACK_TO_MOVE)).toBe('1...');
  });
});
