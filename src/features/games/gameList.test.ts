import { describe, expect, it } from 'vitest';
import type { GameRecord } from '@/core/types';
import {
  DEFAULT_FILTERS,
  availableTimeClasses,
  filterGames,
  formatMonth,
  groupByMonth,
  isReviewable,
  mergeGames,
  outcomeForPlayer,
  playerColor,
  reviewPath,
  sides,
} from './gameList';

let nextId = 1;
function game(overrides: Partial<GameRecord> = {}): GameRecord {
  const id = nextId++;
  return {
    id: `lichess/game${id}`,
    source: 'lichess',
    white: { name: 'Alice', rating: 1500 },
    black: { name: 'Bob', rating: 1600 },
    result: '1-0',
    timeClass: 'blitz',
    variant: 'standard',
    pgn: '',
    endTime: Date.UTC(2026, 9, 1) - id * 60_000,
    ...overrides,
  };
}

describe('player perspective', () => {
  it('finds the colour case-insensitively', () => {
    const g = game();
    expect(playerColor(g, 'alice')).toBe('w');
    expect(playerColor(g, ' BOB ')).toBe('b');
    expect(playerColor(g, 'carol')).toBeNull();
  });

  it('computes the result for the searched player', () => {
    expect(outcomeForPlayer(game({ result: '1-0' }), 'Alice')).toBe('win');
    expect(outcomeForPlayer(game({ result: '1-0' }), 'Bob')).toBe('loss');
    expect(outcomeForPlayer(game({ result: '0-1' }), 'Bob')).toBe('win');
    expect(outcomeForPlayer(game({ result: '0-1' }), 'alice')).toBe('loss');
    expect(outcomeForPlayer(game({ result: '1/2-1/2' }), 'Alice')).toBe('draw');
    expect(outcomeForPlayer(game({ result: '*' }), 'Alice')).toBe('unknown');
    expect(outcomeForPlayer(game({ result: '1-0' }), 'Carol')).toBe('unknown');
  });

  it('splits the searched player from the opponent', () => {
    const g = game();
    expect(sides(g, 'bob')).toEqual({ me: g.black, opponent: g.white, color: 'b' });
    expect(sides(g, 'alice')).toEqual({ me: g.white, opponent: g.black, color: 'w' });
  });

  it('only allows standard games to be reviewed', () => {
    expect(isReviewable(game())).toBe(true);
    expect(isReviewable(game({ variant: 'chess960' }))).toBe(false);
  });
});

describe('filters', () => {
  const games = [
    game({ timeClass: 'blitz', result: '1-0', black: { name: 'Magnus' } }),
    game({ timeClass: 'bullet', result: '0-1', black: { name: 'Hikaru' } }),
    game({ timeClass: 'rapid', result: '1/2-1/2', black: { name: 'Fabiano' } }),
    game({
      timeClass: 'blitz',
      result: '0-1',
      white: { name: 'Magnus' },
      black: { name: 'Alice' },
    }),
  ];

  it('lists only the time classes present, fastest first', () => {
    expect(availableTimeClasses(games)).toEqual(['bullet', 'blitz', 'rapid']);
    expect(availableTimeClasses([game({ timeClass: 'unknown' })])).toEqual([]);
  });

  it('returns everything with the default filters', () => {
    expect(filterGames(games, 'alice', DEFAULT_FILTERS)).toHaveLength(4);
  });

  it('filters by time class and result', () => {
    expect(filterGames(games, 'alice', { ...DEFAULT_FILTERS, timeClass: 'blitz' })).toHaveLength(2);
    const wins = filterGames(games, 'alice', { ...DEFAULT_FILTERS, result: 'win' });
    expect(wins.map((g) => g.black.name)).toEqual(['Magnus', 'Alice']);
    expect(filterGames(games, 'alice', { ...DEFAULT_FILTERS, result: 'loss' })).toHaveLength(1);
    expect(filterGames(games, 'alice', { ...DEFAULT_FILTERS, result: 'draw' })).toHaveLength(1);
  });

  it('searches the opponent name only', () => {
    const magnus = filterGames(games, 'alice', { ...DEFAULT_FILTERS, opponent: ' magn ' });
    expect(magnus).toHaveLength(2);
    // "ali" matches the searched player herself, never the opponent.
    expect(filterGames(games, 'alice', { ...DEFAULT_FILTERS, opponent: 'ali' })).toHaveLength(0);
  });

  it('combines filters', () => {
    expect(
      filterGames(games, 'alice', { timeClass: 'blitz', result: 'win', opponent: 'magnus' }),
    ).toHaveLength(2);
    expect(
      filterGames(games, 'alice', { timeClass: 'bullet', result: 'loss', opponent: '' }),
    ).toHaveLength(1);
  });
});

describe('mergeGames', () => {
  it('appends new games, drops duplicates and keeps newest first', () => {
    const a = game({ endTime: 3000 });
    const b = game({ endTime: 2000 });
    const c = game({ endTime: 1000 });
    const merged = mergeGames([a, b], [b, c]);
    expect(merged.map((g) => g.id)).toEqual([a.id, b.id, c.id]);
    expect(mergeGames([c], [a]).map((g) => g.id)).toEqual([a.id, c.id]);
  });
});

describe('formatting and routes', () => {
  it('formats months', () => {
    expect(formatMonth(2026, 10)).toBe('October 2026');
    expect(formatMonth(2025, 1)).toBe('January 2025');
  });

  it('groups consecutive games by month', () => {
    const oct = new Date(2026, 9, 15).getTime();
    const sep = new Date(2026, 8, 15).getTime();
    const groups = groupByMonth([
      game({ endTime: oct }),
      game({ endTime: oct - 1000 }),
      game({ endTime: sep }),
      game({ endTime: undefined }),
    ]);
    expect(groups.map((g) => [g.label, g.games.length])).toEqual([
      ['October 2026', 2],
      ['September 2026', 1],
      ['Undated', 1],
    ]);
  });

  it('encodes each id segment but keeps the slashes', () => {
    expect(reviewPath('lichess/HqjDTU4A')).toBe('/review/lichess/HqjDTU4A');
    expect(reviewPath('chesscom/some user/2026/10/123')).toBe(
      '/review/chesscom/some%20user/2026/10/123',
    );
    expect(reviewPath('pgn/a#b?c')).toBe('/review/pgn/a%23b%3Fc');
  });

  it('adds whose game it is and the ply as query parameters', () => {
    expect(reviewPath('lichess/HqjDTU4A', { as: 'DrNykterstein' })).toBe(
      '/review/lichess/HqjDTU4A?as=DrNykterstein',
    );
    expect(reviewPath('chesscom/hikaru/2026/10/1', { as: 'Hikaru', ply: 31 })).toBe(
      '/review/chesscom/hikaru/2026/10/1?as=Hikaru&ply=31',
    );
    expect(reviewPath('lichess/x', { as: '', ply: -1 })).toBe('/review/lichess/x');
  });
});
