import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chessComGame, CHESSCOM_GAME } from './__fixtures__/chesscom';
import {
  clearChessComCache,
  fetchChessComArchives,
  fetchChessComMonth,
  fetchChessComProfile,
  mapChessComGame,
  openingNameFromEcoUrl,
  parseArchives,
  parseChessComId,
} from './chesscom';
import { NotFoundError, resetQueuesForTests } from './http';

const API = 'https://api.chess.com/pub';
const NOW = Date.parse('2026-10-26T12:00:00Z');

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

/** URL and cache mode of every fetch call so far. */
const requests = () =>
  fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit).cache ?? 'default']);

beforeEach(async () => {
  resetQueuesForTests();
  await clearChessComCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // Only Date is faked: fake-indexeddb needs the real setImmediate.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('mapChessComGame', () => {
  it('maps a real archive game', () => {
    expect(mapChessComGame(CHESSCOM_GAME, 'hikaru', 2026, 10)).toEqual({
      id: 'chesscom/hikaru/2026/10/184727190848',
      source: 'chesscom',
      url: 'https://www.chess.com/game/live/184727190848',
      white: { name: 'Hikaru', rating: 3451 },
      black: { name: 'mightysmasher', rating: 2864 },
      result: '1-0',
      termination: 'Hikaru won by resignation',
      timeClass: 'blitz',
      timeControl: '180',
      rated: true,
      endTime: 1790978999000,
      eco: 'E62',
      openingName: "King's Indian Defense Fianchetto Karlsbad Panno Uhlmann Szabo System",
      variant: 'standard',
      pgn: CHESSCOM_GAME.pgn,
    });
  });

  it('lowercases the archive username in the id', () => {
    expect(mapChessComGame(CHESSCOM_GAME, ' HiKaRu ', 2026, 3)?.id).toBe(
      'chesscom/hikaru/2026/03/184727190848',
    );
  });

  it.each(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'])(
    'scores %s as a draw',
    (code) => {
      const game = chessComGame({
        white: { username: 'a', rating: 1500, result: code },
        black: { username: 'b', rating: 1500, result: code },
      });
      expect(mapChessComGame(game, 'a', 2026, 10)?.result).toBe('1/2-1/2');
    },
  );

  it('scores a black win', () => {
    const game = chessComGame({
      white: { username: 'a', rating: 1500, result: 'checkmated' },
      black: { username: 'b', rating: 1500, result: 'win' },
    });
    expect(mapChessComGame(game, 'a', 2026, 10)?.result).toBe('0-1');
  });

  it('describes the ending when the PGN has no Termination header', () => {
    const pgn = CHESSCOM_GAME.pgn!.replace(/\[Termination .*\]\n/, '');
    const onTime = chessComGame({
      pgn,
      white: { username: 'Hikaru', rating: 3451, result: 'timeout' },
      black: { username: 'mightysmasher', rating: 2864, result: 'win' },
    });
    expect(mapChessComGame(onTime, 'hikaru', 2026, 10)?.termination).toBe(
      'mightysmasher won on time',
    );
    const drawn = chessComGame({
      pgn,
      white: { username: 'a', rating: 1, result: 'repetition' },
      black: { username: 'b', rating: 1, result: 'repetition' },
    });
    expect(mapChessComGame(drawn, 'a', 2026, 10)?.termination).toBe('Draw by repetition');
  });

  it('takes the id of daily games from /game/daily/<id>', () => {
    const daily = chessComGame({
      url: 'https://www.chess.com/game/daily/987654321',
      time_class: 'daily',
      time_control: '1/86400',
    });
    const record = mapChessComGame(daily, 'hikaru', 2026, 10);
    expect(record?.id).toBe('chesscom/hikaru/2026/10/987654321');
    expect(record?.timeClass).toBe('daily');
    expect(record?.timeControl).toBe('1/86400');
  });

  it('keeps non-standard rules as the variant and unknown time classes as unknown', () => {
    const record = mapChessComGame(
      chessComGame({ rules: 'chess960', time_class: 'classical' }),
      'hikaru',
      2026,
      10,
    );
    expect(record?.variant).toBe('chess960');
    expect(record?.timeClass).toBe('unknown');
  });

  it('returns null for games without a PGN or a usable url', () => {
    expect(mapChessComGame(chessComGame({ pgn: undefined }), 'hikaru', 2026, 10)).toBeNull();
    expect(mapChessComGame(chessComGame({ pgn: '' }), 'hikaru', 2026, 10)).toBeNull();
    expect(mapChessComGame(chessComGame({ url: 'not a url' }), 'hikaru', 2026, 10)).toBeNull();
  });
});

