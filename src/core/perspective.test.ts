import { describe, expect, it } from 'vitest';
import { addressOpponent, reviewForViewer } from './perspective';
import type { GameReview, LineStory, MoveReview } from './types';

describe('addressOpponent', () => {
  it.each([
    // Refutations: the opponent's reply becomes the viewer's.
    [
      'Blunder. This leaves your rook on g8 unprotected: Bxg8 takes it for free. Best was Rxg7, which wins the undefended pawn on g7.',
      'Blunder. This leaves their rook on g8 unprotected: Bxg8 takes it for free. Best was Rxg7, which wins the undefended pawn on g7.',
    ],
    [
      'Your opponent replies Rxg7+, forking your king and bishop, and wins the bishop and a pawn.',
      'You reply Rxg7+, forking their king and bishop, and win the bishop and a pawn.',
    ],
    [
      'Miss. Your opponent replies Rxg7+ and wins your pawn on g7. Best was g5, which keeps your winning chances.',
      'Miss. You reply Rxg7+ and win their pawn on g7. Best was g5, which keeps their winning chances.',
    ],
    ['Your opponent replies e8=Q and makes a new queen.', 'You reply e8=Q and make a new queen.'],
    [
      'Your opponent replies e1=Q and makes a new queen and then wins the exchange.',
      'You reply e1=Q and make a new queen and then win the exchange.',
    ],
    [
      'Your opponent replies Bxb7 and wins your undefended pawn on b7 and then the exchange.',
      'You reply Bxb7 and win their undefended pawn on b7 and then the exchange.',
    ],
    [
      'Mistake. Your pawn on b3 is still hanging: Bxb3 takes it for free and then wins a pawn.',
      'Mistake. Their pawn on b3 is still hanging: Bxb3 takes it for free and then wins a pawn.',
    ],
    [
      'After f8=Q and a few more moves, your opponent comes out a queen ahead.',
      'After f8=Q and a few more moves, you come out a queen ahead.',
    ],
    [
      'Blunder. After Ba3 and a few more moves, Bxe8 wins your undefended rook on e8.',
      'Blunder. After Ba3 and a few more moves, Bxe8 wins their undefended rook on e8.',
    ],
    [
      'After Kxh7, Nf6+ forks your king and queen and wins the queen.',
      'After Kxh7, Nf6+ forks their king and queen and wins the queen.',
    ],
    [
      'Your opponent sacrifices the rook on h7: after Kxh7, Nf6+ forks your king and queen and wins the queen.',
      'You sacrifice the rook on h7: after Kxh7, Nf6+ forks their king and queen and wins the queen.',
    ],
    [
      'Your opponent sacrifices the rook on h7, and a few moves later Qh5 pins your knight to your queen and wins the knight.',
      'You sacrifice the rook on h7, and a few moves later Qh5 pins their knight to their queen and wins the knight.',
    ],
    ["Your opponent's best reply is Nc6.", 'Your best reply is Nc6.'],
    [
      'After Nxe5 Nxe5, your opponent comes out a piece ahead.',
      'After Nxe5 Nxe5, you come out a piece ahead.',
    ],
    [
      'After Qxd8 Rxd8, your opponent wins the queen for a rook.',
      'After Qxd8 Rxd8, you win the queen for a rook.',
    ],
    ['This allows mate in 1 with Qh7#.', 'This allows mate in 1 with Qh7#.'],
    // Misses and ideas: the mover becomes "your opponent".
    [
      'Blunder. You had a forced mate in 9, starting with Bxc4.',
      'Blunder. Your opponent had a forced mate in 9, starting with Bxc4.',
    ],
    [
      'You missed Rxg7+, which forks the king and bishop and wins the bishop and a pawn.',
      'Your opponent missed Rxg7+, which forks the king and bishop and wins the bishop and a pawn.',
    ],
    [
      'Brilliant! You sacrifice the queen on b8: after Nxb8, Rd8# is checkmate.',
      'Brilliant! Your opponent sacrifices the queen on b8: after Nxb8, Rd8# is checkmate.',
    ],
    [
      'You sacrifice the rook on h7 and force mate in 3: Kxh7 Qh5+ Kg8 Qh8#.',
      'Your opponent sacrifices the rook on h7 and forces mate in 3: Kxh7 Qh5+ Kg8 Qh8#.',
    ],
    [
      'Brilliant! You offer your knight on f5. Your opponent does best not to take it, and you are clearly better.',
      'Brilliant! Your opponent offers their knight on f5. You do best not to take it, and your opponent is clearly better.',
    ],
    [
      'Great move! Nf6+ forks the king and queen and wins the queen. It is the only move that keeps you winning.',
      'Great move! Nf6+ forks the king and queen and wins the queen. It is the only move that keeps your opponent winning.',
    ],
    [
      'Great move! This is the only move that keeps your advantage. After Qd2 instead, you would be only slightly better.',
      'Great move! This is the only move that keeps their advantage. After Qd2 instead, your opponent would be only slightly better.',
    ],
    // How the evaluation moved.
    [
      'Mistake. Your opponent was slightly better; now they are clearly better. Best was O-O, the toughest defense.',
      'Mistake. You were slightly better; now you are clearly better. Best was O-O, the toughest defense.',
    ],
    [
      'Inaccuracy. You were clearly better, but now you are only slightly better.',
      'Inaccuracy. Your opponent was clearly better, but now your opponent is only slightly better.',
    ],
    [
      'Mistake. The position was equal, but now your opponent is clearly better.',
      'Mistake. The position was equal, but now you are clearly better.',
    ],
    [
      'Inaccuracy. You are still clearly better, but this gives away part of your edge.',
      'Inaccuracy. Your opponent is still clearly better, but this gives away part of their edge.',
    ],
    [
      'Inaccuracy. Your opponent is still slightly better, and this makes defending harder.',
      'Inaccuracy. You are still slightly better, and this makes it harder for them to defend.',
    ],
    [
      'Miss. You let the chance slip, and now the position is equal.',
      'Miss. Your opponent let the chance slip, and now the position is equal.',
    ],
    [
      'This stalemates your opponent, so the game is a draw.',
      'This stalemates you, so the game is a draw.',
    ],
    ['This loses your queen after Bb5+.', 'This loses their queen after Bb5+.'],
    ['Checkmate! Well played.', 'Checkmate.'],
    // Nothing to rewrite.
    ['Good move, though e5 was more precise.', 'Good move, though e5 was more precise.'],
    [
      'Book move. This is the Scandinavian Defense.',
      'Book move. This is the Scandinavian Defense.',
    ],
    ['', ''],
  ])('%s', (text, expected) => {
    expect(addressOpponent(text)).toBe(expected);
  });
});

