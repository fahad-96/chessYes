import { clear, createStore, get, set } from 'idb-keyval';
import { readPgnHeaders } from '@/core/pgn';
import type { GameRecord, GameResult, PlayerInfo, TimeClass } from '@/core/types';
import { fetchJson, NetworkError, NotFoundError, RateLimitError } from './http';
import { isGameResult, isRecord, num, str } from './util';

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

export interface ArchiveMonth {
  year: number;
  /** 1-12 */
  month: number;
}

/** How long the archive list and the current month are reused without asking the API. */
export const FRESH_MS = 60_000;
/**
 * A month only counts as final when it was downloaded this long after it ended, a safety
 * margin for games that finish right at midnight UTC and are filed a little later.
 */
const MONTH_SETTLE_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Cache: IndexedDB plus a small in-memory copy (which also covers browsers where
// IndexedDB is unavailable, e.g. some private modes).
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  /** Date.now() when the data was downloaded. */
  fetchedAt: number;
  data: T;
}

const cacheStore = createStore('kibitz-chesscom', 'cache');
// Months can hold thousands of games, so only the most recent few stay in memory.
const MEMORY_LIMIT = 8;
const memory = new Map<string, CacheEntry<unknown>>();

function remember(key: string, entry: CacheEntry<unknown>): void {
  memory.delete(key); // re-insert so the Map's order doubles as LRU order
  memory.set(key, entry);
  if (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
}

async function readCache<T>(
  key: string,
  isValid: (data: unknown) => data is T,
): Promise<CacheEntry<T> | undefined> {
  const hit = memory.get(key);
  if (hit && isValid(hit.data)) {
    remember(key, hit);
    return hit as CacheEntry<T>;
  }
  try {
    const stored: unknown = await get(key, cacheStore);
    const fetchedAt = isRecord(stored) ? num(stored.fetchedAt) : undefined;
    if (isRecord(stored) && fetchedAt !== undefined && isValid(stored.data)) {
      const entry: CacheEntry<T> = { fetchedAt, data: stored.data };
      remember(key, entry);
      return entry;
    }
  } catch {
    // Storage unavailable or corrupt: behave as a cache miss.
  }
  return undefined;
}

/** True while an entry is younger than FRESH_MS (a clock set backwards counts as stale). */
function isRecent(fetchedAt: number, now: number): boolean {
  const age = now - fetchedAt;
  return age >= 0 && age < FRESH_MS;
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  const entry: CacheEntry<T> = { fetchedAt: Date.now(), data };
  remember(key, entry);
  try {
    await set(key, entry, cacheStore);
  } catch {
    // Storage full or unavailable: the in-memory copy still serves this session.
  }
}

/** Drops every cached archive list and month (memory and IndexedDB). */
export async function clearChessComCache(): Promise<void> {
  memory.clear();
  try {
    await clear(cacheStore);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/** Stale data beats an error when offline or rate limited; other failures still surface. */
function canFallBackToCache(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof RateLimitError;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Chess.com usernames are case-insensitive; the API and our ids use lowercase. */
function normaliseUsername(username: string): string {
  const user = username.trim().toLowerCase();
  if (!user) throw new NotFoundError('Enter a Chess.com username.');
  return user;
}

function playerUrl(user: string): string {
  return `${CHESSCOM_API}/player/${encodeURIComponent(user)}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Player profile, or throws NotFoundError when the username does not exist. */
export async function fetchChessComProfile(
  username: string,
  signal?: AbortSignal,
): Promise<ChessComProfile> {
  const user = normaliseUsername(username);
  const data = await fetchJson<unknown>(playerUrl(user), { signal });
  const apiUsername = isRecord(data) ? str(data.username) : undefined;
  if (!isRecord(data) || !apiUsername) {
    throw new Error('Unexpected profile response from Chess.com.');
  }
  const url = str(data.url);
  const joined = num(data.joined);
  return {
    username: displayUsername(apiUsername, url),
    name: str(data.name),
    avatar: str(data.avatar),
    title: str(data.title),
    url,
    joined: joined === undefined ? undefined : joined * 1000,
  };
}

/** The profile's `username` is lowercase; the member URL keeps the user's own casing. */
function displayUsername(username: string, url: string | undefined): string {
  const fromUrl = url?.split('/').filter(Boolean).pop();
  return fromUrl && fromUrl.toLowerCase() === username.toLowerCase() ? fromUrl : username;
}

/** Monthly archives as {year, month} (month 1-12), newest first. */
export async function fetchChessComArchives(
  username: string,
  signal?: AbortSignal,
): Promise<ArchiveMonth[]> {
  const user = normaliseUsername(username);
  const key = `archives/${user}`;
  const cached = await readCache(key, isArchiveList);
  if (cached && isRecent(cached.fetchedAt, Date.now())) return [...cached.data];

  try {
    const data = await fetchJson<unknown>(`${playerUrl(user)}/games/archives`, {
      signal,
      cache: 'no-cache',
    });
    const archives = parseArchives(data);
    await writeCache(key, archives);
    return [...archives];
  } catch (error) {
    if (cached && canFallBackToCache(error)) return [...cached.data];
    throw error;
  }
}

function isArchiveList(data: unknown): data is ArchiveMonth[] {
  return (
    Array.isArray(data) &&
    data.every((m) => isRecord(m) && num(m.year) !== undefined && num(m.month) !== undefined)
  );
}

const isArray = (data: unknown): data is unknown[] => Array.isArray(data);

/** Parses `{ archives: [".../games/2026/10", ...] }` into months, newest first. */
export function parseArchives(data: unknown): ArchiveMonth[] {
  if (!isRecord(data) || !Array.isArray(data.archives)) {
    throw new Error('Unexpected archives response from Chess.com.');
  }
  const seen = new Set<string>();
  const months: ArchiveMonth[] = [];
  for (const url of data.archives) {
    const match = typeof url === 'string' ? /\/games\/(\d{4})\/(\d{2})\/?$/.exec(url) : null;
    if (!match) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12 || seen.has(`${year}/${month}`)) continue;
    seen.add(`${year}/${month}`);
    months.push({ year, month });
  }
  // The API lists oldest first; sort rather than reverse so we never depend on that order.
  return months.sort((a, b) => b.year - a.year || b.month - a.month);
}

/**
 * Whether a cached month can be used without asking the API: either it was downloaded
 * after the month was over (it can no longer change) or less than FRESH_MS ago.
 */
function isMonthFresh(fetchedAt: number, year: number, month: number, now: number): boolean {
  const monthEnd = Date.UTC(year, month, 1); // `month` is 1-based, so this is the next month
  return isRecent(fetchedAt, now) || fetchedAt >= monthEnd + MONTH_SETTLE_MS;
}

/** All games of one month, newest first, mapped to GameRecord. */
export async function fetchChessComMonth(
  username: string,
  year: number,
  month: number,
  signal?: AbortSignal,
): Promise<GameRecord[]> {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid month ${year}/${month}`);
  }
  const user = normaliseUsername(username);
  const key = `month/${user}/${year}/${pad2(month)}`;
  const now = Date.now();
  const cached = await readCache(key, isArray);

  let games: unknown[];
  if (cached && isMonthFresh(cached.fetchedAt, year, month, now)) {
    games = cached.data;
  } else {
    // A month we have never seen that ended long ago may come from the browser's HTTP
    // cache as is; anything that might have changed since is revalidated.
    const settled = now >= Date.UTC(year, month, 1) + MONTH_SETTLE_MS;
    try {
      const data = await fetchJson<unknown>(`${playerUrl(user)}/games/${year}/${pad2(month)}`, {
        signal,
        cache: !cached && settled ? 'default' : 'no-cache',
      });
      if (!isRecord(data) || !Array.isArray(data.games)) {
        throw new Error('Unexpected games response from Chess.com.');
      }
      games = data.games;
      await writeCache(key, games);
    } catch (error) {
      if (!cached || !canFallBackToCache(error)) throw error;
      games = cached.data;
    }
  }

  const records: GameRecord[] = [];
  for (const game of games) {
    if (!isChessComGame(game)) continue;
    const record = mapChessComGame(game, user, year, month);
    if (record) records.push(record);
  }
  return records.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

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

/** Checks the fields mapChessComGame cannot do without. */
function isChessComGame(value: unknown): value is ChessComGame {
  const isSide = (side: unknown) =>
    isRecord(side) && typeof side.username === 'string' && typeof side.result === 'string';
  return (
    isRecord(value) && typeof value.url === 'string' && isSide(value.white) && isSide(value.black)
  );
}

/** Result codes that end the game in a draw (the same code is set on both sides). */
const DRAW_CODES = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
]);

const DRAW_DESCRIPTIONS: Record<string, string> = {
  agreed: 'Draw by agreement',
  repetition: 'Draw by repetition',
  stalemate: 'Draw by stalemate',
  insufficient: 'Draw by insufficient material',
  '50move': 'Draw by 50-move rule',
  timevsinsufficient: 'Draw by timeout vs insufficient material',
};

/** How the loser lost, keyed by the loser's result code. */
const LOSS_DESCRIPTIONS: Record<string, string> = {
  checkmated: 'by checkmate',
  resigned: 'by resignation',
  timeout: 'on time',
  abandoned: '- game abandoned',
  kingofthehill: '- king reached the hill',
  threecheck: '- three checks',
  bughousepartnerlose: '- partner lost',
};

const TIME_CLASSES: ReadonlySet<string> = new Set(['bullet', 'blitz', 'rapid', 'daily']);

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
  game: ChessComGame,
  archiveUser: string,
  year: number,
  month: number,
): GameRecord | null {
  if (!game.pgn) return null;
  const gameId = gameIdFromUrl(game.url);
  if (!gameId) return null;

  const headers = safeHeaders(game.pgn);
  const eco = headers.ECO && /^[A-E]\d\d$/.test(headers.ECO) ? headers.ECO : undefined;
  const timeClass: TimeClass = TIME_CLASSES.has(game.time_class)
    ? (game.time_class as TimeClass)
    : 'unknown';

  return {
    id: `chesscom/${archiveUser.trim().toLowerCase()}/${year}/${pad2(month)}/${gameId}`,
    source: 'chesscom',
    url: game.url,
    white: player(game.white),
    black: player(game.black),
    result: chessComResult(game, headers.Result),
    termination: headers.Termination || describeEnding(game),
    timeClass,
    timeControl: game.time_control || undefined,
    rated: typeof game.rated === 'boolean' ? game.rated : undefined,
    endTime: num(game.end_time) === undefined ? undefined : game.end_time * 1000,
    eco,
    openingName: openingNameFromEcoUrl(headers.ECOUrl ?? game.eco),
    variant: !game.rules || game.rules === 'chess' ? 'standard' : game.rules,
    pgn: game.pgn,
  };
}

