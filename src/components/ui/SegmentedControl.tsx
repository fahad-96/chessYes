import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Accessible name of the group. */
  label: string;
  size?: 'sm' | 'md';
  /** Stretch segments to fill the width. */
  fullWidth?: boolean;
  className?: string;
}

/**
 * A single-choice segmented control, built as an ARIA radio group: one tab stop,
 * arrow keys move the selection (the standard radio-group keyboard pattern).
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  fullWidth = false,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    let next: number | null = null;
    if (step !== 0) next = (selectedIndex + step + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next === null) return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'rounded-xl border border-line bg-surface-2 p-1',
        fullWidth ? 'flex w-full' : 'inline-flex',
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
              // At least 40px tall where fingers tap; tighter on larger screens.
              size === 'sm' ? 'h-10 px-2.5 text-sm sm:h-8' : 'h-10 px-3.5 text-sm sm:h-9',
              fullWidth && 'flex-1',
              selected
                ? 'bg-accent/15 text-text ring-1 ring-accent/50'
                : 'text-muted hover:text-text',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
