import { describe, expect, it } from 'vitest';
import { describeAdvantage, explainMove } from './explain';
import type { ExplainInput } from './explain';
import { detectSacrifice } from './material';
import { describeLine } from './tactics';
import { fenAfterUci, legalMoveCount, pvToSan, sideToMove, uciToSan } from './notation';
import type { Score, SuggestedLine } from './types';
import { scoreToWinPercent, winPercentFor } from './winPercent';

/*
 * Engine lines below come from Stockfish 19 (lite, depth 16-18, MultiPV 2), converted
 * to White's point of view, so every explanation is checked against real engine data.
 */

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });

/** A SuggestedLine from a FEN and a space-separated UCI principal variation. */
function line(fen: string, pv: string, score: Score): SuggestedLine {
  const pvUci = pv.split(' ');
  const pvSan = pvToSan(fen, pvUci);
  expect(pvSan).toHaveLength(pvUci.length); // guards against typos in the test data
  return { uci: pvUci[0] ?? '', san: pvSan[0] ?? '', score, pvUci, pvSan };
}

type Setup = Partial<ExplainInput> &
  Pick<ExplainInput, 'classification' | 'fenBefore' | 'uci'> & {
    /** Engine continuation after the move (UCI), scored by `evalAfter`. */
    reply?: string;
  };

/** Builds an ExplainInput, deriving SAN, colour, FEN after and win % from the scores. */
function setup({ reply, ...input }: Setup): ExplainInput {
  const color = sideToMove(input.fenBefore);
  const fenAfter = fenAfterUci(input.fenBefore, input.uci);
  const san = uciToSan(input.fenBefore, input.uci);
  if (!fenAfter || !san) throw new Error(`Illegal test move ${input.uci}`);
  const evalAfter = input.evalAfter ?? null;
  const evalBest = input.evalBest ?? input.best?.score ?? null;
  const moverWin = (score: Score | null) =>
    score ? winPercentFor(scoreToWinPercent(score), color) : 50;
  return {
    color,
    san,
    fenAfter,
    winBefore: moverWin(evalBest),
    winAfter: moverWin(evalAfter),
    evalAfter,
    evalBest,
    isCheckmate: false,
    playedLine: reply && evalAfter ? line(fenAfter, reply, evalAfter) : undefined,
    ...input,
  };
}

const AFTER_1E4_E5_2NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
const BEST_2NC6 = line(
  AFTER_1E4_E5_2NF3,
  'b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 d7c6 d1d8 e8d8 b1c3',
  cp(33),
);

/** The Opera Game (Morphy, Paris 1858) before 11.Bxb5+, 13.Rxd7, 16.Qb8+ and 17.Rd8#. */
const OPERA = {
  before11: 'rn2kb1r/p3qppp/5n2/1p2p1B1/2B1P3/1Q6/PPP2PPP/R3K2R w KQkq - 0 11',
  before13: '3rkb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R w k - 3 13',
  before16: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16',
  before17: '1n2kb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 w k - 0 17',
};

describe('describeAdvantage', () => {
  it.each([
    [100, 'White is winning'],
    [85, 'White is winning'],
    [84.9, 'White is clearly better'],
    [65, 'White is clearly better'],
    [64.9, 'White is slightly better'],
    [55, 'White is slightly better'],
    [54.9, 'The position is equal'],
    [50, 'The position is equal'],
    [45.1, 'The position is equal'],
    [45, 'Black is slightly better'],
    [35.1, 'Black is slightly better'],
    [35, 'Black is clearly better'],
    [15.1, 'Black is clearly better'],
    [15, 'Black is winning'],
    [0, 'Black is winning'],
  ])('White at %s reads "%s"', (whiteWin, text) => {
    expect(describeAdvantage(whiteWin)).toBe(text);
  });
});

