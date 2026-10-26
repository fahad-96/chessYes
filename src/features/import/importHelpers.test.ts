import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  NO_GAMES_MESSAGE,
  OPERA_GAME_PGN,
  formatPgnDate,
  notPgnMessage,
  parseGameLink,
  summarizePgnHeaders,
} from './importHelpers';

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

describe('parseGameLink', () => {
  it('recognises Lichess game links in their usual forms', () => {
    const game = { site: 'lichess', gameId: 'HqjDTU4A' };
    expect(parseGameLink('https://lichess.org/HqjDTU4A')).toEqual(game);
    expect(parseGameLink(' lichess.org/HqjDTU4Aw1x2/black#34 ')).toEqual(game);
    expect(parseGameLink('https://www.lichess.org/HqjDTU4A/white')).toEqual(game);
  });

  it('recognises Chess.com game links', () => {
    expect(parseGameLink('https://www.chess.com/game/live/123456789')).toEqual({
      site: 'chesscom',
    });
    expect(parseGameLink('chess.com/game/daily/987654')).toEqual({ site: 'chesscom' });
    expect(parseGameLink('https://www.chess.com/live/game/123456789')).toEqual({
      site: 'chesscom',
    });
  });

  it('ignores other pages and plain text', () => {
    expect(parseGameLink('https://lichess.org/training')).toBeNull();
    expect(parseGameLink('https://lichess.org/@/thibault')).toBeNull();
    expect(parseGameLink('https://www.chess.com/member/hikaru')).toBeNull();
    expect(parseGameLink('1. e4 e5 https://lichess.org/HqjDTU4A')).toBeNull();
  });
});

describe('notPgnMessage', () => {
  it('explains a FEN, a link and plain text instead of an illegal first move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(notPgnMessage(fen, `Illegal move 1. ${fen.split(' ')[0]}`)).toMatch(/FEN/);
    expect(notPgnMessage('https://example.com/game/1', 'Illegal move 1. https')).toMatch(
      /link, not a PGN/,
    );
    expect(notPgnMessage('hello there', 'Illegal move 1. hello')).toBe(NO_GAMES_MESSAGE);
  });

  it("keeps the parser's message for text that looks like a PGN", () => {
    expect(notPgnMessage('1. e4 e5 2. Nf9', 'Illegal move 2. Nf9')).toBeNull();
    expect(notPgnMessage('[White "a"]\n\nhello', 'Illegal move 1. hello')).toBeNull();
    expect(notPgnMessage('e4 e5 Nf9', 'Illegal move 2. Nf9')).toBeNull();
  });
});
