// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Chess } from 'chess.js';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardProps } from '@/components/Board';
import type { AnalyzeRequest } from '@/engine/stockfish';
import { loadPgnGame } from '@/sources/pgnImport';
import { newGame } from './game';
import PlayPage from './PlayPage';
import { usePlayStore } from './usePlayGame';

// chessground needs a real layout engine; the stub exposes the props instead.
let board: BoardProps | null = null;
vi.mock('@/components/Board', () => ({
  Board: (props: BoardProps) => {
    board = props;
    return <div data-testid="board" data-fen={props.fen} />;
  },
}));

/** A fake engine that answers with the first legal move, or fails when told to. */
const engine = {
  fail: false,
  requests: [] as AnalyzeRequest[],
  newGame: vi.fn(async () => {}),
  analyze: vi.fn(async (request: AnalyzeRequest) => {
    engine.requests.push(request);
    if (engine.fail) throw new Error('The engine took too long to load.');
    const first = new Chess(request.fen).moves({ verbose: true })[0]!;
    return {
      fen: request.fen,
      depth: request.depth,
      lines: [{ pv: [first.lan], score: { type: 'cp' as const, value: 0 }, depth: request.depth }],
    };
  }),
};
vi.mock('@/practice/interactiveEngine', () => ({
  getInteractiveEngine: () => Promise.resolve(engine),
}));

function ReviewProbe() {
  const location = useLocation();
  return <p data-testid="review">{location.pathname + location.search}</p>;
}

function renderPlay() {
  const router = createMemoryRouter(
    [
      { path: '/play', element: <PlayPage /> },
      { path: '/review/*', element: <ReviewProbe /> },
    ],
    { initialEntries: ['/play'] },
  );
  return render(<RouterProvider router={router} />);
}

/** Plays a move on the stubbed board as the user would. */
function boardMove(uci: string): boolean | void {
  let accepted: boolean | void = undefined;
  act(() => {
    accepted = board?.interactive?.onMove(uci);
  });
  return accepted;
}

beforeEach(() => {
  board = null;
  engine.fail = false;
  engine.requests = [];
  engine.analyze.mockClear();
  engine.newGame.mockClear();
  localStorage.clear();
  usePlayStore.setState({ game: null, setup: { color: 'w', level: 3 } });
});

afterEach(cleanup);

