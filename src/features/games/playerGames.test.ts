import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameRecord } from '@/core/types';

// Replace the network calls so these tests cover only paging and caching.
vi.mock('@/sources/chesscom', () => ({
  fetchChessComProfile: vi.fn(),
  fetchChessComArchives: vi.fn(),
  fetchChessComMonth: vi.fn(),
}));
vi.mock('@/sources/lichess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sources/lichess')>()),
  fetchLichessProfile: vi.fn(),
  fetchLichessGames: vi.fn(),
}));

const chesscom = await import('@/sources/chesscom');
const lichess = await import('@/sources/lichess');
const {
  LICHESS_PAGE_SIZE,
  cacheKey,
  classifyLoadError,
  clearCachedList,
  getCachedList,
  loadErrorMessage,
  loadFirstPage,
  loadNextPage,
  setCachedList,
} = await import('./playerGames');

function record(id: string, endTime: number, startTime?: number): GameRecord {
  const game: GameRecord = {
    id,
    source: 'chesscom',
    white: { name: 'hikaru' },
    black: { name: 'opponent' },
    result: '1-0',
    timeClass: 'blitz',
    variant: 'standard',
    pgn: '',
    endTime,
  };
  if (startTime !== undefined) game.startTime = startTime;
  return game;
}

beforeEach(() => {
  vi.mocked(chesscom.fetchChessComProfile).mockReset();
  vi.mocked(chesscom.fetchChessComArchives).mockReset();
  vi.mocked(chesscom.fetchChessComMonth).mockReset();
  vi.mocked(lichess.fetchLichessProfile).mockReset();
  vi.mocked(lichess.fetchLichessGames).mockReset();
});

describe('Chess.com paging', () => {
  it('loads the newest month with games, skipping empty months', async () => {
    vi.mocked(chesscom.fetchChessComProfile).mockResolvedValue({ username: 'hikaru', title: 'GM' });
    vi.mocked(chesscom.fetchChessComArchives).mockResolvedValue([
      { year: 2026, month: 10 },
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
    ]);
    vi.mocked(chesscom.fetchChessComMonth).mockImplementation(async (_u, _y, month) =>
      month === 10 ? [] : [record(`chesscom/hikaru/2026/${month}/1`, month * 1000)],
    );
    const progress: unknown[] = [];

    const data = await loadFirstPage('chesscom', 'Hikaru', undefined, (m) => progress.push(m));

    expect(data.profile).toMatchObject({
      platform: 'chesscom',
      username: 'hikaru',
      title: 'GM',
      url: 'https://www.chess.com/member/hikaru',
    });
    expect(data.games.map((g) => g.id)).toEqual(['chesscom/hikaru/2026/9/1']);
    expect(data.cursor).toMatchObject({ platform: 'chesscom', next: 2 });
    expect(data.hasMore).toBe(true);
    expect(progress).toEqual([{ year: 2026, month: 10 }, { year: 2026, month: 9 }, null]);

    const more = await loadNextPage(data);
    expect(more.games.map((g) => g.id)).toEqual([
      'chesscom/hikaru/2026/9/1',
      'chesscom/hikaru/2026/8/1',
    ]);
    expect(more.hasMore).toBe(false);
    // The input is not mutated.
    expect(data.games).toHaveLength(1);
  });

  it('requests run one after another, never in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const track = <T>(value: T) =>
      new Promise<T>((resolve) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          resolve(value);
        }, 1);
      });
    vi.mocked(chesscom.fetchChessComProfile).mockImplementation(() => track({ username: 'a' }));
    vi.mocked(chesscom.fetchChessComArchives).mockImplementation(() =>
      track([
        { year: 2026, month: 2 },
        { year: 2026, month: 1 },
      ]),
    );
    vi.mocked(chesscom.fetchChessComMonth).mockImplementation(() => track([]));

    const data = await loadFirstPage('chesscom', 'a');

    expect(maxInFlight).toBe(1);
    expect(data.games).toEqual([]);
    expect(data.hasMore).toBe(false);
  });

  it('propagates not-found errors from the profile', async () => {
    const error = Object.assign(new Error('missing'), { name: 'NotFoundError' });
    vi.mocked(chesscom.fetchChessComProfile).mockRejectedValue(error);
    await expect(loadFirstPage('chesscom', 'nobody')).rejects.toBe(error);
    expect(chesscom.fetchChessComArchives).not.toHaveBeenCalled();
  });
});

