// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from '@/app/Layout';
import { useSettings } from '@/state/settings';
import HomePage from './HomePage';

function renderApp(path = '/') {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/home', element: <p>Home page</p> },
          { path: '/about', element: <p>About page</p> },
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
  useSettings.setState({ recent: [], theme: 'system', boardTheme: 'slate', account: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.board;
});

describe('landing page', () => {
  it('is a single screen: the headline and one way in, without the app chrome', () => {
    renderApp();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Every move,explained.');
    expect(screen.getByText('Free chess game review')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start' }).getAttribute('href')).toBe('/home');
    // No app header, menu or footer on the landing page.
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
    expect(screen.queryByText(/Not affiliated with Chess\.com or Lichess\./)).toBeNull();
  });

  it('links to the main pages at the foot', () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Chess Yes' });
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/home', '/import', '/play', '/puzzles', '/about#faq', '/about']);
  });

  it('starts the app with Start', () => {
    const router = renderApp();
    fireEvent.click(screen.getByRole('link', { name: 'Start' }));
    expect(router.state.location.pathname).toBe('/home');
    expect(screen.getByText('Home page')).toBeTruthy();
  });
});

describe('app shell', () => {
  it('shows the footer disclaimer and applies theme settings to <html>', () => {
    renderApp('/about');
    expect(screen.getByText(/Not affiliated with Chess\.com or Lichess\./)).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.board).toBe('slate');

    act(() => useSettings.getState().set({ theme: 'light', boardTheme: 'walnut' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.board).toBe('walnut');

    act(() => useSettings.getState().set({ theme: 'system' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('marks Home as current in the menu and the sidebar on /home', () => {
    renderApp('/home');
    expect(screen.getByRole('button', { name: 'Home: open menu' })).toBeTruthy();
    // The sidebar (large screens) marks the current page too.
    const sidebarCurrent = document.querySelector('aside [aria-current="page"]');
    expect(sidebarCurrent?.textContent).toContain('Home');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const current = document.querySelector('#nav-drawer [aria-current="page"]');
    expect(current?.textContent).toContain('Home');
  });

  it('switches between light and dark from the sidebar', () => {
    useSettings.setState({ theme: 'classic' });
    renderApp('/home');
    fireEvent.click(screen.getByRole('button', { name: 'Light mode' }));
    expect(useSettings.getState().theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    expect(useSettings.getState().theme).toBe('classic');
  });

  it('shows the connected account in the sidebar', () => {
    useSettings.setState({ account: { platform: 'lichess', username: 'thibault' } });
    renderApp('/home');
    const link = document.querySelector('aside a[href="/home?connect"]');
    expect(link?.textContent).toContain('thibault');
    expect(link?.textContent).toContain('Lichess');
  });
});
