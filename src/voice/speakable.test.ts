import { describe, expect, it } from 'vitest';
import { moveNarration, sanToSpeech, textToSpeech } from './speakable';

describe('sanToSpeech', () => {
  it.each([
    ['e4', 'e4'],
    ['exd5', 'e takes d5'],
    ['Nf3', 'Knight f3'],
    ['Bxg8', 'Bishop takes g8'],
    ['Qh5+', 'Queen h5 check'],
    ['Nf6+', 'Knight f6 check'],
    ['Rd8#', 'Rook d8 checkmate'],
    ['O-O', 'castling kingside'],
    ['O-O-O+', 'castling queenside check'],
    ['e8=Q', 'e8 promoting to a queen'],
    ['dxe8=N+', 'd takes e8 promoting to a knight check'],
    ['Nbd7', 'Knight b d7'],
    ['R1e2', 'Rook 1 e2'],
    ['Qb8+!!', 'Queen b8 check'],
    ['Kxf7', 'King takes f7'],
    ['Kxh7', 'King takes h7'],
  ])('%s → %s', (san, spoken) => {
    expect(sanToSpeech(san)).toBe(spoken);
  });

  it('leaves non-SAN text alone', () => {
    expect(sanToSpeech('hello')).toBe('hello');
    expect(sanToSpeech('Best')).toBe('Best');
  });
});

describe('textToSpeech', () => {
  it('replaces moves inside sentences without touching ordinary words', () => {
    expect(
      textToSpeech('This hangs your rook on g8: Bxg8 wins it. Best was Rxg7, which wins a pawn.'),
    ).toBe(
      'This hangs your rook on g8: Bishop takes g8 wins it. Best was Rook takes g7, which wins a pawn.',
    );
    expect(textToSpeech('After exf5 you are down a piece.')).toBe(
      'After e takes f5 you are down a piece.',
    );
  });

  it('reads a story with a sacrifice and a fork naturally', () => {
    expect(
      textToSpeech("After Kxh7, Nf6+ forks your opponent's king and queen and wins the queen."),
    ).toBe(
      "After King takes h7, Knight f6 check forks your opponent's king and queen and wins the queen.",
    );
  });

  it('reads mates, results and move numbers', () => {
    expect(textToSpeech('You had a forced mate in 5, starting with Bxc4.')).toBe(
      'You had a forced mate in 5, starting with Bishop takes c4.',
    );
    expect(textToSpeech('The game ended 1-0.')).toBe('The game ended White wins.');
    expect(textToSpeech('Final score 0-1, then 1/2-1/2 and ½-½.')).toBe(
      'Final score Black wins, then a draw and a draw.',
    );
    expect(textToSpeech('The engine says M3, or #-2 for the other side.')).toBe(
      'The engine says mate in 3, or mate in 2 for the other side.',
    );
    expect(textToSpeech('31. Rg8 hangs the rook; 12... Nf6 was better.')).toBe(
      'Rook g8 hangs the rook; Knight f6 was better.',
    );
  });

  it('does not say a mate or a promotion twice', () => {
    expect(textToSpeech('You sacrifice the queen on b8: after Nxb8, Rd8# is checkmate.')).toBe(
      'You sacrifice the queen on b8: after Knight takes b8, Rook d8 is checkmate.',
    );
    expect(textToSpeech('Your opponent replies e8=Q+ and makes a new queen.')).toBe(
      'Your opponent replies e8 check and makes a new queen.',
    );
    expect(textToSpeech('Best was e8=Q.')).toBe('Best was e8 promoting to a queen.');
  });

  it('pauses between moves of a line', () => {
    expect(textToSpeech('After Ra1+ Kg2, Bxg8 wins your undefended rook on g8.')).toBe(
      'After Rook a1 check, King g2, Bishop takes g8 wins your undefended rook on g8.',
    );
    expect(textToSpeech('about 2.5 pawns')).toBe('about 2.5 pawns');
  });

  it('turns caption dashes into pauses', () => {
    expect(textToSpeech('31... Bxg8 — takes the rook')).toBe('Bishop takes g8, takes the rook');
  });

  it('reads percentages and signed numbers', () => {
    expect(textToSpeech('Winning chances dropped from 90% to 68%.')).toBe(
      'Winning chances dropped from 90 percent to 68 percent.',
    );
    expect(textToSpeech('The eval went from +5.9 to -0.4.')).toBe(
      'The eval went from plus 5.9 to minus 0.4.',
    );
  });
});

