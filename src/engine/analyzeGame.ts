import { Chess } from 'chess.js';
import type {
  AnalysisProgress,
  AnalysisSettings,
  ParsedGame,
  PositionAnalysis,
  TerminalState,
} from '@/core/types';
import type { Engine } from './stockfish';

export interface AnalyzeGameOptions {
  engine: Engine;
  settings: AnalysisSettings;
  /** Previously finished analyses (e.g. from cache); non-null entries are not re-searched. */
  existing?: (PositionAnalysis | null)[];
  signal?: AbortSignal;
  /** Called once per finished position (including terminal ones), in order. */
  onPosition?: (index: number, analysis: PositionAnalysis) => void;
  onProgress?: (progress: AnalysisProgress) => void;
}

/** What has to happen for one position before the run starts. */
type Step =
  | { kind: 'reuse'; analysis: PositionAnalysis }
  | { kind: 'terminal'; analysis: PositionAnalysis }
  | { kind: 'search'; fen: string; legalMoves: number };

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/** FEN of position `index`: 0 is the start, i is the position after move i. */
function positionFen(game: ParsedGame, index: number): string {
  return index === 0 ? game.initialFen : game.moves[index - 1]!.fenAfter;
}

function planStep(
  game: ParsedGame,
  index: number,
  existing: PositionAnalysis | null | undefined,
): Step {
  const fen = positionFen(game, index);
  // Reuse only an entry for this exact position, so a stale or mismatched cache cannot leak in.
  if (existing && existing.fen === fen) return { kind: 'reuse', analysis: existing };

  const chess = new Chess(fen);
  const legalMoves = chess.moves().length;
  // The source's verdict (e.g. a threefold the server enforced) only applies to the final
  // position. Mate and stalemate are checked on every board in case finalState is missing.
  let terminal: TerminalState | undefined =
    index === game.moves.length ? game.finalState : undefined;
  if (!terminal && legalMoves === 0) terminal = chess.inCheck() ? 'checkmate' : 'stalemate';

  return terminal
    ? { kind: 'terminal', analysis: { fen, depth: 0, lines: [], terminal } }
    : { kind: 'search', fen, legalMoves };
}

/** One engine search for position `index`, reporting live progress through `onUpdate`. */
function searchPosition(
  engine: Engine,
  game: ParsedGame,
  index: number,
  step: Extract<Step, { kind: 'search' }>,
  settings: AnalysisSettings,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: PositionAnalysis) => void) | undefined,
): Promise<PositionAnalysis> {
  return engine.analyze({
    fen: step.fen,
    initialFen: game.initialFen,
    moves: game.moves.slice(0, index).map((move) => move.uci),
    depth: settings.depth,
    multiPv: Math.max(1, Math.min(settings.multiPv, step.legalMoves)),
    maxTimeMs: settings.maxTimeMs,
    signal,
    onUpdate,
  });
}

/**
 * Times the searches of one run and turns that into progress events: an ETA from the average
 * time per searched position, and the depth and speed of the search in progress.
 */
function createProgressReporter(total: number, searches: number) {
  let searched = 0;
  let searchTimeMs = 0;
  let remaining = searches;
  const averageMs = () => (searched > 0 ? searchTimeMs / searched : undefined);

  return {
    /** Progress while a search runs (`done` positions finished before it). */
    live(done: number, startedAt: number, partial: PositionAnalysis): AnalysisProgress {
      const progress: AnalysisProgress = { done, total, currentDepth: partial.depth };
      const average = averageMs();
      if (average !== undefined) {
        const elapsed = Date.now() - startedAt;
        progress.etaMs = Math.max(0, Math.round(average * remaining - elapsed));
      }
      if (partial.nodes !== undefined && partial.timeMs) {
        progress.nps = Math.round((partial.nodes * 1000) / partial.timeMs);
      }
      return progress;
    },
    searchFinished(startedAt: number): void {
      searchTimeMs += Date.now() - startedAt;
      searched += 1;
      remaining -= 1;
    },
    /** Progress after a position is finished. */
    finished(done: number): AnalysisProgress {
      const progress: AnalysisProgress = { done, total };
      const average = averageMs();
      if (average !== undefined) progress.etaMs = Math.round(average * remaining);
      return progress;
    },
  };
}

