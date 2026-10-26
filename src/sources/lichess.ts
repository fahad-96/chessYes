import { START_FEN } from '@/core/notation';
import type { GameRecord, GameResult, PlayerInfo, TimeClass } from '@/core/types';
import type { FetchOptions } from './http';
import { fetchJson, fetchText, NotFoundError } from './http';
import { isRecord, num, str } from './util';

/**
 * Lichess API client (https://lichess.org/api). CORS-enabled, no key needed.
 * Requests go through http.queuedFetch (Lichess asks for one request at a time;
 * on 429 wait a full minute before retrying).
 */

export const LICHESS_API = 'https://lichess.org';

/** Default number of games per fetchLichessGames page. */
export const LICHESS_PAGE_SIZE = 30;

/** Lichess's rate-limit guidance: after a 429, wait a full minute before the next request. */
const LICHESS_RETRY: FetchOptions = { retryBaseMs: 60_000, maxRetries: 1 };

export interface LichessProfile {
  username: string;
  title?: string;
  url?: string;
}

function normaliseUsername(username: string): string {
  const user = username.trim().toLowerCase();
  if (!user) throw new NotFoundError('Enter a Lichess username.');
  return user;
}

/** User profile, or throws NotFoundError. */
export async function fetchLichessProfile(
  username: string,
  signal?: AbortSignal,
): Promise<LichessProfile> {
  const user = normaliseUsername(username);
  const data = await fetchJson<unknown>(`${LICHESS_API}/api/user/${encodeURIComponent(user)}`, {
    ...LICHESS_RETRY,
    signal,
  });
  const name = isRecord(data) ? str(data.username) : undefined;
  if (!isRecord(data) || !name) throw new Error('Unexpected profile response from Lichess.');
  return {
    username: name,
    title: str(data.title),
    url: str(data.url) ?? `${LICHESS_API}/@/${name}`,
  };
}

/**
 * A page of the user's games, newest first (by end time).
 * GET /api/games/user/<u>?max=<max>&until=<until>&pgnInJson=true&clocks=true&opening=true
 * with `Accept: application/x-ndjson`. To paginate, pass `until` = the smallest startTime
 * of the previous page minus 1.
 *
 * Lichess filters and orders by start time, so paging by start time never skips or
 * repeats a game, even a long correspondence game that ended after newer games.
 */
export async function fetchLichessGames(
  username: string,
  options: { max?: number; until?: number; signal?: AbortSignal } = {},
): Promise<GameRecord[]> {
  const { until, signal } = options;
  const max = Math.max(1, Math.floor(options.max ?? LICHESS_PAGE_SIZE));
  const user = normaliseUsername(username);
  const params = new URLSearchParams({
    max: String(max),
    pgnInJson: 'true',
    clocks: 'true',
    opening: 'true',
  });
  if (until !== undefined) params.set('until', String(until));

  const text = await fetchText(
    `${LICHESS_API}/api/games/user/${encodeURIComponent(user)}?${params}`,
    { ...LICHESS_RETRY, signal, headers: { Accept: 'application/x-ndjson' } },
  );
  const games: GameRecord[] = [];
  for (const raw of parseNdjson(text)) {
    try {
      games.push(mapLichessGame(raw));
    } catch {
      // Skip a malformed entry instead of failing the whole page.
    }
  }
  return games.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0)).slice(0, max);
}

/** Parses newline-delimited JSON, skipping blank and unparseable lines. */
export function parseNdjson(text: string): unknown[] {
  const values: unknown[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      values.push(JSON.parse(trimmed));
    } catch {
      // A truncated last line (connection dropped mid-stream) is not worth failing over.
    }
  }
  return values;
}

