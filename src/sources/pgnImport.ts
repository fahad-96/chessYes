import { createStore, get, set } from 'idb-keyval';
import { parsePgn, PgnError, readPgnHeaders } from '@/core/pgn';
import type { GameRecord, GameResult, ParsedGame, PlayerInfo } from '@/core/types';
import { openingNameFromEcoUrl } from './chesscom';
import { isGameResult, isRecord, timeClassFromTimeControl } from './util';

/**
 * Pasted / uploaded PGN games. They are stored in IndexedDB (idb-keyval store
 * "kibitz-pgn") so the review URL keeps working after a reload.
 */

const pgnStore = createStore('kibitz-pgn', 'games');
/** Session copy, so a pasted game still opens when IndexedDB is unavailable. */
const memory = new Map<string, GameRecord>();

/** Line endings and surrounding whitespace must not change a game's id. */
export function normalisePgn(pgn: string): string {
  return pgn.replace(/\r\n?/g, '\n').trim();
}

/** cyrb53: a fast, well-distributed 53-bit string hash (not cryptographic). */
function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** `pgn/<hash>` for a PGN; identical games (up to line endings and padding) share an id. */
export function pgnGameId(pgn: string): string {
  return `pgn/${cyrb53(normalisePgn(pgn)).toString(36)}`;
}

/**
 * Builds a GameRecord from one PGN game: id = `pgn/<stable hash of the normalised PGN>`,
 * players/result/time control/date from headers (missing values → "White"/"Black", "*").
 * @throws PgnError when the PGN is not a valid game.
 */
export function recordFromPgn(pgn: string): GameRecord {
  const text = normalisePgn(pgn);
  if (!text) throw new PgnError('The PGN is empty.');
  const parsed = parsePgn(text);
  if (parsed.moves.length === 0) throw new PgnError('The PGN has no moves to review.');

  const headers = readPgnHeaders(text);
  const tag = (name: string) => cleanTag(headers[name]);
  const white = pgnPlayer(tag('White'), tag('WhiteElo'), tag('WhiteTitle'), 'White');
  const black = pgnPlayer(tag('Black'), tag('BlackElo'), tag('BlackTitle'), 'Black');
  const headerResult = tag('Result');
  // A missing or "*" result is filled in from the board when the game visibly ended.
  const result: GameResult =
    isGameResult(headerResult) && headerResult !== '*'
      ? headerResult
      : (resultFromBoard(parsed) ?? '*');
  const termination = tag('Termination');
  const timeControl = tag('TimeControl');
  const eco = tag('ECO');
  const utc = !tag('Timezone') || tag('Timezone') === 'UTC';
  const link = [tag('Link'), tag('Site')].find((value) => value && /^https?:\/\//.test(value));

  return {
    id: pgnGameId(text),
    source: 'pgn',
    url: link,
    white,
    black,
    result,
    termination:
      termination && termination.toLowerCase() !== 'normal'
        ? termination
        : describeBoardEnding(parsed, result, white, black),
    timeClass: timeClassFromTimeControl(timeControl),
    timeControl,
    endTime:
      (utc ? parsePgnDate(tag('EndDate'), tag('EndTime')) : undefined) ??
      parsePgnDate(tag('UTCDate'), tag('UTCTime')) ??
      parsePgnDate(tag('Date')),
    eco: eco && /^[A-E]\d\d$/.test(eco) ? eco : undefined,
    openingName: tag('Opening') ?? openingNameFromEcoUrl(tag('ECOUrl')),
    variant: normaliseVariant(tag('Variant')),
    pgn: text,
  };
}

/** Treats empty and "?" (the PGN spelling of "unknown") tag values as missing. */
function cleanTag(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== '?' ? trimmed : undefined;
}

function pgnPlayer(
  name: string | undefined,
  elo: string | undefined,
  title: string | undefined,
  fallback: string,
): PlayerInfo {
  const rating = elo && /^\d+$/.test(elo) ? Number(elo) : 0;
  return {
    name: name && name !== '-' ? name : fallback,
    rating: rating > 0 ? rating : undefined,
    title,
  };
}

function resultFromBoard(game: ParsedGame): GameResult | undefined {
  const last = game.moves.at(-1);
  if (game.finalState === 'checkmate' && last) return last.color === 'w' ? '1-0' : '0-1';
  // Only automatic draws: threefold and fifty-move draws must be claimed.
  if (game.finalState === 'stalemate' || game.finalState === 'insufficient') return '1/2-1/2';
  return undefined;
}

function describeBoardEnding(
  game: ParsedGame,
  result: GameResult,
  white: PlayerInfo,
  black: PlayerInfo,
): string | undefined {
  switch (game.finalState) {
    case 'checkmate':
      return `${game.moves.at(-1)?.color === 'w' ? white.name : black.name} won by checkmate`;
    case 'stalemate':
      return 'Draw by stalemate';
    case 'insufficient':
      return 'Draw by insufficient material';
    case 'threefold':
      return result === '1/2-1/2' ? 'Draw by repetition' : undefined;
    case 'fifty-move':
      return result === '1/2-1/2' ? 'Draw by 50-move rule' : undefined;
    default:
      return undefined;
  }
}

/** "2026.10.02" (+ "22:09:59") as UTC epoch ms; undefined for partial dates like "2026.??.??". */
function parsePgnDate(date: string | undefined, time?: string): number | undefined {
  const d = date ? /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date) : null;
  if (!d) return undefined;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const t = time ? /^(\d{1,2}):(\d{2}):(\d{2})/.exec(time) : null;
  const [hours, minutes, seconds] = t ? [Number(t[1]), Number(t[2]), Number(t[3])] : [0, 0, 0];
  return Date.UTC(year, month - 1, day, hours, minutes, seconds);
}

/** "Standard" / "From Position" → "standard"; other variants as a compact lowercase key. */
function normaliseVariant(variant: string | undefined): string {
  const key = (variant ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  return !key || key === 'standard' || key === 'fromposition' ? 'standard' : key;
}

/** Stores a pasted game so its review URL survives a reload. Never throws. */
export async function savePgnGame(record: GameRecord): Promise<void> {
  memory.set(record.id, record);
  try {
    await set(record.id, record, pgnStore);
  } catch {
    // Storage full or unavailable: the session copy still serves the review.
  }
}

/** A stored pasted game, or null when it is unknown (or storage is unavailable). */
export async function loadPgnGame(id: string): Promise<GameRecord | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  try {
    const stored: unknown = await get(id, pgnStore);
    if (isRecord(stored) && stored.id === id && typeof stored.pgn === 'string') {
      const record = stored as unknown as GameRecord;
      memory.set(id, record);
      return record;
    }
  } catch {
    // Treat storage errors like a missing game.
  }
  return null;
}
