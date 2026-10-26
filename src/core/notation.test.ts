import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  fenAfterUci,
  legalMoveCount,
  moveNumberLabel,
  parseUci,
  positionKey,
  pvToSan,
  sideToMove,
  uciToSan,
} from './notation';

describe('notation', () => {
  it('reads the side to move', () => {
    expect(sideToMove(START_FEN)).toBe('w');
    expect(sideToMove('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe('b');
  });

  it('parses UCI moves', () => {
    expect(parseUci('e2e4')).toEqual({ from: 'e2', to: 'e4' });
    expect(parseUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
    expect(parseUci('e2e9')).toBeNull();
    expect(parseUci('(none)')).toBeNull();
  });

  it('converts UCI to SAN, including castling and promotion', () => {
    expect(uciToSan(START_FEN, 'g1f3')).toBe('Nf3');
    expect(uciToSan(START_FEN, 'e2e5')).toBeNull();
    expect(uciToSan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1')).toBe('O-O');
    expect(uciToSan('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8c8')).toBe('O-O-O');
    expect(uciToSan('8/4P1k1/8/8/8/8/6K1/8 w - - 0 1', 'e7e8q')).toBe('e8=Q');
  });

  it('converts a PV and stops at the first illegal move', () => {
    expect(pvToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3']);
    expect(pvToSan(START_FEN, ['e2e4', 'e2e4', 'g1f3'])).toEqual(['e4']);
  });

  it('counts legal moves and plays moves', () => {
    expect(legalMoveCount(START_FEN)).toBe(20);
    expect(
      fenAfterUci(START_FEN, 'e2e4')?.startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b'),
    ).toBe(true);
    expect(fenAfterUci(START_FEN, 'e2e5')).toBeNull();
  });

  it('builds position keys without en passant and counters', () => {
    expect(positionKey('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2')).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq',
    );
  });

  it('labels move numbers', () => {
    expect(moveNumberLabel(12, 'w')).toBe('12.');
    expect(moveNumberLabel(12, 'b')).toBe('12...');
  });
});