/**
 * Analyses every position of a game: index 0 = start, index i = after move i.
 * - Positions are searched in order so the UI can stream results.
 * - The final position is not searched when game.finalState is set; it gets
 *   { fen, depth: 0, lines: [], terminal }.
 * - MultiPV is capped at the number of legal moves.
 * - The engine receives the move history (repetition-aware evaluation).
 * - ETA is estimated from the average time of positions searched in this run.
 * - Rejects with an AbortError when the signal aborts; results reported via
 *   onPosition so far remain valid (callers cache them for resuming).
 *
 * engine.newGame() is called once, right before the first search, so a fully
 * cached game never needs to start the engine.
 */
export async function analyzeGame(
  game: ParsedGame,
  options: AnalyzeGameOptions,
): Promise<PositionAnalysis[]> {
  const { engine, settings, existing = [], signal, onPosition, onProgress } = options;
  if (signal?.aborted) throw abortError();

  const steps = Array.from({ length: game.moves.length + 1 }, (_, index) =>
    planStep(game, index, existing[index]),
  );
  const total = steps.length;
  const reporter = createProgressReporter(
    total,
    steps.filter((step) => step.kind === 'search').length,
  );

  const results: PositionAnalysis[] = [];
  let newGameSent = false;

  for (const [index, step] of steps.entries()) {
    if (signal?.aborted) throw abortError();

    let analysis: PositionAnalysis;
    if (step.kind === 'search') {
      if (!newGameSent) {
        await engine.newGame();
        newGameSent = true;
        if (signal?.aborted) throw abortError();
      }

      const startedAt = Date.now();
      const done = results.length;
      analysis = await searchPosition(engine, game, index, step, settings, signal, (partial) =>
        onProgress?.(reporter.live(done, startedAt, partial)),
      );
      reporter.searchFinished(startedAt);
    } else {
      analysis = step.analysis;
    }

    results.push(analysis);
    onPosition?.(index, analysis);
    onProgress?.(reporter.finished(results.length));
  }

  return results;
}

export interface AnalyzePositionsOptions {
  engine: Engine;
  settings: AnalysisSettings;
  /** Positions to search (0 = start, i = after move i). Duplicates are searched once. */
  indices: readonly number[];
  signal?: AbortSignal;
  /** Called once per searched position, in index order. */
  onPosition?: (index: number, analysis: PositionAnalysis) => void;
  /** `done` and `total` count the positions to search, not the whole game. */
  onProgress?: (progress: AnalysisProgress) => void;
}

/**
 * Searches selected positions of a game again, for example to verify a shallow result at a
 * greater depth (see refine.ts). Unlike analyzeGame it ignores earlier results and keeps the
 * engine's hash table (what the engine learned about this game only helps). Positions where
 * the game is over have nothing to search and are skipped. The engine still receives the
 * move history, so repetitions are seen.
 *
 * Resolves with the new analyses by position index. Rejects with an AbortError when the
 * signal aborts; results reported via onPosition so far remain valid.
 */
export async function analyzePositions(
  game: ParsedGame,
  options: AnalyzePositionsOptions,
): Promise<Map<number, PositionAnalysis>> {
  const { engine, settings, indices, signal, onPosition, onProgress } = options;
  if (signal?.aborted) throw abortError();

  const last = game.moves.length;
  const searches = [...new Set(indices)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index <= last)
    .sort((a, b) => a - b)
    .map((index) => ({ index, step: planStep(game, index, undefined) }))
    .filter(
      (item): item is { index: number; step: Extract<Step, { kind: 'search' }> } =>
        item.step.kind === 'search',
    );
  const reporter = createProgressReporter(searches.length, searches.length);
  const results = new Map<number, PositionAnalysis>();

  for (const [done, { index, step }] of searches.entries()) {
    if (signal?.aborted) throw abortError();
    const startedAt = Date.now();
    const analysis = await searchPosition(engine, game, index, step, settings, signal, (partial) =>
      onProgress?.(reporter.live(done, startedAt, partial)),
    );
    reporter.searchFinished(startedAt);
    results.set(index, analysis);
    onPosition?.(index, analysis);
    onProgress?.(reporter.finished(done + 1));
  }

  return results;
}
