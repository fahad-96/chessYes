import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Download, FileText, Link2, Share2, SquareDashed } from 'lucide-react';
import { cn } from '@/lib/cn';
import { copyText, downloadText } from './share';

export interface ShareMenuProps {
  /** Link to the review at the move on the board. */
  getLink: () => string;
  /** FEN of the position on the board. */
  getFen: () => string;
  getPgn: () => string;
  /** The analysis is complete, so the annotated PGN can be downloaded. */
  annotatedReady: boolean;
  getAnnotatedPgn: () => string;
  annotatedFileName: string;
  /** Icon-only trigger (phone header). */
  compact?: boolean;
  className?: string;
}

interface Item {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  hint?: string;
  run: () => Promise<{ text: string; ok: boolean }> | { text: string; ok: boolean };
}

const iconClass = 'h-4 w-4 shrink-0';

/** "Share" button with a menu: copy link / FEN / PGN, download annotated PGN. */
export function ShareMenu({
  getLink,
  getFen,
  getPgn,
  annotatedReady,
  getAnnotatedPgn,
  annotatedFileName,
  compact = false,
  className,
}: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const copy = async (text: string, what: string) =>
    (await copyText(text))
      ? { text: `${what} copied`, ok: true }
      : { text: `Could not copy the ${what.toLowerCase()}`, ok: false };

  const items: Item[] = [
    {
      id: 'link',
      label: 'Copy review link',
      icon: <Link2 aria-hidden="true" className={iconClass} />,
      run: () => copy(getLink(), 'Link'),
    },
    {
      id: 'fen',
      label: 'Copy FEN',
      icon: <SquareDashed aria-hidden="true" className={iconClass} />,
      run: () => copy(getFen(), 'FEN'),
    },
    {
      id: 'pgn',
      label: 'Copy PGN',
      icon: <FileText aria-hidden="true" className={iconClass} />,
      run: () => copy(getPgn(), 'PGN'),
    },
    {
      id: 'download',
      label: 'Download annotated PGN',
      icon: <Download aria-hidden="true" className={iconClass} />,
      disabled: !annotatedReady,
      hint: annotatedReady ? undefined : 'Available when the analysis finishes',
      run: () => {
        downloadText(annotatedFileName, getAnnotatedPgn());
        return { text: 'Annotated PGN downloaded', ok: true };
      },
    },
  ];

  // Close on a click or tap outside.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  // The confirmation fades after a moment.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const runItem = async (item: Item) => {
    if (item.disabled) return;
    close(true);
    try {
      setStatus(await item.run());
    } catch (error) {
      console.error('Share action failed', error);
      setStatus({ text: 'Something went wrong', ok: false });
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (next: number) => buttons[(next + buttons.length) % buttons.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(buttons.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={compact ? 'Share' : undefined}
        title="Share or export this review"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface-2 text-sm font-medium text-text transition-colors',
          'hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent',
          compact ? 'w-10' : 'px-3 lg:h-9',
        )}
      >
        <Share2 aria-hidden="true" className="h-4 w-4" />
        {!compact && 'Share'}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Share and export"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-1 shadow-lg shadow-black/20"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              onClick={() => void runItem(item)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                'focus-visible:bg-surface-2 focus-visible:outline-none',
                item.disabled ? 'cursor-default text-muted/70' : 'hover:bg-surface-2',
              )}
            >
              {item.icon}
              <span className="flex min-w-0 flex-col">
                <span>{item.label}</span>
                {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <span
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-none absolute top-full right-0 z-30 mt-2 inline-flex items-center gap-1.5 rounded-lg bg-text px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-bg shadow transition-opacity',
          status && !open ? 'opacity-100' : 'opacity-0',
        )}
      >
        {status?.ok && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
        {status?.text}
      </span>
    </div>
  );
}
