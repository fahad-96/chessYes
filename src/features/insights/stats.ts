import { PIECE_VALUES } from '@/core/thresholds';
import type { Classification, Color, GameRecord, TimeClass } from '@/core/types';
import { outcomeForPlayer, playerColor, type PlayerOutcome } from '@/features/games/gameList';
import type { LibraryEntry, LibraryMove } from '@/library/library';
import type { Platform } from '@/state/settings';

/**
 * Pure statistics behind the insights page. Part A works on game records alone (no engine);
 * part B works on library entries (reviewed games). Every function takes the player's
 * username and matches it case-insensitively, so "Hikaru" and "hikaru" are the same player.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface ResultCounts {
  /** wins + draws + losses. */
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export function emptyResults(): ResultCounts {
  return { games: 0, wins: 0, draws: 0, losses: 0 };
}

function addOutcome(counts: ResultCounts, outcome: PlayerOutcome): void {
  if (outcome === 'unknown') return;
  counts.games += 1;
  if (outcome === 'win') counts.wins += 1;
  else if (outcome === 'draw') counts.draws += 1;
  else counts.losses += 1;
}

/** Points scored as a percentage (win 1, draw 0.5), or null without finished games. */
export function scorePercent(counts: ResultCounts): number | null {
  if (counts.games === 0) return null;
  return ((counts.wins + counts.draws / 2) / counts.games) * 100;
}

/** Arithmetic mean, or null for an empty list. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Trailing moving average: each value is the mean of itself and up to `window - 1` values
 * before it, so the line starts at the first point instead of `window` points in.
 */
export function movingAverage(values: readonly number[], window: number): number[] {
  const size = Math.max(1, Math.floor(window));
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= size) sum -= values[i - size]!;
    result.push(sum / Math.min(i + 1, size));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Part A: game records
// ---------------------------------------------------------------------------

/**
 * The games insights are computed from: standard chess (variants have their own ratings and
 * openings) that the player took part in and that finished. Order is kept (newest first).
 */
export function insightGames(records: readonly GameRecord[], username: string): GameRecord[] {
  return records.filter(
    (record) =>
      record.variant === 'standard' &&
      playerColor(record, username) !== null &&
      outcomeForPlayer(record, username) !== 'unknown',
  );
}

export interface Overview {
  all: ResultCounts;
  white: ResultCounts;
  black: ResultCounts;
}

/** Wins, draws and losses from the player's side, in total and per colour. */
export function overview(records: readonly GameRecord[], username: string): Overview {
  const result: Overview = { all: emptyResults(), white: emptyResults(), black: emptyResults() };
  for (const record of records) {
    const color = playerColor(record, username);
    if (!color) continue;
    const outcome = outcomeForPlayer(record, username);
    addOutcome(result.all, outcome);
    addOutcome(color === 'w' ? result.white : result.black, outcome);
  }
  return result;
}

/** Fastest first, like the filter chips on the games list. */
export const TIME_CLASS_ORDER: readonly TimeClass[] = [
  'ultrabullet',
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'daily',
  'unknown',
];

export interface RatingPoint {
  /** Epoch ms the game ended. */
  time: number;
  rating: number;
  gameId: string;
}

export interface TimeClassStats {
  timeClass: TimeClass;
  results: ResultCounts;
  /** The player's rating in each rated game with a date, oldest first. */
  ratings: RatingPoint[];
}

/** Results and the rating history per time class, fastest class first. */
export function byTimeClass(records: readonly GameRecord[], username: string): TimeClassStats[] {
  const groups = new Map<TimeClass, TimeClassStats>();
  for (const record of records) {
    const color = playerColor(record, username);
    if (!color) continue;
    let group = groups.get(record.timeClass);
    if (!group) {
      group = { timeClass: record.timeClass, results: emptyResults(), ratings: [] };
      groups.set(record.timeClass, group);
    }
    addOutcome(group.results, outcomeForPlayer(record, username));
    const rating = (color === 'w' ? record.white : record.black).rating;
    // Casual games show the rating but do not change it; they would only repeat points.
    if (rating !== undefined && record.endTime !== undefined && record.rated !== false) {
      group.ratings.push({ time: record.endTime, rating, gameId: record.id });
    }
  }
  for (const group of groups.values()) group.ratings.sort((a, b) => a.time - b.time);
  return TIME_CLASS_ORDER.flatMap((tc) => {
    const group = groups.get(tc);
    return group ? [group] : [];
  });
}

