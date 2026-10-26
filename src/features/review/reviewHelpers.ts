/**
 * Pure helpers for the review screen. Kept free of React so they are easy to test.
 */
import type {
  AnalysisProgress,
  Classification,
  Color,
  GameRecord,
  GameResult,
  GameReview,
  MoveReview,
  ParsedGame,
  ParsedMove,
  PositionAnalysis,
} from '@/core/types';
import { PgnError } from '@/core/pgn';
import { parseUci, sideToMove } from '@/core/notation';
import { formatScore } from '@/core/winPercent';
import type { PresetId } from '@/engine/presets';
import { toLibraryEntry, type LibraryEntry, type Perspective } from '@/library/library';
import { NetworkError, NotFoundError, RateLimitError } from '@/sources/http';
import type { BoardArrow, BoardOrientation } from '@/components/Board';
import type { EvalBarValue } from '@/components/EvalBar';
import type { AnalysisState } from './useGameReview';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ReviewErrorKind =
  'not-found' | 'network' | 'rate-limit' | 'variant' | 'pgn' | 'unknown';

export interface ReviewLoadError {
  kind: ReviewErrorKind;
  title: string;
  message: string;
  /** Whether trying again can help (a missing game or a variant will not change). */
  retryable: boolean;
}

/** True for the DOMException (or lookalike) that fetch/abortable APIs reject with. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

function hasName(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;
}

function siteName(gameId: string): string {
  const source = gameId.split('/')[0];
  if (source === 'chesscom') return 'Chess.com';
  if (source === 'lichess') return 'Lichess';
  return 'the server';
}

/** Turns anything resolveGame/parsePgn can throw into a friendly message. */
export function describeLoadError(error: unknown, gameId: string): ReviewLoadError {
  const source = gameId.split('/')[0];
  const site = siteName(gameId);
  if (error instanceof NotFoundError || hasName(error, 'NotFoundError')) {
    if (source === 'pgn') {
      return {
        kind: 'not-found',
        title: 'Game not found',
        message:
          'This imported game is no longer saved in this browser. Import the PGN again to review it.',
        retryable: false,
      };
    }
    return {
      kind: 'not-found',
      title: 'Game not found',
      message: `We could not find this game on ${site}. It may have been removed, or the link may be wrong.`,
      retryable: true,
    };
  }
  if (error instanceof RateLimitError || hasName(error, 'RateLimitError')) {
    return {
      kind: 'rate-limit',
      title: 'Too many requests',
      message: `${site} is limiting requests right now. Wait a few seconds and try again.`,
      retryable: true,
    };
  }
  if (error instanceof NetworkError || hasName(error, 'NetworkError')) {
    return {
      kind: 'network',
      title: `Could not reach ${site}`,
      message: 'Check your internet connection and try again.',
      retryable: true,
    };
  }
  if (error instanceof PgnError || hasName(error, 'PgnError')) {
    return {
      kind: 'pgn',
      title: 'This game could not be read',
      message: errorMessage(error),
      retryable: false,
    };
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    message: errorMessage(error),
    retryable: true,
  };
}

/** Only standard chess can be reviewed; other variants get a clear explanation. */
export function isReviewableVariant(variant: string): boolean {
  return variant.toLowerCase() === 'standard';
}

