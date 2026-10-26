import type { GameRecord } from '@/core/types';

/**
 * Pasted / uploaded PGN games. They are stored in IndexedDB (idb-keyval store
 * "kibitz-pgn") so the review URL keeps working after a reload.
 */

/**
 * Builds a GameRecord from one PGN game: id = `pgn/<stable hash of the normalised PGN>`,
 * players/result/time control/date from headers (missing values → "White"/"Black", "*").
 * @throws PgnError when the PGN is not a valid game.
 */
export function recordFromPgn(_pgn: string): GameRecord {
  throw new Error('not implemented');
}

export function savePgnGame(_record: GameRecord): Promise<void> {
  throw new Error('not implemented');
}

export function loadPgnGame(_id: string): Promise<GameRecord | null> {
  throw new Error('not implemented');
}
