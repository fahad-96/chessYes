/**
 * Test helper: runs the real Stockfish build from the npm package in Node, wrapped in
 * the Worker interface StockfishEngine expects, so tests exercise genuine engine output.
 * The npm build keeps its state at module level, so create at most one per test file.
 */
import { vi } from 'vitest';
import type { EngineWorker } from '@/engine/stockfish';

/** The part of the package's Node API we use (it ships no type declarations). */
interface NodeStockfish {
  processCommand(command: string): void;
  terminate(): void;
}
type LoadStockfish = (flavor: string, onLine: (line: string) => void) => NodeStockfish;

/** Same flavour the browser loads from public/engine. */
const FLAVOR = 'lite-single';

/**
 * Starts the engine and returns it as an EngineWorker. `onLine` sees every line the
 * engine prints (handy for tests that parse the raw output themselves).
 *
 * The package calls its listener synchronously while a command runs; answering from
 * inside it corrupts the engine's output buffer, so both directions are deferred to a
 * macrotask, which is also how a real worker behaves.
 */
export async function createNodeEngineWorker(
  onLine?: (line: string) => void,
): Promise<EngineWorker> {
  // vi.importActual loads the CommonJS package without needing type declarations.
  const { default: loadStockfish } = await vi.importActual<{ default: LoadStockfish }>('stockfish');
  const worker: EngineWorker = {
    onmessage: null,
    onerror: null,
    postMessage: (command) => setTimeout(() => stockfish.processCommand(command), 0),
    terminate: () => stockfish.terminate(),
  };
  const stockfish = loadStockfish(FLAVOR, (line) => {
    onLine?.(line);
    setTimeout(() => worker.onmessage?.({ data: line } as MessageEvent), 0);
  });
  return worker;
}
