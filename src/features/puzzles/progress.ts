import { clear, createStore, entries, get, set, type UseStore } from 'idb-keyval';

/**
 * Puzzle practice history and spaced repetition, kept in IndexedDB (store
 * "kibitz-puzzles"). If storage is unavailable (private modes, blocked site data) the
 * history lives in memory for the session instead, and nothing throws.
 *
 * Scheduling is a light version of SM-2 (the algorithm behind most flashcard apps):
 *
 * - A puzzle never tried is due now.
 * - Solved on the first try (no wrong move, no hint): the first time it comes back after
 *   1 day; after that the interval is multiplied by the ease (rounded to whole days), and
 *   the ease grows by 0.1, up to 3. Ease starts at 2.5, so a puzzle you keep solving
 *   returns after 1, 3, 8, 22... days.
 * - A miss (a wrong move, a hint, or showing the solution): due again in 10 minutes, the
 *   ease drops by 0.2 (to at least 1.3), the lapse count grows, and the interval starts
 *   over, so the next clean solve brings it back after 1 day again.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Every tunable number of the schedule. */
export const SCHEDULE = {
  /** Days until a puzzle returns after its first clean solve (or the first after a miss). */
  firstIntervalDays: 1,
  startEase: 2.5,
  easeBonus: 0.1,
  maxEase: 3,
  missPenalty: 0.2,
  minEase: 1.3,
  /** A missed puzzle comes back this soon. */
  retryDelayMs: 10 * MINUTE,
} as const;

/** How an attempt ended: solved cleanly on the first try, or not. */
export type PuzzleOutcome = 'solved' | 'failed';

export interface PuzzleProgress {
  /** Puzzle id (`<gameId>#<ply>`). */
  id: string;
  /** When the puzzle is next due (epoch ms). */
  due: number;
  /** Current interval in days; 0 until the first clean solve and again after a miss. */
  interval: number;
  ease: number;
  attempts: number;
  /** Clean first-try solves. */
  solves: number;
  /** Misses after which the interval started over. */
  lapses: number;
  lastAttempt: number;
  lastOutcome: PuzzleOutcome;
}

