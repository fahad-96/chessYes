import { describe, expect, it } from 'vitest';
import { annotatedPgn, formatPgnClock, formatPgnEval } from './annotatedPgn';
import { parsePgn } from './pgn';
import {
  CLASSIFICATIONS,
  type Classification,
  type GameRecord,
  type GameReview,
  type MoveReview,
  type ParsedGame,
  type Score,
} from './types';

const emptyCounts = () =>
  Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;

const OPERA = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]
[Annotator "Someone \\"quoted\\""]

1. e4 { [%clk 0:03:00] } e5 { [%clk 0:02:59.9] } 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3
5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7
12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0
`;

/** A Black-to-move position: 12... Kh8 13. Qh5 Kg8 14. Qd5+ Kh8 (a FEN start). */
const FEN_START = `[White "A"]
[Black "B"]
[Result "*"]
[SetUp "1"]
[FEN "6k1/5ppp/8/8/8/8/5PPP/3Q2K1 b - - 0 12"]

12... h6 13. Qd8+ Kh7 14. Qd3+ g6 *
`;

function record(game: ParsedGame): GameRecord {
  return {
    id: 'pgn/test',
    source: 'pgn',
    white: { name: game.headers.White ?? 'White' },
    black: { name: game.headers.Black ?? 'Black' },
    result: '1-0',
    timeClass: 'unknown',
    variant: 'standard',
    pgn: '',
  };
}

const LABELS: Classification[] = [
  'book',
  'book',
  'best',
  'brilliant',
  'great',
  'inaccuracy',
  'mistake',
  'blunder',
  'missedWin',
  'excellent',
  'good',
  'forced',
];

function fakeReview(
  game: ParsedGame,
  options: { evals?: (ply: number) => Score | null; reviewed?: number } = {},
): GameReview {
  const evals = options.evals ?? ((ply: number) => ({ type: 'cp', value: ply * 10 - 40 }));
  const moves = game.moves
    .slice(0, options.reviewed ?? game.moves.length)
    .map((move, index): MoveReview => ({
      ply: move.ply,
      color: move.color,
      san: move.san,
      uci: move.uci,
      classification: LABELS[index % LABELS.length]!,
      winBefore: 50,
      winAfter: 50,
      winLoss: 0,
      accuracy: 100,
      evalAfter: evals(move.ply),
      whiteWinAfter: 50,
      best: { uci: 'a1a2', san: 'Qd2', score: { type: 'cp', value: 0 }, pvUci: [], pvSan: [] },
      explanation: '',
    }));
  return {
    version: 2,
    engine: { name: 'Stockfish 19 lite', depth: 18, multiPv: 2 },
    moves,
    white: { accuracy: 90, counts: emptyCounts() },
    black: { accuracy: 80, counts: emptyCounts() },
    whiteWinPercents: [],
    opening: { eco: 'C41', name: 'Philidor Defense', lastBookPly: 2 },
    keyMoments: [],
  };
}

describe('formatPgnEval', () => {
  it('prints pawns with two decimals and mates with #', () => {
    expect(formatPgnEval({ type: 'cp', value: 17 })).toBe('0.17');
    expect(formatPgnEval({ type: 'cp', value: -150 })).toBe('-1.50');
    expect(formatPgnEval({ type: 'cp', value: 0 })).toBe('0.00');
    expect(formatPgnEval({ type: 'mate', value: 3 })).toBe('#3');
    expect(formatPgnEval({ type: 'mate', value: -2 })).toBe('#-2');
  });
});

describe('formatPgnClock', () => {
  it('prints h:mm:ss with tenths only when present', () => {
    expect(formatPgnClock(180)).toBe('0:03:00');
    expect(formatPgnClock(179.9)).toBe('0:02:59.9');
    expect(formatPgnClock(3725)).toBe('1:02:05');
  });
});

describe('annotatedPgn', () => {
  const game = parsePgn(OPERA);
  const pgn = annotatedPgn(game, record(game), fakeReview(game));
  /** Movetext on one line, so expectations do not depend on where lines wrap. */
  const flat = (text: string) => text.replace(/\s+/g, ' ');

  it('keeps the original headers, Seven Tag Roster first', () => {
    const lines = pgn.split('\n');
    expect(lines.slice(0, 7)).toEqual([
      '[Event "Paris Opera"]',
      '[Site "Paris FRA"]',
      '[Date "1858.??.??"]',
      '[Round "?"]',
      '[White "Paul Morphy"]',
      '[Black "Duke Karl / Count Isouard"]',
      '[Result "1-0"]',
    ]);
    expect(pgn).toContain('[Annotator "Someone \\"quoted\\""]');
  });

  it('starts with a comment naming the engine and depth', () => {
    expect(flat(pgn)).toContain('{ Reviewed with Stockfish 19 lite (depth 18) } 1. e4');
  });

  it('adds NAGs, evals, clocks, error notes and the opening name', () => {
    const text = flat(pgn);
    expect(text).toContain('1. e4 { [%eval -0.30] [%clk 0:03:00] }');
    expect(text).toContain('1... e5 { [%eval -0.20] [%clk 0:02:59.9] C41 Philidor Defense }');
    expect(text).toContain('2. Nf3 { [%eval -0.10] }'); // best: no NAG
    expect(text).toContain('2... d6 $3 {'); // brilliant
    expect(text).toContain('3. d4 $1 {'); // great
    expect(text).toContain('3... Bg4 $6 { [%eval 0.20] Inaccuracy. Best was Qd2. }');
    expect(text).toContain('4. dxe5 $2 { [%eval 0.30] Mistake. Best was Qd2. }');
    expect(text).toContain('4... Bxf3 $4 { [%eval 0.40] Blunder. Best was Qd2. }');
    expect(text).toContain('5. Qxf3 { [%eval 0.50] Missed win. Best was Qd2. }');
    expect(text).toContain('5... dxe5 { [%eval 0.60] }'); // excellent: no NAG, no note
    expect(text.trimEnd().endsWith('1-0')).toBe(true);
  });

  it('does not suggest the move that was played', () => {
    const review = fakeReview(game);
    const blunder = review.moves[7]!;
    review.moves[7] = { ...blunder, best: { ...blunder.best!, uci: blunder.uci } };
    expect(flat(annotatedPgn(game, record(game), review))).toContain(
      '4... Bxf3 $4 { [%eval 0.40] Blunder. }',
    );
  });

  it('keeps lines within 80 characters', () => {
    const movetext = pgn.split('\n\n')[1]!;
    for (const line of movetext.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
  });

  it('round-trips through parsePgn', () => {
    const again = parsePgn(pgn);
    expect(again.moves.map((m) => m.san)).toEqual(game.moves.map((m) => m.san));
    expect(again.initialFen).toBe(game.initialFen);
    expect(again.moves.map((m) => m.clock)).toEqual(game.moves.map((m) => m.clock));
    expect(again.headers).toEqual({ ...game.headers, Round: '?' });
    expect(again.finalState).toBe('checkmate');
  });

  it('writes mates and leaves out the eval once the game is over', () => {
    const mates = annotatedPgn(
      game,
      record(game),
      fakeReview(game, {
        evals: (ply) =>
          ply === game.moves.length ? null : { type: 'mate', value: ply % 2 ? 2 : -3 },
      }),
    );
    expect(mates).toContain('[%eval #2]');
    expect(mates).toContain('[%eval #-3]');
    expect(flat(mates)).toMatch(/17\. Rd8# (\$\d )?(\{ (?![^}]*%eval)[^}]*\} )?1-0/);
  });

  it('writes moves without a review plainly', () => {
    const partial = annotatedPgn(game, record(game), fakeReview(game, { reviewed: 2 }));
    expect(flat(partial)).toContain('2. Nf3 d6 3. d4 Bg4');
    expect(parsePgn(partial).moves).toHaveLength(game.moves.length);
  });

  it('numbers a game that starts from a FEN with Black to move', () => {
    const fenGame = parsePgn(FEN_START);
    const fenPgn = annotatedPgn(fenGame, record(fenGame), fakeReview(fenGame));
    expect(fenPgn).toContain('[SetUp "1"]');
    expect(fenPgn).toContain('[FEN "6k1/5ppp/8/8/8/8/5PPP/3Q2K1 b - - 0 12"]');
    expect(flat(fenPgn)).toContain('} 12... h6 {');
    expect(flat(fenPgn)).toContain('} 13. Qd8+ {');
    expect(flat(fenPgn)).toContain('} 13... Kh7 {');
    expect(fenPgn.trimEnd().endsWith('*')).toBe(true);
    const again = parsePgn(fenPgn);
    expect(again.initialFen).toBe(fenGame.initialFen);
    expect(again.moves.map((m) => [m.moveNumber, m.color, m.san])).toEqual(
      fenGame.moves.map((m) => [m.moveNumber, m.color, m.san]),
    );
  });

  it('adds SetUp and FEN when a FEN start has no header', () => {
    const fenGame = parsePgn(FEN_START);
    const { FEN: _fen, SetUp: _setUp, ...headers } = fenGame.headers;
    const stripped: ParsedGame = { ...fenGame, headers };
    const again = parsePgn(annotatedPgn(stripped, record(stripped), fakeReview(stripped)));
    expect(again.initialFen).toBe(fenGame.initialFen);
    expect(again.moves.map((m) => m.san)).toEqual(fenGame.moves.map((m) => m.san));
  });

  it('drops braces from comment text', () => {
    const review = fakeReview(game);
    review.opening = { eco: '', name: 'Odd {name}', lastBookPly: 1 };
    const odd = annotatedPgn(game, record(game), review);
    expect(odd).toContain('Odd name }');
    expect(parsePgn(odd).moves).toHaveLength(game.moves.length);
  });
});

describe('annotatedPgn with lines and stories', () => {
  const game = parsePgn(OPERA);
  const flat = (text: string) => text.replace(/\s+/g, ' ');

  /** 4. dxe5 (a mistake) with the engine's 4. Nc3 line, and 4... Bxf3 (a blunder) with a story. */
  function storyReview(): GameReview {
    const review = fakeReview(game);
    const mistake = review.moves[6]!;
    review.moves[6] = {
      ...mistake,
      best: {
        uci: 'b1c3',
        san: 'Nc3',
        score: { type: 'cp', value: 50 },
        pvUci: ['b1c3', 'g8f6', 'h2h3', 'g4h5', 'f1c4', 'b8c6', 'e1g1'],
        pvSan: ['Nc3', 'Nf6', 'h3', 'Bh5', 'Bc4', 'Nc6', 'O-O'],
      },
    };
    const blunder = review.moves[7]!;
    review.moves[7] = {
      ...blunder,
      best: {
        uci: 'd6e5',
        san: 'dxe5',
        score: { type: 'cp', value: 0 },
        pvUci: ['d6e5', 'd1d8', 'e8d8'],
        pvSan: ['dxe5', 'Qxd8+', 'Kxd8'],
      },
      why: {
        kind: 'refutation',
        fen: game.moves[7]!.fenAfter,
        movesUci: ['d1f3'],
        movesSan: ['Qxf3'],
        motifs: [],
        materialSwing: -3,
        text: 'Your opponent takes back with Qxf3 and keeps {an extra} pawn.',
      },
      bestIdea: {
        kind: 'missed',
        fen: game.moves[7]!.fenBefore,
        movesUci: ['d6e5', 'd1d8', 'e8d8'],
        movesSan: ['dxe5', 'Qxd8+', 'Kxd8'],
        motifs: [],
        materialSwing: 0,
        text: 'You missed dxe5, which trades queens and keeps the material level.',
      },
    };
    return review;
  }

  const pgn = annotatedPgn(game, record(game), storyReview());

  it('writes the better line as a variation after an error', () => {
    expect(flat(pgn)).toContain(
      '4. dxe5 $2 { [%eval 0.30] Mistake. Best was Nc3. } (4. Nc3 Nf6 5. h3 Bh5 6. Bc4 Nc6) 4... Bxf3',
    );
  });

  it('adds the story of the move and of the better move', () => {
    expect(flat(pgn)).toContain(
      '4... Bxf3 $4 { [%eval 0.40] Blunder. Best was dxe5. Your opponent takes back with Qxf3 and keeps an extra pawn. } (4... dxe5 5. Qxd8+ Kxd8 { You missed dxe5, which trades queens and keeps the material level. }) 5. Qxf3',
    );
  });

  it('keeps lines within 80 characters and [%eval] commands whole', () => {
    const movetext = pgn.split('\n\n')[1]!;
    for (const line of movetext.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(80);
      expect(line).not.toMatch(/\[%eval$/);
    }
  });

  it('still round-trips through parsePgn', () => {
    const again = parsePgn(pgn);
    expect(again.moves.map((m) => m.san)).toEqual(game.moves.map((m) => m.san));
    expect(again.moves.map((m) => m.clock)).toEqual(game.moves.map((m) => m.clock));
    expect(again.finalState).toBe('checkmate');
  });
});
