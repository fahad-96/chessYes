import type { GameRecord } from '@/core/types';

/**
 * Chess.com Published-Data API client (https://api.chess.com/pub, read-only, no key).
 *
 * Caching (verified in a browser, Oct 2026):
 * - Responses allow CORS for simple GETs but a custom `If-None-Match` header
 *   triggers a preflight that the API rejects, and the ETag header is not exposed
 *   to scripts. So conditional requests are delegated to the browser's HTTP cache:
 *   `cache: 'no-cache'` makes the browser revalidate with its stored ETag /
 *   Last-Modified and reuse the body on 304.
 * - Past monthly archives never change: they are stored in IndexedDB
 *   (idb-keyval store "kibitz-chesscom") and never refetched.
 * - The current month and the archive list are refetched with `cache: 'no-cache'`,
 *   at most once per 60 seconds (the API's max-age), using an in-memory/IDB timestamp.
 * - All requests go through http.queuedFetch (serial, 429 backoff).
 */

export const CHESSCOM_API = 'https://api.chess.com/pub';

export interface ChessComProfile {
  username: string;
  name?: string;
  avatar?: string;
  title?: string;
  url?: string;
  /** Unix ms */
  joined?: number;
}

/** Player profile, or throws NotFoundError when the username does not exist. */
export function fetchChessComProfile(_username: string, _signal?: AbortSignal): Promise<ChessComProfile> {
  throw new Error('not implemented');
}

/** Monthly archives as {year, month} (month 1-12), newest first. */
export function fetchChessComArchives(
  _username: string,
  _signal?: AbortSignal,
): Promise<{ year: number; month: number }[]> {
  throw new Error('not implemented');
}

/** All games of one month, newest first, mapped to GameRecord. */
export function fetchChessComMonth(
  _username: string,
  _year: number,
  _month: number,
  _signal?: AbortSignal,
): Promise<GameRecord[]> {
  throw new Error('not implemented');
}

/** Raw game object as returned in a monthly archive (fields we use). */
export interface ChessComGame {
  url: string;
  pgn?: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  uuid?: string;
  initial_setup?: string;
  fen?: string;
  eco?: string;
  accuracies?: { white: number; black: number };
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

/**
 * Maps a raw archive game to a GameRecord.
 * id = `chesscom/<username lowercased>/<yyyy>/<mm two digits>/<numeric id from url>`
 * where <username> is the player whose archive it came from.
 * result: "win" on one side → that side wins; agreed / repetition / stalemate /
 * insufficient / 50move / timevsinsufficient → draw. variant: rules "chess" → "standard",
 * otherwise the rules value. termination from the PGN Termination header; eco/opening name
 * from the ECO header and the ECOUrl slug. Returns null for games without a PGN.
 */
export function mapChessComGame(
  _game: ChessComGame,
  _archiveUser: string,
  _year: number,
  _month: number,
): GameRecord | null {
  throw new Error('not implemented');
}

/** Parses a chesscom game id back into its parts, or null if malformed. */
export function parseChessComId(
  _id: string,
): { username: string; year: number; month: number; gameId: string } | null {
  throw new Error('not implemented');
}