describe('moveNarration', () => {
  it('says the verdict once, then the explanation', () => {
    expect(
      moveNarration({
        san: 'Rg8',
        color: 'w',
        classification: 'blunder',
        explanation: 'Blunder. This hangs your rook on g8: Bxg8 wins it. Best was Rxg7.',
      }),
    ).toBe(
      'Rook g8 is a blunder. This hangs your rook on g8: Bishop takes g8 wins it. Best was Rook takes g7.',
    );
  });

  it('tells the story instead of the explanation, then the better move', () => {
    expect(
      moveNarration({
        san: 'Rg8',
        color: 'w',
        classification: 'blunder',
        explanation: 'Blunder. This hangs your rook on g8: Bxg8 wins it. Best was Rxg7.',
        story: 'Your opponent replies Bxg8 and wins your rook for free.',
        bestSan: 'Rxg7',
      }),
    ).toBe(
      'Rook g8 is a blunder. Your opponent replies Bishop takes g8 and wins your rook for free. Best was Rook takes g7.',
    );
  });

  it('tells the idea behind a brilliant move without naming a better one', () => {
    expect(
      moveNarration({
        san: 'Rxh7+',
        color: 'w',
        classification: 'brilliant',
        explanation: 'Brilliant! A rook sacrifice.',
        story: "After Kxh7, Nf6+ forks your opponent's king and queen and wins the queen",
        bestSan: 'Rxh7+',
      }),
    ).toBe(
      "Rook takes h7 check is a brilliant move. After King takes h7, Knight f6 check forks your opponent's king and queen and wins the queen.",
    );
  });

  it('starts with a capital', () => {
    expect(
      moveNarration({ san: 'O-O', color: 'b', classification: 'blunder', explanation: '' }),
    ).toBe('Castling kingside is a blunder.');
  });

  it('handles moves without an explanation', () => {
    expect(moveNarration({ san: 'e4', color: 'w', classification: 'book', explanation: '' })).toBe(
      'E4 is a book move.',
    );
  });

  it.each([
    [
      'best',
      'Best move. Bxg8 wins the undefended rook on g8.',
      'Bishop takes g8 is the best move. Bishop takes g8 wins the undefended rook on g8.',
    ],
    ['best', 'Best move.', 'Bishop takes g8 is the best move.'],
    [
      'excellent',
      "Excellent move. The engine's top choice was d4, but this is almost as strong.",
      "Bishop takes g8 is an excellent move. The engine's top choice was d4, but this is almost as strong.",
    ],
    [
      'great',
      'Great move! This is the only move that keeps you winning.',
      'Bishop takes g8 is a great move. This is the only move that keeps you winning.',
    ],
    ['forced', 'The only legal move.', 'Bishop takes g8 is forced.'],
    [
      'book',
      'Book move. This is the Italian Game.',
      'Bishop takes g8 is a book move. This is the Italian Game.',
    ],
    [
      'missedWin',
      'Miss. You had mate in 1 with Ra8#.',
      'Bishop takes g8 is a miss. You had mate in 1 with Rook a8 checkmate.',
    ],
    [
      'mistake',
      'Mistake. Best was Nd2, keeping the position equal.',
      'Bishop takes g8 is a mistake. Best was Knight d2, keeping the position equal.',
    ],
  ] as const)('does not repeat the label of a %s move', (classification, explanation, said) => {
    expect(moveNarration({ san: 'Bxg8', color: 'b', classification, explanation })).toBe(said);
  });

  it('names a Miss once when it tells the story', () => {
    expect(
      moveNarration({
        san: 'Nd5',
        color: 'w',
        classification: 'missedWin',
        explanation: 'Miss. You missed Nxh4, which wins the undefended queen on h4.',
        story: 'Your opponent replies Qxd5 and wins your knight on d5.',
        bestSan: 'Nxh4',
      }),
    ).toBe(
      'Knight d5 is a miss. Your opponent replies Queen takes d5 and wins your knight on d5. Best was Knight takes h4.',
    );
  });

  it('joins "Good move, though ..." to the verdict', () => {
    expect(
      moveNarration({
        san: 'Nge2',
        color: 'w',
        classification: 'good',
        explanation: 'Good move, though d4 was more precise.',
      }),
    ).toBe('Knight g e2 is a good move, though d4 was more precise.');
    expect(
      moveNarration({ san: 'Nge2', color: 'w', classification: 'good', explanation: 'Good move.' }),
    ).toBe('Knight g e2 is a good move.');
  });
});
