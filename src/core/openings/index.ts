/**
 * Opening book built from the Lichess chess-openings dataset (CC0-1.0,
 * https://github.com/lichess-org/chess-openings). The generated data lives in
 * ./data/openings.json and is rebuilt with `npm run openings`.
 */

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

export function createOpeningBook(_data: OpeningBookData): OpeningBook {
  throw new Error('not implemented');
}

/** Lazily loads the bundled book (code-split JSON). Cached after the first call. */
export function loadOpeningBook(): Promise<OpeningBook> {
  throw new Error('not implemented');
}
