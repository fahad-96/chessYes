import { safeStorage } from '@/lib/safeStorage';
import type { PuzzleOutcome } from './progress';

/**
 * A scored puzzle session on top of the spaced-repetition practice: every puzzle solved
 * without help scores a point, every miss (a wrong move, a hint or the solution) costs one of
 * three lives, and the best score is kept in this browser. Pure, apart from load/saveBest.
 */
export const SESSION_LIVES = 3;
const BEST_KEY = 'kibitz-puzzle-best';

export interface PuzzleSession {
  score: number;
  lives: number;
  /** Puzzles solved in a row in this session. */
  streak: number;
  /** The best score of any session, this one included. */
  best: number;
}

export function newSession(best: number): PuzzleSession {
  return { score: 0, lives: SESSION_LIVES, streak: 0, best };
}

export function applyOutcome(session: PuzzleSession, outcome: PuzzleOutcome): PuzzleSession {
  if (isOver(session)) return session;
  if (outcome === 'solved') {
    const score = session.score + 1;
    return { ...session, score, streak: session.streak + 1, best: Math.max(session.best, score) };
  }
  return { ...session, lives: session.lives - 1, streak: 0 };
}

export function isOver(session: PuzzleSession): boolean {
  return session.lives <= 0;
}

export function loadBest(): number {
  const value = Number(safeStorage.getItem(BEST_KEY));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function saveBest(best: number): void {
  if (best > 0) safeStorage.setItem(BEST_KEY, String(best));
}
