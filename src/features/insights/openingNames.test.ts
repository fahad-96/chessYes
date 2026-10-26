import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadOpeningBook, type OpeningBook } from '@/core/openings';
import { parsePgn } from '@/core/pgn';
import type { GameRecord } from '@/core/types';
import {
  bookOpening,
  cachedOpeningName,
  clearOpeningNameCache,
  computeOpeningNames,
  openingFromPgn,
  truncatePgn,
} from './openingNames';

const fixtures = Object.entries(
  import.meta.glob<string>('../../core/__fixtures__/games/*.pgn', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
).map(([path, pgn]) => ({ file: path.replace(/^.*\//, ''), pgn }));
const fixture = (name: string) => fixtures.find((f) => f.file.startsWith(name))!.pgn;

/** A Chess.com-style PGN with a clock comment after every move. */
function withClocks(sans: string[]): string {
  const body = sans
    .map((san, i) => {
      const number = Math.floor(i / 2) + 1;
      const prefix = i % 2 === 0 ? `${number}. ` : `${number}... `;
      return `${prefix}${san} {[%clk 0:02:${String(59 - (i % 50)).padStart(2, '0')}.1]}`;
    })
    .join(' ');
  return `[Event "Live Chess"]\n[White "a"]\n[Black "b"]\n[Result "*"]\n\n${body} *`;
}

const SCOTCH =
  'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6 b3 g6 f4 f6 Ba3 Qf7'.split(' ');

let book: OpeningBook;
beforeAll(async () => {
  book = await loadOpeningBook();
});
beforeEach(() => clearOpeningNameCache());

describe('truncatePgn', () => {
  it('cuts a clocked PGN after 20 plies, keeping it parseable', () => {
    const pgn = withClocks(SCOTCH);
    const short = truncatePgn(pgn, 20);
    expect(short.length).toBeLessThan(pgn.length);
    const moves = parsePgn(short).moves;
    expect(moves).toHaveLength(20);
    expect(moves.map((m) => m.san)).toEqual(
      parsePgn(pgn)
        .moves.slice(0, 20)
        .map((m) => m.san),
    );
    expect(moves[19]!.clock).toBeDefined();
  });

  it('keeps White’s extra move for an odd ply count', () => {
    const short = truncatePgn(withClocks(SCOTCH), 7);
    expect(parsePgn(short).moves.map((m) => m.san)).toEqual(SCOTCH.slice(0, 7));
  });

  it('handles line-wrapped movetext without clocks', () => {
    const pgn = fixture('famous-classical-kasparov-topalov');
    expect(parsePgn(truncatePgn(pgn, 20)).moves).toHaveLength(20);
  });

  it('ignores move numbers inside comments and variations', () => {
    const pgn =
      '[White "a"]\n[Black "b"]\n\n1. e4 {see 11. Nf3 in game 2} 1... e5 (1... c5 2. Nf3 (2. c3) 11. a3) 2. Nf3 *';
    expect(truncatePgn(pgn, 20)).toBe(pgn);
    expect(parsePgn(truncatePgn(pgn, 2)).moves.map((m) => m.san)).toEqual(['e4', 'e5']);
  });

  it('returns short games and games set up from a FEN unchanged', () => {
    const short = withClocks(SCOTCH.slice(0, 6));
    expect(truncatePgn(short, 20)).toBe(short);
    const fen = `[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n${withClocks(SCOTCH)}`;
    expect(truncatePgn(fen, 4)).toBe(fen);
  });
});

describe('book openings', () => {
  it('names the deepest book position on the way (Scotch Game, Mieses Variation)', () => {
    const opening = bookOpening(parsePgn(withClocks(SCOTCH)).moves, book);
    expect(opening?.name).toMatch(/^Scotch Game/);
  });

  it('stops at the first position outside the book', () => {
    const moves = parsePgn(withClocks(['e4', 'e5', 'Ke2', 'Ke7', 'Kd3'])).moves;
    // 2.Ke2 is the "Bongcloud Attack"; the made-up continuation is not in the book.
    expect(bookOpening(moves, book)?.name).toBe(bookOpening(moves.slice(0, 3), book)?.name);
  });

  it('only looks at the first plies', () => {
    const moves = parsePgn(withClocks(SCOTCH)).moves;
    expect(bookOpening(moves, book, 1)?.name).toBe(bookOpening(moves.slice(0, 1), book)?.name);
  });

  it('gives the same name from the shortened PGN as from the whole game', () => {
    for (const { file, pgn } of fixtures) {
      const full = bookOpening(parsePgn(pgn).moves, book);
      expect(openingFromPgn(pgn, book), file).toEqual(full);
    }
  });

  it('returns null for an unreadable PGN', () => {
    expect(openingFromPgn('1. e4 e5 2. Qxf7 Kxf7', book)).toBeNull();
  });
});

describe('computeOpeningNames', () => {
  const record = (id: string, pgn: string, variant = 'standard'): GameRecord => ({
    id,
    source: 'pgn',
    white: { name: 'a' },
    black: { name: 'b' },
    result: '*',
    timeClass: 'blitz',
    variant,
    pgn,
  });

  it('names every game, caches the result and reports progress', async () => {
    const records = [
      record('pgn/1', withClocks(SCOTCH)),
      record('pgn/2', fixture('famous-classical-kasparov-topalov')),
      record('pgn/3', withClocks(SCOTCH), 'chess960'),
    ];
    const progress: number[] = [];
    const names = await computeOpeningNames(records, book, {
      onProgress: (p) => progress.push(p.done),
    });
    expect(names.get('pgn/1')).toMatch(/^Scotch Game/);
    expect(names.get('pgn/2')).toMatch(/^Pirc Defense/);
    expect(names.get('pgn/3')).toBeNull();
    expect(cachedOpeningName('pgn/1')).toBe(names.get('pgn/1'));
    expect(progress.at(-1)).toBe(3);
  });

  it('rejects when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      computeOpeningNames([record('pgn/1', withClocks(SCOTCH))], book, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
