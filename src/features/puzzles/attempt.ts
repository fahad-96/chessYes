import type { MoveVerdict } from '@/practice/checkMove';
import type { PuzzleOutcome } from './progress';

/**
 * The state of one try at a puzzle, as a reducer so the flow can be tested without a
 * board or an engine:
 *
 *   solving ──move──► checking ──best / excellent──► solved
 *      ▲                 │ good: "stronger move" ──► solving
 *      │                 └ wrong ─────────────────► wrong ──retry──► solving
 *      └─────────── reveal (from solving / wrong) ──► revealed
 *
 * `outcome` is set once, at the first moment the result is known: the first wrong move,
 * showing the solution, or solving (a solve after a hint counts as a miss). The page
 * stores it when it appears. A move the engine could not judge (engine unavailable) is
 * not counted.
 */

export type AttemptPhase =
  /** Waiting for the player's move. */
  | { kind: 'solving' }
  /** The engine is judging the move just played. */
  | { kind: 'checking'; uci: string; san: string }
  /** A decent move, but not good enough: the board resets for another try. */
  | { kind: 'good'; san: string }
  /** A move that loses too much. `engineDown`: only the solution could be recognised. */
  | { kind: 'wrong'; uci: string; san: string; engineDown: boolean }
  | { kind: 'solved'; uci: string; san: string; verdict: 'best' | 'excellent' }
  /** The solution was shown. */
  | { kind: 'revealed' };

export interface AttemptState {
  phase: AttemptPhase;
  /** 0 = none, 1 = the piece to move was named, 2 = the solution arrow is shown. */
  hints: 0 | 1 | 2;
  /** Moves tried in this attempt. */
  tries: number;
  outcome: PuzzleOutcome | null;
}

export type AttemptAction =
  | { type: 'move'; uci: string; san: string }
  | { type: 'verdict'; verdict: MoveVerdict; engineDown?: boolean }
  | { type: 'retry' }
  | { type: 'hint' }
  | { type: 'reveal' };

export const INITIAL_ATTEMPT: AttemptState = {
  phase: { kind: 'solving' },
  hints: 0,
  tries: 0,
  outcome: null,
};

/** Whether the attempt is over (the puzzle was solved or its solution shown). */
export function isFinished(state: AttemptState): boolean {
  return state.phase.kind === 'solved' || state.phase.kind === 'revealed';
}

/** Whether the board should accept a move. */
export function acceptsMoves(state: AttemptState): boolean {
  return state.phase.kind === 'solving' || state.phase.kind === 'good';
}

export function attemptReducer(state: AttemptState, action: AttemptAction): AttemptState {
  const { phase } = state;
  switch (action.type) {
    case 'move':
      if (!acceptsMoves(state)) return state;
      return {
        ...state,
        tries: state.tries + 1,
        phase: { kind: 'checking', uci: action.uci, san: action.san },
      };
    case 'verdict': {
      if (phase.kind !== 'checking') return state;
      const { uci, san } = phase;
      if (action.verdict === 'best' || action.verdict === 'excellent') {
        return {
          ...state,
          phase: { kind: 'solved', uci, san, verdict: action.verdict },
          outcome: state.outcome ?? (state.hints > 0 ? 'failed' : 'solved'),
        };
      }
      if (action.verdict === 'good') return { ...state, phase: { kind: 'good', san } };
      const engineDown = action.engineDown ?? false;
      return {
        ...state,
        phase: { kind: 'wrong', uci, san, engineDown },
        // A move the engine could not judge is not held against the player.
        outcome: engineDown ? state.outcome : (state.outcome ?? 'failed'),
      };
    }
    case 'retry':
      return phase.kind === 'wrong' || phase.kind === 'good'
        ? { ...state, phase: { kind: 'solving' } }
        : state;
    case 'hint':
      if (isFinished(state) || phase.kind === 'checking' || state.hints >= 2) return state;
      return {
        ...state,
        hints: state.hints === 0 ? 1 : 2,
        // A hint always comes with a fresh board.
        phase: phase.kind === 'wrong' ? { kind: 'solving' } : phase,
      };
    case 'reveal':
      if (isFinished(state) || phase.kind === 'checking') return state;
      return { ...state, phase: { kind: 'revealed' }, outcome: state.outcome ?? 'failed' };
  }
}

/**
 * How many plies of the solution to show when the attempt ends: up to 5, ending on the
 * player's own move when the line is long enough (so the line shows the point of the
 * move, not a dangling reply). A line that ends in mate is shown in full, up to the mate.
 */
export function solutionPlies(solutionLength: number, endsInMate = false): number {
  if (endsInMate) return solutionLength;
  const plies = Math.min(solutionLength, 5);
  return plies > 2 && plies % 2 === 0 ? plies - 1 : plies;
}
