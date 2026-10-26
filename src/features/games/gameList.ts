import type { Color, GameRecord, PlayerInfo, TimeClass } from '@/core/types';
import type { Platform } from '@/state/settings';

/** Result of a game from the searched player's point of view. */
export type PlayerOutcome = 'win' | 'loss' | 'draw' | 'unknown';
export type ResultFilter = 'all' | 'win' | 'loss' | 'draw';
export type TimeClassFilter = 'all' | TimeClass;

export interface GameFilters {
  timeClass: TimeClassFilter;
  result: ResultFilter;
  /** Case-insensitive substring of the opponent's name. */
  opponent: string;
}

export const DEFAULT_FILTERS: GameFilters = { timeClass: 'all', result: 'all', opponent: '' };

/** Order of the time-class filter chips, fastest first. 'unknown' never gets a chip. */
const TIME_CLASS_ORDER: TimeClass[] = [
  'ultrabullet',
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'daily',
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The colour the searched player had in this game, or null if they did not play in it. */
export function playerColor(record: GameRecord, username: string): Color | null {
  if (sameName(record.white.name, username)) return 'w';
  if (sameName(record.black.name, username)) return 'b';
  return null;
}

/** Win / loss / draw for the searched player ('unknown' for unfinished games or strangers). */
export function outcomeForPlayer(record: GameRecord, username: string): PlayerOutcome {
  const color = playerColor(record, username);
  if (record.result === '1/2-1/2') return 'draw';
  if (color === null || record.result === '*') return 'unknown';
  const whiteWon = record.result === '1-0';
  return whiteWon === (color === 'w') ? 'win' : 'loss';
}

/** The searched player and their opponent (falls back to White/Black when neither name matches). */
export function sides(
  record: GameRecord,
  username: string,
): { me: PlayerInfo; opponent: PlayerInfo; color: Color } {
  const color = playerColor(record, username) ?? 'w';
  return color === 'w'
    ? { me: record.white, opponent: record.black, color }
    : { me: record.black, opponent: record.white, color };
}

/** Only standard chess can be analysed; other variants are listed but disabled. */
export function isReviewable(record: GameRecord): boolean {
  return record.variant === 'standard';
}

/** Time classes present in the list, in chip order. */
export function availableTimeClasses(games: readonly GameRecord[]): TimeClass[] {
  const present = new Set(games.map((g) => g.timeClass));
  return TIME_CLASS_ORDER.filter((tc) => present.has(tc));
}

/** Applies the time-class, result and opponent filters. */
export function filterGames(
  games: readonly GameRecord[],
  username: string,
  filters: GameFilters,
): GameRecord[] {
  const query = filters.opponent.trim().toLowerCase();
  return games.filter((game) => {
    if (filters.timeClass !== 'all' && game.timeClass !== filters.timeClass) return false;
    if (filters.result !== 'all' && outcomeForPlayer(game, username) !== filters.result)
      return false;
    if (query) {
      const color = playerColor(game, username);
      const names =
        color === 'w'
          ? [game.black.name]
          : color === 'b'
            ? [game.white.name]
            : [game.white.name, game.black.name];
      if (!names.some((name) => name.toLowerCase().includes(query))) return false;
    }
    return true;
  });
}

/** Adds newly fetched games, dropping duplicates by id, newest first. */
export function mergeGames(
  existing: readonly GameRecord[],
  incoming: readonly GameRecord[],
): GameRecord[] {
  const seen = new Set(existing.map((g) => g.id));
  const merged = [...existing];
  for (const game of incoming) {
    if (seen.has(game.id)) continue;
    seen.add(game.id);
    merged.push(game);
  }
  // Array.prototype.sort is stable, so games without an end time keep their order at the end.
  return merged.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
}

/** "October 2026" (month 1-12). */
export function formatMonth(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? ''} ${year}`.trim();
}

export interface MonthGroup {
  /** "2026-10", or "unknown" for games without a date. */
  key: string;
  label: string;
  games: GameRecord[];
}

/** Groups an already sorted list by the local calendar month the game ended in. */
export function groupByMonth(games: readonly GameRecord[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const game of games) {
    let key = 'unknown';
    let label = 'Undated';
    if (game.endTime) {
      const date = new Date(game.endTime);
      const month = date.getMonth() + 1;
      key = `${date.getFullYear()}-${String(month).padStart(2, '0')}`;
      label = formatMonth(date.getFullYear(), month);
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.games.push(game);
    else groups.push({ key, label, games: [game] });
  }
  return groups;
}

export interface ReviewLinkOptions {
  /** Whose game it is: the review shows it from this player's side (`?as=`). */
  as?: string;
  /** Opens the review at this ply (`?ply=`). */
  ply?: number;
}

/**
 * Route of a game review. Each id segment is encoded but the slashes are kept; `as` and
 * `ply` become query parameters, e.g. /review/lichess/abc?as=DrNykterstein&ply=31.
 */
export function reviewPath(id: string, options: ReviewLinkOptions = {}): string {
  const path = `/review/${id.split('/').map(encodeURIComponent).join('/')}`;
  const query = new URLSearchParams();
  if (options.as) query.set('as', options.as);
  if (options.ply !== undefined && Number.isInteger(options.ply) && options.ply >= 0) {
    query.set('ply', String(options.ply));
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/** Route of a player's insights page, e.g. /insights/chesscom/Hikaru. */
export function insightsPath(platform: Platform, username: string): string {
  return `/insights/${platform}/${encodeURIComponent(username.trim())}`;
}