export function variantError(variant: string): ReviewLoadError {
  return {
    kind: 'variant',
    title: 'This variant cannot be reviewed',
    message: `Kibitz reviews standard chess only, and this game was played as ${variant}.`,
    retryable: false,
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unexpected error.';
}

// ---------------------------------------------------------------------------
// Analysis bookkeeping
// ---------------------------------------------------------------------------

export const PRESET_ORDER: readonly PresetId[] = ['fast', 'standard', 'deep'];

/** The next deeper preset, or null when already at the deepest. */
export function deeperPreset(id: PresetId): PresetId | null {
  const index = PRESET_ORDER.indexOf(id);
  return PRESET_ORDER[index + 1] ?? null;
}

/** Presets deeper than `id`, deepest first. */
export function deeperPresets(id: PresetId): PresetId[] {
  return PRESET_ORDER.slice(PRESET_ORDER.indexOf(id) + 1).reverse();
}

/** Presets shallower than `id`, deepest first. */
export function shallowerPresets(id: PresetId): PresetId[] {
  return PRESET_ORDER.slice(0, Math.max(0, PRESET_ORDER.indexOf(id))).reverse();
}

/** Number of analysed positions from the start without a gap. */
export function contiguousCount(
  analyses: readonly (PositionAnalysis | null | undefined)[],
): number {
  let count = 0;
  while (count < analyses.length && analyses[count]) count++;
  return count;
}

export function isAnalysisComplete(
  analyses: readonly (PositionAnalysis | null | undefined)[] | null,
  totalPositions: number,
): boolean {
  return !!analyses && contiguousCount(analyses) >= totalPositions;
}

/**
 * Combines in-memory and cached analyses position by position, preferring the
 * in-memory entry (it is never older than what was saved). Trimmed to the game.
 */
export function mergeAnalyses(
  primary: readonly (PositionAnalysis | null)[] | null,
  secondary: readonly (PositionAnalysis | null)[] | null,
  totalPositions: number,
): (PositionAnalysis | null)[] {
  const length = Math.min(totalPositions, Math.max(primary?.length ?? 0, secondary?.length ?? 0));
  const merged: (PositionAnalysis | null)[] = [];
  for (let i = 0; i < length; i++) merged.push(primary?.[i] ?? secondary?.[i] ?? null);
  return merged;
}

/**
 * Time between two review rebuilds while analysis streams in. Building a review runs on the
 * main thread, which also relays the engine's output: on a long game or a slow phone one build
 * takes hundreds of milliseconds, and rebuilding back to back would stall the analysis it
 * shows (and the board). The interval grows so rebuilds take at most 1 / `share` of the time.
 */
export function rebuildInterval(lastBuildMs: number, minimumMs: number, share = 4): number {
  return Math.max(minimumMs, Number.isFinite(lastBuildMs) ? lastBuildMs * share : 0);
}

/** "about 40 s left", "about 2 min left". */
export function formatEta(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 5) return 'almost done';
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s left`;
  return `about ${Math.round(seconds / 60)} min left`;
}

/** Move being analysed, 1-based: position i is the one after move i. */
export function analysingMoveNumber(done: number, totalMoves: number): number {
  return Math.min(Math.max(done, 1), Math.max(totalMoves, 1));
}

/** "Analysing move 23 of 81 · depth 16 · about 40 s left". */
export function progressText(progress: AnalysisProgress, totalMoves: number): string {
  const parts = [
    `Analysing move ${analysingMoveNumber(progress.done, totalMoves)} of ${totalMoves}`,
  ];
  if (progress.currentDepth) parts.push(`depth ${progress.currentDepth}`);
  if (progress.etaMs !== undefined && progress.done < progress.total) {
    parts.push(formatEta(progress.etaMs));
  }
  return parts.join(' · ');
}

/** Share of positions analysed, 0-100. */
export function progressPercent(progress: AnalysisProgress | null): number {
  if (!progress || progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, (progress.done / progress.total) * 100));
}

/** n analysed positions from the start cover n - 1 moves (position i is the one after move i). */
function movesCovered(positions: number, totalMoves: number): number {
  return Math.min(totalMoves, Math.max(0, positions - 1));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export interface AnalysisDescription {
  title: string;
  detail: string;
  /** What screen readers hear when the run changes state (never on every progress step). */
  announcement: string;
}

export interface DescribeAnalysisOptions {
  totalMoves: number;
  /** A deeper run is in progress and the previous, complete review is shown meanwhile. */
  showingPreviousAnalysis?: boolean;
  /** Label of the preset whose review is shown meanwhile, e.g. "Standard". */
  previousPresetLabel?: string;
}

/**
 * Title, detail line and screen-reader announcement for the analysis card, e.g.
 * "Quick review ready" / "Refining at depth 16 · move 23 of 81 · about 2 min left".
 */
export function describeAnalysis(
  analysis: Pick<
    AnalysisState,
    'status' | 'phase' | 'progress' | 'passes' | 'preset' | 'phaseDepth' | 'refineMoves' | 'message'
  >,
  { totalMoves, showingPreviousAnalysis = false, previousPresetLabel }: DescribeAnalysisOptions,
): AnalysisDescription {
  const { status, phase, progress, passes, preset, phaseDepth } = analysis;
  const hasQuickReview = passes.quick !== null;
  const eta =
    progress?.etaMs !== undefined && progress.done < progress.total
      ? ` · ${formatEta(progress.etaMs)}`
      : '';
  const moveOf = progress
    ? `move ${analysingMoveNumber(progress.done, totalMoves)} of ${totalMoves}`
    : 'starting';

  switch (status) {
    case 'preparing':
      return {
        title: 'Preparing analysis',
        detail: 'Starting the engine on your device…',
        announcement: '',
      };
    case 'engine-error':
      return {
        title: 'Analysis unavailable',
        detail: analysis.message ?? 'The chess engine could not start.',
        announcement: '',
      };
    case 'failed':
      return {
        title: 'Analysis stopped unexpectedly',
        detail: analysis.message ?? 'The engine stopped responding.',
        announcement: 'Analysis stopped unexpectedly.',
      };
    case 'done':
      return { title: 'Analysis finished', detail: '', announcement: 'Analysis finished.' };
    case 'running': {
      if (phase === 'quick') {
        return {
          title: 'Building a quick review',
          detail: `Quick pass · ${moveOf}${eta}`,
          announcement: 'Building a quick review.',
        };
      }
      if (phase === 'refining') {
        const pass = passes.refining;
        const moves = analysis.refineMoves;
        return {
          title: moves > 0 ? `Double-checking ${plural(moves, 'key move')}` : 'Double-checking',
          detail:
            pass && pass.total > 0
              ? `Depth ${phaseDepth} · ${pass.done} of ${plural(pass.total, 'position')}${eta}`
              : `Depth ${phaseDepth}`,
          announcement: 'Review ready. Double-checking key moves.',
        };
      }
      if (hasQuickReview) {
        return {
          title: 'Quick review ready',
          detail: `Refining at depth ${phaseDepth} · ${moveOf}${eta}`,
          announcement: `Quick review ready. Refining at depth ${phaseDepth}.`,
        };
      }
      const deeperNote = showingPreviousAnalysis ? ` · ${preset.label.toLowerCase()} analysis` : '';
      return {
        title: `Analysing with Stockfish${deeperNote}`,
        detail: progress ? progressText(progress, totalMoves) : 'Starting…',
        announcement: 'Analysis started.',
      };
    }
    case 'paused': {
      const announcement = 'Analysis paused.';
      if (phase === 'refining') {
        const pass = passes.refining;
        return {
          title: 'Double-check paused',
          detail:
            pass && pass.total > 0
              ? `The review is complete. ${pass.done} of ${plural(pass.total, 'position')} re-checked at depth ${phaseDepth}.`
              : 'The review is complete. Resume to double-check the key moves.',
          announcement,
        };
      }
      const analysed = movesCovered(progress?.done ?? 0, totalMoves);
      if (showingPreviousAnalysis) {
        const shown = previousPresetLabel
          ? `the ${previousPresetLabel.toLowerCase()}`
          : 'the earlier';
        return {
          title: 'Deeper analysis paused',
          detail: `${analysed} of ${totalMoves} moves re-analysed. Showing ${shown} analysis until it finishes.`,
          announcement,
        };
      }
      if (phase === 'full' && hasQuickReview) {
        return {
          title: 'Refinement paused',
          detail: `Showing the quick review. ${analysed} of ${totalMoves} moves refined at depth ${phaseDepth} so far.`,
          announcement,
        };
      }
      const what = phase === 'quick' ? 'moves in the quick review' : 'moves analysed';
      return {
        title: 'Analysis paused',
        detail: `${analysed} of ${totalMoves} ${what}. Resume any time; finished work is saved.`,
        announcement,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Result for display: "1-0", "0-1", "½-½", "*". */
export function resultLabel(result: GameResult): string {
  return result === '1/2-1/2' ? '½-½' : result;
}

/** Starting time in seconds from a time control like "180+2" or "600"; undefined for daily. */
export function baseTimeSeconds(timeControl: string | undefined): number | undefined {
  const match = /^(\d+)(?:\+\d+)?$/.exec(timeControl ?? '');
  return match ? Number(match[1]) : undefined;
}

/**
 * A player's clock at a ply: the time left after their latest move up to that ply.
 * Before their first move it is the starting time. Undefined when the game has no clocks.
 */
export function clockAtPly(
  moves: readonly ParsedMove[],
  ply: number,
  color: Color,
  timeControl: string | undefined,
): number | undefined {
  let clock: number | undefined;
  let gameHasClocks = false;
  for (const move of moves) {
    if (move.clock !== undefined) gameHasClocks = true;
    if (move.ply > ply) continue;
    if (move.color === color && move.clock !== undefined) clock = move.clock;
  }
  if (clock !== undefined) return clock;
  return gameHasClocks ? baseTimeSeconds(timeControl) : undefined;
}

/**
 * Numbers a SAN line: "12. Nf3 Nc6 13. Bb5" or, starting with Black, "12... Nc6 13. Bb5".
 * @param moveNumber full-move number of the first move in the line
 * @param color colour of the side that plays the first move
 */
export function formatLine(
  sans: readonly string[],
  moveNumber: number,
  color: Color,
  maxPlies = 6,
): string {
  const parts: string[] = [];
  let number = moveNumber;
  let side = color;
  sans.slice(0, maxPlies).forEach((san, index) => {
    if (side === 'w') parts.push(`${number}. ${san}`);
    else parts.push(index === 0 ? `${number}... ${san}` : san);
    if (side === 'b') number++;
    side = side === 'w' ? 'b' : 'w';
  });
  return parts.join(' ');
}

/** Move number and colour of the move after `move` (where its reply line starts). */
export function nextMoveNumber(move: Pick<ParsedMove, 'moveNumber' | 'color'>): {
  moveNumber: number;
  color: Color;
} {
  return move.color === 'w'
    ? { moveNumber: move.moveNumber, color: 'b' }
    : { moveNumber: move.moveNumber + 1, color: 'w' };
}

/**
 * Which side to show at the bottom: the player whose games are being browsed
 * (from a chesscom/<username>/... id or a recent search), otherwise White.
 */
export function initialOrientation(
  record: Pick<GameRecord, 'id' | 'white' | 'black'>,
  knownUsernames: readonly string[],
): BoardOrientation {
  const [source, owner] = record.id.split('/');
  const candidates = [...(source === 'chesscom' && owner ? [owner] : []), ...knownUsernames].map(
    (name) => name.toLowerCase(),
  );
  for (const name of candidates) {
    if (record.black.name.toLowerCase() === name) return 'black';
    if (record.white.name.toLowerCase() === name) return 'white';
  }
  return 'white';
}

/**
 * Who "you" are in a game: the player named by the review URL's ?as=<username>, or for
 * Chess.com ids (chesscom/<username>/...) the player whose archive the game came from.
 * Usernames match case-insensitively. Null for imported PGNs (no platform) and when no
 * candidate is one of the players.
 */
export function resolvePerspective(
  record: Pick<GameRecord, 'id' | 'white' | 'black'>,
  asUsername?: string | null,
): Perspective | null {
  const [platform, owner] = record.id.split('/');
  if (platform !== 'chesscom' && platform !== 'lichess') return null;
  const candidates = [asUsername, platform === 'chesscom' ? owner : undefined];
  for (const candidate of candidates) {
    const username = candidate?.trim().toLowerCase();
    if (!username) continue;
    if (record.white.name.toLowerCase() === username) return { platform, username, color: 'w' };
    if (record.black.name.toLowerCase() === username) return { platform, username, color: 'b' };
  }
  return null;
}

/**
 * The library entry to store for a finished review, or null to keep the stored one.
 * - A stored entry from a deeper analysis is kept (it is more accurate); it only gains a
 *   perspective when it had none.
 * - A known perspective is never dropped: a review opened without one keeps the stored one.
 * - Saving at the same depth again keeps the first review date, so revisiting a game does
 *   not reorder lists sorted by it, while labels still follow the current rules.
 */
export function libraryEntryToSave(
  record: GameRecord,
  game: ParsedGame,
  review: GameReview,
  perspective: Perspective | null,
  existing: LibraryEntry | null,
  now = Date.now(),
): LibraryEntry | null {
  if (existing && existing.engine.depth > review.engine.depth) {
    return perspective && !existing.perspective ? { ...existing, perspective } : null;
  }
  const known = perspective ?? existing?.perspective;
  const reviewedAt =
    existing && existing.engine.depth === review.engine.depth ? existing.reviewedAt : now;
  return toLibraryEntry(record, game, review, known, reviewedAt);
}

const ARROW_FREE: ReadonlySet<Classification> = new Set(['book', 'forced']);
const SHOW_REPLY: ReadonlySet<Classification> = new Set(['mistake', 'blunder', 'missedWin']);

function arrowFor(uci: string | undefined, kind: BoardArrow['kind']): BoardArrow | null {
  const parsed = uci ? parseUci(uci) : null;
  return parsed ? { from: parsed.from, to: parsed.to, kind } : null;
}

/**
 * Arrows for the position after a reviewed move: the engine's better move when the
 * played move was not the top choice, and for real errors the opponent's best reply.
 */
export function arrowsForMove(review: MoveReview | undefined, showBest: boolean): BoardArrow[] {
  if (!review || !showBest || ARROW_FREE.has(review.classification)) return [];
  const arrows: BoardArrow[] = [];
  if (review.best && review.best.uci !== review.uci) {
    const best = arrowFor(review.best.uci, 'best');
    if (best) arrows.push(best);
  }
  if (SHOW_REPLY.has(review.classification)) {
    const reply = arrowFor(review.playedLine?.uci, 'threat');
    if (reply) arrows.push(reply);
  }
  return arrows;
}

/** Eval bar content for a position, from its analysis. null while not analysed. */
export function evalBarValueAt(
  analyses: readonly (PositionAnalysis | null)[],
  ply: number,
): EvalBarValue | null {
  const analysis = analyses[ply];
  if (!analysis) return null;
  if (analysis.terminal) {
    if (analysis.terminal === 'checkmate') {
      // The side to move has been mated.
      const whiteMated = sideToMove(analysis.fen) === 'w';
      return {
        kind: 'final',
        whiteWinPercent: whiteMated ? 0 : 100,
        label: whiteMated ? '0-1' : '1-0',
      };
    }
    return { kind: 'final', whiteWinPercent: 50, label: '½-½' };
  }
  const best = analysis.lines[0];
  return best ? { kind: 'score', score: best.score } : null;
}

/** Signed evaluation text for a position ("+1.3", "M2", "1-0"), or null if not analysed. */
export function evalTextAt(
  analyses: readonly (PositionAnalysis | null)[],
  ply: number,
): string | null {
  const value = evalBarValueAt(analyses, ply);
  if (!value) return null;
  return value.kind === 'final' ? value.label : formatScore(value.score);
}