/** "https://www.chess.com/game/live/184727190848" (or /game/daily/...) → "184727190848". */
function gameIdFromUrl(url: string): string | undefined {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const id = path.split('/').filter(Boolean).pop();
  return id && /^[A-Za-z0-9]+$/.test(id) ? id : undefined;
}

function safeHeaders(pgn: string): Record<string, string> {
  try {
    return readPgnHeaders(pgn);
  } catch {
    return {}; // the PGN itself is validated later, when it is parsed for review
  }
}

function player(side: ChessComGame['white']): PlayerInfo {
  return { name: side.username, rating: num(side.rating) };
}

function chessComResult(game: ChessComGame, headerResult: string | undefined): GameResult {
  if (game.white.result === 'win') return '1-0';
  if (game.black.result === 'win') return '0-1';
  if (DRAW_CODES.has(game.white.result) || DRAW_CODES.has(game.black.result)) return '1/2-1/2';
  return isGameResult(headerResult) ? headerResult : '*';
}

/** Fallback when the PGN has no Termination header. */
function describeEnding(game: ChessComGame): string | undefined {
  const { white, black } = game;
  const winner = white.result === 'win' ? white : black.result === 'win' ? black : undefined;
  if (winner) {
    const loser = winner === white ? black : white;
    const how = LOSS_DESCRIPTIONS[loser.result];
    return how ? `${winner.username} won ${how}` : `${winner.username} won`;
  }
  return DRAW_DESCRIPTIONS[white.result] ?? DRAW_DESCRIPTIONS[black.result];
}

