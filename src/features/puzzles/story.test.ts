import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pvToSan } from '@/core/notation';
import type { LineStory, Motif } from '@/core/types';
import type { PuzzleTheme } from './generate';
import { fallbackStory, motifArrows, puzzleStory } from './story';

const describeLine = vi.fn<(...args: unknown[]) => LineStory>();
vi.mock('@/core/tactics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/tactics')>()),
  describeLine: (...args: unknown[]) => describeLine(...args),
}));

/** Royal fork: 30. Ne7+ forks the king on g8 and the queen on c8. */
const FORK = '2q3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 30';
const FORK_LINE = ['d5e7', 'g8f8', 'e7c8', 'f8e8', 'c8b6'];
/** 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? — White mates with Qxf7#. */
const SCHOLAR = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

function puzzle(fen: string, solution: string[], themes: PuzzleTheme[], color: 'w' | 'b' = 'w') {
  return { fen, color, solution, solutionSan: pvToSan(fen, solution), themes };
}

const fork: Motif = {
  type: 'fork',
  step: 0,
  by: 'w',
  square: 'e7',
  targets: ['g8', 'c8'],
  phrase: 'forks the king and queen',
};

function lineStory(overrides: Partial<LineStory> = {}): LineStory {
  return {
    kind: 'idea',
    fen: FORK,
    movesUci: FORK_LINE.slice(0, 3),
    movesSan: pvToSan(FORK, FORK_LINE.slice(0, 3)),
    motifs: [fork],
    materialSwing: 9,
    text: 'Ne7+ forks your opponent’s king and queen and wins the queen.',
    ...overrides,
  };
}

beforeEach(() => {
  describeLine.mockReset();
});

describe('puzzleStory', () => {
  it('tells the tactics story of the solution, for the puzzle’s player', () => {
    describeLine.mockReturnValue(lineStory());
    const story = puzzleStory(puzzle(FORK, FORK_LINE, ['material']));
    expect(describeLine).toHaveBeenCalledWith(FORK, FORK_LINE, { kind: 'idea', player: 'w' });
    expect(story).toEqual({
      text: 'Ne7+ forks your opponent’s king and queen and wins the queen.',
      movesUci: ['d5e7', 'g8f8', 'e7c8'],
      motifs: [fork],
      fallback: false,
    });
  });

  it('tells the tactics module when the opponent’s last move was a capture', () => {
    describeLine.mockReturnValue(lineStory());
    puzzleStory({ ...puzzle(FORK, FORK_LINE, []), lastMove: { uci: 'c5d5', san: 'Nxd5' } });
    expect(describeLine).toHaveBeenLastCalledWith(FORK, FORK_LINE, {
      kind: 'idea',
      player: 'w',
      previousCaptureOn: 'd5',
    });
    puzzleStory({ ...puzzle(FORK, FORK_LINE, []), lastMove: { uci: 'f7f6', san: 'f6' } });
    expect(describeLine).toHaveBeenLastCalledWith(FORK, FORK_LINE, { kind: 'idea', player: 'w' });
  });

  it('counts material from before the opponent’s capture when the solution takes back', () => {
    describeLine.mockReturnValue(lineStory());
    // ...Nxd5 took the knight on d5; exd5 takes back, which wins nothing.
    const fen = '4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1';
    const fenBefore = '4k3/8/5n2/3N4/4P3/8/8/4K3 b - - 0 1';
    const lastMove = { uci: 'f6d5', san: 'Nxd5', fenBefore };
    puzzleStory({ ...puzzle(fen, ['e4d5'], []), lastMove });
    expect(describeLine).toHaveBeenLastCalledWith(fen, ['e4d5'], {
      kind: 'idea',
      player: 'w',
      previousCaptureOn: 'd5',
      startFen: fenBefore,
    });
    // A solution elsewhere counts from the puzzle position.
    puzzleStory({ ...puzzle(fen, ['e1d2'], []), lastMove });
    expect(describeLine).toHaveBeenLastCalledWith(fen, ['e1d2'], {
      kind: 'idea',
      player: 'w',
      previousCaptureOn: 'd5',
    });
  });

  it('keeps only the motifs on the plies it shows', () => {
    const late: Motif = { ...fork, step: 5 };
    describeLine.mockReturnValue(lineStory({ motifs: [fork, late] }));
    expect(puzzleStory(puzzle(FORK, FORK_LINE, [])).motifs).toEqual([fork]);
  });

  it('names the line when the tactics module fails', () => {
    describeLine.mockImplementation(() => {
      throw new Error('tactics failed');
    });
    expect(puzzleStory(puzzle(FORK, FORK_LINE, ['material']))).toEqual({
      text: '30. Ne7+ Kf8 31. Nxc8 Ke8 32. Nb6 wins material.',
      movesUci: FORK_LINE,
      motifs: [],
      fallback: true,
    });
  });

  it('ignores a story that is empty or does not start with the solution', () => {
    describeLine.mockReturnValue(lineStory({ text: '  ' }));
    expect(puzzleStory(puzzle(FORK, FORK_LINE, [])).fallback).toBe(true);
    describeLine.mockReturnValue(lineStory({ movesUci: ['h2h3'] }));
    expect(puzzleStory(puzzle(FORK, FORK_LINE, [])).fallback).toBe(true);
    describeLine.mockReturnValue(lineStory({ movesUci: [] }));
    expect(puzzleStory(puzzle(FORK, FORK_LINE, [])).fallback).toBe(true);
  });
});