describe('explainMove: simple labels', () => {
  it('names the opening for book moves', () => {
    const input = setup({
      classification: 'book',
      fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      uci: 'c7c5',
      opening: { eco: 'B20', name: 'Sicilian Defense' },
    });
    expect(explainMove(input)).toBe('Book move. This is the Sicilian Defense.');
    expect(explainMove({ ...input, opening: undefined })).toBe('Book move.');
  });

  it('explains a forced move (16...Nxb8 in the Opera Game)', () => {
    const fenBefore = fenAfterUci(OPERA.before16, 'b3b8') ?? '';
    expect(legalMoveCount(fenBefore)).toBe(1);
    const input = setup({ classification: 'forced', fenBefore, uci: 'd7b8', evalAfter: mate(1) });
    expect(explainMove(input)).toBe('The only legal move.');
  });

  it('celebrates checkmate (17.Rd8#)', () => {
    const input = setup({
      classification: 'best',
      fenBefore: OPERA.before17,
      uci: 'd1d8',
      isCheckmate: true,
    });
    expect(explainMove(input)).toMatch(/^Checkmate!/);
  });

  it('confirms a best move and mentions a forced mate', () => {
    const input = setup({
      classification: 'best',
      fenBefore: OPERA.before16,
      uci: 'b3b8',
      evalAfter: mate(1),
    });
    expect(explainMove(input)).toBe('Best move. Mate follows on the next move.');
    expect(explainMove({ ...input, evalAfter: cp(500) })).toBe('Best move.');
  });

  it('names the engine move for excellent and good moves', () => {
    // 2...Nf6 (Petrov) is a hair behind 2...Nc6 for the engine.
    const excellent = setup({
      classification: 'excellent',
      fenBefore: AFTER_1E4_E5_2NF3,
      uci: 'g8f6',
      best: BEST_2NC6,
      evalAfter: cp(43),
    });
    expect(explainMove(excellent)).toBe(
      "Excellent move. The engine's top choice was Nc6, but this is almost as strong.",
    );
    const good = setup({ ...excellent, classification: 'good', uci: 'd7d6' });
    expect(explainMove(good)).toBe('Good move, though Nc6 was more precise.');
  });
});

describe('explainMove: brilliant and great moves', () => {
  it('explains a queen sacrifice that forces mate (16.Qb8+)', () => {
    const input = setup({
      classification: 'brilliant',
      fenBefore: OPERA.before16,
      uci: 'b3b8',
      evalAfter: mate(1),
      reply: 'd7b8 d1d8',
      sacrifice: detectSacrifice(OPERA.before16, 'b3b8') ?? undefined,
    });
    expect(explainMove(input)).toBe(
      'Brilliant! You sacrifice your queen on b8. Mate follows on the next move.',
    );
  });

  it('names an exchange sacrifice (13.Rxd7)', () => {
    const input = setup({
      classification: 'brilliant',
      fenBefore: OPERA.before13,
      uci: 'd1d7',
      best: line(OPERA.before13, 'd1d7 f6d7 g5e7 f8e7 b5d7 d8d7 b3b8 d7d8 b8b5 e8f8', cp(714)),
      evalAfter: cp(710),
      reply: 'f6d7 g5e7 f8e7 b5d7 d8d7 b3b8 d7d8 b8e5 e8g8 e5e7',
      sacrifice: detectSacrifice(OPERA.before13, 'd1d7') ?? undefined,
    });
    expect(explainMove(input)).toBe(
      'Brilliant! You sacrifice the exchange on d7. It is sound: you are winning.',
    );
  });

  it('notes when the opponent should decline the offer (Légal: 5.Nxe5)', () => {
    // 1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6 5.Nxe5!: Bxd1?? runs into Bxf7+ and Nd5#.
    const fenBefore = 'rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5';
    const input = setup({
      classification: 'brilliant',
      fenBefore,
      uci: 'f3e5',
      best: line(fenBefore, 'f3e5 d6e5 d1g4 b8c6 d2d3 c6d4 g4d1 f8h6 c1h6 g8h6', cp(212)),
      evalAfter: cp(217),
      reply: 'd6e5 d1g4 b8c6 g4g3 f8g7 d2d3 c6d4 e1d1 h7h5 a2a4',
      sacrifice: detectSacrifice(fenBefore, 'f3e5') ?? undefined,
    });
    expect(input.sacrifice).toEqual({ material: 5, square: 'd1', piece: 'q' });
    expect(explainMove(input)).toBe(
      'Brilliant! You offer your queen on d1. ' +
        'Your opponent does best not to take it, and you are clearly better.',
    );
  });

  it('explains an only move and what the alternative allows (Deep Blue - Kasparov: 9.O-O)', () => {
    const fenBefore = 'r1b1kb1r/pp1nqpp1/2p1Nn1p/8/3P4/3B1N2/PPP2PPP/R1BQK2R w KQkq - 1 9';
    const input = setup({
      classification: 'great',
      fenBefore,
      uci: 'e1g1',
      best: line(fenBefore, 'e1g1 f7e6 d3g6 e8d8 c2c4 e7b4 d1c2 b7b5 c4c5 b4c4', cp(148)),
      secondBest: line(fenBefore, 'd4d5 c6d5 e1g1 f7e6 d3g6 e8d8 c2c4 e7d6 c4d5 f6d5', cp(-187)),
      evalAfter: cp(179),
      reply: 'f7e6 d3g6 e8d8 c1f4 f6h7 f4g3 h7g5 f3h4 d7f6 d1d3',
    });
    expect(explainMove(input)).toBe(
      'Great move! This is the only move that keeps your advantage. ' +
        'After d5 instead, your opponent would be clearly better.',
    );
  });

  it('says "only" for a slight edge, not for a clear one', () => {
    // Same position, with the alternative still clearly better for White (+2.0).
    const fenBefore = 'r1b1kb1r/pp1nqpp1/2p1Nn1p/8/3P4/3B1N2/PPP2PPP/R1BQK2R w KQkq - 1 9';
    const input = setup({
      classification: 'great',
      fenBefore,
      uci: 'e1g1',
      best: line(fenBefore, 'e1g1 f7e6 d3g6 e8d8', cp(900)),
      evalAfter: cp(900),
    });
    const after = (score: Score) =>
      explainMove({ ...input, secondBest: line(fenBefore, 'd4d5 c6d5', score) });
    expect(after(cp(200))).toContain('After d5 instead, you would be clearly better.');
    expect(after(cp(60))).toContain('After d5 instead, you would be only slightly better.');
  });

  it('says when the alternative would allow mate', () => {
    // The back-rank position, with Rd7?? hand-picked as the alternative: Rc1+ mates.
    const fenBefore = '2r3k1/p4ppp/8/8/8/8/P4PPP/3R2K1 w - - 0 1';
    const input = setup({
      classification: 'great',
      fenBefore,
      uci: 'g2g3',
      best: line(fenBefore, 'g2g3 g7g6 d1d7 a7a5', cp(22)),
      secondBest: line(fenBefore, 'd1d7 c8c1 d7d1 c1d1', mate(-2)),
      evalAfter: cp(22),
    });
    expect(explainMove(input)).toContain('Rd7 would allow mate in 2.');
  });
});

