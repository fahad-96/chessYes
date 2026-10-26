// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearPuzzleProgress, loadProgress, recordAttempt } from '@/features/puzzles/progress';
import {
  clearLibrary,
  emptyCounts,
  getLibraryEntries,
  saveToLibrary,
  type LibraryEntry,
} from '@/library/library';
import SettingsPage from './SettingsPage';

function entry(gameId: string): LibraryEntry {
  return {
    v: 1,
    gameId,
    record: {
      id: gameId,
      source: 'lichess',
      white: { name: 'me' },
      black: { name: 'Rival' },
      result: '1-0',
      timeClass: 'blitz',
      variant: 'standard',
      pgn: '',
    },
    reviewedAt: Date.now(),
    engine: { name: 'Stockfish', depth: 16, multiPv: 2 },
    white: { accuracy: 70, counts: emptyCounts() },
    black: { accuracy: 60, counts: emptyCounts() },
    moves: [],
  };
}

/** Clicks a row's button, then "Yes, clear" in the confirmation that replaces it. */
async function clearWithConfirmation(label: string) {
  fireEvent.click(await screen.findByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, clear' }));
}

beforeEach(async () => {
  await clearLibrary();
  await clearPuzzleProgress();
});

afterEach(() => {
  cleanup();
});

describe('SettingsPage storage', () => {
  it('counts the reviewed games and clears the library after a confirmation', async () => {
    await saveToLibrary(entry('lichess/one'));
    await saveToLibrary(entry('lichess/two'));
    render(<SettingsPage />);

    expect(await screen.findByText(/^2 games\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear reviewed games library' }));
    expect(screen.getByText(/Remove every reviewed game\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await getLibraryEntries()).toHaveLength(2);

    await clearWithConfirmation('Clear reviewed games library');
    await waitFor(() => expect(screen.getByText(/^Cleared\. Games you review/)).toBeTruthy());
    expect(await getLibraryEntries()).toHaveLength(0);
  });

  it('resets puzzle progress', async () => {
    await recordAttempt('lichess/one#7', 'solved');
    render(<SettingsPage />);

    expect(await screen.findByText(/^1 puzzle tried/)).toBeTruthy();
    await clearWithConfirmation('Reset puzzle progress');
    await waitFor(() => expect(screen.getByText('Reset. Every puzzle is new again.')).toBeTruthy());
    expect((await loadProgress()).size).toBe(0);
  });

  it('disables the buttons when there is nothing to clear', async () => {
    render(<SettingsPage />);
    expect(await screen.findByText('No puzzles tried yet.')).toBeTruthy();
    const library = screen.getByRole('button', { name: 'Clear reviewed games library' });
    expect((library as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('heading', { name: 'Voice' })).toBeTruthy();
  });
});
