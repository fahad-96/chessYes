import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { START_FEN } from '@/core/notation';
import type {
  AnalysisProgress,
  ParsedGame,
  ParsedMove,
  PositionAnalysis,
  TerminalState,
} from '@/core/types';
import { analyzeGame } from './analyzeGame';
import type { AnalyzeRequest, Engine } from './stockfish';

const settings = { depth: 14, multiPv: 2, maxTimeMs: 2000 };

/** Builds a ParsedGame with chess.js so these tests do not depend on the PGN parser. */
function makeGame(sans: string[], initialFen = START_FEN, finalState?: TerminalState): ParsedGame {
  const chess = new Chess(initialFen);
  const moves: ParsedMove[] = sans.map((san, i) => {
    const move = chess.move(san);
    return {
      ply: i + 1,
      moveNumber: Number(move.before.split(' ')[5]),
      color: move.color,
      san: move.san,
      uci: move.lan,
      from: move.from,
      to: move.to,
      piece: move.piece,
      fenBefore: move.before,
      fenAfter: move.after,
      isCheck: move.san.includes('+') || move.san.includes('#'),
      isCheckmate: move.san.includes('#'),
    };
  });
  return finalState
    ? { headers: {}, initialFen, moves, finalState }
    : { headers: {}, initialFen, moves };
}

/** Records every request and answers with a canned line (the first legal move). */
class FakeEngine implements Engine {
  readonly name = 'Fake';
  readonly requests: AnalyzeRequest[] = [];
  newGameCalls = 0;
  /** Runs before each answer; lets a test pause, abort or emit partial updates. */
  beforeAnswer?: (request: AnalyzeRequest) => Promise<void> | void;

  async init(): Promise<void> {}

  async newGame(): Promise<void> {
    this.newGameCalls += 1;
  }

  async analyze(request: AnalyzeRequest): Promise<PositionAnalysis> {
    this.requests.push(request);
    await this.beforeAnswer?.(request);
    if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const firstMove = new Chess(request.fen).moves({ verbose: true })[0]!.lan;
    return {
      fen: request.fen,
      depth: request.depth,
      lines: [{ pv: [firstMove], score: { type: 'cp', value: 10 }, depth: request.depth }],
      nodes: 1000,
      timeMs: 5,
    };
  }

  terminate(): void {}
}

