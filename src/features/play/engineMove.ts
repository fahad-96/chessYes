import type { Color, EngineLine, PositionAnalysis } from '@/core/types';
import { scoreToWinPercent, winPercentFor } from '@/core/winPercent';
import type { EngineLevel } from './levels';

/** A number in [0, 1), like Math.random. Injected so tests are deterministic. */
export type Random = () => number;

function pickIndex(length: number, random: Random): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

/**
 * The move the engine plays (UCI) at a strength level, from a MultiPV analysis of the
 * position. See levels.ts for what each knob does. Lines whose first move is not in
 * `legalMoves` are ignored; with no usable line, a random legal move is played.
 * @throws Error when there is no legal move (the game is already over).
 */
export function chooseEngineMove(
  analysis: Pick<PositionAnalysis, 'lines'>,
  legalMoves: readonly string[],
  engineColor: Color,
  level: EngineLevel,
  random: Random = Math.random,
): string {
  if (legalMoves.length === 0) throw new Error('There is no legal move to play.');
  const randomMove = () => legalMoves[pickIndex(legalMoves.length, random)]!;
  if (level.randomMoveChance > 0 && random() < level.randomMoveChance) return randomMove();

  const legal = new Set(legalMoves);
  const lines = analysis.lines.filter((line) => line.pv[0] !== undefined && legal.has(line.pv[0]));
  const best = lines[0];
  if (!best) return randomMove();

  // A forced mate the level is strong enough to see is never let go.
  const mate = mateFor(best, engineColor);
  if (mate !== null && mate <= level.mateVision) return best.pv[0]!;
  if (level.temperature <= 0 || lines.length === 1) return best.pv[0]!;

  const wins = lines.map((line) => winPercentFor(scoreToWinPercent(line.score), engineColor));
  const bestWin = Math.max(...wins);
  const candidates = lines
    .map((line, index) => ({ move: line.pv[0]!, loss: bestWin - wins[index]! }))
    .filter((candidate) => candidate.loss <= level.maxLoss);
  const weights = candidates.map((candidate) => Math.exp(-candidate.loss / level.temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return candidates[i]!.move;
  }
  return candidates.at(-1)!.move;
}

/** Moves to a forced mate for `color` in this line, or null when it is not a mate for them. */
function mateFor(line: EngineLine, color: Color): number | null {
  if (line.score.type !== 'mate') return null;
  const forWhite = line.score.value > 0;
  if (forWhite !== (color === 'w')) return null;
  return Math.abs(line.score.value);
}
