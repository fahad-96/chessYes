import { StockfishEngine, type Engine } from '@/engine/stockfish';

/**
 * One engine per browser tab. Starting Stockfish costs a WASM download and
 * compile, so the instance lives at module level and survives navigation between
 * reviews; only the hash table is cleared when the game changes.
 */
let enginePromise: Promise<Engine> | null = null;
let currentGameId: string | null = null;
let createEngine: () => Engine = () => new StockfishEngine();

/** The shared engine, created and initialised on first use. Rejects if it cannot start. */
export function getSharedEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = startEngine();
    // Let a later call try again (e.g. after a transient worker load failure).
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

/**
 * A separate engine, created and initialised now, for work that runs beside the shared one
 * (the batch job analyses several games at once). The caller terminates it when done.
 */
export function startExtraEngine(): Promise<Engine> {
  return startEngine();
}

async function startEngine(): Promise<Engine> {
  if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly is not supported.');
  const engine = createEngine();
  try {
    await engine.init();
    return engine;
  } catch (error) {
    try {
      engine.terminate();
    } catch {
      // The worker never started; nothing to clean up.
    }
    throw error;
  }
}

/**
 * Clears the engine's hash table when moving to a different game, so results do not
 * depend on what was analysed before (and repeated visits give the same evaluations).
 */
export async function prepareEngineForGame(engine: Engine, gameId: string): Promise<void> {
  if (currentGameId === gameId) return;
  await engine.newGame();
  currentGameId = gameId;
}

/** Tests only: swaps the engine factory and forgets the current instance. */
export function setEngineFactoryForTests(factory: (() => Engine) | null): void {
  createEngine = factory ?? (() => new StockfishEngine());
  enginePromise = null;
  currentGameId = null;
}