/** One game by id via /game/export/<id>?clocks=true&opening=true&pgnInJson=true (Accept: application/json). */
export async function fetchLichessGame(gameId: string, signal?: AbortSignal): Promise<GameRecord> {
  // Game ids are 8 characters; the 12-character form adds a player suffix.
  const match = /^([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?$/.exec(gameId.trim());
  if (!match) throw new NotFoundError(`"${gameId}" is not a Lichess game id.`);
  const data = await fetchJson<unknown>(
    `${LICHESS_API}/game/export/${match[1]}?clocks=true&opening=true&pgnInJson=true`,
    { ...LICHESS_RETRY, signal, headers: { Accept: 'application/json' } },
  );
  return mapLichessGame(data);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const TIME_CLASSES: Record<string, TimeClass> = {
  ultraBullet: 'ultrabullet',
  bullet: 'bullet',
  blitz: 'blitz',
  rapid: 'rapid',
  classical: 'classical',
  correspondence: 'daily',
};

/** Statuses that end in a draw when there is no winner. */
const DRAW_STATUSES = new Set(['draw', 'stalemate', 'outoftime', 'timeout', 'variantEnd']);

/**
 * Maps a Lichess game JSON object to a GameRecord. id = `lichess/<id>`.
 * Names: players.<c>.user.name, or "Stockfish level N" for aiLevel, or "Anonymous".
 * timeClass from speed (ultraBullet → ultrabullet, correspondence → daily).
 * variant: "standard" and "fromPosition" are reviewable and map to "standard"
 * (fromPosition games carry a FEN header); others keep their name.
 * startTime = createdAt, endTime = lastMoveAt.
 */
export function mapLichessGame(game: unknown): GameRecord {
  const id = isRecord(game) ? str(game.id) : undefined;
  if (!isRecord(game) || !id) throw new Error('Invalid Lichess game: missing id.');

  const players = isRecord(game.players) ? game.players : {};
  const white = lichessPlayer(players.white);
  const black = lichessPlayer(players.black);
  const status = str(game.status) ?? 'unknownFinish';
  const winner = game.winner === 'white' ? white : game.winner === 'black' ? black : undefined;
  const result: GameResult =
    game.winner === 'white'
      ? '1-0'
      : game.winner === 'black'
        ? '0-1'
        : DRAW_STATUSES.has(status)
          ? '1/2-1/2'
          : '*';
  const opening = isRecord(game.opening) ? game.opening : {};
  const pgn = str(game.pgn)?.trim() || pgnFromMoves(game, white, black, result);
  if (!pgn) throw new Error(`Lichess game ${id} has no moves.`);

  return {
    id: `lichess/${id}`,
    source: 'lichess',
    url: `${LICHESS_API}/${id}`,
    white,
    black,
    result,
    termination: describeTermination(status, winner?.name),
    timeClass: TIME_CLASSES[str(game.speed) ?? ''] ?? 'unknown',
    timeControl: lichessTimeControl(game),
    rated: typeof game.rated === 'boolean' ? game.rated : undefined,
    endTime: num(game.lastMoveAt) ?? num(game.createdAt),
    startTime: num(game.createdAt),
    eco: str(opening.eco),
    openingName: str(opening.name),
    variant: lichessVariant(game.variant),
    pgn,
  };
}

function lichessPlayer(value: unknown): PlayerInfo {
  if (!isRecord(value)) return { name: 'Anonymous' };
  const user = isRecord(value.user) ? value.user : {};
  const aiLevel = num(value.aiLevel);
  const name =
    str(user.name) ?? (aiLevel === undefined ? 'Anonymous' : `Stockfish level ${aiLevel}`);
  return { name, rating: num(value.rating), title: str(user.title) };
}

/** Readable ending, e.g. "DrNykterstein won by resignation" or "Draw by stalemate". */
function describeTermination(status: string, winner: string | undefined): string | undefined {
  const won = (how: string, otherwise: string) => (winner ? `${winner} won ${how}` : otherwise);
  switch (status) {
    case 'mate':
      return won('by checkmate', 'Checkmate');
    case 'resign':
      return won('by resignation', 'Resignation');
    case 'stalemate':
      return 'Draw by stalemate';
    case 'draw':
      return 'Draw';
    case 'outoftime':
      // Without a winner the flagging side's opponent could not have mated.
      return won('on time', 'Draw (timeout vs insufficient material)');
    case 'timeout':
      return won('(opponent left the game)', 'Draw (opponent left the game)');
    case 'cheat':
      return won('(cheat detected)', 'Cheat detected');
    case 'noStart':
      return won('(opponent did not move)', 'Game did not start');
    case 'variantEnd':
      return won('(variant rules)', 'Draw (variant rules)');
    case 'aborted':
      return 'Game aborted';
    case 'created':
    case 'started':
      return 'Game in progress';
    default:
      return winner ? `${winner} won` : undefined;
  }
}

/** "180+0" for real-time games, "1/<seconds>" for correspondence (like Chess.com daily). */
function lichessTimeControl(game: Record<string, unknown>): string | undefined {
  const clock = isRecord(game.clock) ? game.clock : undefined;
  const initial = num(clock?.initial);
  if (initial !== undefined) return `${initial}+${num(clock?.increment) ?? 0}`;
  const days = num(game.daysPerTurn);
  return days === undefined ? undefined : `1/${days * 86400}`;
}

function lichessVariant(value: unknown): string {
  // Most endpoints send the key as a string; some send { key, name }.
  const key = isRecord(value) ? str(value.key) : str(value);
  return !key || key === 'standard' || key === 'fromPosition' ? 'standard' : key;
}

/** Fallback PGN from the space-separated SAN `moves` when the response has no `pgn`. */
function pgnFromMoves(
  game: Record<string, unknown>,
  white: PlayerInfo,
  black: PlayerInfo,
  result: GameResult,
): string | undefined {
  const sans = str(game.moves)?.split(' ').filter(Boolean) ?? [];
  if (sans.length === 0) return undefined;
  const initialFen = str(game.initialFen);
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const tags: [string, string][] = [
    ['White', white.name],
    ['Black', black.name],
    ['Result', result],
  ];
  if (initialFen && initialFen !== START_FEN) tags.push(['SetUp', '1'], ['FEN', initialFen]);

  const fenFields = (initialFen ?? START_FEN).split(' ');
  let whiteToMove = fenFields[1] !== 'b';
  let moveNumber = Number(fenFields[5]) || 1;
  const tokens: string[] = [];
  for (const [index, san] of sans.entries()) {
    if (whiteToMove) tokens.push(`${moveNumber}.`);
    else if (index === 0) tokens.push(`${moveNumber}...`);
    tokens.push(san);
    if (!whiteToMove) moveNumber += 1;
    whiteToMove = !whiteToMove;
  }
  const header = tags.map(([name, value]) => `[${name} "${escape(value)}"]`).join('\n');
  return `${header}\n\n${tokens.join(' ')} ${result}`;
}
