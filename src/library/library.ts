import { clear, createStore, del, get, set, values, type UseStore } from 'idb-keyval';
import { CLASSIFICATIONS } from '@/core/types';
import { scoreToWinPercent, winPercentFor } from '@/core/winPercent';
import type {
  Classification,
  Color,
  GameRecord,
  GameReview,
  ParsedGame,
  PlayerReview,
} from '@/core/types';

/**
 * The library of reviewed games: a compact record of every finished review, kept in
 * IndexedDB (store "kibitz-library"). Insights and puzzles are computed from it, so
 * they work offline and never need to re-run the engine.
 */

/** Bump when LibraryEntry changes shape; older entries are then ignored. */
export const LIBRARY_VERSION = 1;

/** Who "you" are in a game, when known (the player whose game list it came from). */
export interface Perspective {
  platform: 'chesscom' | 'lichess';
  /** Lower-cased username. */
  username: string;
  color: Color;
}

/** Per-move data kept for insights and puzzles. */
export interface LibraryMove {
  ply: number;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  classification: Classification;
  winBefore: number;
  winAfter: number;
  winLoss: number;
  /** Mover's win % for the engine's second choice (puzzle uniqueness check). */
  winSecondBest?: number;
  best?: { uci: string; san: string; pvUci: string[]; pvSan: string[] };
  /** Mover's clock after the move, seconds. */
  clock?: number;
}

export interface LibraryEntry {
  v: typeof LIBRARY_VERSION;
  gameId: string;
  record: GameRecord;
  perspective?: Perspective;
  reviewedAt: number;
  engine: GameReview['engine'];
  white: PlayerReview;
  black: PlayerReview;
  opening?: { eco: string; name: string };
  moves: LibraryMove[];
}

let store: UseStore | undefined;
/** In-memory fallback for browsers without IndexedDB (private modes, locked-down webviews). */
const memory = new Map<string, LibraryEntry>();

function libraryStore(): UseStore {
  store ??= createStore('kibitz-library', 'entries');
  return store;
}

/** Builds a library entry from a complete review. */
export function toLibraryEntry(
  record: GameRecord,
  game: ParsedGame,
  review: GameReview,
  perspective?: Perspective,
  reviewedAt = Date.now(),
): LibraryEntry {
  const moves: LibraryMove[] = review.moves.map((move) => {
    const parsed = game.moves[move.ply - 1];
    const entry: LibraryMove = {
      ply: move.ply,
      color: move.color,
      san: move.san,
      uci: move.uci,
      fenBefore: parsed?.fenBefore ?? '',
      classification: move.classification,
      winBefore: round1(move.winBefore),
      winAfter: round1(move.winAfter),
      winLoss: round1(move.winLoss),
    };
    if (move.secondBest) {
      entry.winSecondBest = round1(
        winPercentFor(scoreToWinPercent(move.secondBest.score), move.color),
      );
    }
    if (move.best) {
      entry.best = {
        uci: move.best.uci,
        san: move.best.san,
        pvUci: move.best.pvUci.slice(0, 8),
        pvSan: move.best.pvSan.slice(0, 8),
      };
    }
    if (parsed?.clock !== undefined) entry.clock = parsed.clock;
    return entry;
  });

  const entry: LibraryEntry = {
    v: LIBRARY_VERSION,
    gameId: record.id,
    record,
    reviewedAt,
    engine: review.engine,
    white: review.white,
    black: review.black,
    moves,
  };
  if (perspective) entry.perspective = perspective;
  if (review.opening) entry.opening = { eco: review.opening.eco, name: review.opening.name };
  return entry;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Saves (or replaces) an entry. Never throws. */
export async function saveToLibrary(entry: LibraryEntry): Promise<void> {
  memory.set(entry.gameId, entry);
  try {
    await set(entry.gameId, entry, libraryStore());
  } catch {
    // Storage unavailable: the entry lives in memory for this session.
  }
}

export async function getLibraryEntry(gameId: string): Promise<LibraryEntry | null> {
  try {
    const entry: unknown = await get(gameId, libraryStore());
    if (isLibraryEntry(entry)) return entry;
  } catch {
    // fall through to memory
  }
  return memory.get(gameId) ?? null;
}

/** Every valid entry, newest game first (by endTime, then review time). */
export async function getLibraryEntries(): Promise<LibraryEntry[]> {
  const byId = new Map(memory);
  try {
    for (const entry of (await values(libraryStore())) as unknown[]) {
      if (isLibraryEntry(entry)) byId.set(entry.gameId, entry);
    }
  } catch {
    // memory only
  }
  return [...byId.values()].sort(
    (a, b) =>
      (b.record.endTime ?? b.reviewedAt) - (a.record.endTime ?? a.reviewedAt) ||
      b.reviewedAt - a.reviewedAt,
  );
}

/** Entries where the given player is known to be one of the sides. */
export async function getPlayerEntries(
  platform: Perspective['platform'],
  username: string,
): Promise<LibraryEntry[]> {
  const name = username.toLowerCase();
  return (await getLibraryEntries()).filter(
    (entry) => entry.perspective?.platform === platform && entry.perspective.username === name,
  );
}

export async function removeFromLibrary(gameId: string): Promise<void> {
  memory.delete(gameId);
  try {
    await del(gameId, libraryStore());
  } catch {
    // nothing stored
  }
}

export async function clearLibrary(): Promise<void> {
  memory.clear();
  try {
    await clear(libraryStore());
  } catch {
    // nothing stored
  }
}

/** Zero counts for every classification. */
export function emptyCounts(): Record<Classification, number> {
  return Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;
}

function isLibraryEntry(value: unknown): value is LibraryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<LibraryEntry>;
  return (
    entry.v === LIBRARY_VERSION &&
    typeof entry.gameId === 'string' &&
    typeof entry.record === 'object' &&
    entry.record !== null &&
    Array.isArray(entry.moves)
  );
}
