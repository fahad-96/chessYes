import type { Color, Score } from '@/core/types';

export interface UciInfo {
  depth: number;
  seldepth?: number;
  /** 1-based MultiPV index (1 when MultiPV is off). */
  multipv: number;
  /** Score converted to White's point of view. */
  score: Score;
  /** True when the score is a lowerbound/upperbound (not exact). */
  bound: boolean;
  pv: string[];
  nodes?: number;
  nps?: number;
  timeMs?: number;
}

/**
 * Parses a UCI `info` line. UCI scores are from the side to move's point of
 * view; this converts them to White's point of view using `sideToMove`.
 * Returns null for info lines without a score and pv (e.g. "info string ...",
 * "info depth 5 currmove ...").
 */
export function parseInfoLine(_line: string, _sideToMove: Color): UciInfo | null {
  throw new Error('not implemented');
}

/** Parses "bestmove e2e4 ponder e7e5" / "bestmove (none)". Null for other lines. */
export function parseBestMove(_line: string): { best: string | null; ponder?: string } | null {
  throw new Error('not implemented');
}