describe('explainMove: mistakes', () => {
  it('spots a hanging queen (2...Qg5?? 3.Nxg5)', () => {
    const input = setup({
      classification: 'blunder',
      fenBefore: AFTER_1E4_E5_2NF3,
      uci: 'd8g5',
      best: BEST_2NC6,
      evalAfter: cp(872),
      reply: 'f3g5 d7d5 e4d5 g8f6 f1e2 f6d5 e2h5 g7g6 h5f3 d5b4',
    });
    expect(explainMove(input)).toBe(
      'Blunder. This hangs your queen on g5: Nxg5 wins it. Best was Nc6, keeping the position equal.',
    );
  });

  it('does not call a piece traded for a bishop hanging (removing the defender: ...a6?? Bxf6)', () => {
    // Bxf6 gxf6 trades the knight for the bishop; the rook on d5 is what is lost.
    const fenBefore = '1r4k1/p4ppp/5n2/3r2B1/8/8/PPP2PPP/R2R2K1 b - - 0 1';
    const input = setup({
      classification: 'blunder',
      fenBefore,
      uci: 'a7a6',
      best: line(fenBefore, 'd5d1 a1d1 h7h6 g5e3 b8b7', cp(-60)),
      evalAfter: cp(480),
      reply: 'g5f6 g7f6 d1d5 g8g7 g2g3 b8c8',
    });
    expect(explainMove(input)).toBe(
      'Blunder. This loses a rook after Bxf6. Best was Rxd1+, keeping a slight edge.',
    );
  });

  it('names a rook won with a minor piece traded on the way as a rook, not the exchange', () => {
    // White to move after ...a6??: Bxf6 gxf6 Rxd5 wins knight and rook for the bishop.
    const fenBefore = '1r4k1/5ppp/p4n2/3r2B1/8/8/PPP2PPP/R2R2K1 w - - 0 2';
    const input = setup({
      classification: 'mistake',
      fenBefore,
      uci: 'h2h3',
      best: line(fenBefore, 'g5f6 g7f6 d1d5 g8g7 g2g3 b8c8', cp(480)),
      evalAfter: cp(60),
      reply: 'd5d1 a1d1 h7h6 g5e3',
    });
    expect(explainMove(input)).toBe('Mistake. You missed Bxf6, which wins a rook.');
  });

  it('does not blame a pawn that is taken back at once (exd5 cxd5)', () => {
    // Made-up position: after ...Nf6? the line trades on d5 and then takes the loose b-pawn.
    const fenBefore = 'rn1qkbnr/pp2pppp/2p5/3p4/4P3/1Q6/PPPP1PPP/RNB1KBNR b KQkq - 0 1';
    const input = setup({
      classification: 'inaccuracy',
      fenBefore,
      uci: 'g8f6',
      best: line(fenBefore, 'd8c7 e4d5 c6d5 b1c3', cp(30)),
      evalAfter: cp(120),
      reply: 'e4d5 c6d5 b3b7 b8d7 g1f3 e7e6',
    });
    expect(explainMove(input)).toBe(
      'Inaccuracy. This loses a pawn after exd5. Best was Qc7, keeping the position equal.',
    );
  });

  it('reports the material the best move would have won (3.d4? instead of 3.Nxg5)', () => {
    const fenBefore = 'rnb1kbnr/pppp1ppp/8/4p1q1/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const input = setup({
      classification: 'blunder',
      fenBefore,
      uci: 'd2d4',
      best: line(fenBefore, 'f3g5 d7d5 e4d5 g8f6 f1e2 f6d5 e2h5 g7g6 h5f3 d5b4', cp(872)),
      evalAfter: cp(237),
      reply: 'g5g4 d4e5 d7d6 b1c3 d6e5 f3e5 g4d1 e1d1 g8f6 c3b5',
    });
    expect(explainMove(input)).toBe('Blunder. You missed Nxg5, which wins the queen.');
  });

  it('names a mate in 1 that was missed (4.Qh4? instead of 4.Qxf7#)', () => {
    const fenBefore = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const input = setup({
      classification: 'blunder',
      fenBefore,
      uci: 'h5h4',
      best: line(fenBefore, 'h5f7', mate(1)),
      evalAfter: cp(-204),
      reply: 'c6d4 c4b3 a7a5 c2c3 d4b3 a2b3 d7d5 g1f3 d5e4',
    });
    expect(explainMove(input)).toBe('Blunder. You had mate in 1 with Qxf7#.');
  });

  it('warns about allowing a back-rank mate (Rd7?? Rc1+)', () => {
    const fenBefore = '2r3k1/p4ppp/8/8/8/8/P4PPP/3R2K1 w - - 0 1';
    const input = setup({
      classification: 'blunder',
      fenBefore,
      uci: 'd1d7',
      best: line(fenBefore, 'g2g3 g7g6 d1d7 a7a5 d7d5 c8a8 a2a4 g8h8 g1g2 h8g7', cp(22)),
      evalAfter: mate(-2),
      reply: 'c8c1 d7d1 c1d1',
    });
    expect(explainMove(input)).toBe(
      'Blunder. This allows a forced mate in 2, starting with Rc1+. ' +
        'Best was g3, keeping the position equal.',
    );
  });

  it('names a bad trade and what it gives up (Blackburne Shilling: 4.Nxe5? Qg5)', () => {
    const fenBefore = 'r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const input = setup({
      classification: 'mistake',
      fenBefore,
      uci: 'f3e5',
      best: line(fenBefore, 'f3d4 e5d4 e1g1 g8f6 f1e1 d7d6 c2c3 f8e7 c3d4 d6d5', cp(112)),
      evalAfter: cp(-88),
      reply: 'd8g5 c4f7 e8d8 e1g1 g5e5 d2d3 g8h6 f7d5 c7c6 c2c3',
    });
    expect(explainMove(input)).toBe(
      'Mistake. This loses a piece for two pawns after Qg5. Best was Nxd4, keeping a slight edge.',
    );
  });

  it('does not report material the engine line wins back (2...h6? 3.Nxe5 Qe7)', () => {
    const input = setup({
      classification: 'inaccuracy',
      fenBefore: AFTER_1E4_E5_2NF3,
      uci: 'h7h6',
      best: BEST_2NC6,
      evalAfter: cp(138),
      reply: 'f3e5 d8e7 d2d4 d7d6 e5g4 e7e4 g4e3 e4h4 b1c3 h4d8',
    });
    expect(explainMove(input)).toBe(
      'Inaccuracy. The position was equal, but now your opponent is slightly better. ' +
        'Best was Nc6, keeping the position equal.',
    );
  });

  it('says a winning chance was missed (Opera Game: 11.Qxb5+? instead of 11.Bxb5+)', () => {
    const input = setup({
      classification: 'missedWin',
      fenBefore: OPERA.before11,
      uci: 'b3b5',
      best: line(OPERA.before11, 'c4b5 e8d8 e1c1 d8c7 d1d3 e7b4 b3f7 b4e7 d3c3 c7b6', cp(684)),
      evalAfter: cp(50),
      reply: 'e7d7 b5e5 f8e7 a1d1 b8c6 e5f4 d7g4 e4e5 g4f4 g5f4',
    });
    expect(input.winBefore).toBeGreaterThanOrEqual(75);
    expect(explainMove(input)).toBe(
      'Missed win. You let a winning chance slip, and now the position is equal. ' +
        'Best was Bxb5+, which keeps your winning chances.',
    );
  });

  it('explains a stalemate blunder', () => {
    const fenBefore = '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1';
    const input = setup({
      classification: 'blunder',
      fenBefore,
      uci: 'g1g6',
      best: line(fenBefore, 'g1g7', mate(1)),
      winAfter: 50,
    });
    expect(explainMove(input)).toBe(
      'Blunder. This stalemates your opponent, so the game is a draw. ' +
        'Best was Qg7#, which is checkmate.',
    );
  });

  it('falls back to the size of the swing when there is no engine line', () => {
    const input = setup({
      classification: 'mistake',
      fenBefore: AFTER_1E4_E5_2NF3,
      uci: 'h7h6',
      winBefore: 80,
      winAfter: 58,
    });
    expect(explainMove(input)).toBe(
      'Mistake. You were clearly better, but now you are only slightly better.',
    );
  });
});

