import { THRESHOLDS } from '@/core/thresholds';
import type {
  AnalysisSettings,
  Classification,
  GameReview,
  MoveReview,
  PositionAnalysis,
} from '@/core/types';
import type { Preset } from './presets';

/**
 * The verification pass that runs after a full analysis. Each position is searched on its
 * own, to a fixed depth, so a search can miss something the next one sees: at depth 12-14 the
 * engine sometimes misses a forced mate, a strong move then looks like a blunder, and the
 * engine's own top move can even appear to lose 25 points. The labels a reader looks at
 * first are re-checked with a deeper search of the positions before and after the move.
 */

/** Most moves one verification pass re-checks (each needs up to two deeper searches). */
export const REFINE_MAX_MOVES = 16;

/** Labels that a wrong search changes the story of the game with. */
export const REFINE_CLASSIFICATIONS: ReadonlySet<Classification> = new Set([
  'brilliant',
  'great',
  'missedWin',
  'mistake',
  'blunder',
]);

/** Extra depth for the verification searches; the deep preset is already slow. */
const EXTRA_DEPTH = 4;
const EXTRA_DEPTH_DEEP = 2;

/** Search settings for verifying a preset's analysis: deeper, with double the time cap. */
export function refineSettings(preset: Preset): AnalysisSettings {
  return {
    depth: preset.depth + (preset.id === 'deep' ? EXTRA_DEPTH_DEEP : EXTRA_DEPTH),
    multiPv: preset.multiPv,
    maxTimeMs: preset.maxTimeMs * 2,
  };
}

/**
 * The engine's own top move appears to lose more than an Inaccuracy's worth: the search
 * after the move saw something the search before it missed, so one of them is wrong.
 */
export function isSuspiciousTopMove(move: MoveReview): boolean {
  return move.best?.uci === move.uci && move.winLoss > THRESHOLDS.loss.inaccuracy;
}

/** Lower sorts first: suspicious top moves, then Brilliant, Great, then errors. */
function priority(move: MoveReview): number {
  if (isSuspiciousTopMove(move)) return 0;
  if (move.classification === 'brilliant') return 1;
  if (move.classification === 'great') return 2;
  return 3;
}

/**
 * The moves whose labels a deeper search should confirm: every Brilliant, Great, Missed
 * Win, Mistake and Blunder, and every engine top move that still lost more than an
 * Inaccuracy. Returns plies in game order.
 *
 * When there are more than `max`, the suspicious top moves come first (they are always a
 * search artefact), then Brilliant and Great (rare, and the most visible when wrong), then
 * the errors that cost the most.
 */
export function selectMovesToRefine(
  review: Pick<GameReview, 'moves'>,
  max = REFINE_MAX_MOVES,
): number[] {
  return review.moves
    .filter((move) => REFINE_CLASSIFICATIONS.has(move.classification) || isSuspiciousTopMove(move))
    .sort((a, b) => priority(a) - priority(b) || b.winLoss - a.winLoss || a.ply - b.ply)
    .slice(0, Math.max(0, max))
    .map((move) => move.ply)
    .sort((a, b) => a - b);
}

/**
 * Position indices to search again for the given moves: the positions before and after each
 * (index ply - 1 and ply), in order. Positions where the game is over have nothing to search,
 * and positions already searched to `targetDepth` (by an interrupted earlier verification)
 * are skipped.
 */
export function positionsToRefine(
  plies: readonly number[],
  analyses: readonly (PositionAnalysis | null | undefined)[],
  targetDepth: number,
): number[] {
  const indices = new Set<number>();
  for (const ply of plies) {
    for (const index of [ply - 1, ply]) {
      const analysis = analyses[index];
      if (index < 0 || !analysis || analysis.terminal) continue;
      if (analysis.depth >= targetDepth) continue;
      indices.add(index);
    }
  }
  return [...indices].sort((a, b) => a - b);
}

/**
 * The verification result that replaces `original`, keeping `original` with it
 * (PositionAnalysis.unverified): a position is shared by the move before it and the move
 * after it, and the review judges a move by verified analyses only when both of its
 * positions are verified, so a neighbour that was not re-checked keeps its full-pass pair.
 */
export function verifiedAnalysis(
  verified: PositionAnalysis,
  original: PositionAnalysis,
): PositionAnalysis {
  const { unverified: earlier, ...plain } = original;
  const { unverified: _ignored, ...result } = verified;
  return { ...result, unverified: earlier ?? plain };
}

/**
 * Whether a verification result should replace the analysis it re-checked. It must have
 * searched at least as deep: on a slow device the time cap can stop it earlier.
 */
export function isBetterAnalysis(
  candidate: PositionAnalysis,
  original: PositionAnalysis | null | undefined,
): boolean {
  if (!original) return true;
  if (original.terminal || candidate.fen !== original.fen || candidate.lines.length === 0) {
    return false;
  }
  return candidate.depth >= original.depth;
}
