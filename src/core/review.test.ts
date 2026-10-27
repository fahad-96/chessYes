import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameAccuracy, moveAccuracy } from './accuracy';
import { explainMove } from './explain';
import { detectSacrifice } from './material';
import { START_FEN, positionKey } from './notation';
import openingsJson from './openings/data/openings.json';
import {
  createOpeningBook,
  type OpeningBook,
  type OpeningBookData,
  type OpeningInfo,
} from './openings';
import { RATED_GAMES, USER_GAME_ID } from './__fixtures__/rated';
import { REVIEW_FORMAT_VERSION, buildGameReview, pickKeyMoments } from './review';
import { THRESHOLDS } from './thresholds';
import {
  CLASSIFICATIONS,
  type Classification,
  type MoveReview,
  type ParsedGame,
  type ParsedMove,
  type PositionAnalysis,
  type Score,
  type TerminalState,
} from './types';
import { cpToWinPercent, positionWhiteWinPercent } from './winPercent';

// The real modules run; wrapping them in spies lets tests check what the review passes
// in, and force a sacrifice where a test needs one.
vi.mock('./explain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./explain')>();
  return { ...actual, explainMove: vi.fn(actual.explainMove) };
});
vi.mock('./material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./material')>();
  return { ...actual, detectSacrifice: vi.fn(actual.detectSacrifice) };
});

const explainMock = vi.mocked(explainMove);
const sacrificeMock = vi.mocked(detectSacrifice);
const realDetectSacrifice = (await vi.importActual<typeof import('./material')>('./material'))
  .detectSacrifice;

const ENGINE = { name: 'Stockfish 19 lite', depth: 16, multiPv: 2 };
const NO_BOOK = { book: null, engine: ENGINE };

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });

/** Plays SAN moves with chess.js and returns the game as the PGN parser would. */
function gameFromSan(sans: string[], initialFen = START_FEN): ParsedGame {
  const chess = new Chess(initialFen);
  const moves = sans.map((san, index): ParsedMove => {
    const fenBefore = chess.fen();
    const played = chess.move(san);
    const move: ParsedMove = {
      ply: index + 1,
      moveNumber: Number(fenBefore.split(' ')[5]),
      color: played.color,
      san: played.san,
      uci: `${played.from}${played.to}${played.promotion ?? ''}`,
      from: played.from,
      to: played.to,
      piece: played.piece,
      fenBefore,
      fenAfter: chess.fen(),
      isCheck: chess.inCheck(),
      isCheckmate: chess.isCheckmate(),
    };
    if (played.captured) move.captured = played.captured;
    if (played.promotion) move.promotion = played.promotion;
    return move;
  });
  const game: ParsedGame = { headers: {}, initialFen, moves };
  if (chess.isCheckmate()) game.finalState = 'checkmate';
  return game;
}

function fenAt(game: ParsedGame, index: number): string {
  return index === 0 ? game.initialFen : game.moves[index - 1]!.fenAfter;
}

/** Analysis of position `index` with lines given as [space-separated UCI pv, score]. */
function analysed(
  game: ParsedGame,
  index: number,
  ...lines: [pv: string, score: Score][]
): PositionAnalysis {
  return {
    fen: fenAt(game, index),
    depth: 16,
    lines: lines.map(([pv, score]) => ({ pv: pv.split(' '), score, depth: 16 })),
  };
}

function terminal(game: ParsedGame, index: number, state: TerminalState): PositionAnalysis {
  return { fen: fenAt(game, index), depth: 0, lines: [], terminal: state };
}

/** One line per position whose first move is the move actually played (or any legal move). */
function flatAnalyses(game: ParsedGame, centipawns: number[]): PositionAnalysis[] {
  return centipawns.map((value, index) => {
    const fen = fenAt(game, index);
    const played = game.moves[index]?.uci;
    const anyLegal = new Chess(fen).moves({ verbose: true })[0];
    const uci = played ?? (anyLegal ? anyLegal.from + anyLegal.to : 'a1a1');
    return analysed(game, index, [uci, cp(value)]);
  });
}

function fakeBook(entries: [fen: string, info: OpeningInfo | null][]): OpeningBook {
  const positions = new Map(entries.map(([fen, info]) => [positionKey(fen), info]));
  return {
    has: (fen) => positions.has(positionKey(fen)),
    lookup: (fen) => positions.get(positionKey(fen)) ?? null,
  };
}

const classifications = (moves: MoveReview[]) => moves.map((m) => m.classification);

// 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#
const SCHOLAR = gameFromSan(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);

function scholarAnalyses(): PositionAnalysis[] {
  const g = SCHOLAR;
  return [
    analysed(g, 0, ['e2e4 e7e5', cp(30)], ['d2d4 d7d5', cp(25)]),
    analysed(g, 1, ['e7e5 g1f3', cp(30)], ['c7c5 g1f3', cp(35)]),
    analysed(g, 2, ['g1f3 b8c6', cp(70)], ['f1c4 g8f6', cp(25)]),
    analysed(g, 3, ['b8c6 f1c4', cp(0)], ['g7g6 h5e5', cp(60)]),
    analysed(g, 4, ['f1c4 g7g6', cp(0)], ['f1b5 g8f6', cp(-10)]),
    analysed(g, 5, ['g7g6 h5f3', cp(0)], ['d8e7 b1c3', cp(10)]),
    analysed(g, 6, ['h5f7', mate(1)], ['c4f7 e8e7', cp(350)]),
    terminal(g, 7, 'checkmate'),
  ];
}

beforeEach(() => {
  explainMock.mockClear();
  sacrificeMock.mockClear();
  sacrificeMock.mockImplementation(realDetectSacrifice);
});