/** Slugs drop apostrophes and turn hyphens into word breaks; restore the common names. */
const OPENING_NAME_FIXES: [RegExp, string][] = [
  [/\bKings\b/g, "King's"],
  [/\bQueens\b/g, "Queen's"],
  [/\bAlekhines\b/g, "Alekhine's"],
  [/\bBishops\b/g, "Bishop's"],
  [/\bBirds\b/g, "Bird's"],
  [/\bOwens\b/g, "Owen's"],
  [/\bPetrovs\b/g, "Petrov's"],
  [/\bCaro Kann\b/g, 'Caro-Kann'],
  [/\bNimzo Indian\b/g, 'Nimzo-Indian'],
  [/\bBogo Indian\b/g, 'Bogo-Indian'],
  [/\bNimzo Larsen\b/g, 'Nimzo-Larsen'],
  [/\bSmith Morra\b/g, 'Smith-Morra'],
  [/\bBlackmar Diemer\b/g, 'Blackmar-Diemer'],
  [/\bRichter Rauzer\b/g, 'Richter-Rauzer'],
];

/**
 * Opening name from a Chess.com ECOUrl, e.g.
 * ".../openings/Kings-Indian-Defense-Fianchetto-Variation-8.d5-Nb8" →
 * "King's Indian Defense Fianchetto Variation" (the move list after the name is dropped).
 */
export function openingNameFromEcoUrl(ecoUrl: string | undefined): string | undefined {
  const slug = ecoUrl ? /\/openings\/([^?#]+)/.exec(ecoUrl)?.[1] : undefined;
  if (!slug) return undefined;
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // Malformed escape: use the slug as is.
  }
  const words: string[] = [];
  for (const token of decoded.split(/[-/]/)) {
    if (/^\d+\./.test(token)) break; // "8.d5", "3...Nf6": the moves start here
    // "Variation...6.O": the moves can also follow the last word directly after "...".
    const [word, moves] = token.split('...');
    if (word) words.push(word);
    if (moves !== undefined) break;
  }
  if (words.length === 0) return undefined;
  return OPENING_NAME_FIXES.reduce(
    (name, [pattern, fix]) => name.replace(pattern, fix),
    words.join(' '),
  );
}

/** Parses a chesscom game id back into its parts, or null if malformed. */
export function parseChessComId(
  id: string,
): { username: string; year: number; month: number; gameId: string } | null {
  const match = /^chesscom\/([^/]+)\/(\d{4})\/(\d{2})\/([A-Za-z0-9]+)$/.exec(id);
  if (!match) return null;
  const [, username = '', year, month, gameId = ''] = match;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return null;
  return { username: username.toLowerCase(), year: Number(year), month: monthNumber, gameId };
}
