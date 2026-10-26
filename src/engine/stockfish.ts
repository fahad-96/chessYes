import { Chess } from 'chess.js';
import { sideToMove } from '@/core/notation';
import type { EngineLine, PositionAnalysis } from '@/core/types';
import { parseBestMove, parseInfoLine } from './uci';

export interface AnalyzeRequest {
  /** FEN of the position to analyse (used for side to move and the result). */
  fen: string;
  /** Game start FEN and the UCI moves leading to `fen`, so the engine sees repetition history. */
  initialFen: string;
  moves: string[];
  depth: number;
  multiPv: number;
  maxTimeMs: number;
  signal?: AbortSignal;
  /** Called with partial results as the search deepens (for live display). */
  onUpdate?: (partial: PositionAnalysis) => void;
}

/** Minimal interface the rest of the app depends on; lets tests use a fake engine. */
export interface Engine {
  readonly name: string;
  init(): Promise<void>;
  analyze(request: AnalyzeRequest): Promise<PositionAnalysis>;
  /** Clears hash tables between games (UCI ucinewgame). */
  newGame(): Promise<void>;
  terminate(): void;
}

export const ENGINE_FILE = 'stockfish-19-lite-single.js';
export const ENGINE_NAME = 'Stockfish 19 lite';

/**
 * The part of the Web Worker API the engine uses. A real `Worker` satisfies it;
 * tests and Node scripts can pass their own implementation via `createWorker`.
 */
export interface EngineWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(command: string): void;
  terminate(): void;
}

export interface StockfishEngineOptions {
  /** Creates the worker. Defaults to the bundled engine served from `public/engine/`. */
  createWorker?: () => EngineWorker;
}

/** How long to wait for the engine to load before giving up (slow mobile networks). */
const INIT_TIMEOUT_MS = 60_000;
/** How long to wait for "bestmove" after "stop" before treating the engine as hung. */
const STOP_TIMEOUT_MS = 3_000;
/** Minimum gap between onUpdate calls, so the UI re-renders at most ~10 times a second. */
const UPDATE_INTERVAL_MS = 100;

/** The command currently waiting for engine output (handshake, newGame or a search). */
interface PendingCommand {
  onLine(line: string): void;
  fail(error: Error): void;
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function defaultWorker(): EngineWorker {
  return new Worker(`${import.meta.env.BASE_URL}engine/${ENGINE_FILE}`);
}

/** Smaller hash on low-memory phones: the engine shares the tab's memory budget. */
function hashSizeMb(): number {
  const memory =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return memory !== undefined && memory <= 2 ? 16 : 32;
}

/** UCI moves (with castling as king moves) that are legal in `fen`. */
function legalUciMoves(fen: string): Set<string> {
  return new Set(new Chess(fen).moves({ verbose: true }).map((move) => move.lan));
}

/**
 * Stockfish running in a Web Worker (single-threaded lite WASM build, served from
 * `${import.meta.env.BASE_URL}engine/`). Speaks UCI over postMessage.
 *
 * - init(): "uci" → wait "uciok"; set Hash (16 MB if navigator.deviceMemory <= 2, else 32);
 *   "isready" → "readyok". Rejects with a readable Error if the worker fails to load
 *   (e.g. no WebAssembly support).
 * - analyze(): one search at a time (calls are queued). Sends
 *   "setoption name MultiPV value N", "position fen <initialFen> moves ...",
 *   "go depth D movetime T". Keeps, per MultiPV index, the latest exact-bound line
 *   at the highest depth; resolves on "bestmove" with lines sorted by MultiPV index.
 *   Lines whose first move is not legal are dropped. If aborted, sends "stop" and
 *   rejects with a DOMException named "AbortError" after the engine answers.
 * - If the worker crashes, pending calls reject and the next call re-creates it.
 */
export class StockfishEngine implements Engine {
  readonly name = ENGINE_NAME;

  private readonly createWorker: () => EngineWorker;
  private worker: EngineWorker | null = null;
  private ready: Promise<void> | null = null;
  private pending: PendingCommand | null = null;
  /** Tail of the command queue; never rejects, so one failure does not block later calls. */
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * Bumped whenever the worker dies. Calls queued before that reject with `lastFailure`
   * instead of silently running on a fresh engine.
   */
  private generation = 0;
  private lastFailure: Error = new Error('The engine stopped unexpectedly.');

  constructor(options: StockfishEngineOptions = {}) {
    this.createWorker = options.createWorker ?? defaultWorker;
  }

  init(): Promise<void> {
    if (!this.ready) {
      const ready = this.start();
      this.ready = ready;
      // A failed start must not stick: the next call tries again.
      ready.catch(() => {
        if (this.ready === ready) this.ready = null;
      });
    }
    return this.ready;
  }

  analyze(request: AnalyzeRequest): Promise<PositionAnalysis> {
    return this.enqueue(async () => {
      if (request.signal?.aborted) throw abortError();
      await this.init();
      return this.search(request);
    });
  }

  newGame(): Promise<void> {
    return this.enqueue(async () => {
      await this.init();
      await this.command(['ucinewgame', 'isready'], (line) => line === 'readyok');
    });
  }

  terminate(): void {
    this.shutDown(new Error('The engine was shut down.'));
  }