describe('buildGameReview: a complete game', () => {
  const analyses = scholarAnalyses();
  const review = () => buildGameReview(SCHOLAR, analyses, NO_BOOK);

  it('reviews every move with the expected labels', () => {
    const result = review();
    expect(result.moves.map((m) => m.ply)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(classifications(result.moves)).toEqual([
      'best', // e4: engine move
      'best', // e5: engine move
      'good', // Qh5: +0.7 → 0.0 loses 3.5 points
      'best', // Nc6: engine move, alternatives close
      'best', // Bc4: engine move
      'blunder', // Nf6??: allows mate in one
      'best', // Qxf7#: engine move; the alternative also wins
    ]);
    expect(result.version).toBe(REVIEW_FORMAT_VERSION);
    expect(result.engine).toEqual(ENGINE);
  });

  it('builds the win % series from every position, ending in mate', () => {
    const { whiteWinPercents } = review();
    expect(whiteWinPercents).toEqual(analyses.map((analysis) => positionWhiteWinPercent(analysis)));
    expect(whiteWinPercents).toHaveLength(8);
    expect(whiteWinPercents[0]).toBeCloseTo(cpToWinPercent(30), 10);
    expect(whiteWinPercents[7]).toBe(100);
  });

  it('fills the details of a blunder from the mover point of view', () => {
    const nf6 = review().moves[5]!;
    expect(nf6).toMatchObject({ ply: 6, color: 'b', san: 'Nf6', uci: 'g8f6' });
    expect(nf6.winBefore).toBeCloseTo(50, 10);
    // A forced mate is a certain result: 0 % for the side that gets mated.
    expect(nf6.winAfter).toBe(0);
    expect(nf6.winLoss).toBeCloseTo(nf6.winBefore - nf6.winAfter, 10);
    expect(nf6.accuracy).toBe(moveAccuracy(nf6.winBefore, nf6.winAfter));
    expect(nf6.evalAfter).toEqual(mate(1));
    expect(nf6.whiteWinAfter).toBe(100);
    expect(nf6.best).toEqual({
      uci: 'g7g6',
      san: 'g6',
      score: cp(0),
      pvUci: ['g7g6', 'h5f3'],
      pvSan: ['g6', 'Qf3'],
    });
    expect(nf6.secondBest?.pvSan).toEqual(['Qe7', 'Nc3']);
    expect(nf6.playedLine).toEqual({
      uci: 'h5f7',
      san: 'Qxf7#',
      score: mate(1),
      pvUci: ['h5f7'],
      pvSan: ['Qxf7#'],
    });
    expect(nf6.explanation).toBe(
      'Blunder. This allows mate in 1 with Qxf7#. Best was g6, keeping the position equal.',
    );
  });

  it('handles the mating move: no evaluation or line after it', () => {
    const qxf7 = review().moves[6]!;
    expect(qxf7.evalAfter).toBeNull();
    expect(qxf7.whiteWinAfter).toBe(100);
    expect('playedLine' in qxf7).toBe(false);
    expect('sacrifice' in qxf7).toBe(false);
    expect(qxf7.winLoss).toBe(0);
    expect(qxf7.accuracy).toBe(100);
  });

  it('passes the full context to the explanation', () => {
    review();
    expect(explainMock).toHaveBeenCalledTimes(7);
    expect(explainMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'blunder',
        san: 'Nf6',
        color: 'b',
        fenBefore: SCHOLAR.moves[5]!.fenBefore,
        fenAfter: SCHOLAR.moves[5]!.fenAfter,
        evalBest: cp(0),
        evalAfter: mate(1),
        isCheckmate: false,
      }),
    );
    expect(explainMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ san: 'Qxf7#', isCheckmate: true, evalAfter: null }),
    );
  });

  it('counts classifications per player, with every label present', () => {
    const { white, black } = review();
    expect(Object.keys(white.counts).sort()).toEqual([...CLASSIFICATIONS].sort());
    expect(white.counts).toMatchObject({ best: 3, good: 1, blunder: 0, book: 0 });
    expect(black.counts).toMatchObject({ best: 2, blunder: 1, good: 0 });
    const total = (counts: Record<Classification, number>) =>
      Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total(white.counts)).toBe(4);
    expect(total(black.counts)).toBe(3);
  });

  it('uses the game accuracy formula over the win % series', () => {
    const result = review();
    const expected = gameAccuracy(result.whiteWinPercents, 'w');
    expect(result.white.accuracy).toBe(expected.white);
    expect(result.black.accuracy).toBe(expected.black);
    expect(result.black.accuracy).toBeLessThan(result.white.accuracy);
  });

  it('computes the accuracies on the Lichess scale when asked, with the same labels', () => {
    const calibrated = review();
    const lichess = buildGameReview(SCHOLAR, analyses, { ...NO_BOOK, accuracyModel: 'lichess' });
    expect(classifications(lichess.moves)).toEqual(classifications(calibrated.moves));
    expect(lichess.whiteWinPercents).toEqual(calibrated.whiteWinPercents);

    const series = analyses.map((analysis) => positionWhiteWinPercent(analysis, 'lichess'));
    const expected = gameAccuracy(series, 'w', 'lichess');
    expect(lichess.white.accuracy).toBe(expected.white);
    expect(lichess.black.accuracy).toBe(expected.black);
    expect(lichess.black.accuracy).not.toBeCloseTo(calibrated.black.accuracy, 0);
    // Per move too: 3...Nf6?? from Black's side, on the Lichess win % of the same positions.
    expect(lichess.moves[5]!.accuracy).toBe(
      moveAccuracy(100 - series[5]!, 100 - series[6]!, 'lichess'),
    );
  });

  it('marks the blunder as a key moment', () => {
    expect(review().keyMoments).toEqual([6]);
  });

  it('only looks for sacrifices where Brilliant is still possible', () => {
    review();
    const checked = sacrificeMock.mock.calls.map(([, uci]) => uci);
    // Not Qh5 (loses 3.5 points), not Nf6 (blunder) and not Qxf7# (the game is over).
    expect(checked).toEqual(['e2e4', 'e7e5', 'b8c6', 'f1c4']);
    expect(sacrificeMock).toHaveBeenCalledWith(SCHOLAR.moves[4]!.fenBefore, 'f1c4');
  });
});

