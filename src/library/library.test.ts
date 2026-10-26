import { beforeEach, describe, expect, it } from 'vitest';
import { parsePgn } from '@/core/pgn';
import type { GameRecord, GameReview, MoveReview } from '@/core/types';
import {
  clearLibrary,
  emptyCounts,
  getLibraryEntries,
  getLibraryEntry,
  getPlayerEntries,
  removeFromLibrary,
  saveToLibrary,
  toLibraryEntry,
} from './library';

const PGN = '[White "a"]\n[Black "b"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *';

function record(id: string, endTime: number): GameRecord {
  return {
    id,
    source: 'lichess',
    white: { name: 'a' },
    black: { name: 'b' },
    result: '*',
    timeClass: 'blitz',
    variant: 'standard',
    endTime,
    pgn: PGN,
  };
}

function review(): GameReview {
  const game = parsePgn(PGN);
  const moves: MoveReview[] = game.moves.map((m) => ({
    ply: m.ply,
    color: m.color,
    san: m.san,
    uci: m.uci,
    classification: 'best',
    winBefore: 52.04,
    winAfter: 51.96,
    winLoss: 0.08,
    accuracy: 100,
    evalAfter: { type: 'cp', value: 20 },
    whiteWinAfter: 52,
    best: {
      uci: m.uci,
      san: m.san,
      score: { type: 'cp', value: 20 },
      pvUci: [m.uci],
      pvSan: [m.san],
    },
    secondBest: {
      uci: 'a2a3',
      san: 'a3',
      score: { type: 'cp', value: -100 },
      pvUci: ['a2a3'],
      pvSan: ['a3'],
    },
    explanation: '',
  }));
  return {
    version: 1,
    engine: { name: 'test', depth: 10, multiPv: 2 },
    moves,
    white: { accuracy: 90, counts: emptyCounts() },
    black: { accuracy: 80, counts: emptyCounts() },
    whiteWinPercents: [50, 52, 52, 52],
    opening: { eco: 'C40', name: "King's Knight Opening", lastBookPly: 3 },
    keyMoments: [],
  };
}

describe('library', () => {
  beforeEach(async () => {
    await clearLibrary();
  });

  it('builds compact entries with the mover-relative second-best win %', () => {
    const entry = toLibraryEntry(record('lichess/x', 1), parsePgn(PGN), review(), {
      platform: 'lichess',
      username: 'a',
      color: 'w',
    });
    expect(entry.moves).toHaveLength(3);
    expect(entry.moves[0]!.fenBefore.startsWith('rnbqkbnr/pppppppp')).toBe(true);
    expect(entry.moves[0]!.winBefore).toBe(52);
    // -1.00 (White POV) is 40.9 % for White and 59.1 % for Black in the Lichess model.
    expect(entry.moves[0]!.winSecondBest).toBeCloseTo(40.9, 1);
    expect(entry.moves[1]!.winSecondBest).toBeCloseTo(59.1, 1);
    expect(entry.opening).toEqual({ eco: 'C40', name: "King's Knight Opening" });
  });

  it('saves, lists newest first, filters by player and removes', async () => {
    const game = parsePgn(PGN);
    await saveToLibrary(toLibraryEntry(record('lichess/old', 1000), game, review()));
    await saveToLibrary(
      toLibraryEntry(record('lichess/new', 2000), game, review(), {
        platform: 'lichess',
        username: 'a',
        color: 'w',
      }),
    );
    expect((await getLibraryEntries()).map((e) => e.gameId)).toEqual([
      'lichess/new',
      'lichess/old',
    ]);
    expect((await getPlayerEntries('lichess', 'A')).map((e) => e.gameId)).toEqual(['lichess/new']);
    expect((await getLibraryEntry('lichess/old'))?.gameId).toBe('lichess/old');
    await removeFromLibrary('lichess/old');
    expect(await getLibraryEntry('lichess/old')).toBeNull();
  });
});
