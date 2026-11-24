import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { GithubIcon } from '@/components/ui/GithubIcon';
import { Logo } from '@/components/ui/Logo';
import { AUTHOR_NAME, AUTHOR_URL, CLASSIFICATION_DOC_URL, REPO_URL } from '@/features/about/links';
import { useSettings, type BoardTheme, type ThemeSetting } from '@/state/settings';
import { NavDrawer, currentNavItem } from './NavDrawer';
import { useSeoHead } from './useSeoHead';

/** App shell: sticky header, page outlet and footer. Also applies the theme settings. */
export function Layout() {
  const theme = useSettings((s) => s.theme);
  const boardTheme = useSettings((s) => s.boardTheme);
  useDocumentTheme(theme, boardTheme);
  useFocusOnNavigation();
  useSeoHead(useLocation().pathname);

  return (
    <div className="flex min-h-dvh flex-col">
      <div aria-hidden="true" className="kb-ambient" />
      <a
        href="#main"
        onClick={(event) => {
          // Hash routing owns the URL fragment, so move focus manually instead of navigating.
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-button focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        Skip to content
      </a>
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 outline-none sm:py-6"
      >
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}

/**
 * Floating glass header: the menu button and the logo on the left, the current section
 * and the source link on the right. The sections live in the menu drawer (NavDrawer).
 */
function Header() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = currentNavItem(pathname);

  // Navigating (a link, back or forward) closes the menu.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 px-2 pt-2 sm:px-4 sm:pt-3">
      <div className="kb-glass mx-auto flex h-14 w-full max-w-6xl items-center gap-1 rounded-2xl pr-2 pl-1.5 sm:gap-2">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-controls="nav-drawer"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-text transition-colors hover:bg-hover"
        >
          <Menu className="h-[22px] w-[22px]" aria-hidden="true" />
        </button>
        <Link to="/" aria-label="Chess Yes home" className="rounded-lg px-1 py-1">
          <Logo />
        </Link>
        <div className="ml-auto flex items-center gap-1">
          {current && (
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={`${current.label}: open menu`}
              className="hidden h-9 items-center gap-2 rounded-full border border-glass-border bg-hover px-3 text-sm font-medium text-text transition-colors hover:bg-accent/15 sm:inline-flex"
            >
              <current.icon className="h-4 w-4 text-brand" aria-hidden="true" />
              {current.label}
            </button>
          )}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Source code on GitHub"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <GithubIcon className="h-[18px] w-[18px]" />
            <span className="sr-only">Source code on GitHub</span>
          </a>
        </div>
      </div>
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} pathname={pathname} />
    </header>
  );
}

function Footer() {
  const linkClass =
    'underline underline-offset-4 decoration-line hover:text-text hover:decoration-current';
  const quietLinkClass = 'underline-offset-4 hover:text-text hover:underline';
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-sm text-muted">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <p>
            Chess Yes is open source under the GPL-3.0 licence.{' '}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
              Read the code
            </a>
            .
          </p>
          <p>
            Created and maintained by{' '}
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {AUTHOR_NAME}
            </a>
          </p>
        </div>
        <div className="flex flex-col gap-1 text-xs sm:flex-row sm:items-baseline sm:justify-between">
          <p className="max-w-xl leading-relaxed">
            Analysis by Stockfish, running on your device. Not affiliated with Chess.com or Lichess.
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            <li>
              <a
                href={CLASSIFICATION_DOC_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={quietLinkClass}
              >
                How moves are classified
              </a>
            </li>
            <li>
              <Link to="/about" className={quietLinkClass}>
                Licenses
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

/**
 * After a route change, moves focus to the page content, so keyboard and screen-reader
 * users start on the new page instead of on <body> (the link they activated is gone).
 * The first render is skipped: on page load the browser's own focus handling is right.
 */
function useFocusOnNavigation() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);
}

/**
 * Mirrors the theme settings onto <html> (index.css keys the colour tokens off
 * data-theme / data-board) and keeps the browser UI colour (theme-color) in sync with
 * the header bar (--chrome: the page background, or the darker bar of the classic theme).
 */
function useDocumentTheme(theme: ThemeSetting, boardTheme: BoardTheme) {
  // Layout effect: apply before paint so a non-system theme never flashes.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    root.dataset.board = boardTheme;
  }, [theme, boardTheme]);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const sync = () => {
      const style = getComputedStyle(document.documentElement);
      const color = (style.getPropertyValue('--chrome') || style.getPropertyValue('--bg')).trim();
      if (color) meta.content = color;
    };
    sync();
    if (theme !== 'system' || typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: light)');
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [theme]);
}