/** Computes the next state of a puzzle after an attempt (pure; `now` in epoch ms). */
export function schedule(
  previous: PuzzleProgress | undefined,
  id: string,
  outcome: PuzzleOutcome,
  now: number = Date.now(),
): PuzzleProgress {
  const ease = previous?.ease ?? SCHEDULE.startEase;
  const base = {
    id,
    attempts: (previous?.attempts ?? 0) + 1,
    lastAttempt: now,
    lastOutcome: outcome,
  };
  if (outcome === 'failed') {
    return {
      ...base,
      due: now + SCHEDULE.retryDelayMs,
      interval: 0,
      ease: round2(Math.max(SCHEDULE.minEase, ease - SCHEDULE.missPenalty)),
      solves: previous?.solves ?? 0,
      lapses: (previous?.lapses ?? 0) + 1,
    };
  }
  const previousInterval = previous?.interval ?? 0;
  // The interval grows with the ease the puzzle had before this solve.
  const interval =
    previousInterval <= 0
      ? SCHEDULE.firstIntervalDays
      : Math.max(previousInterval + 1, Math.round(previousInterval * ease));
  return {
    ...base,
    due: now + interval * DAY,
    interval,
    ease: round2(Math.min(SCHEDULE.maxEase, ease + SCHEDULE.easeBonus)),
    solves: (previous?.solves ?? 0) + 1,
    lapses: previous?.lapses ?? 0,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Key of the list of days with practice (for the streak); puzzle ids contain "#". */
const ACTIVITY_KEY = 'activity';
/** Days of activity kept; enough for any streak worth showing. */
const MAX_ACTIVITY_DAYS = 400;

let store: UseStore | undefined;
/** This session's writes, which win over stored values if storage is failing. */
const memory = new Map<string, PuzzleProgress>();
let memoryActivity: string[] | null = null;

function puzzleStore(): UseStore {
  store ??= createStore('kibitz-puzzles', 'progress');
  return store;
}

/** Every puzzle's progress, by puzzle id. Never throws. */
export async function loadProgress(): Promise<Map<string, PuzzleProgress>> {
  const result = new Map<string, PuzzleProgress>();
  try {
    for (const [key, value] of await entries(puzzleStore())) {
      if (typeof key === 'string' && isProgress(value)) result.set(key, value);
    }
  } catch {
    // Storage unavailable: memory only.
  }
  for (const [id, progress] of memory) result.set(id, progress);
  return result;
}

/** Days with practice as local dates ("2026-10-26"), oldest first. Never throws. */
export async function loadActivity(): Promise<string[]> {
  if (memoryActivity) return memoryActivity;
  try {
    const stored: unknown = await get(ACTIVITY_KEY, puzzleStore());
    if (Array.isArray(stored)) return stored.filter((day) => typeof day === 'string');
  } catch {
    // Storage unavailable.
  }
  return [];
}

/**
 * Records an attempt: schedules the puzzle, saves it and marks today as a practice day.
 * Never throws; returns the new progress.
 */
export async function recordAttempt(
  id: string,
  outcome: PuzzleOutcome,
  now: number = Date.now(),
): Promise<PuzzleProgress> {
  let previous = memory.get(id);
  if (!previous) {
    try {
      const stored: unknown = await get(id, puzzleStore());
      if (isProgress(stored)) previous = stored;
    } catch {
      // Storage unavailable: start from scratch.
    }
  }
  const next = schedule(previous, id, outcome, now);
  memory.set(id, next);

  const today = dayKey(now);
  const activity = await loadActivity();
  memoryActivity = activity.includes(today)
    ? activity
    : [...activity, today].slice(-MAX_ACTIVITY_DAYS);
  try {
    await set(id, next, puzzleStore());
    await set(ACTIVITY_KEY, memoryActivity, puzzleStore());
  } catch {
    // Storage unavailable: kept in memory for this session.
  }
  return next;
}

/** Forgets all puzzle progress. Never throws. */
export async function clearPuzzleProgress(): Promise<void> {
  memory.clear();
  memoryActivity = null;
  try {
    await clear(puzzleStore());
  } catch {
    // nothing stored
  }
}

function isProgress(value: unknown): value is PuzzleProgress {
  if (typeof value !== 'object' || value === null) return false;
  const progress = value as Partial<PuzzleProgress>;
  return (
    typeof progress.id === 'string' &&
    typeof progress.due === 'number' &&
    typeof progress.interval === 'number' &&
    typeof progress.ease === 'number'
  );
}

// ---------------------------------------------------------------------------
// Queue and statistics
// ---------------------------------------------------------------------------

/**
 * The puzzle to practise next: puzzles that are due come first (the longest overdue
 * first), then puzzles never tried, in list order. Ids in `exclude` (skipped this
 * session) are left out. Returns null when nothing is due.
 */
export function pickNextPuzzle<T extends { id: string }>(
  puzzles: readonly T[],
  progress: ReadonlyMap<string, PuzzleProgress>,
  now: number = Date.now(),
  exclude: ReadonlySet<string> = new Set(),
): T | null {
  let due: { puzzle: T; at: number } | null = null;
  let fresh: T | null = null;
  for (const puzzle of puzzles) {
    if (exclude.has(puzzle.id)) continue;
    const state = progress.get(puzzle.id);
    if (!state) {
      fresh ??= puzzle;
    } else if (state.due <= now && (!due || state.due < due.at)) {
      due = { puzzle, at: state.due };
    }
  }
  return due?.puzzle ?? fresh;
}

/**
 * For practising ahead when nothing is due: the puzzle that is due soonest, leaving out
 * `exclude` (puzzles already done this session).
 */
export function pickSoonestPuzzle<T extends { id: string }>(
  puzzles: readonly T[],
  progress: ReadonlyMap<string, PuzzleProgress>,
  exclude: ReadonlySet<string> = new Set(),
): T | null {
  let soonest: { puzzle: T; at: number } | null = null;
  for (const puzzle of puzzles) {
    if (exclude.has(puzzle.id)) continue;
    const at = progress.get(puzzle.id)?.due ?? 0;
    if (!soonest || at < soonest.at) soonest = { puzzle, at };
  }
  return soonest?.puzzle ?? null;
}

/** When the next of these puzzles becomes due (epoch ms), or null if there are none. */
export function nextDueAt(
  puzzles: readonly { id: string }[],
  progress: ReadonlyMap<string, PuzzleProgress>,
): number | null {
  let next: number | null = null;
  for (const puzzle of puzzles) {
    const at = progress.get(puzzle.id)?.due ?? 0;
    if (next === null || at < next) next = at;
  }
  return next;
}

export interface PuzzleStats {
  total: number;
  /** Puzzles due by the end of today, new ones included. */
  dueToday: number;
  /** Puzzles never tried. */
  fresh: number;
  /** Puzzles solved cleanly at least once. */
  solved: number;
  attempts: number;
  /** Clean solves per attempt, 0-1; null before the first attempt. */
  successRate: number | null;
  /** Days in a row with practice, ending today (or yesterday, if not practised yet today). */
  streak: number;
}

/** Statistics for a set of puzzles (`activity` comes from loadActivity). */
export function computeStats(
  puzzles: readonly { id: string }[],
  progress: ReadonlyMap<string, PuzzleProgress>,
  activity: readonly string[],
  now: number = Date.now(),
): PuzzleStats {
  const endOfToday = startOfDay(now, 1);
  let dueToday = 0;
  let fresh = 0;
  let solved = 0;
  let attempts = 0;
  let solves = 0;
  for (const puzzle of puzzles) {
    const state = progress.get(puzzle.id);
    if (!state) {
      fresh++;
      dueToday++;
      continue;
    }
    if (state.due < endOfToday) dueToday++;
    if (state.solves > 0) solved++;
    attempts += state.attempts;
    solves += state.solves;
  }
  return {
    total: puzzles.length,
    dueToday,
    fresh,
    solved,
    attempts,
    successRate: attempts > 0 ? solves / attempts : null,
    streak: currentStreak(activity, now),
  };
}

/** Days in a row with practice, ending today or yesterday. */
export function currentStreak(activity: readonly string[], now: number = Date.now()): number {
  const days = new Set(activity);
  const cursor = new Date(now);
  // A streak is not broken until today is over.
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1); // calendar days, so DST changes are harmless
  }
  return streak;
}

/** Local calendar date of a timestamp, e.g. "2026-10-26". */
export function dayKey(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight `offsetDays` days after the day of `epochMs`. */
function startOfDay(epochMs: number, offsetDays = 0): number {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.getTime();
}

/** When something is due, in words: "now", "in 10 min", "in 3 hours", "tomorrow", "in 4 days". */
export function formatDueIn(at: number, now: number = Date.now()): string {
  const diff = at - now;
  if (diff <= 0) return 'now';
  if (diff < 60 * MINUTE) return `in ${Math.max(1, Math.round(diff / MINUTE))} min`;
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY);
  if (diff < 24 * 60 * MINUTE && days === 0) {
    const hours = Math.round(diff / (60 * MINUTE));
    return hours === 1 ? 'in 1 hour' : `in ${hours} hours`;
  }
  if (days <= 1) return 'tomorrow';
  return `in ${days} days`;
}
