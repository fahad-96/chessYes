import { useEffect, useLayoutEffect, useRef, type ComponentType } from 'react';
import { FileUp, Info, Puzzle, ScanSearch, Settings } from 'lucide-react';
import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { GithubIcon } from '@/components/ui/GithubIcon';
import { Logo } from '@/components/ui/Logo';
import { CLASSIFICATION_DOC_URL, REPO_URL } from '@/features/about/links';
import { cn } from '@/lib/cn';
import { useSettings, type BoardTheme, type ThemeSetting } from '@/state/settings';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Whether the current path belongs to this section. */
  matches: (pathname: string) => boolean;
  /** Left out of the phone header (below 640px) to keep it from overflowing. */
  hideOnPhones?: boolean;
}

const startsWith = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}/`);

const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Review',
    icon: ScanSearch,
    // The review flow starts at home, so game lists and reviews count as "Review".
    matches: (p) => p === '/' || p.startsWith('/player/') || p.startsWith('/review/'),
  },
  { to: '/puzzles', label: 'Puzzles', icon: Puzzle, matches: startsWith('/puzzles') },
  {
    to: '/import',
    label: 'Import PGN',
    icon: FileUp,
    matches: startsWith('/import'),
    // The home page links to the import, so phones can do without the icon.
    hideOnPhones: true,
  },
  { to: '/settings', label: 'Settings', icon: Settings, matches: startsWith('/settings') },
  { to: '/about', label: 'About', icon: Info, matches: startsWith('/about') },
];

/** App shell: sticky header, page outlet and footer. Also applies the theme settings. */
export function Layout() {
  const theme = useSettings((s) => s.theme);
  const boardTheme = useSettings((s) => s.boardTheme);
  useDocumentTheme(theme, boardTheme);
  useFocusOnNavigation();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        onClick={(event) => {
          // Hash routing owns the URL fragment, so move focus manually instead of navigating.
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
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

function Header() {
  const { pathname } = useLocation();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-4">
        <Link to="/" aria-label="Kibitz home" className="-ml-1 rounded-lg px-1 py-1">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.matches(pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // 40px tap targets on phones; compact once the labels show.
                  'inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors md:h-9 md:min-w-0 md:px-3',
                  item.hideOnPhones && 'max-sm:hidden',
                  active
                    ? 'bg-surface-2 text-text'
                    : 'text-muted hover:bg-surface-2 hover:text-text',
                )}
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                {/* Icon-only on phones so the header never overflows, even at 320px. */}
                <span className="sr-only md:not-sr-only">{item.label}</span>
              </Link>
            );
          })}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Source code on GitHub"
            // Hidden on phones to leave room for full-size nav targets; the footer links it too.
            className="ml-0.5 hidden h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text sm:inline-flex"
          >
            <GithubIcon className="h-[18px] w-[18px]" />
            <span className="sr-only">Source code on GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const linkClass = 'underline-offset-4 hover:text-text hover:underline';
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-sm text-muted sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-xl leading-relaxed">
          Kibitz is free and open-source software (GPL-3.0). Analysis by Stockfish, running on your
          device. Not affiliated with Chess.com or Lichess.
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          <li>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
              Source code
            </a>
          </li>
          <li>
            <a
              href={CLASSIFICATION_DOC_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              How moves are classified
            </a>
          </li>
          <li>
            <Link to="/about" className={linkClass}>
              Licenses
            </Link>
          </li>
        </ul>
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
 * data-theme / data-board) and keeps the browser UI colour (theme-color) in sync.
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
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) meta.content = bg;
    };
    sync();
    if (theme !== 'system' || typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: light)');
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [theme]);
}