describe('explainMove: robustness', () => {
  it('never throws on malformed positions or lines', () => {
    const input: ExplainInput = {
      classification: 'blunder',
      color: 'w',
      san: '??',
      uci: 'zz',
      fenBefore: 'not a fen',
      fenAfter: 'not a fen',
      winBefore: 60,
      winAfter: 20,
      evalAfter: cp(-300),
      evalBest: cp(100),
      best: { uci: 'e2e4', san: 'e4', score: cp(100), pvUci: ['e2e4', 'e9e5'], pvSan: ['e4'] },
      playedLine: { uci: 'x', san: 'x', score: cp(-300), pvUci: ['x'], pvSan: [] },
      isCheckmate: false,
    };
    expect(explainMove(input)).toBe(
      'Blunder. You were slightly better, but now your opponent is clearly better. ' +
        'Best was e4, keeping a slight edge.',
    );
  });
});

describe('explainMove: leading with the story of the line', () => {
  /** The user's game fahadkmr - JJose8 (Chess.com, 2026), Stockfish 19 lite lines. */
  const BEFORE_31 = '7R/1R4p1/3k1p1p/4p3/p7/1b4P1/r4P1P/6K1 w - - 2 31';
  const BXG8 = 'b3g8 g1f1 g8c4 f1e1 a4a3 b7a7 d6c5 a7c7 c5b4 c7c8 c4d5 c8b8';
  const RXG7 = 'b7g7 b3d5 h8d8 d6c5 f2f4 d5c6 f4e5 f6e5 d8c8 a2c2 g7g6 c5b6';
  const ROYAL_FORK = 'r5k1/pppq1p1p/6p1/3N4/8/8/PPP2PPP/3Q2K1 w - - 0 1';
  const FORK_LINE = 'd5f6 g8g7 f6d7 a8d8 d7c5 b7b6';

  /** Adds the stories review.ts would attach, from the input's own lines. */
  function withStories(input: ExplainInput, kind: 'error' | 'idea'): ExplainInput {
    const player = input.color;
    if (kind === 'idea') {
      const pv = [input.uci, ...(input.playedLine?.pvUci ?? [])];
      return { ...input, why: describeLine(input.fenBefore, pv, { kind: 'idea', player }) };
    }
    const why = input.playedLine
      ? describeLine(input.fenAfter, input.playedLine.pvUci, {
          kind: 'refutation',
          player,
          reviewedSan: input.san,
          startFen: input.fenBefore,
        })
      : undefined;
    const bestIdea = input.best
      ? describeLine(input.fenBefore, input.best.pvUci, { kind: 'missed', player })
      : undefined;
    return { ...input, why, bestIdea };
  }

  it('shows why 31.Rg8?? is a blunder and what 31.Rxg7 would have won', () => {
    const input = setup({
      classification: 'blunder',
      fenBefore: BEFORE_31,
      uci: 'h8g8',
      best: line(BEFORE_31, RXG7, cp(0)),
      evalAfter: cp(-727),
      reply: BXG8,
    });
    expect(explainMove(withStories(input, 'error'))).toBe(
      'Blunder. This leaves your rook on g8 unprotected: Bxg8 takes it for free. ' +
        'Best was Rxg7, which wins the undefended pawn on g7.',
    );
    // Without the stories the explanation still names the hanging rook.
    expect(explainMove(input)).toBe(
      'Blunder. This hangs your rook on g8: Bxg8 wins it. Best was Rxg7, which wins a pawn.',
    );
  });

  it('names the fork the opponent gets (...c6?? Nc7+)', () => {
    const fenBefore = 'r3k3/ppp2ppp/8/1N6/8/8/PPP2PPP/4K3 b - - 0 1';
    const input = setup({
      classification: 'blunder',
      fenBefore,
      uci: 'c7c6',
      best: line(fenBefore, 'a7a6 b5c3 e8d7', cp(0)),
      evalAfter: cp(450),
      reply: 'b5c7 e8d7 c7a8 d7c8',
    });
    expect(explainMove(withStories(input, 'error'))).toBe(
      'Blunder. Your opponent replies Nc7+, forking your king and rook, and wins the rook. ' +
        'Best was a6, keeping the position equal.',
    );
  });

  it('names the tactic that was missed', () => {
    const input = setup({
      classification: 'mistake',
      fenBefore: ROYAL_FORK,
      uci: 'g2g3',
      best: line(ROYAL_FORK, FORK_LINE, cp(900)),
      evalAfter: cp(80),
      reply: 'd7d6 d5f4 a8e8',
    });
    expect(explainMove(withStories(input, 'error'))).toBe(
      'Mistake. You missed Nf6+, which forks the king and queen and wins the queen.',
    );
  });

  it('spells out a short mate the move allows or misses', () => {
    const fenBefore = '2r3k1/p4ppp/8/8/8/8/P4PPP/3R2K1 w - - 0 1';
    const allows = setup({
      classification: 'blunder',
      fenBefore,
      uci: 'd1d7',
      best: line(fenBefore, 'g2g3 g7g6 d1d7 a7a5', cp(22)),
      evalAfter: mate(-2),
      reply: 'c8c1 d7d1 c1d1',
    });
    expect(explainMove(withStories(allows, 'error'))).toBe(
      'Blunder. This allows a back-rank mate: Rc1+ Rd1 Rxd1#. ' +
        'Best was g3, keeping the position equal.',
    );

    const misses = setup({
      classification: 'blunder',
      fenBefore: OPERA.before16,
      uci: 'b3a4',
      best: line(OPERA.before16, 'b3b8 d7b8 d1d8', mate(2)),
      evalAfter: cp(300),
      reply: 'f8e7 g5e7 e8e7',
    });
    expect(explainMove(withStories(misses, 'error'))).toBe(
      'Blunder. You had mate in 2: Qb8+ Nxb8 Rd8#.',
    );
  });

  it('keeps the engine mate count when the mating line is too long to show (53...Bxc4)', () => {
    const fenBefore = '5K2/5bp1/5pkp/8/2R5/4p1P1/8/4r3 b - - 5 53';
    const mating =
      'f7c4 g3g4 e3e2 g4g5 e1b1 f8e7 e2e1q e7d7 e1e6 d7c7 e6e5 c7c6 e5d5 c6c7 b1b7 c7c8 d5d7';
    const input = setup({
      classification: 'blunder',
      fenBefore,
      uci: 'e3e2',
      best: line(fenBefore, mating, mate(-9)),
      evalAfter: cp(-690),
      reply: 'c4g4 g6f5 g4g7 f7e6 g3g4 f5e5 g7g6',
    });
    expect(explainMove(withStories(input, 'error'))).toBe(
      'Blunder. You had a forced mate in 9, starting with Bxc4.',
    );
  });

  it('does not count taking back as material won (6...Bxc3 7.bxc3)', () => {
    const fenBefore = 'rnbqk1nr/ppp2ppp/8/4p3/1b6/2N3P1/PPPPNPBP/R1BQK2R b KQkq - 2 6';
    const input = setup({
      classification: 'inaccuracy',
      fenBefore,
      uci: 'b4c3',
      best: line(fenBefore, 'b8c6 a2a3 b4c3 e2c3 g8e7 d2d3 h7h5 c1e3', cp(17)),
      evalAfter: cp(89),
      reply: 'b2c3 b8c6 e1g1 g8e7 d2d4 c8e6 d4e5 e6d5 f2f4 e8g8 d1d3 d5g2',
    });
    expect(explainMove(withStories(input, 'error'))).toBe(
      'Inaccuracy. After bxc3 and a few more moves, dxe5 wins a pawn. ' +
        'Best was Nc6, keeping the position equal.',
    );
  });

  it('tells the idea behind a brilliant sacrifice (16.Qb8+)', () => {
    const input = setup({
      classification: 'brilliant',
      fenBefore: OPERA.before16,
      uci: 'b3b8',
      evalAfter: mate(1),
      reply: 'd7b8 d1d8',
      sacrifice: detectSacrifice(OPERA.before16, 'b3b8') ?? undefined,
    });
    expect(explainMove(withStories(input, 'idea'))).toBe(
      'Brilliant! You sacrifice the queen on b8: after Nxb8, Rd8# is checkmate.',
    );
  });

  it('keeps the offer wording when the line does not take the sacrifice (Legal: 5.Nxe5)', () => {
    const fenBefore = 'rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5';
    const input = setup({
      classification: 'brilliant',
      fenBefore,
      uci: 'f3e5',
      evalAfter: cp(217),
      reply: 'd6e5 d1g4 b8c6 g4g3 f8g7 d2d3 c6d4 e1d1 h7h5 a2a4',
      sacrifice: detectSacrifice(fenBefore, 'f3e5') ?? undefined,
    });
    expect(explainMove(withStories(input, 'idea'))).toBe(
      'Brilliant! You offer your queen on d1. ' +
        'Your opponent does best not to take it, and you are clearly better.',
    );
  });

  it('tells the tactic behind a great, best or excellent move', () => {
    const before25 = '5k2/p2R1bpp/5p2/4p3/8/1P4P1/r4P1P/4R1K1 w - - 0 25';
    const great = setup({
      classification: 'great',
      fenBefore: before25,
      uci: 'e1c1',
      best: line(before25, 'e1c1 f7e8 c1c8 e5e4', cp(446)),
      secondBest: line(before25, 'd7d8 f8e7 d8b8 e7d6', cp(60)),
      evalAfter: cp(446),
      reply: 'f7e8 c1c8 e5e4 d7d8 f6f5 d8e8 f8f7',
    });
    expect(explainMove(withStories(great, 'idea'))).toBe(
      'Great move! After Rc1 Be8, Rc8 pins the bishop to the king and wins the bishop. ' +
        'It is the only move that keeps your advantage.',
    );

    const best = setup({
      classification: 'best',
      fenBefore: ROYAL_FORK,
      uci: 'd5f6',
      evalAfter: cp(900),
      reply: 'g8g7 f6d7 a8d8',
    });
    expect(explainMove(withStories(best, 'idea'))).toBe(
      'Best move. Nf6+ forks the king and queen and wins the queen.',
    );
    const excellent: ExplainInput = {
      ...best,
      classification: 'excellent',
      best: line(ROYAL_FORK, 'd1d4', cp(950)),
    };
    expect(explainMove(withStories(excellent, 'idea'))).toBe(
      'Excellent move. Nf6+ forks the king and queen and wins the queen. ' +
        'Qd4 was slightly stronger.',
    );
  });

  it('falls back to the plain explanation when the line shows nothing concrete', () => {
    const input = setup({
      classification: 'best',
      fenBefore: OPERA.before16,
      uci: 'b3b8',
      evalAfter: mate(1),
    });
    const neutral = describeLine(AFTER_1E4_E5_2NF3, ['b8c6'], { kind: 'idea', player: 'b' });
    expect(explainMove({ ...input, why: neutral })).toBe(
      'Best move. Mate follows on the next move.',
    );
  });
});