describe('fallbackStory', () => {
  it('words the line by theme', () => {
    expect(fallbackStory(puzzle(SCHOLAR, ['h5f7'], ['mate'])).text).toBe('4. Qxf7# is checkmate.');
    const ladder = '7k/8/8/8/8/8/R7/1R4K1 w - - 0 41';
    expect(fallbackStory(puzzle(ladder, ['a2a7', 'h8g8', 'b1b8'], ['mate'])).text).toBe(
      '41. Ra7 Kg8 42. Rb8# ends in checkmate.',
    );
    expect(fallbackStory(puzzle(FORK, ['d5e7', 'g8f8'], ['defence'])).text).toBe(
      'Ne7+ is the move that holds: 30. Ne7+ Kf8.',
    );
    expect(fallbackStory(puzzle(FORK, ['d5e7', 'g8f8'], [])).text).toBe(
      'The best line: 30. Ne7+ Kf8.',
    );
  });

  it('numbers a line that starts with Black', () => {
    const fen = '6k1/5ppp/8/8/8/8/3r1PPP/6K1 b - - 0 25';
    const story = fallbackStory(puzzle(fen, ['d2d8'], [], 'b'));
    expect(story.text).toBe('The best line: 25... Rd8.');
  });

  it('shows up to five plies of a long line, ending on the player’s move', () => {
    const story = fallbackStory(puzzle(FORK, [...FORK_LINE, 'e8d8'], ['material']));
    expect(story.movesUci).toEqual(FORK_LINE);
  });
});

describe('motifArrows', () => {
  it('draws an arrow from the forking piece to each target', () => {
    expect(motifArrows([fork], 0, 'w')).toEqual([
      { from: 'e7', to: 'g8', kind: 'best' },
      { from: 'e7', to: 'c8', kind: 'best' },
    ]);
    expect(motifArrows([fork], 1, 'w')).toEqual([]);
  });

  it('uses the threat colour for the opponent’s tactics', () => {
    expect(motifArrows([fork], 0, 'b').map((arrow) => arrow.kind)).toEqual(['threat', 'threat']);
  });

  it('draws one arrow through a pin or skewer, to the far piece', () => {
    const pin: Motif = {
      type: 'pin',
      step: 2,
      by: 'b',
      square: 'b4',
      targets: ['e1', 'c3'], // the king behind the pinned knight
      phrase: 'pins the knight to the king',
    };
    const skewer: Motif = {
      type: 'skewer',
      step: 2,
      by: 'b',
      square: 'a8',
      targets: ['e8', 'h8'],
      phrase: 'skewers the king and rook',
    };
    expect(motifArrows([pin, skewer], 2, 'b')).toEqual([
      { from: 'b4', to: 'e1', kind: 'best' },
      { from: 'a8', to: 'h8', kind: 'best' },
    ]);
  });

  it('skips duplicate arrows and arrows to the piece’s own square', () => {
    const mate: Motif = {
      type: 'checkmate',
      step: 0,
      by: 'w',
      square: 'e7',
      targets: ['g8', 'e7'],
      phrase: 'checkmate',
    };
    expect(motifArrows([fork, mate], 0, 'w')).toHaveLength(2);
  });
});