/**
 * How a game ended. Decisive endings: checkmate, resignation, time, abandonment.
 * Draw endings: agreement, repetition, stalemate, insufficient material, the fifty-move
 * rule and a timeout against insufficient material. 'other' covers anything else
 * (Lichess, for example, reports a plain "Draw" for agreements and claimed repetitions).
 */
export type Ending =
  | 'checkmate'
  | 'resignation'
  | 'time'
  | 'abandonment'
  | 'agreement'
  | 'repetition'
  | 'stalemate'
  | 'insufficient'
  | 'fifty-move'
  | 'time-vs-insufficient'
  | 'other';

export const ENDING_LABELS: Record<Ending, string> = {
  checkmate: 'Checkmate',
  resignation: 'Resignation',
  time: 'Time',
  abandonment: 'Abandoned',
  agreement: 'Agreement',
  repetition: 'Repetition',
  stalemate: 'Stalemate',
  insufficient: 'Insufficient material',
  'fifty-move': '50-move rule',
  'time-vs-insufficient': 'Timeout vs insufficient material',
  other: 'Other',
};

/**
 * Reads the ending from the record's termination text. Both sources describe it in
 * English: Chess.com's PGN Termination tag ("Hikaru won on time", "Game drawn by
 * repetition") and the descriptions Kibitz builds for Lichess ("Draw by stalemate").
 */
export function endingOf(record: GameRecord): Ending {
  const full = (record.termination ?? '').toLowerCase();
  // Only the words after "<winner> won" describe the ending: a name such as "CheckMate99"
  // or "TimeLord" must not count. Usernames have no spaces on either site.
  const won = full.lastIndexOf(' won');
  const text = won === -1 ? full : full.slice(won + ' won'.length);
  if (record.result === '1/2-1/2') {
    if (/agree/.test(text)) return 'agreement';
    if (/repetition/.test(text)) return 'repetition';
    if (/stalemate/.test(text)) return 'stalemate';
    if (/time/.test(text) && /insufficient/.test(text)) return 'time-vs-insufficient';
    if (/insufficient/.test(text)) return 'insufficient';
    if (/50|fifty/.test(text)) return 'fifty-move';
    return 'other';
  }
  // Abandonment first: Lichess calls leaving the game a "timeout".
  if (/abandon|left the game|did not move|did not start/.test(text)) return 'abandonment';
  if (/mate/.test(text)) return 'checkmate';
  if (/resign/.test(text)) return 'resignation';
  if (/on time|time forfeit|timeout|flag/.test(text)) return 'time';
  return 'other';
}

export interface EndingRow {
  ending: Ending;
  count: number;
}

export interface EndingStats {
  wins: EndingRow[];
  losses: EndingRow[];
  draws: EndingRow[];
}

/** How the player's games ended, per result, most common ending first. */
export function endingStats(records: readonly GameRecord[], username: string): EndingStats {
  const tallies = { win: new Map<Ending, number>(), loss: new Map(), draw: new Map() } as Record<
    Exclude<PlayerOutcome, 'unknown'>,
    Map<Ending, number>
  >;
  for (const record of records) {
    const outcome = outcomeForPlayer(record, username);
    if (outcome === 'unknown' || playerColor(record, username) === null) continue;
    const ending = endingOf(record);
    tallies[outcome].set(ending, (tallies[outcome].get(ending) ?? 0) + 1);
  }
  const rows = (map: Map<Ending, number>): EndingRow[] =>
    [...map]
      .map(([ending, count]) => ({ ending, count }))
      // 'other' always goes last; it is the least informative row.
      .sort(
        (a, b) => Number(a.ending === 'other') - Number(b.ending === 'other') || b.count - a.count,
      );
  return { wins: rows(tallies.win), losses: rows(tallies.loss), draws: rows(tallies.draw) };
}

