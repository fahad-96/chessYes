// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, set } from 'idb-keyval';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardProps } from '@/components/Board';
import { pvToSan } from '@/core/notation';
import type { LineStory } from '@/core/types';
import {
  LIBRARY_VERSION,
  clearLibrary,
  emptyCounts,
  saveToLibrary,
  type LibraryEntry,
} from '@/library/library';
import { useSettings } from '@/state/settings';
import { clearPuzzleProgress, loadProgress } from './progress';
import PuzzlesPage from './PuzzlesPage';

// chessground needs a real layout engine; the stub exposes the props instead.
let board: BoardProps | null = null;
vi.mock('@/components/Board', () => ({
  Board: (props: BoardProps) => {
    board = props;
    return <div data-testid="board" data-fen={props.fen} />;
  },
}));

// Until a test says otherwise the tactics module fails, so the page falls back to the line.
const describeLine = vi.fn<() => LineStory>();
vi.mock('@/core/tactics', () => ({ describeLine: () => describeLine() }));

const evaluateMoverWin = vi.fn(async () => 50);
vi.mock('@/practice/interactiveEngine', () => ({
  evaluateMoverWin: () => evaluateMoverWin(),
  getInteractiveEngine: () => Promise.resolve({}),
}));

/** 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.d3? (Qxf7# was mate). */
const SCHOLAR = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

