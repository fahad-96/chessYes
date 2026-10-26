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
  /** Win/draw/loss per mille from White's point of view (only with UCI_ShowWDL). */
  wdl?: [win: number, draw: number, loss: number];
}

/** Fields that consume the rest of the line; we do not use them, so parsing stops there. */
const UNUSED_TAIL_FIELDS = new Set(['refutation', 'currline']);

/** Number tokens we read; everything else in an info line is skipped. */
const NUMERIC_FIELDS = new Set([
  'depth',
  'seldepth',
  'multipv',
  'nodes',
  'nps',
  'time',
  'hashfull',
  'tbhits',
  'cpuload',
  'currmovenumber',
]);

function toInt(token: string | undefined): number | undefined {
  if (token === undefined || !/^-?\d+$/.test(token)) return undefined;
  return Number(token);
}

/**
 * Parses a UCI `info` line. UCI scores are from the side to move's point of
 * view; this converts them to White's point of view using `sideToMove`.
 * Returns null for info lines without a score and pv (e.g. "info string ...",
 * "info depth 5 currmove ..."), and for "score mate 0" (the side to move is
 * already mated, so there is no line to report).
 */
export function parseInfoLine(line: string, sideToMove: Color): UciInfo | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'info') return null;

  const numbers = new Map<string, number>();
  let score: Score | undefined;
  let bound = false;
  let pv: string[] = [];
  let wdl: [number, number, number] | undefined;

  let i = 1;
  while (i < tokens.length) {
    const key = tokens[i]!;
    if (key === 'string') return null;
    if (key === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
    if (UNUSED_TAIL_FIELDS.has(key)) break;

    if (NUMERIC_FIELDS.has(key)) {
      const value = toInt(tokens[i + 1]);
      if (value !== undefined) numbers.set(key, value);
      i += 2;
    } else if (key === 'score') {
      const kind = tokens[i + 1];
      const value = toInt(tokens[i + 2]);
      i += 3;
      if ((kind === 'cp' || kind === 'mate') && value !== undefined) {
        score = { type: kind, value };
      }
      // Bounds come right after the value; they mark a fail-high/low, not a real score.
      const flag = tokens[i];
      if (flag === 'lowerbound' || flag === 'upperbound') {
        bound = true;
        i += 1;
      }
    } else if (key === 'wdl') {
      const [w, d, l] = [1, 2, 3].map((offset) => toInt(tokens[i + offset]));
      if (w !== undefined && d !== undefined && l !== undefined) wdl = [w, d, l];
      i += 4;
    } else {
      // Fields we ignore ("currmove e2e4", future additions): step over one token at a time.
      i += 1;
    }
  }

  const depth = numbers.get('depth');
  if (!score || pv.length === 0 || depth === undefined) return null;
  if (score.type === 'mate' && score.value === 0) return null;

  const flip = sideToMove === 'b';
  const info: UciInfo = {
    depth,
    multipv: numbers.get('multipv') ?? 1,
    // `|| 0` turns the -0 produced by negating cp 0 into a plain 0.
    score: { type: score.type, value: flip ? -score.value || 0 : score.value },
    bound,
    pv,
  };
  const seldepth = numbers.get('seldepth');
  const nodes = numbers.get('nodes');
  const nps = numbers.get('nps');
  const timeMs = numbers.get('time');
  if (seldepth !== undefined) info.seldepth = seldepth;
  if (nodes !== undefined) info.nodes = nodes;
  if (nps !== undefined) info.nps = nps;
  if (timeMs !== undefined) info.timeMs = timeMs;
  if (wdl) info.wdl = flip ? [wdl[2], wdl[1], wdl[0]] : wdl;
  return info;
}

/** Parses "bestmove e2e4 ponder e7e5" / "bestmove (none)". Null for other lines. */
export function parseBestMove(line: string): { best: string | null; ponder?: string } | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'bestmove') return null;
  const move = tokens[1];
  const best = move && move !== '(none)' && move !== '0000' ? move : null;
  const ponder = tokens[2] === 'ponder' ? tokens[3] : undefined;
  return ponder && ponder !== '(none)' ? { best, ponder } : { best };
}