describe('buildGameReview: classifications in context', () => {
  it('labels +0.3 → -5.0 a blunder', () => {
    const game = gameFromSan(['f3']);
    const analyses = [analysed(game, 0, ['d2d4', cp(30)]), analysed(game, 1, ['e7e5', cp(-500)])];
    const [move] = buildGameReview(game, analyses, NO_BOOK).moves;
    expect(move?.classification).toBe('blunder');
    expect(move?.winLoss).toBeCloseTo(cpToWinPercent(30) - cpToWinPercent(-500), 10);
  });

  it('labels throwing away a winning position a plain error when nothing was there to take', () => {
    const game = gameFromSan(['e4']);
    const analyses = [analysed(game, 0, ['d2d4', cp(400)]), analysed(game, 1, ['e7e5', cp(0)])];
    expect(classifications(buildGameReview(game, analyses, NO_BOOK).moves)).toEqual(['mistake']);
  });

  it("labels a move that does not take the material the opponent's blunder offered a Miss", () => {
    // 1.e4 e5 2.Nf3 Qh4?? 3.d3?: Nxh4 wins the queen.
    const game = gameFromSan(['e4', 'e5', 'Nf3', 'Qh4', 'd3']);
    const analyses = [
      ...flatAnalyses(game, [30, 30, 30]),
      analysed(game, 3, ['b8c6 f1b5', cp(30)]),
      analysed(game, 4, ['f3h4 b8c6', cp(900)]),
      analysed(game, 5, ['h4e7 b1c3', cp(50)]),
    ];
    const { moves } = buildGameReview(game, analyses, NO_BOOK);
    expect(classifications(moves).slice(3)).toEqual(['blunder', 'missedWin']);
    expect(moves[4]?.bestIdea?.materialSwing).toBe(9);
    expect(moves[4]?.explanation).toBe(
      'Miss. You missed Nxh4, which wins the undefended queen on h4.',
    );
  });

  it("labels giving back most of the opponent's mistake a Miss, a small slip not", () => {
    // 1.e4 a6 2.h3: made-up evaluations; the engine wanted 2.d4 after Black's slip.
    const game = gameFromSan(['e4', 'a6', 'h3']);
    const withGift = (afterA6: number) => [
      analysed(game, 0, ['e2e4', cp(30)]),
      analysed(game, 1, ['e7e5 g1f3', cp(30)]),
      analysed(game, 2, ['d2d4 e7e6', cp(afterA6)]),
      analysed(game, 3, ['e7e5 g1f3', cp(0)]),
    ];
    // a6 gives away 10.6 points (a Mistake) and h3 gives back all of them.
    const big = buildGameReview(game, withGift(250), NO_BOOK).moves;
    expect(classifications(big).slice(1)).toEqual(['mistake', 'missedWin']);
    // a6 gives away only 5.9 points (an Inaccuracy): h3 is just an Inaccuracy too.
    const small = buildGameReview(game, withGift(150), NO_BOOK).moves;
    expect(classifications(small).slice(1)).toEqual(['inaccuracy', 'inaccuracy']);
  });

  it('detects Brilliant and Great moves and puts them first among key moments', () => {
    const analyses = scholarAnalyses();
    // Nc6 is the only move that keeps Black afloat: the alternative is +2.5 for White.
    analyses[3] = analysed(SCHOLAR, 3, ['b8c6 f1c4', cp(0)], ['g7g6 h5e5', cp(250)]);
    const bishop = { material: 3, square: 'c4' as const, piece: 'b' as const };
    sacrificeMock.mockImplementation((_fen, uci) => (uci === 'f1c4' ? bishop : null));

    const result = buildGameReview(SCHOLAR, analyses, NO_BOOK);
    expect(result.moves[3]?.classification).toBe('great');
    expect(result.moves[4]?.classification).toBe('brilliant');
    expect(result.moves[4]?.sacrifice).toEqual(bishop);
    expect(explainMock).toHaveBeenCalledWith(
      expect.objectContaining({ san: 'Bc4', classification: 'brilliant', sacrifice: bishop }),
    );
    expect(result.keyMoments).toEqual([4, 5, 6]);
  });

  it('never labels the mating move Great, even when every alternative is far worse', () => {
    const analyses = scholarAnalyses();
    // Qxf7# against an alternative that only keeps an edge (+0.5).
    analyses[6] = analysed(SCHOLAR, 6, ['h5f7', mate(1)], ['c4f7 e8e7', cp(50)]);
    const qxf7 = buildGameReview(SCHOLAR, analyses, NO_BOOK).moves[6];
    expect(qxf7?.classification).toBe('best');
    expect(qxf7?.explanation).toBe('Checkmate! Well played.');
  });

  it('does not call the other recapture a material gain (4.Bxc6 dxc6?, best bxc6)', () => {
    const game = gameFromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6']);
    const analyses = [
      ...flatAnalyses(game, [30, 30, 30, 30, 30, 30, 30]),
      analysed(game, 7, ['b7c6 e1g1 d7d6', cp(30)], ['d7c6 e1g1 f7f6', cp(250)]),
      analysed(game, 8, ['e1g1 f7f6', cp(250)]),
    ];
    const dxc6 = buildGameReview(game, analyses, NO_BOOK).moves[7]!;
    expect(dxc6.classification).toBe('mistake');
    expect(dxc6.explanation).not.toContain('wins');
    expect(dxc6.bestIdea?.materialSwing).toBe(0);
    expect(dxc6.bestIdea?.text).toBe('bxc6 was the strongest move.');
  });

  it('does not label stepping out of a fork Brilliant (the forked rook was already lost)', () => {
    // ...Nc2+ forks Ke1 and Ra1; Kd2 is the engine's move and keeps White winning.
    const game = gameFromSan(['Kd2'], '4k3/8/8/8/8/8/2n5/R3K2R w KQ - 0 1');
    const analyses = [
      analysed(game, 0, ['e1d2 c2a1 h1a1', cp(600)], ['e1d1 c2a1', cp(450)]),
      analysed(game, 1, ['c2a1 h1a1 e8d7', cp(600)]),
    ];
    const [kd2] = buildGameReview(game, analyses, NO_BOOK).moves;
    expect(kd2?.classification).toBe('best');
    expect(kd2?.sacrifice).toBeUndefined();
  });

  it('does not treat a capture that ends the game as a sacrifice', () => {
    // Nxe3 leaves king and knight against king: drawn on the spot, so Kxe3 never comes.
    const game = gameFromSan(['Nxe3'], '8/8/8/8/5k2/4p3/2N5/3K4 w - - 0 60');
    game.finalState = 'insufficient';
    const analyses = [
      analysed(game, 0, ['c2e3', cp(0)], ['d1e1 e3e2', cp(-600)]),
      terminal(game, 1, 'insufficient'),
    ];
    const result = buildGameReview(game, analyses, NO_BOOK);
    expect(result.moves[0]?.classification).not.toBe('brilliant');
    expect(result.moves[0]?.sacrifice).toBeUndefined();
    expect(sacrificeMock).not.toHaveBeenCalled();
  });

  it('does not label a sacrifice Brilliant when the material comes straight back', () => {
    // 29.Rxg7+ Kxg7 30.Qxh5: the check uncovers the queen on h5. An only move, not a sacrifice.
    const fen = '3r1rk1/2p2pp1/p6p/1ppBp2q/4P1R1/3P1Q2/5PK1/8 w - - 4 29';
    const game = gameFromSan(['Rxg7+'], fen);
    const analyses = [
      analysed(game, 0, ['g4g7 g8g7 f3h5', cp(340)], ['d3d4 h5g4', cp(-590)]),
      analysed(game, 1, ['g8g7 f3h5 d8d5', cp(330)]),
    ];
    const [rxg7] = buildGameReview(game, analyses, NO_BOOK).moves;
    expect(sacrificeMock).toHaveBeenCalledTimes(1);
    expect(rxg7?.sacrifice).toBeUndefined();
    expect(rxg7?.classification).toBe('great');
  });

  it('keeps a sacrifice that leads to a forced mate even if material comes back on the way', () => {
    const fen = '3r1rk1/2p2pp1/p6p/1ppBp2q/4P1R1/3P1Q2/5PK1/8 w - - 4 29';
    const game = gameFromSan(['Rxg7+'], fen);
    const analyses = [
      analysed(game, 0, ['g4g7 g8g7 f3h5', mate(9)], ['d3d4 h5g4', cp(-590)]),
      analysed(game, 1, ['g8g7 f3h5 d8d5', mate(8)]),
    ];
    const [rxg7] = buildGameReview(game, analyses, NO_BOOK).moves;
    expect(rxg7?.classification).toBe('brilliant');
  });

  it('does not label answering a check or taking a hanging piece Great', () => {
    // ...Bxf2+ (made-up evaluations): Kf1 is the only good move, but it answers a check.
    const check = gameFromSan(
      ['Kf1'],
      'r1bqk1nr/pppp1ppp/2n5/8/2B1P3/8/PPPP1bPP/RNBQK2R w KQkq - 0 5',
    );
    const checkAnalyses = [
      analysed(check, 0, ['e1f1 f2b6', cp(-100)], ['e1e2 f2b6', cp(-500)]),
      analysed(check, 1, ['f2b6 d2d3', cp(-100)]),
    ];
    expect(classifications(buildGameReview(check, checkAnalyses, NO_BOOK).moves)).toEqual(['best']);

    // The knight on d5 hangs: Qxd5 wins it, and every other move lets Black consolidate.
    const hanging = gameFromSan(['Qxd5'], '4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1');
    const hangingAnalyses = [
      analysed(hanging, 0, ['d1d5 e8f8', cp(900)], ['e1e2 d5f4', cp(0)]),
      analysed(hanging, 1, ['e8f8 d5d7', cp(900)]),
    ];
    expect(classifications(buildGameReview(hanging, hangingAnalyses, NO_BOOK).moves)).toEqual([
      'best',
    ]);
  });

  it('labels letting a mate in one slip a Miss, although the position stays winning', () => {
    const game = gameFromSan(['h3'], '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
    const analyses = [
      analysed(game, 0, ['a1a8', mate(1)], ['g1f1 g8f8', cp(1500)]),
      analysed(game, 1, ['h7h6 a1a8 g8h7', cp(1200)]),
    ];
    const [move] = buildGameReview(game, analyses, NO_BOOK).moves;
    // Mate (100 %) → +12 (clamped to +10, 87.9 %).
    expect(move?.winLoss).toBeCloseTo(100 - cpToWinPercent(1000), 10);
    expect(move?.classification).toBe('missedWin');
    expect(move?.explanation).toBe('Miss. You had mate in 1 with Ra8#.');
  });

  it('labels walking into a forced mate in a bad position a Mistake', () => {
    // 1.e4 f6?? allows 2.Qh5+; Black was already clearly worse in this made-up analysis.
    const game = gameFromSan(['e4', 'f6']);
    const analyses = [
      analysed(game, 0, ['e2e4', cp(30)]),
      analysed(game, 1, ['e7e5 g1f3', cp(800)]),
      analysed(game, 2, ['d1h5 g7g6 h5g6', mate(3)]),
    ];
    const f6 = buildGameReview(game, analyses, NO_BOOK).moves[1];
    // -8.0 (17 %) → mated (0 %).
    expect(f6?.winLoss).toBeCloseTo(100 - cpToWinPercent(800), 10);
    expect(f6?.winLoss).toBeLessThanOrEqual(THRESHOLDS.loss.mistake);
    expect(f6?.classification).toBe('mistake');
    expect(f6?.explanation).toBe(
      'Mistake. This allows a forced mate in 3, starting with Qh5+. Best was e5, the toughest defense.',
    );
  });

  it('labels the only legal move Forced and skips sacrifice detection', () => {
    const game = gameFromSan(['Kxb2'], 'k7/8/8/8/8/8/1r6/K7 w - - 0 1');
    const analyses = [analysed(game, 0, ['a1b2', cp(0)]), terminal(game, 1, 'insufficient')];
    const result = buildGameReview(game, analyses, NO_BOOK);
    expect(classifications(result.moves)).toEqual(['forced']);
    expect(result.whiteWinPercents).toEqual([50, 50]);
    expect(result.moves[0]?.evalAfter).toBeNull();
    expect(sacrificeMock).not.toHaveBeenCalled();
  });

  it('attributes moves correctly when Black moves first', () => {
    const game = gameFromSan(['Kd7', 'e4', 'Kd6'], '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1');
    const analyses = [
      analysed(game, 0, ['e8e7', cp(0)]),
      analysed(game, 1, ['e2e4', cp(600)]),
      analysed(game, 2, ['d7d6', cp(600)]),
      analysed(game, 3, ['e1d2', cp(600)]),
    ];
    const result = buildGameReview(game, analyses, NO_BOOK);
    expect(result.moves.map((m) => m.color)).toEqual(['b', 'w', 'b']);
    expect(classifications(result.moves)).toEqual(['blunder', 'best', 'best']);
    expect(result.black.counts.blunder).toBe(1);
    expect(result.white.accuracy).toBe(100);
    expect(result.black.accuracy).toBe(gameAccuracy(result.whiteWinPercents, 'b').black);
    expect(result.black.accuracy).toBeLessThan(100);
  });

  it('skips engine lines whose first move is illegal and trims illegal tails', () => {
    const game = gameFromSan(['e4']);
    const analyses = [
      analysed(game, 0, ['e2e5', cp(30)], ['d2d4 d7d5 e2e4 e2e4', cp(20)]),
      analysed(game, 1, ['e7e5', cp(30)]),
    ];
    const [move] = buildGameReview(game, analyses, NO_BOOK).moves;
    expect(move?.best).toBeUndefined();
    expect(move?.secondBest).toMatchObject({
      pvUci: ['d2d4', 'd7d5', 'e2e4'],
      pvSan: ['d4', 'd5', 'e4'],
    });
  });
});

describe('buildGameReview: verified analyses', () => {
  // 1.e4 e5 2.Nf3, all equal at first; the verification pass re-checked 1...e5 (positions
  // 1 and 2) and found both positions much better for Black.
  const game = gameFromSan(['e4', 'e5', 'Nf3']);
  // The engine preferred 1.d4, so 1.e4 is judged by its loss alone.
  const original = [
    analysed(game, 0, ['d2d4 d7d5', cp(30)], ['e2e4 e7e5', cp(30)]),
    ...flatAnalyses(game, [30, 30, 30, 30]).slice(1),
  ];
  const verify = (index: number): PositionAnalysis => ({
    ...original[index]!,
    depth: 20,
    lines: original[index]!.lines.map((line) => ({ ...line, score: cp(-500), depth: 20 })),
    unverified: original[index]!,
  });
  const analyses = [original[0]!, verify(1), verify(2), original[3]!];

  it('judges a move by verified analyses only when both of its positions were verified', () => {
    const review = buildGameReview(game, analyses, NO_BOOK);
    // 1.e4 and 2.Nf3 each have one verified and one unverified position: full-pass pairs.
    expect(classifications(review.moves).slice(1)).toEqual(['best', 'best']);
    expect(review.moves[0]!.winLoss).toBeCloseTo(0);
    expect(review.moves[2]!.winBefore).toBeCloseTo(review.moves[2]!.winAfter);
    // 1...e5 is judged by the two verified positions.
    expect(review.moves[1]!.winBefore).toBeCloseTo(100 - cpToWinPercent(-500));
    // The graph shows the best estimate of every position.
    expect(review.whiteWinPercents[1]).toBeCloseTo(cpToWinPercent(-500));
  });

  it('would turn the unchecked neighbours into errors if pairs were mixed', () => {
    const mixed = analyses.map(({ unverified: _, ...analysis }) => analysis);
    const review = buildGameReview(game, mixed, NO_BOOK);
    expect(review.moves[0]!.classification).toBe('blunder');
  });
});

describe('buildGameReview: partial analysis', () => {
  const full = scholarAnalyses();

  it('reviews nothing when nothing is analysed yet', () => {
    const result = buildGameReview(SCHOLAR, [], NO_BOOK);
    expect(result.moves).toEqual([]);
    expect(result.whiteWinPercents).toEqual([]);
    expect(result.keyMoments).toEqual([]);
    expect(result.white.accuracy).toBe(100);
    expect(result.black.accuracy).toBe(100);
    expect(Object.values(result.white.counts).every((n) => n === 0)).toBe(true);
  });

  it('needs the position after a move before reviewing it', () => {
    const result = buildGameReview(SCHOLAR, full.slice(0, 1), NO_BOOK);
    expect(result.moves).toEqual([]);
    expect(result.whiteWinPercents).toHaveLength(1);
  });

  it('reviews the analysed prefix of a running analysis', () => {
    const result = buildGameReview(SCHOLAR, full.slice(0, 4), NO_BOOK);
    expect(result.moves).toHaveLength(3);
    expect(result.whiteWinPercents).toHaveLength(4);
  });

  it('stops at the first gap', () => {
    const withGap: (PositionAnalysis | null)[] = [...full];
    withGap[3] = null;
    const result = buildGameReview(SCHOLAR, withGap, NO_BOOK);
    expect(result.moves).toHaveLength(2);
    expect(result.whiteWinPercents).toHaveLength(3);

    const missingStart = buildGameReview(SCHOLAR, [null, ...full.slice(1)], NO_BOOK);
    expect(missingStart.moves).toEqual([]);
    expect(missingStart.whiteWinPercents).toEqual([]);
  });

  it('treats a position without any engine line as a gap instead of failing', () => {
    const broken = [...full];
    broken[2] = { fen: fenAt(SCHOLAR, 2), depth: 0, lines: [] };
    const result = buildGameReview(SCHOLAR, broken, NO_BOOK);
    expect(result.moves).toHaveLength(1);
  });

  it('ignores analyses beyond the final position', () => {
    const game = gameFromSan(['e4']);
    const analyses = flatAnalyses(game, [30, 30]);
    const result = buildGameReview(game, [...analyses, analyses[1]!], NO_BOOK);
    expect(result.moves).toHaveLength(1);
    expect(result.whiteWinPercents).toHaveLength(2);
  });
});

describe('buildGameReview: opening book', () => {
  // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6
  const game = gameFromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6']);
  const analyses = flatAnalyses(game, [20, 20, 20, 20, 20, 20, 20]);
  const after = (ply: number) => game.moves[ply - 1]!.fenAfter;
  const KINGS_PAWN = { eco: 'C20', name: "King's Pawn Game" };
  const KNIGHT = { eco: 'C40', name: "King's Knight Opening" };

  it('labels moves Book until the game first leaves the book', () => {
    const book = fakeBook([
      [after(1), KINGS_PAWN],
      [after(2), null],
      [after(3), KNIGHT],
      // Position after 3.Bc4 is in the book, but 2...Nc6 already left it.
      [after(5), { eco: 'C50', name: 'Italian Game' }],
    ]);
    const result = buildGameReview(game, analyses, { book, engine: ENGINE });
    expect(classifications(result.moves)).toEqual(['book', 'book', 'book', 'best', 'best', 'best']);
    expect(result.moves.map((m) => m.opening)).toEqual([
      KINGS_PAWN,
      undefined,
      KNIGHT,
      undefined,
      undefined,
      undefined,
    ]);
    expect(result.opening).toEqual({ ...KNIGHT, lastBookPly: 3 });
    expect(result.white.counts.book).toBe(2);
    expect(result.black.counts.book).toBe(1);
    expect(explainMock).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'book', san: 'Nf3', opening: KNIGHT }),
    );
  });

  it('does not run sacrifice detection on book moves', () => {
    const book = fakeBook([
      [after(1), KINGS_PAWN],
      [after(2), KINGS_PAWN],
    ]);
    buildGameReview(game, analyses, { book, engine: ENGINE });
    const checked = sacrificeMock.mock.calls.map(([, uci]) => uci);
    expect(checked).toEqual(['g1f3', 'b8c6', 'f1c4', 'g8f6']);
  });

  it('reports the last named opening and the last book ply', () => {
    const book = fakeBook([
      [after(1), KINGS_PAWN],
      [after(2), null],
    ]);
    const result = buildGameReview(game, analyses, { book, engine: ENGINE });
    expect(result.opening).toEqual({ ...KINGS_PAWN, lastBookPly: 2 });
  });

  it('knows the opening before the analysis reaches it', () => {
    const book = fakeBook([[after(1), KINGS_PAWN]]);
    const result = buildGameReview(game, analyses.slice(0, 1), { book, engine: ENGINE });
    expect(result.moves).toEqual([]);
    expect(result.opening).toEqual({ ...KINGS_PAWN, lastBookPly: 1 });
  });

  it('has no opening without a book or without named positions', () => {
    expect(buildGameReview(game, analyses, NO_BOOK).opening).toBeUndefined();
    const unnamed = fakeBook([[after(1), null]]);
    const result = buildGameReview(game, analyses, { book: unnamed, engine: ENGINE });
    expect(result.moves[0]?.classification).toBe('book');
    expect(result.opening).toBeUndefined();
    expect('opening' in result).toBe(false);
  });

  it('ends the book at a move that throws the game away, even inside a trap line', () => {
    // 1.f3 e5 2.g4?? Qh4#: the real book contains "Barnes Opening: Fool's Mate".
    const realBook = createOpeningBook(openingsJson as unknown as OpeningBookData);
    const fools = gameFromSan(['f3', 'e5', 'g4', 'Qh4#']);
    expect(fools.moves.every((m) => realBook.has(m.fenAfter))).toBe(true);
    const foolsAnalyses = [
      analysed(fools, 0, ['e2e4 e7e5', cp(30)], ['d2d4 d7d5', cp(25)]),
      analysed(fools, 1, ['e7e5 e2e4', cp(-60)], ['d7d5 d2d4', cp(-50)]),
      analysed(fools, 2, ['e2e4 b8c6', cp(-70)], ['b1c3 b8c6', cp(-90)]),
      analysed(fools, 3, ['d8h4', mate(-1)], ['b8c6 f1g2', cp(-150)]),
      terminal(fools, 4, 'checkmate'),
    ];
    const result = buildGameReview(fools, foolsAnalyses, { book: realBook, engine: ENGINE });
    expect(classifications(result.moves)).toEqual(['book', 'book', 'blunder', 'best']);
    expect(result.moves[2]?.explanation).toMatch(/^Blunder\. This allows mate in 1 with Qh4#\./);
    expect(result.keyMoments).toEqual([3]);
    expect(result.opening?.lastBookPly).toBe(2);
    expect(result.opening?.name).not.toMatch(/Fool/);
  });

  it('never labels a checkmating move Book', () => {
    const mating = gameFromSan(['f3', 'e5', 'g4', 'Qh4#']);
    const book = fakeBook(mating.moves.map((m) => [m.fenAfter, KINGS_PAWN]));
    // Without analysis of the losing move, only the mate itself is known to leave the book.
    const result = buildGameReview(mating, [], { book, engine: ENGINE });
    expect(result.opening?.lastBookPly).toBe(3);
  });

  it('keeps a book move that is the engine top move or loses less than a Mistake', () => {
    const book = fakeBook([
      [after(1), KINGS_PAWN],
      [after(2), KINGS_PAWN],
      [after(3), KNIGHT],
    ]);
    const swings = [
      analysed(game, 0, ['e2e4', cp(30)]),
      // 1.e4 is the engine's top move: a deeper search seeing less does not end the book.
      analysed(game, 1, ['e7e5', cp(-150)]),
      // 1...e5 loses about 8 points: an Inaccuracy's worth, still theory.
      analysed(game, 2, ['g1f3', cp(30)]),
      ...analyses.slice(3),
    ];
    const result = buildGameReview(game, swings, { book, engine: ENGINE });
    expect(classifications(result.moves).slice(0, 3)).toEqual(['book', 'book', 'book']);
  });

  it('never labels a move Book when the first move is already out of book', () => {
    const book = fakeBook([[after(2), KINGS_PAWN]]);
    const result = buildGameReview(game, analyses, { book, engine: ENGINE });
    expect(result.moves.every((m) => m.classification !== 'book')).toBe(true);
  });
});