function scholarEntry(): LibraryEntry {
  return {
    v: LIBRARY_VERSION,
    gameId: 'lichess/abcd1234',
    record: {
      id: 'lichess/abcd1234',
      source: 'lichess',
      white: { name: 'me' },
      black: { name: 'Rival' },
      result: '1-0',
      timeClass: 'blitz',
      variant: 'standard',
      endTime: Date.now() - 3 * 86_400_000,
      pgn: '',
    },
    perspective: { platform: 'lichess', username: 'me', color: 'w' },
    reviewedAt: Date.now(),
    engine: { name: 'Stockfish', depth: 16, multiPv: 2 },
    accuracyModel: 'calibrated',
    white: { accuracy: 70, counts: emptyCounts() },
    black: { accuracy: 60, counts: emptyCounts() },
    moves: [
      {
        ply: 7,
        color: 'w',
        san: 'd3',
        uci: 'd2d3',
        fenBefore: SCHOLAR,
        classification: 'missedWin',
        winBefore: 97.5,
        winAfter: 55,
        winLoss: 42.5,
        accuracy: 8.4,
        winSecondBest: 60,
        best: { uci: 'h5f7', san: 'Qxf7#', pvUci: ['h5f7'], pvSan: pvToSan(SCHOLAR, ['h5f7']) },
      },
    ],
  };
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/puzzles', element: <PuzzlesPage /> },
      { path: '*', element: <p>elsewhere</p> },
    ],
    { initialEntries: ['/puzzles'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Plays a move on the stubbed board, as chessground would after a drag. */
function play(uci: string) {
  const interactive = board?.interactive;
  if (!interactive) throw new Error('the board does not accept moves');
  act(() => {
    interactive.onMove(uci);
  });
}

beforeEach(async () => {
  board = null;
  evaluateMoverWin.mockClear();
  describeLine.mockReset();
  describeLine.mockImplementation(() => {
    throw new Error('tactics failed');
  });
  useSettings.setState({ recent: [] });
  await clearLibrary();
  await clearPuzzleProgress();
});

afterEach(() => {
  cleanup();
});

describe('PuzzlesPage', () => {
  it('explains where puzzles come from when there are no reviewed games', async () => {
    useSettings.setState({ recent: [{ platform: 'chesscom', username: 'Hikaru' }] });
    renderPage();
    expect(await screen.findByText('Puzzles come from your reviewed games')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Analyse my recent games/ }).getAttribute('href')).toBe(
      '/insights/chesscom/Hikaru',
    );
    expect(screen.getByRole('link', { name: /Find my games/ }).getAttribute('href')).toBe('/');
    expect(screen.queryByText(/need a fresh review/)).toBeNull();
  });

  it('says why games reviewed by an older version no longer make puzzles', async () => {
    const older = { ...scholarEntry(), v: 1 };
    await set(older.gameId, older, createStore('kibitz-library', 'entries'));
    renderPage();
    expect(await screen.findByText('Puzzles come from your reviewed games')).toBeTruthy();
    expect(screen.getByText(/need a fresh review before they make puzzles again/)).toBeTruthy();
  });

  it('solves a puzzle, plays the line and moves on', async () => {
    await saveToLibrary(scholarEntry());
    renderPage();
    expect(await screen.findByText('Find the best move for White')).toBeTruthy();
    expect(board?.fen).toBe(SCHOLAR);
    expect(board?.orientation).toBe('white');
    expect(board?.interactive?.color).toBe('white');
    // The mistake stays hidden until the end.
    expect(screen.queryByText(/In the game you played/)).toBeNull();

    play('h5f7');
    expect(await screen.findByText('Solved!')).toBeTruthy();
    expect(screen.getByText(/In the game you played/).textContent).toContain('4. d3?');
    // Without a tactics story, the line itself is the explanation.
    expect(screen.getByRole('region', { name: 'Why it works' }).textContent).toContain(
      '4. Qxf7# is checkmate.',
    );
    expect(board?.interactive).toBeNull();
    expect(evaluateMoverWin).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Open this moment/ }).getAttribute('href')).toBe(
      '/review/lichess/abcd1234?ply=7',
    );
    await waitFor(async () =>
      expect((await loadProgress()).get('lichess/abcd1234#7')).toMatchObject({ solves: 1 }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Next puzzle/ }));
    expect(await screen.findByText('You’re all caught up')).toBeTruthy();
  });

  it('records a miss for the game move and shows the solution', async () => {
    await saveToLibrary(scholarEntry());
    renderPage();
    await screen.findByText('Find the best move for White');

    play('d2d3');
    expect(await screen.findByText('That’s the move you played in the game')).toBeTruthy();
    // The game move is already evaluated: the engine is not needed.
    expect(evaluateMoverWin).not.toHaveBeenCalled();
    await waitFor(async () =>
      expect((await loadProgress()).get('lichess/abcd1234#7')).toMatchObject({ lapses: 1 }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Show solution/ }));
    expect(screen.getByRole('heading', { name: /The best move was Qxf7#/ })).toBeTruthy();
    expect(board?.fen).toBe(SCHOLAR);
    expect(board?.arrows?.map((a) => a.kind)).toEqual(['best', 'played']);
  });

  it('asks the engine about other moves and lets a good move try again', async () => {
    evaluateMoverWin.mockResolvedValueOnce(94); // 3.5 points short: "good"
    await saveToLibrary(scholarEntry());
    renderPage();
    await screen.findByText('Find the best move for White');

    play('c4f7');
    expect(await screen.findByText(/Bxf7\+ is good, but there’s a stronger move/)).toBeTruthy();
    expect(evaluateMoverWin).toHaveBeenCalledOnce();
    expect(board?.fen).toBe(SCHOLAR);
    expect(board?.interactive).not.toBeNull();
    expect((await loadProgress()).size).toBe(0);
  });

  it('names the piece, then shows the arrow as hints', async () => {
    await saveToLibrary(scholarEntry());
    renderPage();
    await screen.findByText('Find the best move for White');

    fireEvent.click(screen.getByRole('button', { name: /Hint/ }));
    expect(screen.getByText(/Move your queen\./)).toBeTruthy();
    expect(screen.getByText('Hint: the piece on h5')).toBeTruthy();
    expect(board?.arrows).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Show arrow/ }));
    expect(board?.arrows).toEqual([{ from: 'h5', to: 'f7', kind: 'best' }]);
    expect(screen.queryByText('Hint: the piece on h5')).toBeNull();
  });

  it('explains the solution with the tactics story and draws its motifs', async () => {
    describeLine.mockReturnValue({
      kind: 'missed',
      fen: SCHOLAR,
      movesUci: ['h5f7'],
      movesSan: ['Qxf7#'],
      motifs: [
        {
          type: 'checkmate',
          step: 0,
          by: 'w',
          square: 'f7',
          targets: ['e8'],
          phrase: 'mates the king',
        },
      ],
      materialSwing: 1,
      mateIn: 1,
      text: 'Qxf7# would have been checkmate: the bishop on c4 protects the queen.',
    });
    await saveToLibrary(scholarEntry());
    renderPage();
    await screen.findByText('Find the best move for White');

    fireEvent.click(screen.getByRole('button', { name: /Show solution/ }));
    const why = screen.getByRole('region', { name: 'Why it works' });
    expect(why.textContent).toContain('the bishop on c4 protects the queen');
    // The puzzle position shows the best move and the game move...
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(board?.arrows?.map((a) => a.kind)).toEqual(['best', 'played']);
    // ...and the move that sets up the tactic shows what it hits.
    fireEvent.click(screen.getByRole('button', { name: 'Qxf7#' }));
    expect(board?.arrows).toEqual([{ from: 'f7', to: 'e8', kind: 'best' }]);
  });
});
