import type { GameRecord } from '@/core/types';
import {
  fetchChessComArchives,
  fetchChessComMonth,
  fetchChessComProfile,
} from '@/sources/chesscom';
import { LICHESS_PAGE_SIZE, fetchLichessGames, fetchLichessProfile } from '@/sources/lichess';
import type { Platform } from '@/state/settings';
import { mergeGames } from './gameList';

/**
 * Loading a player's game list page by page, plus a module-level cache so that
 * coming back from a review shows the list instantly (no refetch, same pages).
 */

export { LICHESS_PAGE_SIZE };

export interface PlayerProfile {
  platform: Platform;
  username: string;
  /** Real name, when the player shares it. */
  name?: string;
  title?: string;
  avatar?: string;
  /** Profile page on the original site. */
  url: string;
}

interface Month {
  year: number;
  month: number;
}

/** Where the next page starts. */
export type PageCursor =
  | { platform: 'chesscom'; archives: Month[]; next: number }
  | { platform: 'lichess'; until?: number };

export interface GameListData {
  profile: PlayerProfile;
  games: GameRecord[];
  cursor: PageCursor;
  hasMore: boolean;
}

/** Progress messages while pages load (e.g. which month is being fetched). */
export type ProgressCallback = (label: Month | null) => void;

const cache = new Map<string, GameListData>();

export function cacheKey(platform: Platform, username: string): string {
  return `${platform}:${username.trim().toLowerCase()}`;
}

export function getCachedList(platform: Platform, username: string): GameListData | undefined {
  return cache.get(cacheKey(platform, username));
}

export function setCachedList(platform: Platform, username: string, data: GameListData): void {
  cache.set(cacheKey(platform, username), data);
}

export function clearCachedList(platform: Platform, username: string): void {
  cache.delete(cacheKey(platform, username));
}

/** Fetches the profile. Throws NotFoundError for unknown players. */
export async function loadProfile(
  platform: Platform,
  username: string,
  signal?: AbortSignal,
): Promise<PlayerProfile> {
  if (platform === 'chesscom') {
    const p = await fetchChessComProfile(username, signal);
    return {
      platform,
      username: p.username || username,
      name: p.name,
      title: p.title,
      avatar: p.avatar,
      url: p.url ?? `https://www.chess.com/member/${encodeURIComponent(p.username || username)}`,
    };
  }
  const p = await fetchLichessProfile(username, signal);
  return {
    platform,
    username: p.username || username,
    title: p.title,
    url: p.url ?? `https://lichess.org/@/${encodeURIComponent(p.username || username)}`,
  };
}

/** The player exists, but their games could not be loaded. */
export class GamesUnavailableError extends Error {
  override name = 'GamesUnavailableError';
}

/**
 * Profile plus the newest page of games. Requests run one after another (Chess.com 429s
 * parallel ones). Only a missing profile means the player does not exist: once the profile
 * has loaded, a "not found" for the games themselves (closed or restricted accounts, or a
 * site that refuses the request) is reported as a GamesUnavailableError instead.
 */
export async function loadFirstPage(
  platform: Platform,
  username: string,
  signal?: AbortSignal,
  onProgress?: ProgressCallback,
): Promise<GameListData> {
  const profile = await loadProfile(platform, username, signal);
  try {
    const cursor: PageCursor =
      platform === 'chesscom'
        ? { platform, archives: await fetchChessComArchives(profile.username, signal), next: 0 }
        : { platform };
    const empty: GameListData = { profile, games: [], cursor, hasMore: true };
    return await loadNextPage(empty, signal, onProgress);
  } catch (error) {
    if (classifyLoadError(error) !== 'not-found') throw error;
    const site = platform === 'chesscom' ? 'Chess.com' : 'Lichess';
    throw new GamesUnavailableError(
      `${site} found ${profile.username} but did not return their games.`,
      { cause: error },
    );
  }
}

/**
 * Fetches the next page and returns a new GameListData (the input is not mutated).
 * Chess.com: the next monthly archive that has games (empty months are skipped).
 * Lichess: the next LICHESS_PAGE_SIZE games older than the oldest one loaded.
 */
export async function loadNextPage(
  data: GameListData,
  signal?: AbortSignal,
  onProgress?: ProgressCallback,
): Promise<GameListData> {
  const { cursor, profile } = data;
  if (cursor.platform === 'chesscom') {
    let next = cursor.next;
    let page: GameRecord[] = [];
    while (next < cursor.archives.length && page.length === 0) {
      const month = cursor.archives[next]!;
      onProgress?.(month);
      page = await fetchChessComMonth(profile.username, month.year, month.month, signal);
      next += 1;
    }
    onProgress?.(null);
    return {
      ...data,
      games: mergeGames(data.games, page),
      cursor: { ...cursor, next },
      hasMore: next < cursor.archives.length,
    };
  }

  onProgress?.(null);
  const page = await fetchLichessGames(profile.username, {
    max: LICHESS_PAGE_SIZE,
    until: cursor.until,
    signal,
  });
  const games = mergeGames(data.games, page);
  // Lichess pages by start time; end time is only a fallback for records without one.
  const starts = page
    .map((g) => g.startTime ?? g.endTime)
    .filter((t): t is number => typeof t === 'number');
  const until = starts.length > 0 ? Math.min(...starts) - 1 : undefined;
  // A page that adds nothing new (or gives no usable cursor) means we have reached the end.
  const addedAny = games.length > data.games.length;
  return {
    ...data,
    games,
    cursor: { platform: 'lichess', until },
    hasMore: page.length >= LICHESS_PAGE_SIZE && addedAny && until !== undefined,
  };
}

export type LoadErrorKind = 'not-found' | 'rate-limit' | 'network' | 'other';

/** Classifies a loading error; error classes are matched by name so mocks and bundles agree. */
export function classifyLoadError(error: unknown): LoadErrorKind {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotFoundError') return 'not-found';
  if (name === 'RateLimitError') return 'rate-limit';
  if (name === 'NetworkError' || error instanceof TypeError) return 'network';
  return 'other';
}

/** A friendly, actionable message for a loading error. */
export function loadErrorMessage(kind: LoadErrorKind, platform: Platform): string {
  const site = platform === 'chesscom' ? 'Chess.com' : 'Lichess';
  switch (kind) {
    case 'rate-limit':
      return `${site} is rate-limiting requests; try again in a minute.`;
    case 'network':
      return `Could not reach ${site}. Check your connection and try again.`;
    case 'not-found':
      return `${site} could not find these games.`;
    default:
      return `Something went wrong while loading games from ${site}.`;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
