import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameRecord } from '@/core/types';
import { fetchChessComMonth } from './chesscom';
import { NotFoundError } from './http';
import { fetchLichessGame } from './lichess';
import { loadPgnGame } from './pgnImport';
import { resolveGame } from './resolveGame';

vi.mock('./chesscom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./chesscom')>()),
  fetchChessComMonth: vi.fn(),
}));
vi.mock('./lichess', () => ({ fetchLichessGame: vi.fn() }));
vi.mock('./pgnImport', () => ({ loadPgnGame: vi.fn() }));

const record = (id: string): GameRecord => ({
  id,
  source: 'pgn',
  white: { name: 'White' },
  black: { name: 'Black' },
  result: '*',
  timeClass: 'unknown',
  variant: 'standard',
  pgn: '1. e4 *',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveGame', () => {
  it('finds a Chess.com game in its monthly archive', async () => {
    const game = record('chesscom/hikaru/2026/10/184727190848');
    vi.mocked(fetchChessComMonth).mockResolvedValue([record('chesscom/hikaru/2026/10/1'), game]);
    const signal = new AbortController().signal;

    await expect(resolveGame('chesscom/Hikaru/2026/10/184727190848', signal)).resolves.toBe(game);
    expect(fetchChessComMonth).toHaveBeenCalledWith('hikaru', 2026, 10, signal);
  });

  it('throws NotFoundError when the game is not in that month', async () => {
    vi.mocked(fetchChessComMonth).mockResolvedValue([record('chesscom/hikaru/2026/10/1')]);
    await expect(resolveGame('chesscom/hikaru/2026/10/2')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects malformed Chess.com ids without a request', async () => {
    await expect(resolveGame('chesscom/hikaru/2026/13/1')).rejects.toBeInstanceOf(NotFoundError);
    expect(fetchChessComMonth).not.toHaveBeenCalled();
  });

  it('fetches Lichess games by id', async () => {
    const game = record('lichess/HqjDTU4A');
    vi.mocked(fetchLichessGame).mockResolvedValue(game);
    await expect(resolveGame('lichess/HqjDTU4A')).resolves.toBe(game);
    expect(fetchLichessGame).toHaveBeenCalledWith('HqjDTU4A', undefined);
  });

  it('propagates NotFoundError from Lichess', async () => {
    vi.mocked(fetchLichessGame).mockRejectedValue(new NotFoundError('gone'));
    await expect(resolveGame('lichess/abcdefgh')).rejects.toBeInstanceOf(NotFoundError);
    await expect(resolveGame('lichess/')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('loads pasted games from storage', async () => {
    const game = record('pgn/abc123');
    vi.mocked(loadPgnGame).mockResolvedValue(game);
    await expect(resolveGame('pgn/abc123')).resolves.toBe(game);
    expect(loadPgnGame).toHaveBeenCalledWith('pgn/abc123');

    vi.mocked(loadPgnGame).mockResolvedValue(null);
    await expect(resolveGame('pgn/missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each(['', 'unknown/123', 'chesscom', 'pgn'])('rejects the id "%s"', async (id) => {
    await expect(resolveGame(id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
