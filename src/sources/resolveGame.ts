import type { GameRecord } from '@/core/types';

/**
 * Loads a game from its route id (see GameRecord.id), so review URLs can be
 * reloaded and shared:
 * - chesscom/...: fetches that month's archive (cached) and finds the game
 * - lichess/<id>: fetches the single game
 * - pgn/<hash>: reads the locally stored PGN
 * @throws NotFoundError when the game cannot be found.
 */
export function resolveGame(_id: string, _signal?: AbortSignal): Promise<GameRecord> {
  throw new Error('not implemented');
}
