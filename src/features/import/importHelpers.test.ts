import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { OPERA_GAME_PGN, formatPgnDate, summarizePgnHeaders } from './importHelpers';

describe('formatPgnDate', () => {
  it('formats full and partial dates', () => {
    expect(formatPgnDate('2024.03.15')).toBe('15 Mar 2024');
    expect(formatPgnDate('2024.03.??')).toBe('Mar 2024');
    expect(formatPgnDate('1858.??.??')).toBe('1858');
    expect(formatPgnDate('2024.12.01')).toBe('1 Dec 2024');
  });

  it('returns an empty string for unknown or malformed dates', () => {
    expect(formatPgnDate(undefined)).toBe('');
    expect(formatPgnDate('????.??.??')).toBe('');
    expect(formatPgnDate('yesterday')).toBe('');
    expect(formatPgnDate('2024.13.01')).toBe('2024');
  });
});

describe('summarizePgnHeaders', () => {
  it('summarises the tags shown in the game picker', () => {
    expect(
      summarizePgnHeaders({
        Event: 'Paris Opera',
        White: 'Paul Morphy',
        Black: 'Duke Karl / Count Isouard',
        Result: '1-0',
        Date: '1858.??.??',
      }),
    ).toEqual({
      white: 'Paul Morphy',
      black: 'Duke Karl / Count Isouard',
      result: '1-0',
      date: '1858',
      event: 'Paris Opera',
    });
  });

  it('falls back for missing tags', () => {
    expect(summarizePgnHeaders({ White: '?', Result: '*', Event: '?' })).toEqual({
      white: 'White',
      black: 'Black',
      result: '',
      date: '',
      event: '',
    });
    expect(summarizePgnHeaders({ Result: '1/2-1/2', UTCDate: '2025.01.02' }).result).toBe('½-½');
    expect(summarizePgnHeaders({ UTCDate: '2025.01.02' }).date).toBe('2 Jan 2025');
  });
});

describe('OPERA_GAME_PGN', () => {
  it('is a legal game that ends in checkmate', () => {
    const chess = new Chess();
    chess.loadPgn(OPERA_GAME_PGN);
    expect(chess.history()).toHaveLength(33);
    expect(chess.isCheckmate()).toBe(true);
    expect(chess.getHeaders().White).toBe('Paul Morphy');
  });
});
