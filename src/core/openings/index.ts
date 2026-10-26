/**
 * Opening book built from the Lichess chess-openings dataset (CC0-1.0,
 * https://github.com/lichess-org/chess-openings). The generated data lives in
 * ./data/openings.json and is rebuilt with `npm run openings`.
 */
import { positionKey } from '../notation';

export interface OpeningInfo {
  eco: string;
  name: string;
}

/** Shape of ./data/openings.json. */
export interface OpeningBookData {
  source: string;
  license: string;
  /** [eco, name] pairs. */
  names: [string, string][];
  /**
   * positionKey(fen) → index into `names`, or -1 when the position is on a book line
   * but no named opening has been reached yet.
   * Every position along every dataset line is present (not just the named end positions),
   * mapped to its own name when it is a named position, otherwise to the deepest named
   * position before it on that line.
   */
  positions: Record<string, number>;
}

export interface OpeningBook {
  /** True when the position is on any book line. */
  has(fen: string): boolean;
  /** Opening name for a book position (see OpeningBookData.positions), or null. */
  lookup(fen: string): OpeningInfo | null;
}

/**
 * Wraps book data in lookup helpers. Positions are matched by positionKey, so move
 * counters and the en passant square do not matter and transpositions are found.
 */
export function createOpeningBook(data: OpeningBookData): OpeningBook {
  const { names, positions } = data;
  // hasOwn keeps keys such as "constructor" from resolving through the prototype.
  const has = (fen: string) => Object.hasOwn(positions, positionKey(fen));
  return {
    has,
    lookup(fen) {
      if (!has(fen)) return null;
      const entry = names[positions[positionKey(fen)] ?? -1];
      return entry ? { eco: entry[0], name: entry[1] } : null;
    },
  };
}

let bookPromise: Promise<OpeningBook> | null = null;

/** Lazily loads the bundled book (code-split JSON). Cached after the first call. */
export function loadOpeningBook(): Promise<OpeningBook> {
  bookPromise ??= import('./data/openings.json')
    // The inferred JSON type widens the [eco, name] tuples to string[], hence the cast.
    .then((module) => createOpeningBook(module.default as unknown as OpeningBookData))
    .catch((error: unknown) => {
      // Forget the failure (e.g. a chunk that did not download) so the next call retries.
      bookPromise = null;
      throw error;
    });
  return bookPromise;
}
