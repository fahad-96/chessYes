import type { GameRecord } from '@/core/types';

/**
 * Lichess API client (https://lichess.org/api). CORS-enabled, no key needed.
 * Requests go through http.queuedFetch (Lichess asks for one request at a time;
 * on 429 wait a full minute before retrying).
 */

export const LICHESS_API = 'https://lichess.org';

export interface LichessProfile {
  username: string;
  title?: string;
  url?: string;
}

/** User profile, or throws NotFoundError. */
export function fetchLichessProfile(_username: string, _signal?: AbortSignal): Promise<LichessProfile> {
  throw new Error('not implemented');
}

/**
 * A page of the user's games, newest first.
 * GET /api/games/user/<u>?max=<max>&until=<until>&pgnInJson=true&clocks=true&opening=true
 * with `Accept: application/x-ndjson`. Pass `until` = endTime of the oldest game
 * from the previous page minus 1 to paginate.
 */
export function fetchLichessGames(
  _username: string,
  _options?: { max?: number; until?: number; signal?: AbortSignal },
): Promise<GameRecord[]> {
  throw new Error('not implemented');
}

/** One game by id via /game/export/<id>?clocks=true&opening=true&pgnInJson=true (Accept: application/json). */
export function fetchLichessGame(_gameId: string, _signal?: AbortSignal): Promise<GameRecord> {
  throw new Error('not implemented');
}

/**
 * Maps a Lichess game JSON object to a GameRecord. id = `lichess/<id>`.
 * Names: players.<c>.user.name, or "Stockfish level N" for aiLevel, or "Anonymous".
 * timeClass from speed (ultraBullet → ultrabullet, correspondence → daily).
 * variant: "standard" and "fromPosition" are reviewable and map to "standard"
 * (fromPosition games carry a FEN header); others keep their name.
 * endTime = lastMoveAt.
 */
export function mapLichessGame(_game: unknown): GameRecord {
  throw new Error('not implemented');
}
