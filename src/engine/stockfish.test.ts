import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '@/core/notation';
import { ENGINE_FILE, StockfishEngine, type AnalyzeRequest } from './stockfish';

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
/** 1.e4 e5 2.Nf3 d6 3.d4: Black to move, with ...Be6, ...Be7, ...Nf6 and ...exd4 legal. */
const PHILIDOR = 'rnbqkbnr/ppp2ppp/3p4/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 3';

/**
 * Stands in for the Web Worker: records commands and answers the handshake.
 * Searches are scripted per test through `onGo`.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: string[] = [];
  terminated = false;
  /** Answer "stop" with a bestmove (a hung engine would not). */
  answersStop = true;
  onGo?: (command: string, worker: FakeWorker) => void;

  constructor(readonly url: string) {
    FakeWorker.instances.push(this);
  }

  postMessage(command: string): void {
    this.sent.push(command);
    if (command === 'uci') this.emit('id name Fake', 'option name Hash type spin', 'uciok');
    else if (command === 'isready') this.emit('readyok');
    else if (command.startsWith('go')) this.onGo?.(command, this);
    else if (command === 'stop' && this.answersStop) this.emit('bestmove e7e5');
  }

  /** Delivers lines asynchronously, like a real worker, in a single message. */
  emit(...lines: string[]): void {
    queueMicrotask(() => this.onmessage?.({ data: lines.join('\n') } as MessageEvent));
  }

  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function latestWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (!worker) throw new Error('no worker created');
  return worker;
}

function request(overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  return {
    fen: AFTER_E4,
    initialFen: START_FEN,
    moves: ['e2e4'],
    depth: 3,
    multiPv: 2,
    maxTimeMs: 1000,
    ...overrides,
  };
}