  /** Runs tasks one at a time, in call order. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    const run = this.queue.then(() => {
      if (generation !== this.generation) throw this.lastFailure;
      return task();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async start(): Promise<void> {
    if (typeof WebAssembly !== 'object') {
      throw new Error('This browser does not support WebAssembly, which the engine needs.');
    }

    let worker: EngineWorker;
    try {
      worker = this.createWorker();
    } catch (error) {
      throw new Error(`Could not start the engine: ${errorMessage(error)}`, { cause: error });
    }
    this.worker = worker;
    worker.onmessage = (event) => this.receive(worker, event.data);
    worker.onerror = (event) => {
      const detail = event.message ? `: ${event.message}` : '';
      this.shutDown(
        new Error(
          `The engine stopped working${detail}. Reload the page to try again; ` +
            'if it keeps happening, your browser may not support WebAssembly.',
        ),
        worker,
      );
    };

    const timeout = setTimeout(() => {
      this.shutDown(new Error('The engine took too long to load. Check your connection.'), worker);
    }, INIT_TIMEOUT_MS);
    try {
      await this.command(['uci'], (line) => line === 'uciok');
      await this.command(
        [`setoption name Hash value ${hashSizeMb()}`, 'isready'],
        (line) => line === 'readyok',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Sends commands and resolves when `isDone` accepts a line of output. */
  private command(commands: string[], isDone: (line: string) => boolean): Promise<void> {
    if (!this.worker) return Promise.reject(this.lastFailure);
    return new Promise((resolve, reject) => {
      this.pending = {
        onLine: (line) => {
          if (!isDone(line)) return;
          this.pending = null;
          resolve();
        },
        fail: reject,
      };
      this.send(...commands);
    });
  }

  private search(request: AnalyzeRequest): Promise<PositionAnalysis> {
    const { fen, signal, onUpdate } = request;
    // The signal may have fired while we waited for the queue or the handshake.
    if (signal?.aborted) return Promise.reject(abortError());
    if (!this.worker) return Promise.reject(this.lastFailure);
    const side = sideToMove(fen);
    const legal = legalUciMoves(fen);
    const multiPv = Math.max(1, Math.floor(request.multiPv));
    const depth = Math.max(1, Math.floor(request.depth));
    const movetime = Math.max(1, Math.floor(request.maxTimeMs));
    const startedAt = Date.now();

    const lines = new Map<number, EngineLine>();
    let nodes: number | undefined;
    let engineTimeMs: number | undefined;
    let stopping = false;
    let lastUpdateAt = 0;
    let updateTimer: ReturnType<typeof setTimeout> | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;

    const snapshot = (): PositionAnalysis => {
      const sorted = [...lines.entries()].sort(([a], [b]) => a - b).map(([, line]) => line);
      const result: PositionAnalysis = { fen, depth: sorted[0]?.depth ?? 0, lines: sorted };
      if (nodes !== undefined) result.nodes = nodes;
      result.timeMs = engineTimeMs ?? Date.now() - startedAt;
      return result;
    };

    const emitUpdate = () => {
      updateTimer = undefined;
      lastUpdateAt = Date.now();
      onUpdate?.(snapshot());
    };

    const scheduleUpdate = () => {
      if (!onUpdate || updateTimer !== undefined) return;
      const wait = UPDATE_INTERVAL_MS - (Date.now() - lastUpdateAt);
      if (wait <= 0) emitUpdate();
      else updateTimer = setTimeout(emitUpdate, wait);
    };

    return new Promise<PositionAnalysis>((resolve, reject) => {
      const cleanUp = () => {
        this.pending = null;
        clearTimeout(updateTimer);
        clearTimeout(stopTimer);
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        if (stopping) return;
        stopping = true;
        this.send('stop');
        // A hung engine would otherwise block the queue forever.
        stopTimer = setTimeout(() => {
          cleanUp();
          this.shutDown(new Error('The engine did not respond to "stop".'));
          reject(abortError());
        }, STOP_TIMEOUT_MS);
      };

      this.pending = {
        onLine: (line) => {
          if (line.startsWith('bestmove')) {
            if (!parseBestMove(line)) return;
            cleanUp();
            if (stopping) reject(abortError());
            else resolve(snapshot());
            return;
          }
          const info = parseInfoLine(line, side);
          if (!info) return;
          if (info.nodes !== undefined) nodes = info.nodes;
          if (info.timeMs !== undefined) engineTimeMs = info.timeMs;
          // Bound scores come from fail-high/low re-searches: only a direction, not a value.
          // An illegal first move means a stale or corrupt line; it must not replace a good one.
          if (info.bound || info.multipv > multiPv || !legal.has(info.pv[0]!)) return;
          const previous = lines.get(info.multipv);
          if (previous && info.depth < previous.depth) return;
          lines.set(info.multipv, { pv: info.pv, score: info.score, depth: info.depth });
          scheduleUpdate();
        },
        fail: (error) => {
          cleanUp();
          // Once the caller has aborted, the abort is the outcome they asked for.
          reject(stopping ? abortError() : error);
        },
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      const moves = request.moves.length > 0 ? ` moves ${request.moves.join(' ')}` : '';
      this.send(
        `setoption name MultiPV value ${multiPv}`,
        `position fen ${request.initialFen}${moves}`,
        `go depth ${depth} movetime ${movetime}`,
      );
    });
  }

  private send(...commands: string[]): void {
    for (const command of commands) this.worker?.postMessage(command);
  }

  private receive(worker: EngineWorker, data: unknown): void {
    // Ignore late messages from a worker we already replaced.
    if (worker !== this.worker || typeof data !== 'string') return;
    for (const raw of data.split('\n')) {
      const line = raw.trim();
      if (line) this.pending?.onLine(line);
    }
  }

  /**
   * Kills the worker (if `worker` is given, only when it is still the current one),
   * fails the waiting command and every call queued before now. The next call starts
   * a fresh worker.
   */
  private shutDown(error: Error, worker: EngineWorker | null = this.worker): void {
    if (worker !== this.worker) return;
    this.generation += 1;
    this.lastFailure = error;
    this.worker = null;
    this.ready = null;
    try {
      worker?.terminate();
    } catch {
      // Already gone.
    }
    const pending = this.pending;
    this.pending = null;
    pending?.fail(error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