/** Family label for games whose opening could not be named. */
export const UNNAMED_OPENING = 'Unnamed opening';

/** "Sicilian Defense: Najdorf Variation, English Attack" → "Sicilian Defense". */
export function openingFamily(name: string): string {
  return (name.split(':')[0] ?? name).trim();
}

/**
 * Family of an opening name that may come from elsewhere than the book. Book names have a
 * ':' after the family; names without one (Chess.com's "Sicilian Defense Najdorf Variation")
 * are matched to the longest known family they start with, so both land in the same row.
 */
export function resolveFamily(
  name: string,
  knownFamilies: ReadonlySet<string> = new Set(),
): string {
  const trimmed = name.trim();
  if (!trimmed) return UNNAMED_OPENING;
  if (trimmed.includes(':')) return openingFamily(trimmed);
  let best: string | null = null;
  for (const family of knownFamilies) {
    if (trimmed !== family && !trimmed.startsWith(`${family} `)) continue;
    if (!best || family.length > best.length) best = family;
  }
  return best ?? trimmed;
}

export interface OpeningRow {
  family: string;
  color: Color;
  results: ResultCounts;
  /** Score %, see scorePercent. */
  score: number;
  /** Mean rating of the opponents in these games, or null when none was rated. */
  opponentRating: number | null;
  /** Newest first, like the input. */
  gameIds: string[];
}

/**
 * Results per opening family, split by the player's colour.
 * @param familyOf the family of a game (see resolveFamily); undefined means unnamed.
 */
