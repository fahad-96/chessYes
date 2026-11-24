import type { Color } from '@/core/types';
import type { LibraryEntry } from '@/library/library';
import {
  PUZZLE_THEMES,
  countThemes,
  generatePuzzles,
  type PuzzleTheme,
} from '@/features/puzzles/generate';

/** What a "analyze my recent games" run found, for the summary and the puzzle session. */
export interface TrainSummary {
  /** Games of the run that are in the library (analysed now or before). */
  games: number;
  /** The player's average accuracy over those games, or null without any. */
  accuracy: number | null;
  mistakes: number;
  blunders: number;
  /** Puzzles made from those games: the mistakes ready to retrain. */
  puzzles: number;
  /** The theme with the most puzzles (ties go to the first in PUZZLE_THEMES), or null. */
  focus: PuzzleTheme | null;
}

function sideOf(entry: LibraryEntry): Color | null {
  return entry.perspective?.color ?? null;
}

/**
 * Sums up the run's games (`gameIds`) among the player's library entries: accuracy and the
 * mistakes they made, and the puzzles those mistakes become.
 */
export function summarizeRun(
  entries: readonly LibraryEntry[],
  gameIds: ReadonlySet<string>,
): TrainSummary {
  const run = entries.filter((entry) => gameIds.has(entry.gameId) && sideOf(entry) !== null);
  let accuracySum = 0;
  let mistakes = 0;
  let blunders = 0;
  for (const entry of run) {
    const review = sideOf(entry) === 'w' ? entry.white : entry.black;
    accuracySum += review.accuracy;
    mistakes += review.counts.mistake ?? 0;
    blunders += review.counts.blunder ?? 0;
  }
  const puzzles = generatePuzzles(run);
  const counts = countThemes(puzzles);
  let focus: PuzzleTheme | null = null;
  for (const theme of PUZZLE_THEMES) {
    if (counts[theme] > 0 && (focus === null || counts[theme] > counts[focus])) focus = theme;
  }
  return {
    games: run.length,
    accuracy: run.length > 0 ? accuracySum / run.length : null,
    mistakes,
    blunders,
    puzzles: puzzles.length,
    focus,
  };
}

/** The lines of the progress screen, oldest first (the screen shows the newest on top). */
export function progressLines(state: {
  phase: 'loading' | 'analysing' | 'done';
  gameNumber?: number;
  queued?: number;
  opponent?: string;
  summary?: TrainSummary | null;
  focusLabel?: string;
}): string[] {
  const lines = ['Reading your game patterns'];
  if (state.phase === 'analysing' && state.queued) {
    const number = Math.max(1, state.gameNumber ?? 1);
    lines.push(
      `Analyzing game ${Math.min(number, state.queued)} of ${state.queued}` +
        (state.opponent ? ` · ${state.opponent}` : ''),
    );
  }
  const summary = state.summary;
  if (state.phase === 'done' && summary) {
    lines.push(`${summary.games} of your games analyzed`);
    lines.push(
      summary.puzzles === 1
        ? '1 of your mistakes ready to retrain'
        : `${summary.puzzles} of your mistakes ready to retrain`,
    );
    if (state.focusLabel) lines.push(`Session focus: ${state.focusLabel}`);
  }
  return lines;
}
