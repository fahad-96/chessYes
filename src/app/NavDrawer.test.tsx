// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Layout } from './Layout';
import { NAV_SECTIONS, currentNavItem } from './NavDrawer';

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <p>Landing page</p> },
          { path: '/home', element: <p>Home page</p> },
          { path: '/play', element: <p>Play page</p> },
          { path: '/puzzles', element: <p>Puzzles page</p> },
          { path: '/review/*', element: <p>Review page</p> },
          { path: '*', element: <p>Not found</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const drawer = () => document.getElementById('nav-drawer') as HTMLDialogElement;

// ScrollRestoration scrolls on navigation, which jsdom does not implement.
beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(cleanup);

describe('currentNavItem', () => {
  it('finds the section of a path', () => {
    expect(currentNavItem('/home')?.label).toBe('Home');
    expect(currentNavItem('/review/lichess/abc')?.label).toBe('Home');
    expect(currentNavItem('/player/chesscom/hikaru')?.label).toBe('Home');
    expect(currentNavItem('/insights/lichess/abc')?.label).toBe('Home');
    expect(currentNavItem('/')).toBeNull();
    expect(currentNavItem('/play')?.label).toBe('Play');
    expect(currentNavItem('/settings')?.label).toBe('Settings');
    expect(currentNavItem('/nowhere')).toBeNull();
  });

  it('lists every section once', () => {
    const paths = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.to));
    expect(paths).toEqual(['/home', '/play', '/puzzles', '/import', '/settings', '/about']);
  });
});

describe('the header menu', () => {
  it('opens from the menu button and marks the current page', () => {
    renderAt('/play');
    const button = screen.getByRole('button', { name: 'Open menu' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(drawer().open).toBe(false);

    fireEvent.click(button);
    expect(drawer().open).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const current = drawer().querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain('Play');
    expect(drawer().querySelectorAll('nav a')).toHaveLength(6);
  });

  it('shows the current section in the header', () => {
    renderAt('/puzzles');
    expect(screen.getByRole('button', { name: 'Puzzles: open menu' })).toBeTruthy();
  });

  it('closes with the close button and on the backdrop', () => {
    renderAt('/home');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close menu', hidden: true }));
    expect(drawer().open).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    // A click on the dialog element itself is a click on the dimmed page around the panel.
    fireEvent.click(drawer());
    expect(drawer().open).toBe(false);
  });

  it('navigates and closes when a link is picked', async () => {
    const router = renderAt('/home');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const puzzles = [...drawer().querySelectorAll('nav a')].find((link) =>
      link.textContent?.startsWith('Puzzles'),
    )!;
    await act(async () => {
      fireEvent.click(puzzles);
    });
    expect(router.state.location.pathname).toBe('/puzzles');
    expect(await screen.findByText('Puzzles page')).toBeTruthy();
    expect(drawer().open).toBe(false);
  });

  it('closes when the page changes from elsewhere (back, forward)', async () => {
    const router = renderAt('/home');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await act(async () => {
      await router.navigate('/play');
    });
    expect(drawer().open).toBe(false);
  });
});
