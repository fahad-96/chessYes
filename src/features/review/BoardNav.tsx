import { ArrowDownUp, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface BoardNavProps {
  ply: number;
  totalPlies: number;
  onSeek: (ply: number) => void;
  onFlip: () => void;
  /** Draws its own border and background (false when a parent bar provides them). */
  framed?: boolean;
  className?: string;
}

function NavButton({
  label,
  shortcut,
  onClick,
  disabled,
  children,
  wide,
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={`${label} (${shortcut})`}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-11 items-center justify-center rounded-xl text-text transition-colors',
        'hover:bg-surface-3 active:bg-surface-3 disabled:pointer-events-none disabled:opacity-35',
        'focus-visible:outline-2 focus-visible:outline-accent',
        wide ? 'flex-[1.4]' : 'flex-1',
      )}
    >
      {children}
    </button>
  );
}

/** First / previous / next / last move and flip board. */
export function BoardNav({
  ply,
  totalPlies,
  onSeek,
  onFlip,
  framed = true,
  className,
}: BoardNavProps) {
  const atStart = ply <= 0;
  const atEnd = ply >= totalPlies;
  return (
    <nav
      aria-label="Move navigation"
      className={cn(
        'flex items-center gap-1 p-1',
        framed && 'rounded-2xl border border-line bg-surface',
        className,
      )}
    >
      <NavButton label="First move" shortcut="Home" onClick={() => onSeek(0)} disabled={atStart}>
        <ChevronFirst aria-hidden="true" className="h-5 w-5" />
      </NavButton>
      <NavButton
        label="Previous move"
        shortcut="ArrowLeft"
        onClick={() => onSeek(ply - 1)}
        disabled={atStart}
        wide
      >
        <ChevronLeft aria-hidden="true" className="h-6 w-6" />
      </NavButton>
      <NavButton
        label="Next move"
        shortcut="ArrowRight"
        onClick={() => onSeek(ply + 1)}
        disabled={atEnd}
        wide
      >
        <ChevronRight aria-hidden="true" className="h-6 w-6" />
      </NavButton>
      <NavButton
        label="Last move"
        shortcut="End"
        onClick={() => onSeek(totalPlies)}
        disabled={atEnd}
      >
        <ChevronLast aria-hidden="true" className="h-5 w-5" />
      </NavButton>
      <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-line" />
      <NavButton label="Flip board" shortcut="F" onClick={onFlip}>
        <ArrowDownUp aria-hidden="true" className="h-5 w-5" />
      </NavButton>
    </nav>
  );
}
