import { describe, expect, it } from 'vitest';
import {
  INITIAL_ATTEMPT,
  acceptsMoves,
  attemptReducer,
  isFinished,
  solutionPlies,
  type AttemptAction,
  type AttemptState,
} from './attempt';

function run(...actions: AttemptAction[]): AttemptState {
  return actions.reduce(attemptReducer, INITIAL_ATTEMPT);
}

const move = (san = 'Nf5'): AttemptAction => ({ type: 'move', uci: 'g3f5', san });

describe('attemptReducer', () => {
  it('solves cleanly with the best move', () => {
    const state = run(move(), { type: 'verdict', verdict: 'best' });
    expect(state.phase).toEqual({ kind: 'solved', uci: 'g3f5', san: 'Nf5', verdict: 'best' });
    expect(state.outcome).toBe('solved');
    expect(isFinished(state)).toBe(true);
    expect(acceptsMoves(state)).toBe(false);
  });

  it('accepts an excellent alternative as solved', () => {
    expect(run(move(), { type: 'verdict', verdict: 'excellent' }).outcome).toBe('solved');
  });

  it('asks again after a good move without counting a miss', () => {
    const state = run(move(), { type: 'verdict', verdict: 'good' });
    expect(state.phase).toEqual({ kind: 'good', san: 'Nf5' });
    expect(state.outcome).toBeNull();
    expect(acceptsMoves(state)).toBe(true);
    const solved = attemptReducer(attemptReducer(state, move('Qh5')), {
      type: 'verdict',
      verdict: 'best',
    });
    expect(solved.outcome).toBe('solved');
    expect(solved.tries).toBe(2);
  });

  it('counts a wrong move as a miss, even when solved afterwards', () => {
    const wrong = run(move(), { type: 'verdict', verdict: 'wrong' });
    expect(wrong.phase.kind).toBe('wrong');
    expect(wrong.outcome).toBe('failed');
    expect(acceptsMoves(wrong)).toBe(false);
    const solved = run(
      move(),
      { type: 'verdict', verdict: 'wrong' },
      { type: 'retry' },
      move('Qh5'),
      { type: 'verdict', verdict: 'best' },
    );
    expect(solved.phase.kind).toBe('solved');
    expect(solved.outcome).toBe('failed');
  });

  it('does not count a move the engine could not judge', () => {
    const state = run(move(), { type: 'verdict', verdict: 'wrong', engineDown: true });
    expect(state.phase).toMatchObject({ kind: 'wrong', engineDown: true });
    expect(state.outcome).toBeNull();
  });

  it('gives two hints, and a solve after a hint counts as a miss', () => {
    const one = run({ type: 'hint' });
    expect(one.hints).toBe(1);
    const two = attemptReducer(one, { type: 'hint' });
    expect(two.hints).toBe(2);
    expect(attemptReducer(two, { type: 'hint' }).hints).toBe(2);
    const solved = run({ type: 'hint' }, move(), { type: 'verdict', verdict: 'best' });
    expect(solved.outcome).toBe('failed');
  });

  it('resets the board when a hint is asked for after a wrong move', () => {
    const state = run(move(), { type: 'verdict', verdict: 'wrong' }, { type: 'hint' });
    expect(state.phase.kind).toBe('solving');
  });

  it('reveals the solution as a miss and then ignores further input', () => {
    const state = run({ type: 'reveal' });
    expect(state.phase.kind).toBe('revealed');
    expect(state.outcome).toBe('failed');
    expect(run({ type: 'reveal' }, move())).toEqual(state);
    expect(run({ type: 'reveal' }, { type: 'hint' })).toEqual(state);
  });

  it('ignores actions that do not fit the phase', () => {
    const checking = run(move());
    expect(attemptReducer(checking, move('Qh5'))).toBe(checking);
    expect(attemptReducer(checking, { type: 'reveal' })).toBe(checking);
    expect(attemptReducer(checking, { type: 'hint' })).toBe(checking);
    expect(attemptReducer(INITIAL_ATTEMPT, { type: 'verdict', verdict: 'best' })).toBe(
      INITIAL_ATTEMPT,
    );
    expect(attemptReducer(INITIAL_ATTEMPT, { type: 'retry' })).toBe(INITIAL_ATTEMPT);
  });
});

describe('solutionPlies', () => {
  it('shows up to five plies, ending on the player’s move when it can', () => {
    expect([1, 2, 3, 4, 5, 6, 8].map((n) => solutionPlies(n))).toEqual([1, 2, 3, 3, 5, 5, 5]);
    // A mating line is shown up to the mate.
    expect(solutionPlies(7, true)).toBe(7);
  });
});