/** Waits until the worker has received `command`. */
async function sentCommand(worker: () => FakeWorker, command: string): Promise<void> {
  await vi.waitFor(() => expect(worker().sent).toContain(command));
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('StockfishEngine handshake', () => {
  it('loads the bundled engine and completes uci / Hash / isready', async () => {
    const engine = new StockfishEngine();
    await engine.init();
    const worker = latestWorker();
    expect(worker.url).toBe(`/engine/${ENGINE_FILE}`);
    expect(worker.sent).toEqual(['uci', 'setoption name Hash value 32', 'isready']);
  });

  it('uses a 16 MB hash on low-memory devices', async () => {
    vi.stubGlobal('navigator', { deviceMemory: 2 });
    const engine = new StockfishEngine();
    await engine.init();
    expect(latestWorker().sent).toContain('setoption name Hash value 16');
  });

  it('starts a single worker however often init is called', async () => {
    const engine = new StockfishEngine();
    await Promise.all([engine.init(), engine.init()]);
    await engine.init();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects with a readable error when the worker fails to load, then retries', async () => {
    class BrokenWorker extends FakeWorker {
      override postMessage(command: string): void {
        this.sent.push(command);
        queueMicrotask(() => this.crash('WebAssembly is not defined'));
      }
    }
    vi.stubGlobal('Worker', BrokenWorker);
    const engine = new StockfishEngine();
    await expect(engine.init()).rejects.toThrow(/WebAssembly is not defined/);
    expect(latestWorker().terminated).toBe(true);

    vi.stubGlobal('Worker', FakeWorker);
    await engine.init();
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('rejects when the worker cannot be constructed', async () => {
    const engine = new StockfishEngine({
      createWorker: () => {
        throw new Error('blocked by policy');
      },
    });
    await expect(engine.init()).rejects.toThrow('Could not start the engine: blocked by policy');
  });

  it('sends ucinewgame and waits for readyok on newGame', async () => {
    const engine = new StockfishEngine();
    await engine.newGame();
    expect(latestWorker().sent.slice(-2)).toEqual(['ucinewgame', 'isready']);
  });
});

describe('StockfishEngine.analyze', () => {
  it('sends the position with history and collects exact MultiPV lines', async () => {
    const engine = new StockfishEngine();
    const promise = engine.analyze(request());
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    const worker = latestWorker();
    expect(worker.sent.slice(-3)).toEqual([
      'setoption name MultiPV value 2',
      `position fen ${START_FEN} moves e2e4`,
      'go depth 3 movetime 1000',
    ]);

    worker.emit(
      'info string NNUE evaluation using nn-61e7af4bb97d.nnue',
      'info depth 1 multipv 1 score cp 10 nodes 100 time 1 pv e7e5',
      'info depth 1 multipv 2 score cp 5 nodes 100 time 1 pv c7c5',
      // A fail-high with a tempting move: only a bound, must be ignored.
      'info depth 2 multipv 1 score cp 40 lowerbound nodes 200 time 2 pv d7d5',
      'info depth 2 multipv 1 score cp 25 nodes 300 time 3 pv e7e5 g1f3',
      'info depth 2 multipv 2 score cp 15 nodes 300 time 3 pv c7c5 g1f3',
      // Lower depth than what we have: ignored.
      'info depth 1 multipv 2 score cp 99 nodes 310 time 3 pv a7a6',
      // Illegal first move for Black: dropped, keeps the depth-2 line.
      'info depth 3 multipv 2 score cp -10 nodes 400 time 4 pv e2e4',
      'info depth 3 currmove e7e5 currmovenumber 1',
      'info depth 3 multipv 1 score mate 5 nodes 500 time 5 pv e7e5 g1f3',
      'bestmove e7e5 ponder g1f3',
    );

    // Black is to move, so scores flip to White's point of view.
    await expect(promise).resolves.toEqual({
      fen: AFTER_E4,
      depth: 3,
      lines: [
        { pv: ['e7e5', 'g1f3'], score: { type: 'mate', value: -5 }, depth: 3 },
        { pv: ['c7c5', 'g1f3'], score: { type: 'cp', value: -15 }, depth: 2 },
      ],
      nodes: 500,
      timeMs: 5,
    });
  });

  it('sorts lines by MultiPV index and ignores indices above the request', async () => {
    const engine = new StockfishEngine();
    const promise = engine.analyze(request({ multiPv: 2 }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    latestWorker().emit(
      'info depth 4 multipv 3 score cp 1 pv a7a6',
      'info depth 4 multipv 2 score cp 2 pv c7c5',
      'info depth 4 multipv 1 score cp 3 pv e7e5',
      'bestmove e7e5',
    );
    const result = await promise;
    expect(result.lines.map((line) => line.pv[0])).toEqual(['e7e5', 'c7c5']);
  });

  it('uses "position fen" without moves for a bare position', async () => {
    const engine = new StockfishEngine();
    const promise = engine.analyze(request({ fen: START_FEN, moves: [], multiPv: 1 }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    expect(latestWorker().sent).toContain(`position fen ${START_FEN}`);
    latestWorker().emit('info depth 3 score cp 30 pv e2e4', 'bestmove e2e4');
    expect((await promise).lines[0]?.score).toEqual({ type: 'cp', value: 30 });
  });

  it('runs one search at a time, in call order', async () => {
    const engine = new StockfishEngine();
    const first = engine.analyze(request({ depth: 5 }));
    const second = engine.analyze(request({ depth: 6 }));
    await sentCommand(latestWorker, 'go depth 5 movetime 1000');
    const worker = latestWorker();
    expect(worker.sent.filter((c) => c.startsWith('go'))).toHaveLength(1);

    worker.emit('info depth 5 score cp 1 pv e7e5', 'bestmove e7e5');
    await first;
    await sentCommand(latestWorker, 'go depth 6 movetime 1000');
    worker.emit('info depth 6 score cp 2 pv e7e5', 'bestmove e7e5');
    expect((await second).depth).toBe(6);
  });

  it('throttles live updates to about ten per second', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const engine = new StockfishEngine();
    const updates: number[] = [];
    const promise = engine.analyze(request({ onUpdate: (partial) => updates.push(partial.depth) }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    const worker = latestWorker();

    worker.emit(
      'info depth 1 score cp 1 pv e7e5',
      'info depth 2 score cp 2 pv e7e5',
      'info depth 3 score cp 3 pv e7e5',
    );
    await vi.waitFor(() => expect(updates).toEqual([1]));
    await vi.advanceTimersByTimeAsync(100);
    expect(updates).toEqual([1, 3]);

    worker.emit('bestmove e7e5');
    await promise;
    await vi.advanceTimersByTimeAsync(500);
    expect(updates).toEqual([1, 3]);
  });

  it('sends stop on abort and rejects with AbortError once the engine answers', async () => {
    const engine = new StockfishEngine();
    const controller = new AbortController();
    const promise = engine.analyze(request({ signal: controller.signal }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    latestWorker().emit('info depth 1 score cp 1 pv e7e5');

    controller.abort();
    expect(latestWorker().sent.at(-1)).toBe('stop');
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    // The engine stays usable after an abort.
    const next = engine.analyze(request({ depth: 4 }));
    await sentCommand(latestWorker, 'go depth 4 movetime 1000');
    latestWorker().emit('info depth 4 score cp 7 pv e7e5', 'bestmove e7e5');
    expect((await next).depth).toBe(4);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects without searching when the signal is already aborted', async () => {
    const engine = new StockfishEngine();
    await engine.init();
    const promise = engine.analyze(request({ signal: AbortSignal.abort() }));
    await expect(promise).rejects.toBeInstanceOf(DOMException);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(latestWorker().sent.some((c) => c.startsWith('go'))).toBe(false);
  });

  it('gives up on an engine that ignores stop and replaces it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const engine = new StockfishEngine();
    const controller = new AbortController();
    const promise = engine.analyze(request({ signal: controller.signal }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    const hung = latestWorker();
    hung.answersStop = false;

    controller.abort();
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(3000);
    await rejection;
    expect(hung.terminated).toBe(true);

    vi.useRealTimers();
    const next = engine.analyze(request({ depth: 2 }));
    await sentCommand(latestWorker, 'go depth 2 movetime 1000');
    expect(latestWorker()).not.toBe(hung);
    latestWorker().emit('info depth 2 score cp 0 pv e7e5', 'bestmove e7e5');
    await next;
  });

  it('rejects pending calls when the worker crashes and recreates it on the next call', async () => {
    const engine = new StockfishEngine();
    const running = engine.analyze(request());
    const queued = engine.analyze(request({ depth: 9 }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    const crashed = latestWorker();

    crashed.crash('RuntimeError: memory access out of bounds');
    await expect(running).rejects.toThrow(/memory access out of bounds/);
    await expect(queued).rejects.toThrow(/memory access out of bounds/);
    expect(crashed.terminated).toBe(true);
    expect(crashed.sent.some((c) => c.startsWith('go depth 9'))).toBe(false);

    const next = engine.analyze(request({ depth: 4 }));
    await sentCommand(latestWorker, 'go depth 4 movetime 1000');
    const fresh = latestWorker();
    expect(fresh).not.toBe(crashed);
    expect(fresh.sent.slice(0, 3)).toEqual(['uci', 'setoption name Hash value 32', 'isready']);
    fresh.emit('info depth 4 score cp 12 pv e7e5', 'bestmove e7e5');
    expect((await next).lines[0]?.score).toEqual({ type: 'cp', value: -12 });
  });

  it('ignores messages from a worker that was already replaced', async () => {
    const engine = new StockfishEngine();
    await engine.init();
    const old = latestWorker();
    old.crash('gone');

    const next = engine.analyze(request());
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    old.emit('info depth 30 score cp 999 pv e7e5', 'bestmove e7e5');
    latestWorker().emit('info depth 3 score cp 5 pv c7c5', 'bestmove c7c5');
    expect((await next).lines).toEqual([
      { pv: ['c7c5'], score: { type: 'cp', value: -5 }, depth: 3 },
    ]);
  });

  it('still reports AbortError when the worker dies after an abort', async () => {
    const engine = new StockfishEngine();
    const controller = new AbortController();
    const promise = engine.analyze(request({ signal: controller.signal }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    latestWorker().answersStop = false;
    controller.abort();
    latestWorker().crash('boom');
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects the running search on terminate', async () => {
    const engine = new StockfishEngine();
    const promise = engine.analyze(request());
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    engine.terminate();
    await expect(promise).rejects.toThrow('The engine was shut down.');
    expect(latestWorker().terminated).toBe(true);
  });

  it('never mixes iterations when the time cap stops a search mid-iteration', async () => {
    // Real Stockfish output: depth 12 re-searched f8e7 with only a bound, and its line 2
    // repeats the depth-11 line 1. Filling each slot on its own gave [c8e6, c8e6]; both
    // lines now come from depth 11, the deepest iteration with every line.
    const engine = new StockfishEngine();
    const promise = engine.analyze(request({ fen: PHILIDOR, initialFen: PHILIDOR, moves: [] }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    latestWorker().emit(
      'info depth 11 multipv 1 score cp -29 pv c8e6 b1c3',
      'info depth 11 multipv 2 score cp -31 pv f8e7 b1c3',
      'info depth 12 multipv 1 score cp -27 lowerbound pv f8e7',
      'info depth 12 multipv 2 score cp -28 pv c8e6 b1c3',
      'bestmove f8e7',
    );
    const result = await promise;
    expect(result.lines.map((line) => [line.pv[0], line.depth])).toEqual([
      ['c8e6', 11],
      ['f8e7', 11],
    ]);
    expect(result.depth).toBe(11);
  });

  it("takes a deeper line 1 that is the engine's choice and keeps a different line 2", async () => {
    // The best move changed at depth 10, and line 2 was cut off with only a bound.
    const engine = new StockfishEngine();
    const promise = engine.analyze(request({ fen: PHILIDOR, initialFen: PHILIDOR, moves: [] }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    latestWorker().emit(
      'info depth 9 multipv 1 score cp -20 pv g8f6 b1c3',
      'info depth 9 multipv 2 score cp -35 pv e5d4 f3d4',
      'info depth 10 multipv 1 score cp -25 pv e5d4 f3d4',
      'info depth 10 multipv 2 score cp -30 upperbound pv g8f6',
      'bestmove e5d4',
    );
    const result = await promise;
    expect(result.lines.map((line) => [line.pv[0], line.depth])).toEqual([
      ['e5d4', 10],
      ['g8f6', 9],
    ]);
    expect(result.depth).toBe(10);
  });

  it("ignores a deeper line 1 that is not the engine's final choice", async () => {
    const engine = new StockfishEngine();
    const promise = engine.analyze(request({ fen: PHILIDOR, initialFen: PHILIDOR, moves: [] }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    latestWorker().emit(
      'info depth 9 multipv 1 score cp -20 pv g8f6 b1c3',
      'info depth 9 multipv 2 score cp -35 pv e5d4 f3d4',
      'info depth 10 multipv 1 score cp -25 pv b8c6 d4d5',
      'bestmove g8f6',
    );
    const result = await promise;
    expect(result.lines.map((line) => line.pv[0])).toEqual(['g8f6', 'e5d4']);
  });

  it('takes the deepest line per slot, without repeats, when no iteration is complete', async () => {
    const engine = new StockfishEngine();
    const promise = engine.analyze(request());
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    latestWorker().emit(
      'info depth 2 multipv 1 score cp 20 pv e7e5',
      'info depth 1 multipv 2 score cp 30 pv e7e5',
      'bestmove e7e5',
    );
    expect((await promise).lines.map((line) => line.pv[0])).toEqual(['e7e5']);
  });

  it('returns no lines for a position without legal moves', async () => {
    const mated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    const engine = new StockfishEngine();
    const promise = engine.analyze(request({ fen: mated, initialFen: mated, moves: [] }));
    await sentCommand(latestWorker, 'go depth 3 movetime 1000');
    latestWorker().emit('info depth 0 score mate 0', 'bestmove (none)');
    expect(await promise).toMatchObject({ fen: mated, depth: 0, lines: [] });
  });
});
