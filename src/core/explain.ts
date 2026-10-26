import type { Classification, Color, SacrificeInfo, Score, SuggestedLine } from './types';

export interface ExplainInput {
  classification: Classification;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  winBefore: number;
  winAfter: number;
  /** Evaluation (White POV) after the move; null when the game ended with it. */
  evalAfter: Score | null;
  /** Evaluation (White POV) of the best line before the move. */
  evalBest: Score | null;
  best?: SuggestedLine;
  secondBest?: SuggestedLine;
  /** Engine continuation after the played move (starts with the opponent's reply). */
  playedLine?: SuggestedLine;
  sacrifice?: SacrificeInfo;
  opening?: { eco: string; name: string };
  isCheckmate: boolean;
}

/**
 * Plain-English explanation of a move, 1-3 short sentences, no jargon beyond
 * standard chess terms. Rule-based (no AI): it looks at mates for/against,
 * material won or lost along the engine lines, hanging pieces, the sacrifice and
 * the size of the swing, and always names the better move for non-best moves,
 * e.g. "Blunder. This hangs your knight on f5: after exf5 you are down a piece.
 * Best was Nd2, keeping the position equal."
 */
export function explainMove(_input: ExplainInput): string {
  throw new Error('not implemented');
}

/** Describes who is better from White's win %, e.g. "White is winning", "The position is equal". */
export function describeAdvantage(_whiteWinPercent: number): string {
  throw new Error('not implemented');
}
