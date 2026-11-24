// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from '@/app/Layout';
import { useSettings } from '@/state/settings';
import HomePage from './HomePage';

function PlayerProbe() {
  const { platform, username } = useParams();
  return <p>player page: {`${platform}/${username}`}</p>;
}

function renderApp(path = '/') {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/player/:platform/:username', element: <PlayerProbe /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  // jsdom has no scrolling; ScrollRestoration calls window.scrollTo on navigation.
  vi.stubGlobal('scrollTo', vi.fn());
  useSettings.setState({ recent: [], theme: 'system', boardTheme: 'slate' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.board;
});

describe('app shell', () => {
  it('shows the footer disclaimer and applies theme settings to <html>', () => {
    renderApp();
    expect(screen.getByText(/Not affiliated with Chess\.com or Lichess\./)).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.board).toBe('slate');

    act(() => useSettings.getState().set({ theme: 'light', boardTheme: 'walnut' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.board).toBe('walnut');

    act(() => useSettings.getState().set({ theme: 'system' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('marks the Review nav item as current on the home page', () => {
    renderApp();
    // The header names the section; the links themselves are in the menu.
    expect(screen.getByRole('button', { name: 'Review: open menu' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const current = screen.getByRole('link', { current: 'page' });
    expect(current.textContent).toContain('Review');
  });
});

describe('home search', () => {
  it('rejects invalid usernames with a readable message', () => {
    renderApp();
    const input = screen.getByLabelText('Chess.com username');
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: /find games/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/3 to 25 characters/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('navigates to the player page and remembers the search', () => {
    const router = renderApp();
    fireEvent.click(screen.getByRole('radio', { name: 'Lichess' }));
    fireEvent.change(screen.getByLabelText('Lichess username'), {
      target: { value: ' DrNykterstein ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /find games/i }));
    expect(router.state.location.pathname).toBe('/player/lichess/DrNykterstein');
    expect(screen.getByText('player page: lichess/DrNykterstein')).toBeTruthy();
    expect(useSettings.getState().recent[0]).toEqual({
      platform: 'lichess',
      username: 'DrNykterstein',
    });
  });

  it('switches platform when a profile URL is pasted', () => {
    const router = renderApp();
    fireEvent.change(screen.getByLabelText('Chess.com username'), {
      target: { value: 'https://lichess.org/@/thibault' },
    });
    fireEvent.click(screen.getByRole('button', { name: /find games/i }));
    expect(router.state.location.pathname).toBe('/player/lichess/thibault');
  });

  it('lists recent searches and removes one', () => {
    useSettings.setState({
      recent: [
        { platform: 'chesscom', username: 'hikaru' },
        { platform: 'lichess', username: 'thibault' },
      ],
    });
    renderApp();
    expect(screen.getByRole('link', { name: /hikaru/ }).getAttribute('href')).toBe(
      '/player/chesscom/hikaru',
    );
    fireEvent.click(screen.getByRole('button', { name: /Remove hikaru/ }));
    expect(useSettings.getState().recent).toEqual([{ platform: 'lichess', username: 'thibault' }]);
    expect(screen.queryByRole('link', { name: /hikaru/ })).toBeNull();
  });
});