describe('buildGameReview: stories behind the labels', () => {
  /** Before 31.Rg8?? in the user's game fahadkmr - JJose8 (Chess.com, 2026). */
  const BEFORE_31 = '7R/1R4p1/3k1p1p/4p3/p7/1b4P1/r4P1P/6K1 w - - 2 31';
  const ROYAL_FORK = 'r5k1/pppq1p1p/6p1/3N4/8/8/PPP2PPP/3Q2K1 w - - 0 1';

  function rg8Review() {
    const game = gameFromSan(['Rg8'], BEFORE_31);
    const analyses = [
      analysed(
        game,
        0,
        ['b7g7 b3d5 h8d8 d6c5 f2f4 d5c6 f4e5 f6e5', cp(0)],
        ['h8h7 b3d5 b7b6 d6c5', cp(-60)],
      ),
      analysed(game, 1, ['b3g8 g1f1 g8c4 f1e1 a4a3 b7a7', cp(-727)]),
    ];
    return { game, review: buildGameReview(game, analyses, NO_BOOK) };
  }

  it('shows the refutation of a blunder and what the best move would have done', () => {
    const { game, review } = rg8Review();
    const [rg8] = review.moves;
    expect(rg8?.classification).toBe('blunder');
    expect(rg8?.why).toMatchObject({
      kind: 'refutation',
      fen: game.moves[0]!.fenAfter,
      movesUci: ['b3g8'],
      movesSan: ['Bxg8'],
      materialSwing: -5,
    });
    expect(rg8?.bestIdea).toMatchObject({
      kind: 'missed',
      fen: game.moves[0]!.fenBefore,
      movesSan: ['Rxg7'],
      materialSwing: 1,
    });
    expect(rg8?.explanation).toBe(
      'Blunder. This leaves your rook on g8 unprotected: Bxg8 takes it for free. ' +
        'Best was Rxg7, which wins the undefended pawn on g7.',
    );
    expect(explainMock).toHaveBeenCalledWith(
      expect.objectContaining({ why: rg8?.why, bestIdea: rg8?.bestIdea }),
    );
  });

  it('reuses the stories when the review is rebuilt during the analysis', () => {
    const first = rg8Review().review.moves[0];
    const again = rg8Review().review.moves[0];
    expect(again?.why).toBe(first?.why);
    expect(again?.bestIdea).toBe(first?.bestIdea);
  });

  it('shows the idea behind Brilliant and Great moves', () => {
    const analyses = scholarAnalyses();
    analyses[3] = analysed(SCHOLAR, 3, ['b8c6 f1c4', cp(0)], ['g7g6 h5e5', cp(250)]);
    const bishop = { material: 3, square: 'c4' as const, piece: 'b' as const };
    sacrificeMock.mockImplementation((_fen, uci) => (uci === 'f1c4' ? bishop : null));
    const { moves } = buildGameReview(SCHOLAR, analyses, NO_BOOK);
    expect(moves[3]).toMatchObject({ classification: 'great', why: { kind: 'idea' } });
    expect(moves[3]?.why?.movesUci[0]).toBe('b8c6');
    expect(moves[4]).toMatchObject({ classification: 'brilliant', why: { kind: 'idea' } });
    expect(moves[4]?.why?.fen).toBe(SCHOLAR.moves[4]!.fenBefore);
    expect('bestIdea' in moves[4]!).toBe(false);
  });

  it('tells the idea of a best move only when the move itself sets up a tactic', () => {
    const game = gameFromSan(['Nf6+', 'Kg7', 'Kf1'], ROYAL_FORK);
    const analyses = [
      analysed(game, 0, ['d5f6 g8g7 f6d7 a8d8', cp(900)], ['d1d4 d7d4', cp(800)]),
      analysed(game, 1, ['g8g7 f6d7 a8d8', cp(900)]),
      analysed(game, 2, ['f6d7 a8d8', cp(900)], ['g1f1 d7d1', cp(-500)]),
      analysed(game, 3, ['d7d1', cp(-900)]),
    ];
    const [nf6, kg7, kf1] = buildGameReview(game, analyses, NO_BOOK).moves;
    expect(nf6?.classification).toBe('best');
    expect(nf6?.why).toMatchObject({
      kind: 'idea',
      movesSan: ['Nf6+', 'Kg7', 'Nxd7'],
      text: 'Nf6+ forks the king and queen and wins the queen.',
    });
    expect(nf6?.explanation).toBe('Best move. Nf6+ forks the king and queen and wins the queen.');
    expect('why' in kg7!).toBe(false);
    // The blunder that drops the knight gets its refutation, and the fork it missed.
    expect(kf1?.classification).toBe('blunder');
    expect(kf1?.why?.kind).toBe('refutation');
    expect(kf1?.bestIdea?.text).toBe('You missed Nxd7, which wins the undefended queen on d7.');
  });

  it('gives no story to book, forced or good moves, nor to checkmates', () => {
    const { moves } = buildGameReview(SCHOLAR, scholarAnalyses(), NO_BOOK);
    expect(moves[2]?.classification).toBe('good');
    for (const move of [moves[0], moves[2], moves[6]]) {
      expect('why' in move!).toBe(false);
      expect('bestIdea' in move!).toBe(false);
    }
    // The blunder 3...Nf6?? still shows the mate it allows.
    expect(moves[5]?.why).toMatchObject({ kind: 'refutation', mateIn: 1, movesSan: ['Qxf7#'] });
    const forced = gameFromSan(['Kxb2'], 'k7/8/8/8/8/8/1r6/K7 w - - 0 1');
    const forcedAnalyses = [
      analysed(forced, 0, ['a1b2', cp(0)]),
      terminal(forced, 1, 'insufficient'),
    ];
    expect('why' in buildGameReview(forced, forcedAnalyses, NO_BOOK).moves[0]!).toBe(false);
  });
});

