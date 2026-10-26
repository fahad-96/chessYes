import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCHEDULE,
  clearPuzzleProgress,
  computeStats,
  currentStreak,
  dayKey,
  formatDueIn,
  loadActivity,
  loadProgress,
  nextDueAt,
  pickNextPuzzle,
  pickSoonestPuzzle,
  recordAttempt,
  schedule,
  type PuzzleProgress,
} from './progress';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A Monday morning, local time. */
const START = new Date(2026, 9, 26, 9, 0, 0).getTime();

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs real timers to answer.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  await clearPuzzleProgress();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('schedule', () => {
  it('brings a puzzle back after 1 day, then multiplies the interval by the ease', () => {
    let p = schedule(undefined, 'a', 'solved', START);
    expect(p).toMatchObject({ interval: 1, ease: 2.6, solves: 1, attempts: 1, lapses: 0 });
    expect(p.due).toBe(START + DAY);

    p = schedule(p, 'a', 'solved', p.due);
    expect(p.interval).toBe(3); // 1 × 2.6, rounded
    expect(p.ease).toBe(2.7);
    p = schedule(p, 'a', 'solved', p.due);
    expect(p.interval).toBe(8); // 3 × 2.7
    p = schedule(p, 'a', 'solved', p.due);
    expect(p.interval).toBe(22); // 8 × 2.8
    expect(p).toMatchObject({ solves: 4, attempts: 4 });
  });

  it('caps the ease', () => {
    let p: PuzzleProgress | undefined;
    for (let i = 0; i < 10; i++) p = schedule(p, 'a', 'solved', START);
    expect(p?.ease).toBe(SCHEDULE.maxEase);
  });

  it('brings a miss back in 10 minutes, lowers the ease and starts the interval over', () => {
    const solved = schedule(schedule(undefined, 'a', 'solved', START), 'a', 'solved', START);
    const missed = schedule(solved, 'a', 'failed', START);
    expect(missed).toMatchObject({
      interval: 0,
      ease: 2.5,
      lapses: 1,
      solves: 2,
      attempts: 3,
      lastOutcome: 'failed',
    });
    expect(missed.due).toBe(START + 10 * MINUTE);
    // The next clean solve starts again at one day.
    expect(schedule(missed, 'a', 'solved', START).interval).toBe(1);
  });

  it('never lets the ease fall below the minimum', () => {
    let p: PuzzleProgress | undefined;
    for (let i = 0; i < 10; i++) p = schedule(p, 'a', 'failed', START);
    expect(p?.ease).toBe(SCHEDULE.minEase);
    expect(p?.lapses).toBe(10);
  });
});

describe('storage', () => {
  it('records attempts and reads them back', async () => {
    const saved = await recordAttempt('lichess/x#12', 'solved');
    expect(saved.due).toBe(START + DAY);
    const progress = await loadProgress();
    expect(progress.get('lichess/x#12')).toEqual(saved);
    expect(await loadActivity()).toEqual([dayKey(START)]);
  });

  it('continues from the stored state', async () => {
    await recordAttempt('a#1', 'solved');
    vi.setSystemTime(START + DAY);
    const second = await recordAttempt('a#1', 'solved');
    expect(second).toMatchObject({ interval: 3, attempts: 2 });
    vi.setSystemTime(START + 5 * DAY);
    await recordAttempt('b#1', 'failed');
    expect(await loadActivity()).toEqual([
      dayKey(START),
      dayKey(START + DAY),
      dayKey(START + 5 * DAY),
    ]);
  });

  it('forgets everything on clear', async () => {
    await recordAttempt('a#1', 'failed');
    await clearPuzzleProgress();
    expect((await loadProgress()).size).toBe(0);
    expect(await loadActivity()).toEqual([]);
  });
});

describe('queue', () => {
  const puzzles = [
    { id: 'new1' },
    { id: 'late' },
    { id: 'new2' },
    { id: 'later' },
    { id: 'future' },
  ];
  const progress = new Map<string, PuzzleProgress>([
    ['late', schedule(undefined, 'late', 'failed', START - 2 * DAY)],
    ['later', schedule(undefined, 'later', 'failed', START - DAY)],
    ['future', schedule(undefined, 'future', 'solved', START)],
  ]);

  it('offers due puzzles first (longest overdue first), then new ones in order', () => {
    expect(pickNextPuzzle(puzzles, progress, START)?.id).toBe('late');
    expect(pickNextPuzzle(puzzles, progress, START, new Set(['late']))?.id).toBe('later');
    expect(pickNextPuzzle(puzzles, progress, START, new Set(['late', 'later']))?.id).toBe('new1');
    expect(
      pickNextPuzzle(puzzles, progress, START, new Set(['late', 'later', 'new1', 'new2'])),
    ).toBeNull();
  });

  it('picks the puzzle due soonest when practising ahead', () => {
    const exclude = new Set(['new1', 'new2', 'late', 'later']);
    expect(pickSoonestPuzzle(puzzles, progress, exclude)?.id).toBe('future');
    expect(nextDueAt([{ id: 'future' }], progress)).toBe(START + DAY);
    expect(nextDueAt([], progress)).toBeNull();
  });
});

describe('stats', () => {
  it('counts due, new and solved puzzles and the success rate', () => {
    const progress = new Map<string, PuzzleProgress>();
    const solvedOnce = schedule(undefined, 'a', 'solved', START - 3 * DAY); // due 2 days ago
    progress.set('a', schedule(solvedOnce, 'a', 'failed', START - DAY)); // due again since yesterday
    progress.set('b', schedule(undefined, 'b', 'solved', START)); // due tomorrow
    progress.set('c', schedule(undefined, 'c', 'failed', START)); // due in 10 minutes
    const stats = computeStats([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], progress, []);
    expect(stats).toEqual({
      total: 4,
      dueToday: 3, // a, c and the new d
      fresh: 1,
      solved: 2,
      attempts: 4,
      successRate: 0.5,
      streak: 0,
    });
  });

  it('has no success rate before the first attempt', () => {
    expect(computeStats([{ id: 'a' }], new Map(), []).successRate).toBeNull();
  });

  it('counts the streak in calendar days, ending today or yesterday', () => {
    const days = (offsets: number[]) => offsets.map((d) => dayKey(START - d * DAY));
    expect(currentStreak(days([0, 1, 2]), START)).toBe(3);
    expect(currentStreak(days([1, 2]), START)).toBe(2); // not practised yet today
    expect(currentStreak(days([0, 2, 3]), START)).toBe(1);
    expect(currentStreak(days([2, 3]), START)).toBe(0);
    expect(currentStreak([], START)).toBe(0);
  });
});

describe('formatDueIn', () => {
  it('describes when a puzzle is due', () => {
    expect(formatDueIn(START - 1, START)).toBe('now');
    expect(formatDueIn(START + 10 * MINUTE, START)).toBe('in 10 min');
    expect(formatDueIn(START + 3 * 60 * MINUTE, START)).toBe('in 3 hours');
    expect(formatDueIn(START + DAY, START)).toBe('tomorrow');
    expect(formatDueIn(START + 4 * DAY, START)).toBe('in 4 days');
  });
});
