import { describe, expect, it } from 'vitest';
import { parsePgn } from '@/core/pgn';
import {
  CLASSIFICATIONS,
  type Classification,
  type GameReview,
  type MoveReview,
} from '@/core/types';
import { moveLabelAt, narrationAt, tourPlies } from './coach';

const game = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');

const emptyCounts = () =>
  Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;

function moveReview(ply: number, overrides: Partial<MoveReview> = {}): MoveReview {
  const move = game.moves[ply - 1]!;
  return {
    ply,
    color: move.color,
    san: move.san,
    uci: move.uci,
    classification: 'best',
    winBefore: 50,
    winAfter: 50,
    winLoss: 0,
    accuracy: 100,
    evalAfter: { type: 'cp', value: 20 },
    whiteWinAfter: 50,
    explanation: '',
    ...overrides,
  };
}

function review(moves: MoveReview[], keyMoments: number[]): GameReview {
  return {
    version: 1,
    engine: { name: 'Stockfish', depth: 18, multiPv: 2 },
    accuracyModel: 'calibrated',
    moves,
    white: { accuracy: 90, counts: emptyCounts() },
    black: { accuracy: 90, counts: emptyCounts() },
    whiteWinPercents: [],
    keyMoments,
  };
}

describe('narrationAt', () => {
  const reviewed = review(
    [
      moveReview(1, { classification: 'book', explanation: 'Book move. King’s Pawn Opening.' }),
      moveReview(2),
      moveReview(3),
      moveReview(4, {
        classification: 'blunder',
        explanation: 'Blunder. This hangs your knight.',
        best: {
          uci: 'd7d6',
          san: 'd6',
          score: { type: 'cp', value: 30 },
          pvUci: ['d7d6'],
          pvSan: ['d6'],
        },
        why: {
          kind: 'refutation',
          fen: game.moves[3]!.fenAfter,
          movesUci: ['f1b5'],
          movesSan: ['Bb5'],
          motifs: [
            {
              type: 'pin',
              step: 0,
              by: 'w',
              square: 'b5',
              targets: ['c6', 'e8'],
              phrase: 'pins the knight to the king',
            },
          ],
          materialSwing: 0,
          text: 'Your opponent replies Bb5 and pins your knight.',
        },
      }),
    ],
    [4],
  );

  it('tells the story of a move and names the better move', () => {
    expect(narrationAt(game, reviewed, 4)).toBe(
      'Knight c6 is a blunder. Your opponent replies Bishop b5 and pins your knight. Best was d6.',
    );
  });

  it('tells the explanation when it already holds the story or the story shows nothing', () => {
    const story = reviewed.moves[3]!.why!;
    const told = review(
      [
        ...reviewed.moves.slice(0, 3),
        {
          ...reviewed.moves[3]!,
          explanation: `Blunder. ${story.text} Best was d6, keeping the balance.`,
        },
      ],
      [4],
    );
    expect(narrationAt(game, told, 4)).toBe(
      'Knight c6 is a blunder. Your opponent replies Bishop b5 and pins your knight. Best was d6, keeping the balance.',
    );
    const plain = review(
      [
        ...reviewed.moves.slice(0, 3),
        {
          ...reviewed.moves[3]!,
          why: { ...story, motifs: [], text: 'Your opponent’s best reply is Bb5.' },
        },
      ],
      [4],
    );
    expect(narrationAt(game, plain, 4)).toBe('Knight c6 is a blunder. This hangs your knight.');
  });

  it('tells what a Miss let go rather than the opponent’s reply', () => {
    const miss = review(
      [
        ...reviewed.moves.slice(0, 3),
        {
          ...reviewed.moves[3]!,
          classification: 'missedWin',
          explanation: 'Miss. You had mate in 6, starting with d6.',
        },
      ],
      [4],
    );
    expect(narrationAt(game, miss, 4)).toBe(
      'Knight c6 is a miss. You had mate in 6, starting with d6.',
    );
  });

  it('falls back to the explanation, then to the move alone', () => {
    expect(narrationAt(game, reviewed, 1)).toBe('E4 is a book move. King’s Pawn Opening.');
    expect(narrationAt(game, reviewed, 5)).toBe('Bishop b5.');
    expect(narrationAt(game, null, 2)).toBe('E5.');
  });

  it('says nothing at the start', () => {
    expect(narrationAt(game, reviewed, 0)).toBe('');
  });

  it('labels moves and lists the key moments that can be told', () => {
    expect(moveLabelAt(game, 4)).toBe('2... Nc6');
    expect(moveLabelAt(game, 9)).toBe('');
    expect(tourPlies(game, review(reviewed.moves, [2, 4, 6, 40]))).toEqual([2, 4]);
    expect(tourPlies(game, null)).toEqual([]);
  });
});