describe('Lichess paging', () => {
  // Each game starts 5 ms before it ends.
  const page = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) => {
      const endTime = 100_000 - (start + i) * 10;
      return record(`lichess/g${start + i}`, endTime, endTime - 5);
    });

  it('pages with until = oldest start time - 1', async () => {
    vi.mocked(lichess.fetchLichessProfile).mockResolvedValue({ username: 'DrNykterstein' });
    vi.mocked(lichess.fetchLichessGames).mockResolvedValueOnce(page(0, LICHESS_PAGE_SIZE));

    const first = await loadFirstPage('lichess', 'drnykterstein');
    expect(first.profile.url).toBe('https://lichess.org/@/DrNykterstein');
    expect(lichess.fetchLichessGames).toHaveBeenLastCalledWith('DrNykterstein', {
      max: LICHESS_PAGE_SIZE,
      until: undefined,
      signal: undefined,
    });
    expect(first.hasMore).toBe(true);

    vi.mocked(lichess.fetchLichessGames).mockResolvedValueOnce(page(29, 5));
    const second = await loadNextPage(first);
    const oldestStart = 100_000 - 29 * 10 - 5;
    expect(vi.mocked(lichess.fetchLichessGames).mock.calls[1]?.[1]?.until).toBe(oldestStart - 1);
    // g29 overlapped and is not duplicated; a short page means we reached the end.
    expect(second.games).toHaveLength(LICHESS_PAGE_SIZE + 4);
    expect(second.hasMore).toBe(false);
  });

  it('falls back to end times for records without a start time', async () => {
    vi.mocked(lichess.fetchLichessProfile).mockResolvedValue({ username: 'x' });
    const noStarts = page(0, LICHESS_PAGE_SIZE).map(({ startTime: _start, ...game }) => game);
    vi.mocked(lichess.fetchLichessGames).mockResolvedValueOnce(noStarts);
    const first = await loadFirstPage('lichess', 'x');
    expect(first.cursor).toEqual({ platform: 'lichess', until: 100_000 - 29 * 10 - 1 });
  });

  it('stops when a full page adds nothing new', async () => {
    vi.mocked(lichess.fetchLichessProfile).mockResolvedValue({ username: 'x' });
    vi.mocked(lichess.fetchLichessGames).mockResolvedValue(page(0, LICHESS_PAGE_SIZE));
    const first = await loadFirstPage('lichess', 'x');
    const second = await loadNextPage(first);
    expect(second.games).toHaveLength(LICHESS_PAGE_SIZE);
    expect(second.hasMore).toBe(false);
  });
});

describe('cache', () => {
  it('is keyed by platform and case-insensitive username', async () => {
    vi.mocked(lichess.fetchLichessProfile).mockResolvedValue({ username: 'x' });
    vi.mocked(lichess.fetchLichessGames).mockResolvedValue([]);
    const data = await loadFirstPage('lichess', 'x');
    expect(cacheKey('lichess', ' AbC ')).toBe('lichess:abc');
    setCachedList('lichess', 'Thibault', data);
    expect(getCachedList('lichess', 'thibault')).toBe(data);
    expect(getCachedList('chesscom', 'thibault')).toBeUndefined();
    clearCachedList('lichess', 'THIBAULT');
    expect(getCachedList('lichess', 'thibault')).toBeUndefined();
  });
});

describe('errors', () => {
  it('classifies errors by name', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name });
    expect(classifyLoadError(named('NotFoundError'))).toBe('not-found');
    expect(classifyLoadError(named('RateLimitError'))).toBe('rate-limit');
    expect(classifyLoadError(named('NetworkError'))).toBe('network');
    expect(classifyLoadError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyLoadError(new Error('boom'))).toBe('other');
    expect(classifyLoadError('weird')).toBe('other');
  });

  it('writes friendly messages', () => {
    expect(loadErrorMessage('rate-limit', 'chesscom')).toBe(
      'Chess.com is rate-limiting requests; try again in a minute.',
    );
    expect(loadErrorMessage('network', 'lichess')).toMatch(/Could not reach Lichess/);
  });
});
