import { parsePgn } from '@/core/pgn';
import type { OpeningBook, OpeningInfo } from '@/core/openings';
import type { GameRecord, ParsedMove } from '@/core/types';

/**
 * Opening names for the openings table, computed with the project's opening book so the
 * names match the ones reviews show (the sources' own names differ between sites).
 */

/** Only the first this-many plies decide the opening name. */
export const OPENING_PLIES = 20;

/**
 * The deepest named book position within the first `maxPlies` plies, the way reviews name
 * openings: the walk stops at the first position that is not in the book (or a checkmate),
 * and the name is the last one seen on the way.
 */
export function bookOpening(
  moves: readonly ParsedMove[],
  book: OpeningBook,
  maxPlies = OPENING_PLIES,
): OpeningInfo | null {
  let opening: OpeningInfo | null = null;
  for (const move of moves.slice(0, maxPlies)) {
    if (move.isCheckmate || !book.has(move.fenAfter)) break;
    opening = book.lookup(move.fenAfter) ?? opening;
  }
  return opening;
}

/**
 * Cuts a PGN after its first `plies` plies, so parsing a long game for its opening costs a
 * few moves instead of a hundred. The cut is made at the main-line move number that
 * follows the last wanted ply (outside comments and variations), so the shortened PGN is
 * still valid. Games set up from a FEN are returned whole: their move numbers do not
 * start at 1.
 */
export function truncatePgn(pgn: string, plies = OPENING_PLIES): string {
  if (/\[\s*FEN\s/.test(pgn)) return pgn;
  const target = Math.floor(plies / 2) + 1;
  // Plies are counted in pairs; an odd count keeps White's extra move.
  const keepWhiteMove = plies % 2 === 1;
  const headerEnd = movetextStart(pgn);
  let depth = 0;
  for (let i = headerEnd; i < pgn.length; i++) {
    const char = pgn[i]!;
    if (char === '{') {
      const close = pgn.indexOf('}', i + 1);
      if (close === -1) return pgn;
      i = close;
    } else if (char === ';') {
      const end = pgn.indexOf('\n', i + 1);
      if (end === -1) return pgn;
      i = end;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && /\d/.test(char) && (i === 0 || /\s|\)|\}/.test(pgn[i - 1]!))) {
      const match = /^(\d+)(\.+)/.exec(pgn.slice(i, i + 8));
      if (!match) continue;
      const number = Number(match[1]);
      const blackMove = match[2]!.length > 1;
      if (number < target || blackMove) {
        i += match[0].length - 1;
        continue;
      }
      if (keepWhiteMove) {
        // Keep "N. <white move>" and cut at the next token boundary after it.
        const rest = /^\d+\.+\s*\S+/.exec(pgn.slice(i));
        return rest ? pgn.slice(0, i + rest[0].length) : pgn;
      }
      return pgn.slice(0, i);
    }
  }
  return pgn;
}

/** Index just after the tag pairs (the movetext starts here). */
function movetextStart(pgn: string): number {
  const tags = /^(?:\s*\[[^\]\n]*\]\s*)*/.exec(pgn);
  return tags ? tags[0].length : 0;
}

/**
 * The book opening of a game from its PGN, or null when the PGN cannot be parsed or no
 * book position is reached. Parses only the first plies when it safely can.
 */
export function openingFromPgn(pgn: string, book: OpeningBook): OpeningInfo | null {
  const short = truncatePgn(pgn);
  for (const text of short === pgn ? [pgn] : [short, pgn]) {
    try {
      return bookOpening(parsePgn(text).moves, book);
    } catch {
      // A cut in the wrong place (unusual PGN layout): retry with the whole game.
    }
  }
  return null;
}

/** Book opening name per game id (null: no book opening). Records never change. */
const cache = new Map<string, string | null>();

/** The cached book name of a game: a string, null (none), or undefined (not computed yet). */
export function cachedOpeningName(gameId: string): string | null | undefined {
  return cache.get(gameId);
}

export interface NameProgress {
  done: number;
  total: number;
}

/** Work at most this long before yielding to the browser, so the page stays responsive. */
const SLICE_MS = 12;

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Computes (and caches) the book opening name of every record, a few at a time.
 * Resolves with a map from game id to name (null when the book has none).
 * Rejects with an AbortError when the signal aborts.
 */
export async function computeOpeningNames(
  records: readonly GameRecord[],
  book: OpeningBook,
  options: { signal?: AbortSignal; onProgress?: (progress: NameProgress) => void } = {},
): Promise<Map<string, string | null>> {
  const { signal, onProgress } = options;
  const result = new Map<string, string | null>();
  let sliceStart = Date.now();
  for (const [index, record] of records.entries()) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let name = cache.get(record.id);
    if (name === undefined) {
      name =
        record.variant === 'standard' ? (openingFromPgn(record.pgn, book)?.name ?? null) : null;
      cache.set(record.id, name);
    }
    result.set(record.id, name);
    if (Date.now() - sliceStart >= SLICE_MS) {
      onProgress?.({ done: index + 1, total: records.length });
      await yieldToBrowser();
      sliceStart = Date.now();
    }
  }
  onProgress?.({ done: records.length, total: records.length });
  return result;
}

/** Tests only. */
export function clearOpeningNameCache(): void {
  cache.clear();
}
