import { describe, expect, it } from 'vitest';
import { pvToSan } from '@/core/notation';
import { LIBRARY_VERSION, emptyCounts, type LibraryEntry } from '@/library/library';
import { progressLines, summarizeRun } from './trainSummary';

/** 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.d3? (Qxf7# was mate). */
const SCHOLAR = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

function entry(gameId: string, color: 'w' | 'b', withMistake: boolean): LibraryEntry {
  const counts = { ...emptyCounts(), mistake: withMistake ? 1 : 0, blunder: 2 };
  return {
    v: LIBRARY_VERSION,
    gameId,
    record: {
      id: gameId,
      source: 'lichess',
      white: { name: 'me' },
      black: { name: 'Rival' },
      result: '1-0',
      timeClass: 'blitz',
      variant: 'standard',
      pgn: '',
    },
    perspective: { platform: 'lichess', username: 'me', color },
    reviewedAt: 0,
    engine: { name: 'Stockfish', depth: 12, multiPv: 2 },
    accuracyModel: 'calibrated',
    white: { accuracy: 80, counts },
    black: { accuracy: 60, counts },
    moves: withMistake
      ? [
          {
            ply: 7,
            color: 'w',
            san: 'd3',
            uci: 'd2d3',
            fenBefore: SCHOLAR,
            classification: 'missedWin',
            winBefore: 97.5,
            winAfter: 55,
            winLoss: 42.5,
            accuracy: 8.4,
            winSecondBest: 60,
            best: {
              uci: 'h5f7',
              san: 'Qxf7#',
              pvUci: ['h5f7'],
              pvSan: pvToSan(SCHOLAR, ['h5f7']),
            },
          },
        ]
      : [],
  };
}

describe('summarizeRun', () => {
  it('sums up the run’s games from the player’s side and finds the focus', () => {
    const entries = [
      entry('lichess/a', 'w', true),
      entry('lichess/b', 'b', false),
      entry('lichess/c', 'w', true),
    ];
    const summary = summarizeRun(entries, new Set(['lichess/a', 'lichess/b']));
    expect(summary.games).toBe(2);
    expect(summary.accuracy).toBe(70); // 80 as White, 60 as Black
    expect(summary.mistakes).toBe(1);
    expect(summary.blunders).toBe(4);
    expect(summary.puzzles).toBe(1);
    // Mate and missed-win tie: the first theme in order wins.
    expect(summary.focus).toBe('mate');
  });

  it('handles a run with nothing in the library', () => {
    expect(summarizeRun([], new Set(['x']))).toEqual({
      games: 0,
      accuracy: null,
      mistakes: 0,
      blunders: 0,
      puzzles: 0,
      focus: null,
    });
  });
});

describe('progressLines', () => {
  it('starts by reading the games', () => {
    expect(progressLines({ phase: 'loading' })).toEqual(['Reading your game patterns']);
  });

  it('counts the games being analysed', () => {
    expect(
      progressLines({ phase: 'analysing', gameNumber: 3, queued: 10, opponent: 'vs Magnus' }),
    ).toEqual(['Reading your game patterns', 'Analyzing game 3 of 10 · vs Magnus']);
  });

  it('ends with what was found and the focus', () => {
    const summary = {
      games: 10,
      accuracy: 81,
      mistakes: 7,
      blunders: 3,
      puzzles: 12,
      focus: 'defence' as const,
    };
    expect(progressLines({ phase: 'done', summary, focusLabel: 'Defence' })).toEqual([
      'Reading your game patterns',
      '10 of your games analyzed',
      '12 of your mistakes ready to retrain',
      'Session focus: Defence',
    ]);
  });
});
