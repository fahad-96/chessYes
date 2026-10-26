import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameAccuracy, moveAccuracy } from './accuracy';
import { explainMove } from './explain';
import { detectSacrifice } from './material';
import { START_FEN, positionKey } from './notation';
import type { OpeningBook, OpeningInfo } from './openings';
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
    analysed(g, 2, ['g1f3 b8c6', cp(30)], ['f1c4 g8f6', cp(25)]),
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
      'good', // Qh5: +0.3 → 0.0 loses 2.8 points
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
    expect(whiteWinPercents).toEqual(analyses.map(positionWhiteWinPercent));
    expect(whiteWinPercents).toHaveLength(8);
    expect(whiteWinPercents[0]).toBeCloseTo(cpToWinPercent(30), 10);
    expect(whiteWinPercents[7]).toBe(100);
  });

  it('fills the details of a blunder from the mover point of view', () => {
    const nf6 = review().moves[5]!;
    expect(nf6).toMatchObject({ ply: 6, color: 'b', san: 'Nf6', uci: 'g8f6' });
    expect(nf6.winBefore).toBeCloseTo(50, 10);
    expect(nf6.winAfter).toBeCloseTo(100 - cpToWinPercent(1000), 10);
    expect(nf6.winLoss).toBeCloseTo(nf6.winBefore - nf6.winAfter, 10);
    expect(nf6.accuracy).toBe(moveAccuracy(nf6.winBefore, nf6.winAfter));
    expect(nf6.evalAfter).toEqual(mate(1));
    expect(nf6.whiteWinAfter).toBeCloseTo(cpToWinPercent(1000), 10);
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

  it('marks the blunder as a key moment', () => {
    expect(review().keyMoments).toEqual([6]);
  });

  it('only looks for sacrifices where Brilliant is still possible', () => {
    review();
    const checked = sacrificeMock.mock.calls.map(([, uci]) => uci);
    // Not Qh5 (loses 2.8 points) and not Nf6 (blunder).
    expect(checked).toEqual(['e2e4', 'e7e5', 'b8c6', 'f1c4', 'h5f7']);
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

  it('labels throwing away a winning position a Missed Win', () => {
    const game = gameFromSan(['e4']);
    const analyses = [analysed(game, 0, ['d2d4', cp(400)]), analysed(game, 1, ['e7e5', cp(0)])];
    expect(classifications(buildGameReview(game, analyses, NO_BOOK).moves)).toEqual(['missedWin']);
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

  it('labels letting a mate in one slip an Inaccuracy even when the win % does not move', () => {
    const game = gameFromSan(['h3'], '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
    const analyses = [
      analysed(game, 0, ['a1a8', mate(1)], ['g1f1 g8f8', cp(1500)]),
      analysed(game, 1, ['h7h6 a1a8 g8h7', cp(1200)]),
    ];
    const [move] = buildGameReview(game, analyses, NO_BOOK).moves;
    expect(move?.winLoss).toBe(0);
    expect(move?.classification).toBe('inaccuracy');
    expect(move?.explanation).toBe('Inaccuracy. You had mate in 1 with Ra8#.');
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
    expect(f6?.winLoss).toBeLessThan(THRESHOLDS.loss.good);
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
      analysed(game, 1, ['e2e4', cp(300)]),
      analysed(game, 2, ['d7d6', cp(300)]),
      analysed(game, 3, ['e1d2', cp(300)]),
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

  it('never labels a move Book when the first move is already out of book', () => {
    const book = fakeBook([[after(2), KINGS_PAWN]]);
    const result = buildGameReview(game, analyses, { book, engine: ENGINE });
    expect(result.moves.every((m) => m.classification !== 'book')).toBe(true);
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