describe('openingNameFromEcoUrl', () => {
  it('cuts the slug at the first move', () => {
    expect(
      openingNameFromEcoUrl(`https://www.chess.com/openings/Sicilian-Defense-Open-2...d6-3.d4`),
    ).toBe('Sicilian Defense Open');
    expect(
      openingNameFromEcoUrl('https://www.chess.com/openings/Caro-Kann-Defense-Advance-Variation'),
    ).toBe('Caro-Kann Defense Advance Variation');
    expect(openingNameFromEcoUrl('https://www.chess.com/openings/Queens-Pawn-Opening')).toBe(
      "Queen's Pawn Opening",
    );
  });

  it('cuts moves that follow the name directly after "..."', () => {
    expect(
      openingNameFromEcoUrl(
        'https://www.chess.com/openings/French-Defense-Chigorin-Variation...6.O-O-Ng6',
      ),
    ).toBe('French Defense Chigorin Variation');
  });

  it('returns undefined without a slug', () => {
    expect(openingNameFromEcoUrl(undefined)).toBeUndefined();
    expect(openingNameFromEcoUrl('https://www.chess.com/game/live/1')).toBeUndefined();
    expect(openingNameFromEcoUrl('https://www.chess.com/openings/1.e4')).toBeUndefined();
  });
});

describe('parseChessComId', () => {
  it('splits an id into its parts', () => {
    expect(parseChessComId('chesscom/hikaru/2026/10/184727190848')).toEqual({
      username: 'hikaru',
      year: 2026,
      month: 10,
      gameId: '184727190848',
    });
    expect(parseChessComId('chesscom/Hikaru/2026/01/1')?.username).toBe('hikaru');
  });

  it.each([
    'chesscom/hikaru/2026/13/1',
    'chesscom/hikaru/2026/00/1',
    'chesscom/hikaru/26/10/1',
    'chesscom/hikaru/2026/10',
    'chesscom/hikaru/2026/10/1/extra',
    'lichess/abcdefgh',
  ])('rejects %s', (id) => {
    expect(parseChessComId(id)).toBeNull();
  });
});

describe('parseArchives', () => {
  it('returns months newest first and skips junk', () => {
    expect(
      parseArchives({
        archives: [
          `${API}/player/hikaru/games/2025/12`,
          `${API}/player/hikaru/games/2026/01`,
          'garbage',
          42,
          `${API}/player/hikaru/games/2026/10`,
        ],
      }),
    ).toEqual([
      { year: 2026, month: 10 },
      { year: 2026, month: 1 },
      { year: 2025, month: 12 },
    ]);
  });

  it('rejects an unexpected shape', () => {
    expect(() => parseArchives({})).toThrow();
  });
});

describe('fetchChessComProfile', () => {
  it('maps the profile, converting joined to ms and keeping the display casing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        username: 'hikaru',
        name: 'Hikaru Nakamura',
        title: 'GM',
        avatar: 'https://images.chesscomfiles.com/avatar.png',
        url: 'https://www.chess.com/member/Hikaru',
        joined: 1389043258,
      }),
    );
    await expect(fetchChessComProfile('HIKARU')).resolves.toEqual({
      username: 'Hikaru',
      name: 'Hikaru Nakamura',
      title: 'GM',
      avatar: 'https://images.chesscomfiles.com/avatar.png',
      url: 'https://www.chess.com/member/Hikaru',
      joined: 1389043258000,
    });
    expect(requests()).toEqual([[`${API}/player/hikaru`, 'default']]);
  });

  it('throws NotFoundError for unknown users', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, message: 'not found' }, 404));
    await expect(fetchChessComProfile('nobody-here')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('fetchChessComArchives', () => {
  it('fetches with revalidation and reuses the list for 60 seconds', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        archives: [`${API}/player/hikaru/games/2026/09`, `${API}/player/hikaru/games/2026/10`],
      }),
    );
    const expected = [
      { year: 2026, month: 10 },
      { year: 2026, month: 9 },
    ];
    await expect(fetchChessComArchives('Hikaru')).resolves.toEqual(expected);
    vi.setSystemTime(NOW + 59_000);
    await expect(fetchChessComArchives('hikaru')).resolves.toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + 61_000);
    await fetchChessComArchives('hikaru');
    expect(requests()).toEqual([
      [`${API}/player/hikaru/games/archives`, 'no-cache'],
      [`${API}/player/hikaru/games/archives`, 'no-cache'],
    ]);
  });
});

