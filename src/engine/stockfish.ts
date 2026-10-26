import type { PositionAnalysis } from '@/core/types';

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

  init(): Promise<void> {
    throw new Error('not implemented');
  }

  analyze(_request: AnalyzeRequest): Promise<PositionAnalysis> {
    throw new Error('not implemented');
  }

  newGame(): Promise<void> {
    throw new Error('not implemented');
  }

  terminate(): void {
    throw new Error('not implemented');
  }
}