function story(text: string): LineStory {
  return {
    kind: 'refutation',
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
    movesUci: [],
    movesSan: [],
    motifs: [],
    materialSwing: 0,
    text,
  };
}

function move(ply: number, explanation: string, why?: LineStory): MoveReview {
  const review: MoveReview = {
    ply,
    color: ply % 2 === 1 ? 'w' : 'b',
    san: 'e4',
    uci: 'e2e4',
    classification: 'blunder',
    winBefore: 50,
    winAfter: 20,
    winLoss: 30,
    accuracy: 10,
    evalAfter: null,
    whiteWinAfter: 50,
    explanation,
  };
  if (why) review.why = why;
  return review;
}

describe('reviewForViewer', () => {
  const why = story('This leaves your rook on g8 unprotected: Bxg8 takes it for free.');
  const review = {
    moves: [move(1, 'You missed d4.', why), move(2, 'You missed e5.', why)],
  } as GameReview;

  it('rewrites only the other side’s moves', () => {
    const shown = reviewForViewer(review, 'w');
    expect(shown.moves[0]).toBe(review.moves[0]);
    expect(shown.moves[1]?.explanation).toBe('Your opponent missed e5.');
    expect(shown.moves[1]?.why?.text).toBe(
      'This leaves their rook on g8 unprotected: Bxg8 takes it for free.',
    );
    // The original review is left as it was.
    expect(review.moves[1]?.explanation).toBe('You missed e5.');
  });

  it('keeps a rewritten story stable across rebuilds that reuse it', () => {
    expect(reviewForViewer(review, 'w').moves[1]?.why).toBe(
      reviewForViewer(review, 'w').moves[1]?.why,
    );
  });

  it('returns the review unchanged without a viewer', () => {
    expect(reviewForViewer(review, null)).toBe(review);
  });
});
