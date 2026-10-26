import { describe, expect, it } from 'vitest';
import { START_FEN } from '@/core/notation';
import { pieceHint } from './hints';

describe('pieceHint', () => {
  it('names a unique piece without its square', () => {
    expect(pieceHint(START_FEN, 'd1h5')).toEqual({
      piece: 'q',
      square: 'd1',
      ambiguous: false,
      text: 'Move your queen.',
    });
  });

  it('names the square when there are several pieces of the kind', () => {
    expect(pieceHint(START_FEN, 'g1f3')?.text).toBe('Move your knight on g1.');
    expect(pieceHint(START_FEN, 'e2e4')?.text).toBe('Move your pawn on e2.');
  });

  it('treats castling as a king move', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1';
    expect(pieceHint(fen, 'e8g8')?.text).toBe('Move your king.');
  });

  it('returns null for bad input', () => {
    expect(pieceHint(START_FEN, 'e4e5')).toBeNull();
    expect(pieceHint(START_FEN, 'nonsense')).toBeNull();
    expect(pieceHint('bad fen', 'e2e4')).toBeNull();
  });
});