describe('buildGameReview: a rated game (the one that started the calibration)', () => {
  // Kibitz's own depth-16 analysis of a 10-minute game between two players rated about 830.
  // Its Chess.com review counted 3 Misses for White and none for Black.
  const rated = RATED_GAMES.find((game) => game.id === USER_GAME_ID)!;
  const book = createOpeningBook(openingsJson as unknown as OpeningBookData);
  const review = buildGameReview(rated.game, rated.analyses, { book, engine: ENGINE });
  const name = (move: MoveReview) =>
    `${Math.ceil(move.ply / 2)}${move.color === 'w' ? '.' : '...'}${move.san}`;
  const labelOf = (moveName: string) =>
    review.moves.find((move) => name(move) === moveName)?.classification;

  it('labels the moves that let a real chance slip a Miss', () => {
    const misses = review.moves.filter((m) => m.classification === 'missedWin').map(name);
    // 23.Re1 and 25.Re6+ let a forced mate go.
    expect(misses).toEqual(['23.Re1', '25.Re6+']);
    expect(review.white.counts.missedWin).toBe(2);
    expect(review.black.counts.missedWin).toBe(0);
  });

  it('does not call it a Miss when the move played still wins the material', () => {
    // 13.g4 would trap the bishop on h5 at once, but after 13.Nd5 the engine line still
    // wins it (...a5 Bxd4 exd4 g4 Bxg4 fxg4): Nd5 is slower, not a missed chance.
    const nd5 = review.moves.find((move) => name(move) === '13.Nd5')!;
    expect(nd5.bestIdea?.materialSwing).toBe(2);
    expect(nd5.why?.materialSwing).toBe(2);
    expect(nd5.classification).toBe('inaccuracy');
  });

  it('keeps plain errors where there was no particular chance', () => {
    // 3.b3 answers a small slip (2...g6, an Inaccuracy). 18.Qh2 gives a won position back,
    // but the best move 18.Nh3 wins nothing: that is a Mistake, not a missed chance.
    expect(labelOf('3.b3')).toBe('inaccuracy');
    expect(labelOf('18.Qh2')).toBe('mistake');
    // Errors that leave Black clearly worse stay Blunders, even right after White's Miss.
    expect(labelOf('20...Bf4')).toBe('blunder');
    expect(labelOf('23...Qc8')).toBe('blunder');
  });

  it('gives the label counts documented in docs/CLASSIFICATION.md', () => {
    expect(review.white.counts).toMatchObject({
      book: 2,
      great: 1,
      best: 11,
      excellent: 2,
      good: 5,
      inaccuracy: 2,
      mistake: 1,
      blunder: 0,
      missedWin: 2,
    });
    expect(review.black.counts).toMatchObject({
      book: 1,
      forced: 1,
      great: 1,
      best: 5,
      excellent: 5,
      good: 4,
      inaccuracy: 3,
      mistake: 3,
      blunder: 2,
      missedWin: 0,
    });
  });
});

