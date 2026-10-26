import type { GameRecord } from '@/core/types';
import { fetchChessComMonth, parseChessComId } from './chesscom';
import { NotFoundError } from './http';
import { fetchLichessGame } from './lichess';
import { loadPgnGame } from './pgnImport';

/**
 * Loads a game from its route id (see GameRecord.id), so review URLs can be
 * reloaded and shared:
 * - chesscom/...: fetches that month's archive (cached) and finds the game
 * - lichess/<id>: fetches the single game
 * - pgn/<hash>: reads the locally stored PGN
 * @throws NotFoundError when the game cannot be found.
 */
export async function resolveGame(id: string, signal?: AbortSignal): Promise<GameRecord> {
  const slash = id.indexOf('/');
  const prefix = slash === -1 ? id : id.slice(0, slash);
  const rest = slash === -1 ? '' : id.slice(slash + 1);

  switch (prefix) {
    case 'chesscom': {
      const parts = parseChessComId(id);
      if (!parts) break;
      const { username, year, month, gameId } = parts;
      const games = await fetchChessComMonth(username, year, month, signal);
      // Rebuild the canonical id so a link with different username casing still matches.
      const canonical = `chesscom/${username}/${year}/${String(month).padStart(2, '0')}/${gameId}`;
      const game = games.find((record) => record.id === canonical);
      if (game) return game;
      break;
    }
    case 'lichess':
      if (!rest || rest.includes('/')) break;
      return fetchLichessGame(rest, signal);
    case 'pgn': {
      const game = rest ? await loadPgnGame(id) : null;
      if (game) return game;
      break;
    }
  }
  throw new NotFoundError(`Game not found: ${id}`);
}