describe('PlayPage', () => {
  it('starts a game with the chosen side and strength', () => {
    renderPlay();
    expect(screen.getByRole('heading', { name: 'Play Stockfish' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Black' }));
    fireEvent.click(screen.getByRole('radio', { name: /^8/ }));
    expect(screen.getByText(/Level 8, Stockfish\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Play/ }));

    const game = usePlayStore.getState().game;
    expect(game).toMatchObject({ player: 'b', level: 8, moves: [] });
    expect(usePlayStore.getState().setup).toEqual({ color: 'b', level: 8 });
    expect(board?.orientation).toBe('black');
  });

  it('answers the player move with an engine move at the level limits', async () => {
    usePlayStore.setState({ game: newGame('w', 8, Date.now()) });
    renderPlay();
    expect(screen.getByText('Your move')).toBeTruthy();
    expect(board?.interactive?.color).toBe('white');

    expect(boardMove('e2e4')).toBe(true);
    expect(screen.getByText('Stockfish is thinking…')).toBeTruthy();
    // Not the player's turn: the board refuses another move.
    expect(boardMove('d2d4')).toBe(false);

    await waitFor(() => expect(usePlayStore.getState().game?.moves).toHaveLength(2));
    expect(engine.newGame).toHaveBeenCalledTimes(1);
    expect(engine.requests[0]).toMatchObject({ moves: ['e2e4'], depth: 18, multiPv: 1 });
    expect(screen.getByText('Your move')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Moves played' }).textContent).toContain('e4');
  });

  it('lets the engine open when the player has Black', async () => {
    usePlayStore.setState({ game: newGame('b', 8, Date.now()) });
    renderPlay();
    await waitFor(() => expect(usePlayStore.getState().game?.moves).toHaveLength(1));
    expect(engine.requests[0]?.moves).toEqual([]);
  });

  it('takes back the player move and the reply', async () => {
    usePlayStore.setState({ game: newGame('w', 8, Date.now()) });
    renderPlay();
    boardMove('e2e4');
    await waitFor(() => expect(usePlayStore.getState().game?.moves).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /Take back/ }));
    expect(usePlayStore.getState().game?.moves).toEqual([]);
    expect(screen.getByRole('button', { name: /Take back/ }).hasAttribute('disabled')).toBe(true);
  });

  it('asks before resigning, then offers the review', async () => {
    usePlayStore.setState({ game: newGame('w', 8, Date.now()) });
    renderPlay();
    boardMove('e2e4');
    await waitFor(() => expect(usePlayStore.getState().game?.moves).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /Resign/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(usePlayStore.getState().game?.outcome).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Resign/ }));
    const confirm = screen.getByRole('group', { name: 'Confirm resignation' });
    fireEvent.click(confirm.querySelector('button')!);
    expect(usePlayStore.getState().game?.outcome).toMatchObject({ reason: 'resignation' });
    expect(screen.getByText('You lost')).toBeTruthy();
    expect(screen.getByText('Stockfish level 8 won by resignation.')).toBeTruthy();
    expect(board?.interactive).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Review this game/ }));
    const probe = await screen.findByTestId('review');
    const [path, search] = probe.textContent!.split('?');
    expect(path).toMatch(/^\/review\/pgn\/[0-9a-z]+$/);
    expect(search).toBe('as=You');
    const record = await loadPgnGame(path!.replace('/review/', ''));
    expect(record).toMatchObject({ white: { name: 'You' }, result: '0-1' });
  });

  it('starts a rematch or goes back to the setup when the game is over', async () => {
    usePlayStore.setState({ game: newGame('w', 8, Date.now()) });
    renderPlay();
    fireEvent.click(screen.getByRole('button', { name: /Resign/ }));
    fireEvent.click(
      screen.getByRole('group', { name: 'Confirm resignation' }).querySelector('button')!,
    );
    // No moves: nothing to review.
    expect(screen.getByRole('button', { name: /Review this game/ }).hasAttribute('disabled')).toBe(
      true,
    );
    const finished = usePlayStore.getState().game!;
    fireEvent.click(screen.getByRole('button', { name: /Rematch/ }));
    const rematch = usePlayStore.getState().game!;
    expect(rematch.id).not.toBe(finished.id);
    expect(rematch).toMatchObject({ level: 8, moves: [], outcome: null });

    fireEvent.click(screen.getByRole('button', { name: /Resign/ }));
    fireEvent.click(
      screen.getByRole('group', { name: 'Confirm resignation' }).querySelector('button')!,
    );
    fireEvent.click(screen.getByRole('button', { name: /New game/ }));
    expect(usePlayStore.getState().game).toBeNull();
    expect(screen.getByRole('button', { name: /^Play/ })).toBeTruthy();
  });

  it('shows an engine failure and tries again', async () => {
    engine.fail = true;
    usePlayStore.setState({ game: newGame('b', 8, Date.now()) });
    renderPlay();
    expect(await screen.findByText('Stockfish could not move.')).toBeTruthy();
    expect(screen.getByText('The engine took too long to load.')).toBeTruthy();

    engine.fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(usePlayStore.getState().game?.moves).toHaveLength(1));
    expect(screen.queryByText('Stockfish could not move.')).toBeNull();
  });

  it('resumes the saved game after a reload', async () => {
    const saved = { ...newGame('w', 3, Date.now()), moves: ['e2e4', 'e7e5'] };
    localStorage.setItem('kibitz-play', JSON.stringify({ state: { game: saved }, version: 1 }));
    await usePlayStore.persist.rehydrate();
    expect(usePlayStore.getState().game?.moves).toEqual(['e2e4', 'e7e5']);

    localStorage.setItem(
      'kibitz-play',
      JSON.stringify({ state: { game: { ...saved, moves: ['e2e5'] } }, version: 1 }),
    );
    await usePlayStore.persist.rehydrate();
    expect(usePlayStore.getState().game).toBeNull();
  });
});
