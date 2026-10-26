/**
 * Runs the real Stockfish build from the npm package in Node, through the same
 * StockfishEngine class the browser uses, so the UCI handling is checked against
 * genuine engine output (score signs, MultiPV, bestmove) rather than a script.
 */
import { Chess } from 'chess.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { START_FEN, sideToMove } from '@/core/notation';
import { createNodeEngineWorker } from '@/test/nodeStockfish';
import { StockfishEngine } from './stockfish';
import { parseBestMove, parseInfoLine } from './uci';

const WHITE_MATES_IN_ONE = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'; // Ra8#
const BLACK_MATES_IN_ONE = 'r5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1'; // ...Ra1#
const DEPTH = 10;
const TIMEOUT_MS = 60_000;

/** Every line the engine printed, so tests can parse the raw output themselves. */
const output: string[] = [];
let engine: StockfishEngine;

/** Output lines printed during `run`, i.e. for one search. */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const start = output.length;
  const result = await run();
  return { result, lines: output.slice(start) };
}

function isLegal(fen: string, uci: string): boolean {
  return new Chess(fen).moves({ verbose: true }).some((move) => move.lan === uci);
}

function analyzeFen(fen: string, multiPv = 2) {
  return engine.analyze({
    fen,
    initialFen: fen,
    moves: [],
    depth: DEPTH,
    multiPv,
    maxTimeMs: 20_000,
  });
}

beforeAll(async () => {
  const worker = await createNodeEngineWorker((line) => output.push(line));
  engine = new StockfishEngine({ createWorker: () => worker });
  await engine.init();
  await engine.newGame();
}, TIMEOUT_MS);

afterAll(() => {
  engine?.terminate();
});

describe('Stockfish (real engine, Node)', () => {
  it(
    'evaluates the start position as roughly equal with legal MultiPV lines',
    async () => {
      const { result, lines } = await captureOutput(() => analyzeFen(START_FEN));

      expect(result.fen).toBe(START_FEN);
      expect(result.depth).toBe(DEPTH);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]!.pv[0]).not.toBe(result.lines[1]!.pv[0]);
      for (const line of result.lines) {
        expect(isLegal(START_FEN, line.pv[0]!)).toBe(true);
        expect(line.score.type).toBe('cp');
        expect(Math.abs(line.score.value)).toBeLessThan(100);
      }
      expect(result.nodes).toBeGreaterThan(0);
      expect(result.timeMs).toBeGreaterThanOrEqual(0);

      const infos = lines.map((line) => parseInfoLine(line, 'w')).filter((info) => info !== null);
      expect(infos.length).toBeGreaterThan(DEPTH);
      expect(infos.every((info) => info.multipv === 1 || info.multipv === 2)).toBe(true);
      const best = parseBestMove(lines.find((line) => line.startsWith('bestmove'))!);
      expect(isLegal(START_FEN, best!.best!)).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'reports a positive mate score when White mates in one',
    async () => {
      const { result, lines } = await captureOutput(() => analyzeFen(WHITE_MATES_IN_ONE));

      expect(result.lines[0]).toMatchObject({ pv: ['a1a8'], score: { type: 'mate', value: 1 } });
      // The runner-up keeps a big material edge for White.
      expect(result.lines[1]!.score.type).toBe('cp');
      expect(result.lines[1]!.score.value).toBeGreaterThan(300);

      const side = sideToMove(WHITE_MATES_IN_ONE);
      const mateScores = lines
        .map((line) => parseInfoLine(line, side))
        .filter((info) => info !== null && info.multipv === 1 && info.score.type === 'mate');
      expect(mateScores.length).toBeGreaterThan(0);
      expect(mateScores.every((info) => info!.score.value === 1)).toBe(true);
      expect(parseBestMove(lines.find((line) => line.startsWith('bestmove'))!)?.best).toBe('a1a8');
    },
    TIMEOUT_MS,
  );

  it(
    'reports a negative mate score (White POV) when Black mates in one',
    async () => {
      const { result, lines } = await captureOutput(() => analyzeFen(BLACK_MATES_IN_ONE));

      expect(result.lines[0]).toMatchObject({ pv: ['a8a1'], score: { type: 'mate', value: -1 } });
      expect(result.lines[1]!.score.type).toBe('cp');
      expect(result.lines[1]!.score.value).toBeLessThan(-300);

      const side = sideToMove(BLACK_MATES_IN_ONE);
      const mateScores = lines
        .map((line) => parseInfoLine(line, side))
        .filter((info) => info !== null && info.multipv === 1 && info.score.type === 'mate');
      expect(mateScores.length).toBeGreaterThan(0);
      expect(mateScores.every((info) => info!.score.value === -1)).toBe(true);
      expect(parseBestMove(lines.find((line) => line.startsWith('bestmove'))!)?.best).toBe('a8a1');
    },
    TIMEOUT_MS,
  );

  it(
    'follows the move history given after the start position',
    async () => {
      // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? and White mates with Qxf7.
      const moves = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6'];
      const chess = new Chess();
      for (const move of moves) chess.move(move);
      const result = await engine.analyze({
        fen: chess.fen(),
        initialFen: START_FEN,
        moves,
        depth: DEPTH,
        multiPv: 1,
        maxTimeMs: 20_000,
      });
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatchObject({ pv: ['h5f7'], score: { type: 'mate', value: 1 } });
    },
    TIMEOUT_MS,
  );

  it(
    'stops a long search on abort and stays usable',
    async () => {
      const controller = new AbortController();
      const search = engine.analyze({
        fen: START_FEN,
        initialFen: START_FEN,
        moves: [],
        depth: 40,
        multiPv: 1,
        maxTimeMs: 30_000,
        signal: controller.signal,
      });
      const startedAt = Date.now();
      setTimeout(() => controller.abort(), 200);
      await expect(search).rejects.toMatchObject({ name: 'AbortError' });
      expect(Date.now() - startedAt).toBeLessThan(5_000);

      const after = await analyzeFen(WHITE_MATES_IN_ONE, 1);
      expect(after.lines[0]?.pv[0]).toBe('a1a8');
    },
    TIMEOUT_MS,
  );
});
