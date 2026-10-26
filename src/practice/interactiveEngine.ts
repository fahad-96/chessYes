import { Chess } from 'chess.js';
import { sideToMove } from '@/core/notation';
import type { PositionAnalysis } from '@/core/types';
import { positionWhiteWinPercent, winPercentFor } from '@/core/winPercent';
import { StockfishEngine, type Engine } from '@/engine/stockfish';
import { getSharedEngine } from '@/features/review/engine';

/**
 * A second engine for interactive work (exploring variations, checking retried
 * moves, puzzles), so it never waits behind a full-game analysis. On low-memory
 * phones it falls back to the shared analysis engine instead of starting another.
 */
let enginePromise: Promise<Engine> | null = null;

function lowMemoryDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return memory !== undefined && memory <= 2;
}

export function getInteractiveEngine(): Promise<Engine> {
  if (lowMemoryDevice()) return getSharedEngine();
  if (!enginePromise) {
    enginePromise = (async () => {
      const engine = new StockfishEngine();
      await engine.init();
      return engine;
    })();
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

export interface EvaluateOptions {
  depth?: number;
  maxTimeMs?: number;
  multiPv?: number;
  signal?: AbortSignal;
  onUpdate?: (partial: PositionAnalysis) => void;
}

/** Analyses a single position with the interactive engine (no game history). */
export async function analysePosition(
  fen: string,
  { depth = 18, maxTimeMs = 4000, multiPv = 1, signal, onUpdate }: EvaluateOptions = {},
): Promise<PositionAnalysis> {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { fen, depth: 0, lines: [], terminal: 'checkmate' };
  if (chess.isStalemate()) return { fen, depth: 0, lines: [], terminal: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { fen, depth: 0, lines: [], terminal: 'insufficient' };
  const engine = await getInteractiveEngine();
  const legal = chess.moves().length;
  return engine.analyze({
    fen,
    initialFen: fen,
    moves: [],
    depth,
    maxTimeMs,
    multiPv: Math.max(1, Math.min(multiPv, legal)),
    signal,
    onUpdate,
  });
}

/**
 * Win % for the player who just moved into `fenAfter` (used by checkMove's `evaluate`).
 * Defaults are tuned to answer in about a second on a phone.
 */
export async function evaluateMoverWin(
  fenAfter: string,
  signal?: AbortSignal,
  options: Omit<EvaluateOptions, 'signal'> = {},
): Promise<number> {
  const analysis = await analysePosition(fenAfter, {
    depth: 14,
    maxTimeMs: 1500,
    ...options,
    signal,
  });
  const mover = sideToMove(fenAfter) === 'w' ? 'b' : 'w';
  return winPercentFor(positionWhiteWinPercent(analysis), mover);
}