export function openingStats(
  records: readonly GameRecord[],
  username: string,
  familyOf: (record: GameRecord) => string | undefined,
): { white: OpeningRow[]; black: OpeningRow[] } {
  const groups = new Map<string, OpeningRow & { ratings: number[] }>();
  for (const record of records) {
    const color = playerColor(record, username);
    const outcome = outcomeForPlayer(record, username);
    if (!color || outcome === 'unknown') continue;
    const family = familyOf(record) || UNNAMED_OPENING;
    const key = `${color}|${family}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        family,
        color,
        results: emptyResults(),
        score: 0,
        opponentRating: null,
        gameIds: [],
        ratings: [],
      };
      groups.set(key, group);
    }
    addOutcome(group.results, outcome);
    group.gameIds.push(record.id);
    const opponent = color === 'w' ? record.black : record.white;
    if (opponent.rating !== undefined) group.ratings.push(opponent.rating);
  }
  const rows = [...groups.values()].map(({ ratings, ...row }) => ({
    ...row,
    score: scorePercent(row.results) ?? 0,
    opponentRating: mean(ratings),
  }));
  const ordered = sortOpeningRows(rows, 'games', 'desc');
  return {
    white: ordered.filter((row) => row.color === 'w'),
    black: ordered.filter((row) => row.color === 'b'),
  };
}

export type OpeningSortKey = 'family' | 'games' | 'score' | 'opponent';
export type SortDirection = 'asc' | 'desc';

/** Sorts opening rows; ties fall back to more games first, then the name. */
export function sortOpeningRows(
  rows: readonly OpeningRow[],
  key: OpeningSortKey,
  direction: SortDirection,
): OpeningRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  const value = (row: OpeningRow): number | string => {
    switch (key) {
      case 'family':
        return row.family.toLowerCase();
      case 'games':
        return row.results.games;
      case 'score':
        return row.score;
      case 'opponent':
        // Unrated rows sort last in both directions.
        return row.opponentRating ?? (direction === 'asc' ? Infinity : -Infinity);
    }
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const primary =
      typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb)
        : (va as number) - (vb as number);
    if (primary !== 0) return primary * sign;
    return b.results.games - a.results.games || a.family.localeCompare(b.family);
  });
}

// ---------------------------------------------------------------------------
// Part B: reviewed games from the library
// ---------------------------------------------------------------------------

/** A reviewed game with the colour the player had in it. */
export interface PlayerEntry {
  entry: LibraryEntry;
  color: Color;
}

/**
 * The player's colour in a library entry: from the saved perspective when it is this
 * player, otherwise from the names (reviews opened without a perspective count too).
 */
export function entryColor(
  entry: Pick<LibraryEntry, 'record' | 'perspective'>,
  platform: Platform,
  username: string,
): Color | null {
  const name = username.trim().toLowerCase();
  const { perspective } = entry;
  if (perspective && perspective.platform === platform && perspective.username === name) {
    return perspective.color;
  }
  if (entry.record.source !== platform) return null;
  return playerColor(entry.record, username);
}

/** The player's reviewed games, oldest first (by end time, then review time). */
export function playerEntries(
  entries: readonly LibraryEntry[],
  platform: Platform,
  username: string,
): PlayerEntry[] {
  const result: PlayerEntry[] = [];
  for (const entry of entries) {
    const color = entryColor(entry, platform, username);
    if (color && entry.moves.some((move) => move.color === color)) result.push({ entry, color });
  }
  const time = (e: LibraryEntry) => e.record.endTime ?? e.reviewedAt;
  return result.sort(
    (a, b) => time(a.entry) - time(b.entry) || a.entry.reviewedAt - b.entry.reviewedAt,
  );
}

const other = (color: Color): Color => (color === 'w' ? 'b' : 'w');

/** Win / draw / loss for whoever played `color`. */
export function outcomeForColor(record: GameRecord, color: Color): PlayerOutcome {
  if (record.result === '1/2-1/2') return 'draw';
  if (record.result === '*') return 'unknown';
  return (record.result === '1-0') === (color === 'w') ? 'win' : 'loss';
}
const sideReview = (entry: LibraryEntry, color: Color) =>
  color === 'w' ? entry.white : entry.black;

export interface AccuracyPoint {
  gameId: string;
  entry: LibraryEntry;
  color: Color;
  accuracy: number;
  opponentAccuracy: number | null;
  /** Moving average of `accuracy` up to and including this game. */
  average: number;
}

/** Game accuracy per reviewed game (oldest first) with a trailing moving average. */
export function accuracyTrend(entries: readonly PlayerEntry[], window = 5): AccuracyPoint[] {
  const averages = movingAverage(
    entries.map(({ entry, color }) => sideReview(entry, color).accuracy),
    window,
  );
  return entries.map(({ entry, color }, index) => {
    const opponentMoved = entry.moves.some((move) => move.color === other(color));
    return {
      gameId: entry.gameId,
      entry,
      color,
      accuracy: sideReview(entry, color).accuracy,
      opponentAccuracy: opponentMoved ? sideReview(entry, other(color)).accuracy : null,
      average: averages[index]!,
    };
  });
}

/** Labels compared between the player and their opponents. */
export const TRACKED_LABELS = [
  'brilliant',
  'great',
  'inaccuracy',
  'mistake',
  'blunder',
  'missedWin',
] as const satisfies readonly Classification[];

export type TrackedLabel = (typeof TRACKED_LABELS)[number];

export interface LabelRate {
  label: TrackedLabel;
  /** Total over all games. */
  you: number;
  opponents: number;
  /** Per game. */
  youPerGame: number;
  opponentsPerGame: number;
}

/** How often the player and their opponents got each tracked label, per game. */
export function labelRates(entries: readonly PlayerEntry[]): LabelRate[] {
  const games = Math.max(1, entries.length);
  return TRACKED_LABELS.map((label) => {
    let you = 0;
    let opponents = 0;
    for (const { entry, color } of entries) {
      you += sideReview(entry, color).counts[label] ?? 0;
      opponents += sideReview(entry, other(color)).counts[label] ?? 0;
    }
    return { label, you, opponents, youPerGame: you / games, opponentsPerGame: opponents / games };
  });
}

export type Phase = 'opening' | 'middlegame' | 'endgame';
export const PHASES: readonly Phase[] = ['opening', 'middlegame', 'endgame'];

/** A side's first this-many moves count as the opening (also outside the book). */
export const OPENING_MOVES = 12;
/** Endgame once the non-pawn, non-king material of both sides together is at most this. */
export const ENDGAME_MATERIAL = 13;

/** Knights, bishops, rooks and queens of both sides in pawn units (3, 3, 5, 9). */
export function nonPawnMaterial(fen: string): number {
  const placement = fen.split(' ')[0] ?? '';
  let total = 0;
  for (const char of placement.toLowerCase()) {
    if (char === 'n' || char === 'b' || char === 'r' || char === 'q') total += PIECE_VALUES[char];
  }
  return total;
}

/**
 * The phase of a move, decided in this order (documented on the insights page):
 * 1. Opening: a book move, or one of the side's first OPENING_MOVES moves.
 * 2. Endgame: before the move, the knights, bishops, rooks and queens of both sides add up
 *    to at most ENDGAME_MATERIAL pawn units (a rook and minor piece each, or less).
 * 3. Middlegame: everything else.
 * @param sideMoveNumber 1 for the side's first move in the game, 2 for its second, ...
 */
export function phaseOf(move: LibraryMove, sideMoveNumber: number): Phase {
  if (move.classification === 'book' || sideMoveNumber <= OPENING_MOVES) return 'opening';
  if (move.fenBefore && nonPawnMaterial(move.fenBefore) <= ENDGAME_MATERIAL) return 'endgame';
  return 'middlegame';
}

export interface PhaseStat {
  /** Mean move accuracy, or null without moves. */
  accuracy: number | null;
  moves: number;
}

export type PhaseAccuracy = Record<Phase, { you: PhaseStat; opponents: PhaseStat }>;

/**
 * Accuracy per phase: the mean of the move accuracies (on the entries' accuracy scale) over
 * the moves played in that phase (a plain mean, unlike game accuracy, so phases of any
 * length compare).
 */
export function phaseAccuracy(entries: readonly PlayerEntry[]): PhaseAccuracy {
  const sums = Object.fromEntries(
    PHASES.map((phase) => [phase, { you: [] as number[], opponents: [] as number[] }]),
  ) as Record<Phase, { you: number[]; opponents: number[] }>;
  for (const { entry, color } of entries) {
    const moveNumbers: Record<Color, number> = { w: 0, b: 0 };
    for (const move of entry.moves) {
      moveNumbers[move.color] += 1;
      const phase = phaseOf(move, moveNumbers[move.color]);
      sums[phase][move.color === color ? 'you' : 'opponents'].push(move.accuracy);
    }
  }
  const stat = (values: number[]): PhaseStat => ({ accuracy: mean(values), moves: values.length });
  return Object.fromEntries(
    PHASES.map((phase) => [
      phase,
      { you: stat(sums[phase].you), opponents: stat(sums[phase].opponents) },
    ]),
  ) as PhaseAccuracy;
}

/**
 * Starting clock in seconds from a time control: "180+2" → 180, "600" → 600.
 * Null for daily games ("1/86400") and unknown controls, where the clock is not a factor.
 */
export function baseTimeSeconds(timeControl: string | undefined): number | null {
  if (!timeControl || timeControl.includes('/')) return null;
  const base = Number(timeControl.split('+')[0]);
  return Number.isFinite(base) && base > 0 ? base : null;
}

/** Below this share of the starting clock a player is in time trouble. */
export const TIME_TROUBLE_SHARE = 0.1;

/** Labels that count as errors for the time-trouble comparison. */
const ERROR_LABELS: ReadonlySet<Classification> = new Set(['mistake', 'blunder', 'missedWin']);

export interface TimeTroubleStats {
  /** Reviewed games with a real-time clock and clock data for the player. */
  games: number;
  /** Games in which the player made at least one move in time trouble. */
  gamesInTrouble: number;
  /** Player moves with a known clock. */
  moves: number;
  troubleMoves: number;
  /** Mistakes, blunders and misses made in time trouble / with time to spare. */
  troubleErrors: number;
  calmErrors: number;
  /** Errors per 100 moves, or null without moves in that state. */
  troubleRate: number | null;
  calmRate: number | null;
}

/**
 * Mistakes made in time trouble, from the clock comments in the PGN. A move counts as played
 * in time trouble when the clock after it (the time the player had left when they moved)
 * is below TIME_TROUBLE_SHARE of the starting time. Misses count as errors too: each
 * one let a real chance slip.
 */
export function timeTrouble(entries: readonly PlayerEntry[]): TimeTroubleStats {
  const stats: TimeTroubleStats = {
    games: 0,
    gamesInTrouble: 0,
    moves: 0,
    troubleMoves: 0,
    troubleErrors: 0,
    calmErrors: 0,
    troubleRate: null,
    calmRate: null,
  };
  for (const { entry, color } of entries) {
    const base = baseTimeSeconds(entry.record.timeControl);
    if (base === null) continue;
    const moves = entry.moves.filter((move) => move.color === color && move.clock !== undefined);
    if (moves.length === 0) continue;
    stats.games += 1;
    let inTrouble = false;
    for (const move of moves) {
      const trouble = move.clock! < base * TIME_TROUBLE_SHARE;
      const error = ERROR_LABELS.has(move.classification);
      stats.moves += 1;
      if (trouble) {
        inTrouble = true;
        stats.troubleMoves += 1;
        if (error) stats.troubleErrors += 1;
      } else if (error) {
        stats.calmErrors += 1;
      }
    }
    if (inTrouble) stats.gamesInTrouble += 1;
  }
  const calmMoves = stats.moves - stats.troubleMoves;
  stats.troubleRate =
    stats.troubleMoves > 0 ? (stats.troubleErrors / stats.troubleMoves) * 100 : null;
  stats.calmRate = calmMoves > 0 ? (stats.calmErrors / calmMoves) * 100 : null;
  return stats;
}

export interface OpeningCost {
  family: string;
  games: number;
  /** Mean game accuracy of the player in these games. */
  accuracy: number;
  score: number;
  results: ResultCounts;
}

/**
 * Accuracy and score per opening family over the reviewed games, lowest accuracy first
 * (ties: more games first). The name is the review's book opening when there is one.
 */
export function openingCosts(
  entries: readonly PlayerEntry[],
  knownFamilies: ReadonlySet<string> = new Set(),
): OpeningCost[] {
  const groups = new Map<string, { accuracies: number[]; results: ResultCounts }>();
  for (const { entry, color } of entries) {
    const name = entry.opening?.name ?? entry.record.openingName ?? '';
    const family = resolveFamily(name, knownFamilies);
    let group = groups.get(family);
    if (!group) {
      group = { accuracies: [], results: emptyResults() };
      groups.set(family, group);
    }
    group.accuracies.push(sideReview(entry, color).accuracy);
    addOutcome(group.results, outcomeForColor(entry.record, color));
  }
  return [...groups]
    .map(([family, group]) => ({
      family,
      games: group.accuracies.length,
      accuracy: mean(group.accuracies) ?? 0,
      score: scorePercent(group.results) ?? 0,
      results: group.results,
    }))
    .sort((a, b) => a.accuracy - b.accuracy || b.games - a.games);
}

/** Labels a costly move can have; Best/Book/... moves can show search noise, not errors. */
const MISTAKE_LABELS: ReadonlySet<Classification> = new Set([
  'inaccuracy',
  'mistake',
  'blunder',
  'missedWin',
]);

export interface CostlyMove {
  entry: LibraryEntry;
  color: Color;
  move: LibraryMove;
}

/** The player's moves that lost the most win %, biggest first. */
export function biggestMistakes(entries: readonly PlayerEntry[], limit = 10): CostlyMove[] {
  const moves: CostlyMove[] = [];
  for (const { entry, color } of entries) {
    for (const move of entry.moves) {
      if (move.color === color && MISTAKE_LABELS.has(move.classification)) {
        moves.push({ entry, color, move });
      }
    }
  }
  return moves
    .sort(
      (a, b) =>
        b.move.winLoss - a.move.winLoss ||
        (b.entry.record.endTime ?? 0) - (a.entry.record.endTime ?? 0) ||
        a.move.ply - b.move.ply,
    )
    .slice(0, limit);
}

/** Accuracy of the player in one reviewed game. */
export function entryAccuracy({ entry, color }: PlayerEntry): number {
  return sideReview(entry, color).accuracy;
}
