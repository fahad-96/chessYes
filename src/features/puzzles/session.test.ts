// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_LIVES, applyOutcome, isOver, loadBest, newSession, saveBest } from './session';

afterEach(() => localStorage.clear());

describe('puzzle session', () => {
  it('scores solved puzzles and builds a streak', () => {
    let session = newSession(5);
    session = applyOutcome(session, 'solved');
    session = applyOutcome(session, 'solved');
    expect(session).toEqual({ score: 2, lives: SESSION_LIVES, streak: 2, best: 5 });
  });

  it('costs a life and the streak for a miss', () => {
    let session = applyOutcome(newSession(0), 'solved');
    session = applyOutcome(session, 'failed');
    expect(session).toMatchObject({ score: 1, lives: SESSION_LIVES - 1, streak: 0, best: 1 });
  });

  it('ends after the last life and ignores later puzzles', () => {
    let session = newSession(0);
    for (let i = 0; i < SESSION_LIVES; i++) session = applyOutcome(session, 'failed');
    expect(isOver(session)).toBe(true);
    expect(applyOutcome(session, 'solved')).toBe(session);
  });

  it('raises the best score as the session passes it', () => {
    let session = newSession(1);
    session = applyOutcome(session, 'solved');
    expect(session.best).toBe(1);
    session = applyOutcome(session, 'solved');
    expect(session.best).toBe(2);
  });

  it('keeps the best score in this browser', () => {
    expect(loadBest()).toBe(0);
    saveBest(7);
    expect(loadBest()).toBe(7);
    saveBest(0);
    expect(loadBest()).toBe(7);
  });
});