describe('fetchChessComMonth', () => {
  const older = chessComGame({ url: 'https://www.chess.com/game/live/1', end_time: 1790000000 });
  const newer = chessComGame({ url: 'https://www.chess.com/game/live/2', end_time: 1790500000 });

  it('maps the games newest first and skips unusable ones', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ games: [older, { url: 'x' }, chessComGame({ pgn: undefined }), newer] }),
    );
    const games = await fetchChessComMonth('Hikaru', 2026, 9);
    expect(games.map((game) => game.id)).toEqual([
      'chesscom/hikaru/2026/09/2',
      'chesscom/hikaru/2026/09/1',
    ]);
    expect(requests()).toEqual([[`${API}/player/hikaru/games/2026/09`, 'default']]);
  });

  it('never refetches a past month once cached, even after a reload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ games: [older] }));
    await fetchChessComMonth('hikaru', 2026, 9);
    vi.setSystemTime(NOW + 30 * 24 * 3600 * 1000);
    await expect(fetchChessComMonth('HIKARU', 2026, 9)).resolves.toHaveLength(1);

    // A fresh module instance has an empty memory cache, so this hit comes from IndexedDB.
    vi.resetModules();
    const reloaded = await import('./chesscom');
    await expect(reloaded.fetchChessComMonth('hikaru', 2026, 9)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the current month for 60 seconds, then revalidates it', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ games: [newer] }));
    await fetchChessComMonth('hikaru', 2026, 10);
    vi.setSystemTime(NOW + 30_000);
    await fetchChessComMonth('hikaru', 2026, 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + 61_000);
    await fetchChessComMonth('hikaru', 2026, 10);
    expect(requests()).toEqual([
      [`${API}/player/hikaru/games/2026/10`, 'no-cache'],
      [`${API}/player/hikaru/games/2026/10`, 'no-cache'],
    ]);
  });

  it('revalidates a month that was cached before it ended', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ games: [older] }));
    await fetchChessComMonth('hikaru', 2026, 10);

    vi.setSystemTime(Date.parse('2026-11-02T00:00:00Z'));
    fetchMock.mockResolvedValueOnce(jsonResponse({ games: [older, newer] }));
    await expect(fetchChessComMonth('hikaru', 2026, 10)).resolves.toHaveLength(2);

    // That download happened after the month ended, so it is final now.
    vi.setSystemTime(Date.parse('2027-01-01T00:00:00Z'));
    await expect(fetchChessComMonth('hikaru', 2026, 10)).resolves.toHaveLength(2);
    expect(requests()).toEqual([
      [`${API}/player/hikaru/games/2026/10`, 'no-cache'],
      [`${API}/player/hikaru/games/2026/10`, 'no-cache'],
    ]);
  });

  it('falls back to stale cached games when the network is down', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ games: [newer] }));
    await fetchChessComMonth('hikaru', 2026, 10);

    vi.setSystemTime(NOW + 120_000);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchChessComMonth('hikaru', 2026, 10)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3); // first load, then a failure and its retry
  });

  it('propagates NotFoundError and rejects invalid months', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'not found' }, 404));
    await expect(fetchChessComMonth('nobody', 2026, 9)).rejects.toBeInstanceOf(NotFoundError);
    await expect(fetchChessComMonth('hikaru', 2026, 13)).rejects.toBeInstanceOf(RangeError);
  });
});
