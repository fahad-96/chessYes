/**
 * End-to-end check of the review pipeline with nothing mocked: PGN parsing, the real
 * Stockfish engine (npm build, run in Node through the same StockfishEngine class and
 * analyzeGame orchestration the browser uses), the real opening book and buildGameReview.
 *
 * The game is Morphy's Opera Game (Paris, 1858), whose key moments are well known.
 * Assertions stick to facts that hold at any reasonable depth, and a table of every
 * move is printed so the classifications can be inspected by eye.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeGame } from '@/engine/analyzeGame';
import { StockfishEngine } from '@/engine/stockfish';
import { createNodeEngineWorker } from '@/test/nodeStockfish';
import openingsJson from './openings/data/openings.json';
import { createOpeningBook, type OpeningBookData } from './openings';
import { parsePgn } from './pgn';
import { buildGameReview } from './review';
import type { GameReview, MoveReview, ParsedGame, PositionAnalysis } from './types';

const OPERA_GAME = `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6
9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+
Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

const SETTINGS = { depth: 13, multiPv: 2, maxTimeMs: 60_000 };
/** Generous: 33 searches on a single WASM thread, possibly on a slow CI machine. */
const TIMEOUT_MS = 300_000;

let game: ParsedGame;
let analyses: PositionAnalysis[];
let review: GameReview;
let reviewOptions: Parameters<typeof buildGameReview>[2];

/** The review of the move with the given SAN, played by the given side. */
function moveBy(color: 'w' | 'b', san: string): MoveReview {
  const move = review.moves.find((m) => m.color === color && m.san === san);
  if (!move) throw new Error(`No move ${san} by ${color} in the review`);
  return move;
}

function printTable(moves: MoveReview[]): void {
  const rows = moves.map((m) => {
    const label =
      `${m.ply}`.padStart(2) + ` ${Math.ceil(m.ply / 2)}${m.color === 'w' ? '.' : '...'}`;
    const win = `${m.winBefore.toFixed(1)} -> ${m.winAfter.toFixed(1)}`;
    const why = m.why
      ? `
          ${m.why.kind}: ${m.why.movesSan.join(' ')} | ${m.why.text}`
      : '';
    return `${label.padEnd(9)} ${m.san.padEnd(7)} ${m.classification.padEnd(10)} ${win}${why}`;
  });
  console.log(['Opera Game review (mover win %):', ...rows].join('\n'));
}

beforeAll(async () => {
  game = parsePgn(OPERA_GAME);

  const worker = await createNodeEngineWorker();
  const engine = new StockfishEngine({ createWorker: () => worker });
  try {
    await engine.init();
    analyses = await analyzeGame(game, { engine, settings: SETTINGS });
    const book = createOpeningBook(openingsJson as unknown as OpeningBookData);
    reviewOptions = {
      book,
      engine: { name: engine.name, depth: SETTINGS.depth, multiPv: SETTINGS.multiPv },
    };
    review = buildGameReview(game, analyses, reviewOptions);
  } finally {
    engine.terminate();
  }
  printTable(review.moves);
}, TIMEOUT_MS);

describe('review pipeline on the Opera Game (real engine, real book)', () => {
  it('parses the game and ends in checkmate', () => {
    expect(game.moves).toHaveLength(33);
    expect(game.finalState).toBe('checkmate');
    const last = game.moves.at(-1)!;
    expect(last).toMatchObject({ san: 'Rd8#', isCheckmate: true, color: 'w' });
  });

  it('reviews every move', () => {
    expect(review.moves).toHaveLength(33);
    expect(review.moves.map((m) => m.ply)).toEqual(game.moves.map((m) => m.ply));
    expect(review.moves.at(-1)).toMatchObject({ san: 'Rd8#', evalAfter: null, winLoss: 0 });
  });

  it('builds the win % series from start to mate', () => {
    expect(review.whiteWinPercents).toHaveLength(34);
    expect(review.whiteWinPercents.at(-1)).toBe(100);
    for (const value of review.whiteWinPercents) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('labels the opening moves Book and names the opening', () => {
    expect(review.moves.slice(0, 3).map((m) => m.classification)).toEqual(['book', 'book', 'book']);
    expect(review.opening?.name).toMatch(/Philidor/);
  });

  it('finds the queen sacrifice 16.Qb8+ brilliant', () => {
    const qb8 = moveBy('w', 'Qb8+');
    expect(qb8.classification).toBe('brilliant');
    expect(qb8.sacrifice).toMatchObject({ piece: 'q', square: 'b8' });
    expect(qb8.explanation).toMatch(/^Brilliant!/);
  });

  it('shows the idea behind 16.Qb8+: the queen sacrifice and the mate', () => {
    const qb8 = moveBy('w', 'Qb8+');
    expect(qb8.why).toMatchObject({ kind: 'idea', mateIn: 2, movesSan: ['Qb8+', 'Nxb8', 'Rd8#'] });
    expect(qb8.why?.text).toBe('You sacrifice the queen on b8: after Nxb8, Rd8# is checkmate.');
    expect(qb8.explanation).toBe(
      'Brilliant! You sacrifice the queen on b8: after Nxb8, Rd8# is checkmate.',
    );
  });

  it('shows the refutation of every inaccuracy, mistake, blunder and miss', () => {
    const errors = review.moves.filter((m) =>
      (['inaccuracy', 'mistake', 'blunder', 'missedWin'] as const).some(
        (label) => label === m.classification,
      ),
    );
    expect(errors.length).toBeGreaterThan(0);
    for (const move of errors) {
      expect(move.why?.kind).toBe('refutation');
      expect(move.why?.fen).toBe(game.moves[move.ply - 1]!.fenAfter);
      expect(move.why?.movesUci[0]).toBe(move.playedLine?.uci);
      expect(move.why?.text.trim()).not.toBe('');
    }
  });

  it('labels the only legal reply 16...Nxb8 Forced', () => {
    expect(moveBy('b', 'Nxb8').classification).toBe('forced');
  });

  it('rates Black lower than Morphy', () => {
    expect(review.black.accuracy).toBeLessThan(review.white.accuracy);
    const blackErrors = ['inaccuracy', 'mistake', 'blunder', 'missedWin'] as const;
    const total = blackErrors.reduce((sum, label) => sum + review.black.counts[label], 0);
    expect(total).toBeGreaterThan(0);
  });

  it('offers the Lichess accuracy scale without changing a label', () => {
    const lichess = buildGameReview(game, analyses, { ...reviewOptions, accuracyModel: 'lichess' });
    expect(lichess.moves.map((m) => m.classification)).toEqual(
      review.moves.map((m) => m.classification),
    );
    expect(lichess.whiteWinPercents).toEqual(review.whiteWinPercents);
    expect(lichess.black.accuracy).toBeLessThan(lichess.white.accuracy);
    expect(lichess.white.accuracy).not.toBe(review.white.accuracy);
    for (const player of [review.white, review.black, lichess.white, lichess.black]) {
      expect(player.accuracy).toBeGreaterThan(0);
      expect(player.accuracy).toBeLessThanOrEqual(100);
    }
  });

  it('explains every move and highlights key moments', () => {
    for (const move of review.moves) expect(move.explanation.trim()).not.toBe('');
    expect(review.keyMoments.length).toBeGreaterThan(0);
    expect(review.keyMoments).toContain(moveBy('w', 'Qb8+').ply);
  });
});
