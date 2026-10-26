import { Lightbulb, SkipForward, Square, Volume2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The step of a "show why" line, right under the board: "31... Bxg8 — takes the rook".
 * Read out by screen readers as the line plays.
 */
export function StoryCaption({
  caption,
  tone,
  className,
}: {
  caption: string;
  /** 'threat' when the line shows what the opponent does to the player. */
  tone: 'threat' | 'idea';
  className?: string;
}) {
  return (
    <p
      aria-live="polite"
      className={cn(
        'flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-sm leading-snug font-medium',
        tone === 'threat' ? 'border-danger/30 bg-danger/10' : 'border-success/30 bg-success/10',
        className,
      )}
    >
      <Lightbulb
        aria-hidden="true"
        className={cn('h-4 w-4 shrink-0', tone === 'threat' ? 'text-danger' : 'text-success')}
      />
      <span className="min-w-0">{caption}</span>
    </p>
  );
}

export interface TourBarProps {
  /** 0-based position in the tour. */
  index: number;
  total: number;
  /** The move being narrated, e.g. "31. Rg8". */
  label: string;
  onNext: () => void;
  onStop: () => void;
  className?: string;
}

/** "Narrate key moments" in progress: which moment is being told, skip and stop. */
export function TourBar({ index, total, label, onNext, onStop, className }: TourBarProps) {
  const last = index >= total - 1;
  return (
    <div
      role="group"
      aria-label="Narrating key moments"
      className={cn(
        'flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 py-1 pr-1 pl-3 text-sm',
        className,
      )}
    >
      <Volume2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-pulse text-accent" />
      <p className="min-w-0 flex-1 truncate" aria-live="polite">
        <span className="font-medium">
          Key moment {index + 1} of {total}
        </span>
        <span className="text-muted"> · {label}</span>
      </p>
      {!last && (
        <button
          type="button"
          onClick={onNext}
          aria-label="Next key moment"
          title="Next key moment"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <SkipForward aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onStop}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 font-medium hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
        Stop
      </button>
    </div>
  );
}