describe('pickKeyMoments', () => {
  const move = (ply: number, classification: Classification, winLoss = 0): MoveReview => ({
    ply,
    color: ply % 2 === 1 ? 'w' : 'b',
    san: 'a3',
    uci: 'a2a3',
    classification,
    winBefore: 50,
    winAfter: 50 - winLoss,
    winLoss,
    accuracy: moveAccuracy(50, 50 - winLoss),
    evalAfter: cp(0),
    whiteWinAfter: 50,
    explanation: '',
  });

  it('keeps highlights, then the costliest setbacks, up to eight, in game order', () => {
    const moves = [
      move(1, 'great'),
      move(2, 'blunder', 40),
      move(3, 'brilliant'),
      move(4, 'mistake', 15),
      move(5, 'missedWin', 25),
      move(6, 'inaccuracy', 8),
      move(7, 'blunder', 30),
      move(8, 'good', 3),
      move(9, 'mistake', 12),
      move(10, 'blunder', 45),
      move(11, 'mistake', 18),
      move(12, 'brilliant'),
      move(13, 'mistake', 11),
      move(14, 'blunder', 22),
    ];
    expect(pickKeyMoments(moves)).toEqual([1, 2, 3, 5, 7, 10, 12, 14]);
  });

  it('prefers Brilliant over Great when there are too many highlights', () => {
    const moves = [
      ...[1, 2, 3, 4, 5, 6].map((ply) => move(ply, 'great')),
      ...[7, 8, 9].map((ply) => move(ply, 'brilliant')),
      move(10, 'blunder', 50),
    ];
    expect(pickKeyMoments(moves)).toEqual([1, 2, 3, 4, 5, 7, 8, 9]);
  });

  it('breaks ties in win % lost by game order', () => {
    const moves = Array.from({ length: 10 }, (_, i) => move(i + 1, 'mistake', 15));
    expect(pickKeyMoments(moves)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('ignores inaccuracies and good moves', () => {
    expect(pickKeyMoments([move(1, 'inaccuracy', 9), move(2, 'best'), move(3, 'book')])).toEqual(
      [],
    );
  });
});
