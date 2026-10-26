import { Chess } from 'chess.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '../notation';
import data from './data/openings.json';
import { createOpeningBook, loadOpeningBook } from './index';
import type { OpeningBookData } from './index';

const bookData = data as unknown as OpeningBookData; // JSON infers string[] for the tuples
const book = createOpeningBook(bookData);

/** FEN after a space-separated list of SAN moves from the start position. */
function fenAfter(moves: string): string {
  const chess = new Chess();
  for (const san of moves.split(' ')) chess.move(san);
  return chess.fen();
}

const NAJDORF = 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6';

describe('opening book data', () => {
  it('records its source and license', () => {
    expect(bookData.source).toBe('https://github.com/lichess-org/chess-openings');
    expect(bookData.license).toBe('CC0-1.0');
    expect(bookData.names.length).toBeGreaterThan(3000);
  });

  it('only points at existing names', () => {
    for (const index of Object.values(bookData.positions)) {
      expect(index === -1 || bookData.names[index] !== undefined).toBe(true);
    }
  });

  it('does not contain the start position', () => {
    expect(book.has(START_FEN)).toBe(false);
  });
});

describe('createOpeningBook with the bundled data', () => {
  it("names 1.e4 the King's Pawn Game", () => {
    expect(book.lookup(fenAfter('e4'))).toEqual({ eco: 'B00', name: "King's Pawn Game" });
  });

  it('names 1.e4 c5 the Sicilian Defense', () => {
    expect(book.lookup(fenAfter('e4 c5'))).toEqual({ eco: 'B20', name: 'Sicilian Defense' });
  });

  it('finds the Najdorf', () => {
    expect(book.lookup(fenAfter(NAJDORF))?.name).toContain('Najdorf');
  });

  it('finds the Ruy Lopez after 3.Bb5', () => {
    expect(book.lookup(fenAfter('e4 e5 Nf3 Nc6 Bb5'))).toEqual({ eco: 'C60', name: 'Ruy Lopez' });
  });

  it('matches transpositions to the same entry', () => {
    const viaD4 = fenAfter('d4 Nf6 c4 e6');
    const viaC4 = fenAfter('c4 e6 d4 Nf6');
    expect(book.has(viaD4)).toBe(true);
    expect(book.lookup(viaC4)).toEqual(book.lookup(viaD4));
  });

  it('gives a position in the middle of a line the name of the deepest named position', () => {
    // 1.d4 Nf6 2.c4 e6 ends no dataset line; 2.c4 is the deepest named position before it.
    expect(book.lookup(fenAfter('d4 Nf6 c4 e6'))).toEqual(book.lookup(fenAfter('d4 Nf6 c4')));
  });

  it('breaks ties between equally long lines alphabetically', () => {
    // Both lines end here after five plies; "King's Gambit..." sorts before "Van Geet...".
    const kingsGambit = fenAfter('e4 e5 f4 exf4 Nc3');
    expect(book.lookup(kingsGambit)).toEqual({
      eco: 'C33',
      name: "King's Gambit Accepted: Mason-Keres Gambit",
    });
    expect(book.lookup(fenAfter('Nc3 e5 f4 exf4 e4'))).toEqual(book.lookup(kingsGambit));
  });

  it('ignores move counters and the en passant square', () => {
    const withEnPassant = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const laterCounters = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 12 40';
    expect(book.lookup(withEnPassant)?.eco).toBe('B00');
    expect(book.lookup(laterCounters)?.eco).toBe('B00');
  });

  it('has no entry for positions off the book', () => {
    const middlegame = 'r4rk1/1pp2ppp/p1n1bq2/4p3/4P3/1BN2Q1P/PPP2PP1/R4RK1 w - - 0 14';
    expect(book.has(middlegame)).toBe(false);
    expect(book.lookup(middlegame)).toBeNull();

    // 2.Ke2 (the Bongcloud) is in the dataset, 2...Ke7 and 3.Kd3 are not.
    expect(book.has(fenAfter('e4 e5 Ke2'))).toBe(true);
    expect(book.has(fenAfter('e4 e5 Ke2 Ke7'))).toBe(false);
    expect(book.has(fenAfter('e4 e5 Ke2 Ke7 Kd3'))).toBe(false);
    expect(book.lookup(fenAfter('e4 e5 Ke2 Ke7 Kd3'))).toBeNull();
  });
});

describe('createOpeningBook with hand-made data', () => {
  const tiny = createOpeningBook({
    source: 'test',
    license: 'CC0-1.0',
    names: [['B00', "King's Pawn Game"]],
    positions: {
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq': 0,
      'rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq': -1,
      'rnbqkbnr/pppppppp/8/8/8/7P/PPPPPPP1/RNBQKBNR b KQkq': 7,
    },
  });

  it('treats -1 as "in book but not named yet"', () => {
    expect(tiny.has(fenAfter('a3'))).toBe(true);
    expect(tiny.lookup(fenAfter('a3'))).toBeNull();
  });

  it('returns null for an out-of-range name index', () => {
    expect(tiny.lookup(fenAfter('h3'))).toBeNull();
  });

  it('does not resolve keys through the object prototype', () => {
    expect(tiny.has('constructor')).toBe(false);
    expect(tiny.lookup('toString')).toBeNull();
  });
});

describe('loadOpeningBook', () => {
  afterEach(() => {
    vi.doUnmock('./data/openings.json');
    vi.resetModules();
  });

  it('loads the bundled book once and caches it', async () => {
    const first = loadOpeningBook();
    expect(loadOpeningBook()).toBe(first);
    const loaded = await first;
    expect(loaded.lookup(fenAfter('e4'))?.name).toBe("King's Pawn Game");
  });

  it('retries after a failed load', async () => {
    vi.resetModules();
    let fail = true;
    vi.doMock('./data/openings.json', () => {
      if (fail) throw new Error('chunk failed to load');
      return { default: bookData };
    });
    const { loadOpeningBook: load } = await import('./index');

    await expect(load()).rejects.toThrow(); // vitest wraps the factory error
    fail = false;
    const loaded = await load();
    expect(loaded.has(fenAfter(NAJDORF))).toBe(true);
  });
});
