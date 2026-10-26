import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Lightbulb, Pause, Play, RotateCcw, Undo2 } from 'lucide-react';
import { ListenButton } from '@/components/ListenButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { motifsAt, storyOutcome } from './story';
import { numberedMoves, type Variation } from './variation';

export interface StoryPanelProps {
  /** A variation of kind 'story'. */
  variation: Variation;
  title: string;
  playing: boolean;
  onSeek: (index: number) => void;
  onStep: (delta: number) => void;
  onTogglePlay: () => void;
  onClose: () => void;
  className?: string;
}

function IconButton({
  label,
  onClick,
  disabled,
  shortcut,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text transition-colors',
        'hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-35',
        'focus-visible:outline-2 focus-visible:outline-accent',
      )}
    >
      {children}
    </button>
  );
}

/**
 * "Show why": the story of a move played out on the board. Its moves (the step with the
 * motif is marked), the story text, play / pause / step controls, and a button that reads
 * the story aloud.
 */
export function StoryPanel({
  variation,
  title,
  playing,
  onSeek,
  onStep,
  onTogglePlay,
  onClose,
  className,
}: StoryPanelProps) {
  const story = variation.story?.story;
  if (!story) return null;
  const atStart = variation.index === 0;
  const atEnd = variation.index >= variation.moves.length;
  const chip = storyOutcome(variation);

  return (
    <Card aria-label={title} className={cn('flex flex-col gap-3 p-3 sm:p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex min-w-0 items-start gap-2 pt-1 text-sm leading-snug font-semibold">
          <Lightbulb aria-hidden="true" className="mt-px h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0">{title}</span>
        </h2>
        <Button
          size="sm"
          variant="secondary"
          onClick={onClose}
          className="h-10 shrink-0 sm:h-8"
          aria-keyshortcuts="Escape"
          title="Back to game (Esc)"
        >
          <Undo2 aria-hidden="true" className="h-4 w-4" />
          Back to game
        </Button>
      </div>

      <p className="text-sm leading-relaxed">
        {story.text}
        {chip && (
          <span
            className={cn(
              'tabular ml-2 inline-flex rounded-md px-1.5 py-0.5 align-[1px] text-xs font-semibold',
              chip.good ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
            )}
          >
            {chip.text}
          </span>
        )}
      </p>

      <ol aria-label="Moves in this line" className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
        {numberedMoves(variation.moves).map((move) => {
          const current = move.index === variation.index;
          // The step with a motif or the sacrifice is the one to look at.
          const motif =
            motifsAt(story, move.index - 1).length > 0 || (move.index === 1 && !!story.sacrifice);
          return (
            <li key={move.index} className="flex items-center">
              {move.number && (
                <span aria-hidden="true" className="tabular pr-0.5 pl-1 text-xs text-muted">
                  {move.number}
                </span>
              )}
              <button
                type="button"
                onClick={() => onSeek(move.index)}
                aria-current={current ? 'step' : undefined}
                aria-label={`${move.number ?? ''} ${move.san}${motif ? ', the key move' : ''}`.trim()}
                className={cn(
                  'inline-flex min-h-10 items-center gap-1 rounded-md px-1.5 text-sm transition-colors lg:min-h-8',
                  'focus-visible:outline-2 focus-visible:outline-accent',
                  current ? 'bg-accent/20 font-semibold text-text' : 'hover:bg-surface-2',
                )}
              >
                {move.san}
                {motif && (
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-1 border-t border-line pt-2">
        <IconButton
          label="Previous move"
          shortcut="ArrowLeft"
          onClick={() => onStep(-1)}
          disabled={atStart}
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </IconButton>
        <IconButton
          label={playing ? 'Pause' : atEnd ? 'Play again' : 'Play'}
          shortcut="Space"
          onClick={onTogglePlay}
        >
          {playing ? (
            <Pause aria-hidden="true" className="h-4 w-4" />
          ) : atEnd ? (
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Play aria-hidden="true" className="h-4 w-4" />
          )}
        </IconButton>
        <IconButton
          label="Next move"
          shortcut="ArrowRight"
          onClick={() => onStep(1)}
          disabled={atEnd}
        >
          <ChevronRight aria-hidden="true" className="h-5 w-5" />
        </IconButton>
        <div className="ml-auto flex items-center gap-1">
          {/* Reads the story aloud without turning on narration for every move. */}
          <ListenButton text={story.text} />
          <span className="tabular min-w-9 text-right text-xs text-muted" aria-hidden="true">
            {variation.index} / {variation.moves.length}
          </span>
        </div>
      </div>
    </Card>
  );
}
