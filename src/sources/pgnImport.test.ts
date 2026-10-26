import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgnError } from '@/core/pgn';
import { CHESSCOM_PGN } from './__fixtures__/chesscom';
import { LICHESS_PGN } from './__fixtures__/lichess';
import { loadPgnGame, pgnGameId, recordFromPgn, savePgnGame } from './pgnImport';
import { timeClassFromTimeControl } from './util';

const SCHOLARS_MATE = '[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#';

describe('recordFromPgn', () => {
  it('reads players, result, time control, opening and date from a Lichess PGN', () => {
    expect(recordFromPgn(LICHESS_PGN)).toEqual({
      id: pgnGameId(LICHESS_PGN),
      source: 'pgn',
      url: 'https://lichess.org/game/HqjDTU4A',
      white: { name: 'DrNykterstein', rating: 3177, title: 'GM' },
      black: { name: 'Night-King96', rating: 2848, title: 'GM' },
      result: '1-0',
      termination: undefined, // "Normal" says nothing
      timeClass: 'blitz',
      timeControl: '180+0',
      endTime: Date.parse('2026-10-14T18:04:06Z'),
      eco: 'A50',
      openingName: "Queen's Indian Accelerated",
      variant: 'standard',
      pgn: LICHESS_PGN,
    });
  });

  it('uses the end time, link and ECOUrl opening of a Chess.com PGN', () => {
    const record = recordFromPgn(CHESSCOM_PGN);
    expect(record.endTime).toBe(Date.parse('2026-10-02T22:09:59Z'));
    expect(record.url).toBe('https://www.chess.com/game/live/184727190848');
    expect(record.termination).toBe('Hikaru won by resignation');
    expect(record.openingName).toBe(
      "King's Indian Defense Fianchetto Karlsbad Panno Uhlmann Szabo System",
    );
    expect(record.timeClass).toBe('blitz');
  });

  it('gives the same id regardless of line endings and padding', () => {
    const crlf = `\r\n  ${LICHESS_PGN.replace(/\n/g, '\r\n')}\r\n\r\n`;
    expect(recordFromPgn(crlf).id).toBe(recordFromPgn(LICHESS_PGN).id);
    expect(recordFromPgn(crlf).pgn).toBe(LICHESS_PGN);
    expect(recordFromPgn(LICHESS_PGN).id).toMatch(/^pgn\/[0-9a-z]+$/);
    expect(recordFromPgn(SCHOLARS_MATE).id).not.toBe(recordFromPgn(LICHESS_PGN).id);
  });

  it('fills in defaults for missing headers', () => {
    const record = recordFromPgn('1. d4 d5 2. c4 *');
    expect(record).toMatchObject({
      white: { name: 'White' },
      black: { name: 'Black' },
      result: '*',
      timeClass: 'unknown',
      variant: 'standard',
    });
    expect(record.endTime).toBeUndefined();
    expect(recordFromPgn('[White "?"]\n[Date "2026.??.??"]\n\n1. e4 *').white.name).toBe('White');
  });

  it('infers the result and ending from a checkmate on the board', () => {
    const record = recordFromPgn(SCHOLARS_MATE);
    expect(record.result).toBe('1-0');
    expect(record.termination).toBe('Alice won by checkmate');
  });

  it('keeps a non-standard Variant header', () => {
    expect(recordFromPgn('[Variant "From Position"]\n\n1. e4 *').variant).toBe('standard');
    expect(recordFromPgn('[Variant "Three-check"]\n\n1. e4 *').variant).toBe('threecheck');
  });

  it('rejects text that is not a game', () => {
    expect(() => recordFromPgn('')).toThrow(PgnError);
    expect(() => recordFromPgn('   \n ')).toThrow(PgnError);
    expect(() => recordFromPgn('1. e4 e5 2. Ke3 Qh4 3. Zz9')).toThrow(PgnError);
    expect(() => recordFromPgn('[White "Alice"]\n\n*')).toThrow(PgnError);
  });
});

describe('timeClassFromTimeControl', () => {
  it.each([
    ['15+0', 'ultrabullet'],
    ['60', 'bullet'],
    ['120+1', 'bullet'],
    ['180+2', 'blitz'],
    ['300+5', 'rapid'],
    ['600', 'rapid'],
    ['900+10', 'rapid'],
    ['1800', 'classical'],
    ['40/7200:3600', 'classical'],
    ['1/86400', 'daily'],
    ['-', 'unknown'],
    [undefined, 'unknown'],
  ])('%s → %s', (timeControl, expected) => {
    expect(timeClassFromTimeControl(timeControl)).toBe(expected);
  });
});

describe('savePgnGame / loadPgnGame', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores a game so its id resolves after a reload', async () => {
    const record = recordFromPgn(SCHOLARS_MATE);
    await savePgnGame(record);
    await expect(loadPgnGame(record.id)).resolves.toEqual(record);

    vi.resetModules();
    const reloaded = await import('./pgnImport');
    await expect(reloaded.loadPgnGame(record.id)).resolves.toEqual(record);
  });

  it('returns null for unknown ids', async () => {
    await expect(loadPgnGame('pgn/doesnotexist')).resolves.toBeNull();
  });

  it('keeps working when IndexedDB is unavailable', async () => {
    vi.resetModules();
    const fresh = await import('./pgnImport');
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('Storage is disabled', 'SecurityError');
    });
    const record = fresh.recordFromPgn('1. e4 e5 *');
    await expect(fresh.savePgnGame(record)).resolves.toBeUndefined();
    await expect(fresh.loadPgnGame(record.id)).resolves.toEqual(record);
    await expect(fresh.loadPgnGame('pgn/other')).resolves.toBeNull();
  });
});
