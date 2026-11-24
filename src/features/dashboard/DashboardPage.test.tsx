// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameRecord } from '@/core/types';
import { NotFoundError } from '@/sources/http';
import { useSettings } from '@/state/settings';
import DashboardPage from './DashboardPage';
import { greetingFor, latestRatings, recentGames } from './dashboard';

const loadProfile = vi.fn();
vi.mock('@/features/games/playerGames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/games/playerGames')>()),
  loadProfile: (...args: unknown[]) => loadProfile(...args),
}));

const NOW = Date.UTC(2026, 10, 24, 18);
function game(id: string, patch: Partial<GameRecord> = {}): GameRecord {
  return {
    id: `chesscom/hikaru/2026/11/${id}`,
    source: 'chesscom',
    white: { name: 'Hikaru', rating: 3250 },
    black: { name: 'MagnusCarlsen', rating: 3300 },
    result: '1-0',
    timeClass: 'blitz',
    timeControl: '180',
    variant: 'standard',
    endTime: NOW,
    pgn: '',
    ...patch,
  };
}

let gamesState: { data: unknown; status: string; error: null; retry: () => void };
vi.mock('@/features/games/usePlayerGames', () => ({ usePlayerGames: () => gamesState }));
vi.mock('@/features/games/useLibraryAccuracies', () => ({
  useLibraryAccuracies: () => new Map([['chesscom/hikaru/2026/11/1', 91.4]]),
}));

function renderAt(path = '/home') {
  const router = createMemoryRouter(
    [
      { path: '/home', element: <DashboardPage /> },
      { path: '/review/*', element: <p>Review page</p> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const dialog = () => document.querySelector('dialog.kb-modal') as HTMLDialogElement;

beforeEach(() => {
  loadProfile.mockReset();
  useSettings.setState({ account: null, skippedConnect: false, recent: [] });
  gamesState = {
    data: {
      profile: { platform: 'chesscom', username: 'Hikaru', name: 'Hikaru Nakamura', url: '' },
      games: [
        game('1'),
        game('2', {
          timeClass: 'rapid',
          white: { name: 'Fabi', rating: 2800 },
          black: { name: 'Hikaru', rating: 2900 },
          result: '1-0',
          endTime: NOW - 1000,
        }),
      ],
      cursor: { platform: 'chesscom', archives: [], next: 0 },
      hasMore: false,
    },
    status: 'ready',
    error: null,
    retry: vi.fn(),
  };
});

afterEach(cleanup);

describe('connect your account', () => {
  it('opens on a first visit, checks the username and remembers the account', async () => {
    loadProfile.mockResolvedValue({ platform: 'chesscom', username: 'Hikaru', url: '' });
    renderAt();
    expect(dialog().open).toBe(true);
    expect(screen.getByRole('heading', { name: 'Connect your account' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Connect Chess\.com/ }));
    const input = screen.getByLabelText('Chess.com username');
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByRole('alert').textContent).toMatch(/3 to 25 characters/);
    expect(loadProfile).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: ' hikaru ' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('heading', { name: 'You’re all set' })).toBeTruthy();
    expect(loadProfile).toHaveBeenCalledWith('chesscom', 'hikaru', expect.anything());
    expect(useSettings.getState().account).toEqual({ platform: 'chesscom', username: 'Hikaru' });
    // Still open on the last step, although the account is already saved.
    expect(dialog().open).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Show my games/ }));
    expect(dialog().open).toBe(false);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Hikaru Nakamura');
  });

  it('says so when the player does not exist', async () => {
    loadProfile.mockRejectedValue(new NotFoundError('nope'));
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: /Connect Lichess/ }));
    const input = screen.getByLabelText('Lichess username');
    fireEvent.change(input, { target: { value: 'nobody_here' } });
    fireEvent.submit(input.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /no Lichess player called “nobody_here”/,
    );
    expect(useSettings.getState().account).toBeNull();
  });

  it('lets the player go on without an account, and stops asking', () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: /Continue without one/ }));
    expect(dialog().open).toBe(false);
    expect(useSettings.getState().skippedConnect).toBe(true);
    expect(screen.getByText('Connect Chess.com or Lichess')).toBeTruthy();
    cleanup();
    renderAt();
    expect(dialog().open).toBe(false);
  });

  it('opens again from /home?connect to change the account', () => {
    useSettings.setState({ account: { platform: 'chesscom', username: 'Hikaru' } });
    const router = renderAt('/home?connect');
    expect(dialog().open).toBe(true);
    // What the browser does on Escape (jsdom's <dialog> has no close()).
    act(() => {
      dialog().removeAttribute('open');
      dialog().dispatchEvent(new Event('close'));
    });
    expect(router.state.location.search).toBe('');
  });
});

describe('home with an account', () => {
  beforeEach(() => {
    useSettings.setState({ account: { platform: 'chesscom', username: 'Hikaru' } });
  });

  it('greets the player and shows their ratings and latest games', async () => {
    renderAt();
    expect(dialog().open).toBe(false);
    expect(screen.getByText(/^Good (morning|afternoon|evening),$/)).toBeTruthy();
    const ratings = screen.getByRole('list', { name: 'Ratings' }).textContent;
    expect(ratings).toContain('3250');
    expect(ratings).toContain('2900');
    const review = screen
      .getAllByRole('link')
      .find((a) => a.textContent?.includes('Accuracy 91.4'));
    expect(review?.getAttribute('href')).toBe('/review/chesscom/hikaru/2026/11/1?as=Hikaru');
    expect(screen.getAllByText('Win')).toHaveLength(1);
    expect(screen.getAllByText('Loss')).toHaveLength(1);
  });

  it('offers to try again when the games fail to load', async () => {
    gamesState = { ...gamesState, data: null, status: 'error' };
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(gamesState.retry).toHaveBeenCalled());
  });
});

describe('dashboard helpers', () => {
  it('greets by the time of day', () => {
    expect(greetingFor(new Date(2026, 0, 1, 8))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 0, 1, 13))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 0, 1, 21))).toBe('Good evening');
    expect(greetingFor(new Date(2026, 0, 1, 2))).toBe('Good evening');
  });

  it('reads the latest rating per time class from the player’s side', () => {
    const games = [
      game('a', { timeClass: 'blitz', endTime: 1, white: { name: 'Hikaru', rating: 3100 } }),
      game('b', {
        timeClass: 'blitz',
        endTime: 2,
        black: { name: 'hikaru', rating: 3200 },
        white: { name: 'X', rating: 1 },
      }),
      game('c', { timeClass: 'rapid', endTime: 3, white: { name: 'Hikaru', rating: 2800 } }),
    ];
    expect(latestRatings(games, 'Hikaru')).toEqual([
      { timeClass: 'rapid', rating: 2800 },
      { timeClass: 'blitz', rating: 3200 },
    ]);
    expect(recentGames(games, 2).map((g) => g.id.split('/').at(-1))).toEqual(['c', 'b']);
  });
});