describe('analyzeGame', () => {
  it('analyses every position in order and passes the move history', async () => {
    const game = makeGame(['e4', 'e5', 'Nf3']);
    const engine = new FakeEngine();
    const indices: number[] = [];

    const results = await analyzeGame(game, {
      engine,
      settings,
      onPosition: (index) => indices.push(index),
    });

    expect(results).toHaveLength(4);
    expect(indices).toEqual([0, 1, 2, 3]);
    expect(engine.newGameCalls).toBe(1);
    expect(engine.requests.map((r) => r.moves)).toEqual([
      [],
      ['e2e4'],
      ['e2e4', 'e7e5'],
      ['e2e4', 'e7e5', 'g1f3'],
    ]);
    expect(engine.requests.map((r) => r.fen)).toEqual([
      START_FEN,
      ...game.moves.map((move) => move.fenAfter),
    ]);
    for (const request of engine.requests) {
      expect(request).toMatchObject({ initialFen: START_FEN, depth: 14, maxTimeMs: 2000 });
    }
    expect(results.map((r) => r.fen)).toEqual(engine.requests.map((r) => r.fen));
  });

  it('passes a custom start position as the history root', async () => {
    const initialFen = 'k7/8/2K5/8/8/8/8/7R w - - 0 1';
    const game = makeGame(['Rh8+', 'Ka7'], initialFen);
    const engine = new FakeEngine();
    await analyzeGame(game, { engine, settings });
    expect(engine.requests.map((r) => r.initialFen)).toEqual([initialFen, initialFen, initialFen]);
    expect(engine.requests[2]!.moves).toEqual(['h1h8', 'a8a7']);
  });

  it('caps MultiPV at the number of legal moves', async () => {
    // After Rh8+ Black's only legal move is Ka7.
    const game = makeGame(['Rh8+', 'Ka7'], 'k7/8/2K5/8/8/8/8/7R w - - 0 1');
    const engine = new FakeEngine();
    await analyzeGame(game, { engine, settings: { ...settings, multiPv: 3 } });
    expect(engine.requests.map((r) => r.multiPv)).toEqual([3, 1, 3]);
  });

  it('does not search a final position the source marked as over', async () => {
    const game = makeGame(['Rh8#'], 'k7/8/1K6/8/8/8/8/7R w - - 0 1', 'checkmate');
    const engine = new FakeEngine();
    const results = await analyzeGame(game, { engine, settings });
    expect(engine.requests).toHaveLength(1);
    expect(results[1]).toEqual({
      fen: game.moves[0]!.fenAfter,
      depth: 0,
      lines: [],
      terminal: 'checkmate',
    });
  });

  it('detects mate and stalemate on the board when finalState is missing', async () => {
    const mate = makeGame(['Rh8#'], 'k7/8/1K6/8/8/8/8/7R w - - 0 1');
    const stalemate = makeGame(['Qf7'], '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1');
    const engine = new FakeEngine();
    const mateResults = await analyzeGame(mate, { engine, settings });
    const stalemateResults = await analyzeGame(stalemate, { engine, settings });
    expect(engine.requests).toHaveLength(2);
    expect(mateResults[1]?.terminal).toBe('checkmate');
    expect(stalemateResults[1]?.terminal).toBe('stalemate');
  });

  it('uses the source verdict for draws that are not visible on the board', async () => {
    const game = makeGame(['e4', 'e5'], START_FEN, 'threefold');
    const engine = new FakeEngine();
    const results = await analyzeGame(game, { engine, settings });
    expect(engine.requests).toHaveLength(2);
    expect(results[2]).toMatchObject({ depth: 0, lines: [], terminal: 'threefold' });
  });

  it('skips positions that already have an analysis', async () => {
    const game = makeGame(['e4', 'e5', 'Nf3']);
    const cached: PositionAnalysis = {
      fen: game.moves[0]!.fenAfter,
      depth: 20,
      lines: [{ pv: ['e7e5'], score: { type: 'cp', value: 30 }, depth: 20 }],
    };
    const engine = new FakeEngine();
    const reported: PositionAnalysis[] = [];
    const results = await analyzeGame(game, {
      engine,
      settings,
      existing: [null, cached],
      onPosition: (_, analysis) => reported.push(analysis),
    });
    expect(engine.requests.map((r) => r.moves.length)).toEqual([0, 2, 3]);
    expect(results[1]).toBe(cached);
    expect(reported[1]).toBe(cached);
    expect(results).toHaveLength(4);
  });

  it('re-searches a cached entry that belongs to a different position', async () => {
    const game = makeGame(['e4']);
    const stale: PositionAnalysis = { fen: 'some other position', depth: 20, lines: [] };
    const engine = new FakeEngine();
    await analyzeGame(game, { engine, settings, existing: [null, stale] });
    expect(engine.requests).toHaveLength(2);
  });

  it('never touches the engine when everything is cached', async () => {
    const game = makeGame(['e4']);
    const engine = new FakeEngine();
    const first = await analyzeGame(game, { engine, settings });
    const fresh = new FakeEngine();
    const second = await analyzeGame(game, { engine: fresh, settings, existing: first });
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.newGameCalls).toBe(0);
    expect(second).toEqual(first);
  });

  it('reports progress after every position, counting cached ones', async () => {
    const game = makeGame(['e4', 'e5', 'Nf3']);
    const engine = new FakeEngine();
    const cached: PositionAnalysis = { fen: START_FEN, depth: 20, lines: [] };
    const progress: AnalysisProgress[] = [];
    await analyzeGame(game, {
      engine,
      settings,
      existing: [cached],
      onProgress: (p) => progress.push(p),
    });
    expect(progress.map((p) => [p.done, p.total])).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
    // No estimate until a position has actually been searched in this run.
    expect(progress[0]!.etaMs).toBeUndefined();
    expect(progress[1]!.etaMs).toBeTypeOf('number');
    expect(progress[3]!.etaMs).toBe(0);
  });

  it('forwards live engine updates as progress with depth and speed', async () => {
    const game = makeGame(['e4']);
    const engine = new FakeEngine();
    engine.beforeAnswer = (request) => {
      request.onUpdate?.({ fen: request.fen, depth: 7, lines: [], nodes: 50_000, timeMs: 100 });
    };
    const progress: AnalysisProgress[] = [];
    await analyzeGame(game, { engine, settings, onProgress: (p) => progress.push(p) });
    expect(progress[0]).toEqual({ done: 0, total: 2, currentDepth: 7, nps: 500_000 });
    expect(progress[2]).toMatchObject({ done: 1, total: 2, currentDepth: 7 });
  });

  it('stops before the next position when aborted and rejects with AbortError', async () => {
    const game = makeGame(['e4', 'e5', 'Nf3', 'Nc6']);
    const engine = new FakeEngine();
    const controller = new AbortController();
    const reported: number[] = [];
    const run = analyzeGame(game, {
      engine,
      settings,
      signal: controller.signal,
      onPosition: (index) => {
        reported.push(index);
        if (index === 1) controller.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(reported).toEqual([0, 1]);
    expect(engine.requests).toHaveLength(2);
  });

  it('passes the signal to the engine so a running search is interrupted', async () => {
    const game = makeGame(['e4', 'e5']);
    const engine = new FakeEngine();
    const controller = new AbortController();
    engine.beforeAnswer = (request) => {
      if (engine.requests.length === 2) controller.abort();
      expect(request.signal).toBe(controller.signal);
    };
    const reported: number[] = [];
    const run = analyzeGame(game, {
      engine,
      settings,
      signal: controller.signal,
      onPosition: (index) => reported.push(index),
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(reported).toEqual([0]);
  });

  it('rejects at once when the signal is already aborted', async () => {
    const engine = new FakeEngine();
    const run = analyzeGame(makeGame(['e4']), { engine, settings, signal: AbortSignal.abort() });
    await expect(run).rejects.toBeInstanceOf(DOMException);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.newGameCalls).toBe(0);
    expect(engine.requests).toHaveLength(0);
  });
});
