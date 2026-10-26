import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lichessGame, LICHESS_GAME, LICHESS_PGN } from './__fixtures__/lichess';
import { NotFoundError, RateLimitError, resetQueuesForTests } from './http';
import {
  fetchLichessGame,
  fetchLichessGames,
  fetchLichessProfile,
  mapLichessGame,
  parseNdjson,
} from './lichess';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ndjson = (games: unknown[]) =>
  new Response(games.map((game) => JSON.stringify(game) + '\n').join(''), {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetQueuesForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('parseNdjson', () => {
  it('parses one value per line, ignoring blank lines and a trailing newline', () => {
    expect(parseNdjson('{"a":1}\n\n{"b":2}\r\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns nothing for an empty body', () => {
    expect(parseNdjson('')).toEqual([]);
    expect(parseNdjson('\n')).toEqual([]);
  });

  it('skips a truncated line', () => {
    expect(parseNdjson('{"a":1}\n{"b":')).toEqual([{ a: 1 }]);
  });
});

describe('mapLichessGame', () => {
  it('maps a real game', () => {
    expect(mapLichessGame(LICHESS_GAME)).toEqual({
      id: 'lichess/HqjDTU4A',
      source: 'lichess',
      url: 'https://lichess.org/HqjDTU4A',
      white: { name: 'DrNykterstein', rating: 3177, title: 'GM' },
      black: { name: 'Night-King96', rating: 2848, title: 'GM' },
      result: '1-0',
      termination: 'DrNykterstein won by resignation',
      timeClass: 'blitz',
      timeControl: '180+0',
      rated: true,
      endTime: 1792001402854,
      startTime: 1792001046539,
      eco: 'A50',
      openingName: "Queen's Indian Accelerated",
      variant: 'standard',
      pgn: LICHESS_PGN,
    });
  });

  it('names anonymous and AI players', () => {
    const record = mapLichessGame(
      lichessGame({ players: { white: {}, black: { aiLevel: 3 } }, winner: 'black' }),
    );
    expect(record.white).toEqual({ name: 'Anonymous' });
    expect(record.black).toEqual({ name: 'Stockfish level 3' });
    expect(record.termination).toBe('Stockfish level 3 won by resignation');
  });

  it('survives missing optional fields', () => {
    const record = mapLichessGame({ id: 'abcdefgh', pgn: '1. e4 e5 *' });
    expect(record).toMatchObject({
      id: 'lichess/abcdefgh',
      white: { name: 'Anonymous' },
      black: { name: 'Anonymous' },
      result: '*',
      timeClass: 'unknown',
      variant: 'standard',
      pgn: '1. e4 e5 *',
    });
    expect(record.timeControl).toBeUndefined();
    expect(record.endTime).toBeUndefined();
    expect(record.startTime).toBeUndefined();
  });

  it.each([
    ['mate', 'black', '0-1', 'Night-King96 won by checkmate'],
    ['resign', 'white', '1-0', 'DrNykterstein won by resignation'],
    ['stalemate', undefined, '1/2-1/2', 'Draw by stalemate'],
    ['draw', undefined, '1/2-1/2', 'Draw'],
    ['outoftime', 'black', '0-1', 'Night-King96 won on time'],
    ['outoftime', undefined, '1/2-1/2', 'Draw (timeout vs insufficient material)'],
    ['timeout', 'white', '1-0', 'DrNykterstein won (opponent left the game)'],
    ['cheat', 'white', '1-0', 'DrNykterstein won (cheat detected)'],
    ['aborted', undefined, '*', 'Game aborted'],
    ['started', undefined, '*', 'Game in progress'],
    ['unknownFinish', undefined, '*', undefined],
  ])('maps status %s (winner %s) to %s', (status, winner, result, termination) => {
    const record = mapLichessGame(lichessGame({ status, winner }));
    expect(record.result).toBe(result);
    expect(record.termination).toBe(termination);
  });

  it('maps speeds to time classes', () => {
    expect(mapLichessGame(lichessGame({ speed: 'ultraBullet' })).timeClass).toBe('ultrabullet');
    expect(mapLichessGame(lichessGame({ speed: 'classical' })).timeClass).toBe('classical');
    expect(mapLichessGame(lichessGame({ speed: 'unheardOf' })).timeClass).toBe('unknown');
  });

  it('writes correspondence time controls like Chess.com daily games', () => {
    const record = mapLichessGame(
      lichessGame({ speed: 'correspondence', clock: undefined, daysPerTurn: 3 }),
    );
    expect(record.timeClass).toBe('daily');
    expect(record.timeControl).toBe('1/259200');
  });

  it('treats fromPosition as standard and keeps other variants', () => {
    expect(mapLichessGame(lichessGame({ variant: 'fromPosition' })).variant).toBe('standard');
    expect(mapLichessGame(lichessGame({ variant: 'chess960' })).variant).toBe('chess960');
    expect(mapLichessGame(lichessGame({ variant: { key: 'crazyhouse' } })).variant).toBe(
      'crazyhouse',
    );
  });

  it('builds a PGN from the move list when the response has none', () => {
    expect(mapLichessGame(lichessGame({ pgn: undefined })).pgn).toBe(
      [
        '[White "DrNykterstein"]',
        '[Black "Night-King96"]',
        '[Result "1-0"]',
        '',
        '1. d4 Nf6 2. c4 b6 1-0',
      ].join('\n'),
    );
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const fromPosition = mapLichessGame(
      lichessGame({ pgn: undefined, moves: 'e5 Nf3', initialFen: fen, variant: 'fromPosition' }),
    );
    expect(fromPosition.pgn).toContain(`[SetUp "1"]\n[FEN "${fen}"]`);
    expect(fromPosition.pgn).toMatch(/1\.\.\. e5 2\. Nf3 1-0$/);
  });

  it('throws on input that is not a game', () => {
    expect(() => mapLichessGame(null)).toThrow();
    expect(() => mapLichessGame({ players: {} })).toThrow();
    expect(() => mapLichessGame({ id: 'abcdefgh' })).toThrow(/no moves/);
  });
});

describe('fetchLichessGames', () => {
  it('requests the ndjson stream and returns games newest first', async () => {
    const older = lichessGame({ id: 'older000', lastMoveAt: 1000 });
    const newer = lichessGame({ id: 'newer000', lastMoveAt: 2000 });
    fetchMock.mockResolvedValue(ndjson([older, 'not a game', newer]));

    const games = await fetchLichessGames('DrNykterstein', { max: 10 });
    expect(games.map((game) => game.id)).toEqual(['lichess/newer000', 'lichess/older000']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://lichess.org/api/games/user/drnykterstein?max=10&pgnInJson=true&clocks=true&opening=true',
    );
    expect(init.headers).toEqual({ Accept: 'application/x-ndjson' });
  });

  it('returns an empty list for an empty stream', async () => {
    fetchMock.mockResolvedValue(new Response(''));
    await expect(fetchLichessGames('newbie')).resolves.toEqual([]);
  });

  it('paginates by start time and keeps games that ended after newer ones', async () => {
    // Lichess applies `until` to start times: a long correspondence game that started
    // before `until` but ended later must still be listed.
    const correspondence = lichessGame({ id: 'corresp0', createdAt: 900, lastMoveAt: 5000 });
    const next = lichessGame({ id: 'next0000', createdAt: 500, lastMoveAt: 800 });
    fetchMock.mockResolvedValue(ndjson([correspondence, next]));

    const games = await fetchLichessGames('user', { max: 2, until: 1000 });
    expect(games.map((game) => [game.id, game.startTime])).toEqual([
      ['lichess/corresp0', 900],
      ['lichess/next0000', 500],
    ]);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get('until')).toBe('1000');
    expect(url.searchParams.get('max')).toBe('2');
  });

  it('waits a full minute after a 429, then gives up after one retry', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response(null, { status: 429 }));
    const assertion = expect(fetchLichessGames('user')).rejects.toBeInstanceOf(RateLimitError);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchLichessGame', () => {
  it('exports one game as JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse(LICHESS_GAME));
    await expect(fetchLichessGame('HqjDTU4A')).resolves.toMatchObject({ id: 'lichess/HqjDTU4A' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://lichess.org/game/export/HqjDTU4A?clocks=true&opening=true&pgnInJson=true',
    );
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('accepts the 12-character player id form', async () => {
    fetchMock.mockResolvedValue(jsonResponse(LICHESS_GAME));
    await fetchLichessGame('HqjDTU4Awxyz');
    expect(fetchMock.mock.calls[0]![0]).toContain('/game/export/HqjDTU4A?');
  });

  it('throws NotFoundError for malformed ids and missing games', async () => {
    await expect(fetchLichessGame('../oops')).rejects.toBeInstanceOf(NotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    await expect(fetchLichessGame('abcdefgh')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('fetchLichessProfile', () => {
  it('maps the profile', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'drnykterstein', username: 'DrNykterstein', title: 'GM' }),
    );
    await expect(fetchLichessProfile('DRNYKTERSTEIN')).resolves.toEqual({
      username: 'DrNykterstein',
      title: 'GM',
      url: 'https://lichess.org/@/DrNykterstein',
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://lichess.org/api/user/drnykterstein');
  });

  it('throws NotFoundError for unknown users', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    await expect(fetchLichessProfile('nobody')).rejects.toBeInstanceOf(NotFoundError);
  });
});
