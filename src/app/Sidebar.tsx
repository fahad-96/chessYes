import { Moon, Sun, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { PLATFORM_LABELS } from '@/features/home/username';
import { cn } from '@/lib/cn';
import { useSettings } from '@/state/settings';
import { NAV_SECTIONS } from './NavDrawer';

/** Light when the light theme is chosen, or when following a light system. */
function useIsLight(): boolean {
  const theme = useSettings((s) => s.theme);
  if (theme === 'light') return true;
  if (theme !== 'system' || typeof matchMedia !== 'function') return false;
  return matchMedia('(prefers-color-scheme: light)').matches;
}

/**
 * The app's navigation on large screens: a floating glass panel on the left with the
 * sections, then the theme switch and the connected account at the bottom. Smaller screens
 * use the header's menu drawer (NavDrawer) instead.
 */
export function Sidebar({ pathname }: { pathname: string }) {
  const account = useSettings((s) => s.account);
  const setSettings = useSettings((s) => s.set);
  const isLight = useIsLight();
  const [main, app] = NAV_SECTIONS;

  const itemClass = (active: boolean) =>
    cn(
      'flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors',
      active
        ? 'bg-accent/15 text-text ring-1 ring-accent/25 ring-inset'
        : 'text-muted hover:bg-hover hover:text-text',
    );

  return (
    <aside className="kb-glass fixed inset-y-3 left-3 z-30 hidden w-60 flex-col rounded-2xl lg:flex">
      <Link to="/home" aria-label="Chess Yes home" className="mx-4 mt-5 mb-6 rounded-lg">
        <Logo />
      </Link>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-1">
          {main?.items.map((item) => {
            const active = item.matches(pathname);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={itemClass(active)}
                >
                  <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex flex-col gap-1 border-t border-glass-border px-3 pt-3 pb-3">
        <button
          type="button"
          onClick={() => setSettings({ theme: isLight ? 'classic' : 'light' })}
          className={itemClass(false)}
        >
          {isLight ? (
            <Moon className="h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <Sun className="h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          {isLight ? 'Dark mode' : 'Light mode'}
        </button>
        {app?.items.map((item) => {
          const active = item.matches(pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={itemClass(active)}
            >
              <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        <Link
          to="/home?connect"
          className="mt-1 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-hover"
          title={account ? 'Change account' : 'Connect your Chess.com or Lichess account'}
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand/40 to-brand/10 font-display text-lg text-text"
          >
            {account ? (
              account.username.slice(0, 1).toUpperCase()
            ) : (
              <UserRound className="h-4 w-4" />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">
              {account ? account.username : 'Connect account'}
            </span>
            <span className="truncate text-xs text-muted">
              {account ? PLATFORM_LABELS[account.platform] : 'Chess.com or Lichess'}
            </span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
