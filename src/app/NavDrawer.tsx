import { useEffect, useRef, type ComponentType } from 'react';
import { FileUp, Info, Puzzle, ScanSearch, Settings, Swords, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GithubIcon } from '@/components/ui/GithubIcon';
import { Logo } from '@/components/ui/Logo';
import { AUTHOR_NAME, AUTHOR_URL, REPO_URL } from '@/features/about/links';
import { cn } from '@/lib/cn';

export interface NavItem {
  to: string;
  label: string;
  /** One line under the label in the menu. */
  description: string;
  icon: ComponentType<{ className?: string }>;
  /** Whether the current path belongs to this section. */
  matches: (pathname: string) => boolean;
}

const startsWith = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}/`);

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Chess',
    items: [
      {
        to: '/',
        label: 'Review',
        description: 'Look up your games and review them',
        icon: ScanSearch,
        // The review flow starts at home, so game lists and reviews count as "Review".
        matches: (p) => p === '/' || p.startsWith('/player/') || p.startsWith('/review/'),
      },
      {
        to: '/play',
        label: 'Play',
        description: 'Play Stockfish at eight strengths',
        icon: Swords,
        matches: startsWith('/play'),
      },
      {
        to: '/puzzles',
        label: 'Puzzles',
        description: 'Train on your own mistakes',
        icon: Puzzle,
        matches: startsWith('/puzzles'),
      },
      {
        to: '/import',
        label: 'Import PGN',
        description: 'Paste or upload any game',
        icon: FileUp,
        matches: startsWith('/import'),
      },
    ],
  },
  {
    title: 'App',
    items: [
      {
        to: '/settings',
        label: 'Settings',
        description: 'Theme, board and analysis',
        icon: Settings,
        matches: startsWith('/settings'),
      },
      {
        to: '/about',
        label: 'About',
        description: 'How Chess Yes works',
        icon: Info,
        matches: startsWith('/about'),
      },
    ],
  },
];

/** The section the path belongs to (shown in the header), or null (e.g. a 404). */
export function currentNavItem(pathname: string): NavItem | null {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((candidate) => candidate.matches(pathname));
    if (item) return item;
  }
  return null;
}

export interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
  pathname: string;
}

/**
 * The main menu: a modal <dialog> sliding in from the left as a frosted glass panel.
 * The dialog gives focus trapping, Escape to close and an inert page for free; a click on
 * the dimmed page or on a link closes it, and focus returns to the menu button.
 */
export function NavDrawer({ open, onClose, pathname }: NavDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      // Start on the current page's link rather than the first one.
      dialog.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      id="nav-drawer"
      aria-label="Menu"
      className="kb-glass kb-drawer"
      // Escape (and the browser's own close requests) end here.
      onClose={onClose}
      onClick={(event) => {
        // The panel fills the dialog, so a click on the dialog itself is on the backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 py-3 pr-3 pl-4">
          <Link to="/" onClick={onClose} aria-label="Chess Yes home" className="rounded-lg py-1">
            <Logo />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-3">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="mt-3 first:mt-1">
              <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
                {section.title}
              </p>
              <ul className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const active = item.matches(pathname);
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'group flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors',
                          active
                            ? 'bg-accent/15 text-text ring-1 ring-accent/30 ring-inset'
                            : 'text-text hover:bg-hover',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                            active
                              ? 'border-transparent bg-button text-accent-fg'
                              : 'border-glass-border bg-hover text-muted group-hover:text-text',
                          )}
                        >
                          <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[15px] leading-tight font-semibold">
                            {item.label}
                          </span>
                          <span className="truncate text-xs text-muted">{item.description}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-2 border-t border-glass-border px-4 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] text-sm text-muted">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md hover:text-text"
          >
            <GithubIcon className="h-4 w-4" />
            Source code on GitHub
          </a>
          <p className="text-xs">
            Created by{' '}
            <a
              href={AUTHOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-text"
            >
              {AUTHOR_NAME}
            </a>
          </p>
        </div>
      </div>
    </dialog>
  );
}
