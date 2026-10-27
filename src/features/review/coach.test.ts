import { describe, expect, it } from 'vitest';
import { parsePgn } from '@/core/pgn';
import {
  CLASSIFICATIONS,
  type Classification,
  type GameReview,
  type MoveReview,
} from '@/core/types';
import { CLIPS } from '@/voice/vocabulary';
import { coachScript, coachSummary } from '@/voice/coachScript';
import {
  introduction,
  moveLabelAt,
  narrationAt,
  storyMovePly,
  storyNarration,
  tourPlies,
  upcomingLines,
} from './coach';
import type { Variation } from './variation';

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

  it('says the coach line of a reviewed move, with its words as text', () => {
    const line = narrationAt(game, reviewed, 4);
    expect(line).toEqual(coachScript(reviewed.moves[3]!));
    expect(line.segments[0]!.key).toBe('move:Nc6');
    expect(line.text).toMatch(/^Knight to c6. .*blunder/);
    expect(line.segments.every((s) => CLIPS.has(s.key))).toBe(true);
  });

  it('says just the move while it is not analysed', () => {
    expect(narrationAt(game, reviewed, 5)).toEqual({
      segments: [{ key: 'move:Bb5' }],
      text: 'Bishop to b5.',
    });
    expect(narrationAt(game, null, 2).text).toBe('e5.');
  });

  it('says nothing at the start', () => {
    expect(narrationAt(game, reviewed, 0)).toEqual({ segments: [], text: '' });
  });

  it('opens with the accuracies once the game is reviewed', () => {
    expect(introduction(reviewed)).toEqual(coachSummary(reviewed));
    expect(typeof introduction(null)).toBe('string');
  });

  it('finds the move a story is about, and its line', () => {
    const story = reviewed.moves[3]!.why!;
    const after: Variation = {
      kind: 'story',
      startPly: 4,
      startFen: story.fen,
      moves: [],
      index: 0,
      story: {
        story,
        player: 'b',
        mover: 'b',
        afterMove: true,
        anchorLabel: '2... Nc6',
        san: 'Nc6',
        classification: 'blunder',
      },
    };
    expect(storyMovePly(after)).toBe(4);
    expect(
      storyMovePly({ ...after, startPly: 3, story: { ...after.story!, afterMove: false } }),
    ).toBe(4);
    expect(storyMovePly(null)).toBeNull();
    expect(storyNarration(game, reviewed, after)).toEqual(narrationAt(game, reviewed, 4));
    expect(upcomingLines(game, reviewed, [5, 6, 13]).map((l) => l.segments[0]!.key)).toEqual([
      'move:Bb5',
      'sq:a6',
    ]);
  });

  it('labels moves and lists the key moments that can be told', () => {
    expect(moveLabelAt(game, 4)).toBe('2... Nc6');
    expect(moveLabelAt(game, 9)).toBe('');
    expect(tourPlies(game, review(reviewed.moves, [2, 4, 6, 40]))).toEqual([2, 4]);
    expect(tourPlies(game, null)).toEqual([]);
  });
});
