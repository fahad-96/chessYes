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
  let remainingSearches = steps.filter((step) => step.kind === 'search').length;

  const results: PositionAnalysis[] = [];
  let searched = 0;
  let searchTimeMs = 0;
  let newGameSent = false;
  const averageMs = () => (searched > 0 ? searchTimeMs / searched : undefined);

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
      analysis = await engine.analyze({
        fen: step.fen,
        initialFen: game.initialFen,
        moves: game.moves.slice(0, index).map((move) => move.uci),
        depth: settings.depth,
        multiPv: Math.max(1, Math.min(settings.multiPv, step.legalMoves)),
        maxTimeMs: settings.maxTimeMs,
        signal,
        onUpdate: (partial) => {
          if (!onProgress) return;
          const progress: AnalysisProgress = { done, total, currentDepth: partial.depth };
          const average = averageMs();
          if (average !== undefined) {
            const elapsed = Date.now() - startedAt;
            progress.etaMs = Math.max(0, Math.round(average * remainingSearches - elapsed));
          }
          if (partial.nodes !== undefined && partial.timeMs) {
            progress.nps = Math.round((partial.nodes * 1000) / partial.timeMs);
          }
          onProgress(progress);
        },
      });
      searchTimeMs += Date.now() - startedAt;
      searched += 1;
      remainingSearches -= 1;
    } else {
      analysis = step.analysis;
    }

    results.push(analysis);
    onPosition?.(index, analysis);

    const progress: AnalysisProgress = { done: results.length, total };
    const average = averageMs();
    if (average !== undefined) progress.etaMs = Math.round(average * remainingSearches);
    onProgress?.(progress);
  }

  return results;
}
