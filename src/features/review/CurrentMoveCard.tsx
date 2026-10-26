import type { ReactNode } from 'react';
import { Eye, EyeOff, Lightbulb, Play, RotateCcw } from 'lucide-react';
import type { Classification, Color, MoveReview, ParsedMove } from '@/core/types';
import { moveNumberLabel } from '@/core/notation';
import { storyMatters } from '@/core/tactics';
import { formatScore } from '@/core/winPercent';
import { ClassificationIcon } from '@/components/ClassificationIcon';
import { CLASSIFICATION_META, verdictText } from '@/components/classificationMeta';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import type { AnalysisStatus } from './useGameReview';
import { formatLine, nextMoveNumber } from './reviewHelpers';
import { storyTitle } from './story';
import { useMediaQuery } from './useMediaQuery';

const NO_BEST_LINE: ReadonlySet<Classification> = new Set(['book', 'forced']);
const REPLY_MATTERS: ReadonlySet<Classification> = new Set(['mistake', 'blunder', 'missedWin']);

export interface CurrentMoveCardProps {
  ply: number;
  totalPlies: number;
  move: ParsedMove | undefined;
  moveReview: MoveReview | undefined;
  /** Evaluation after the move, e.g. "+1.3" or "1-0". */
  evalText: string | null;
  openingName: string | null;
  analysisStatus: AnalysisStatus;
  /** The review could not be built, so analysed moves have no rating either. */
  reviewFailed?: boolean;
  /** Whether this move has an arrow to draw at all (the switch is hidden otherwise). */
  hasArrow: boolean;
  showArrow: boolean;
  onToggleArrow: (show: boolean) => void;
  onStart: () => void;
  onResume: () => void;
  showStartButton: boolean;
  /** The colour "you" played, when known: "You played Nf5" instead of "Black played Nf5". */
  perspectiveColor?: Color | null;
  /** Opens an engine line on the board: the best line, or the continuation after the move. */
  onShowLine?: (line: 'best' | 'played') => void;
  /**
   * Plays a story on the board: 'why' (the refutation of a bad move or the idea behind a
   * good one) or 'best' (what the better move would have done).
   */
  onShowStory?: (story: 'why' | 'best') => void;
  /** Starts retrying this move; given only for moves that can be retried. */
  onRetry?: () => void;
  className?: string;
}

function LineBlock({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 py-0.5">{title}</p>
        {action}
      </div>
      <p className="mt-1 font-mono text-xs leading-relaxed break-words text-muted">{children}</p>
    </div>
  );
}

function ShowLineButton({
  label,
  onClick,
  text = 'Show line',
}: {
  label: string;
  onClick: () => void;
  text?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="-my-2 -mr-2 inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Play aria-hidden="true" className="h-3.5 w-3.5" />
      {text}
    </button>
  );
}

/** What happened on the move being shown, and what the engine preferred. */
export function CurrentMoveCard({
  ply,
  totalPlies,
  move,
  moveReview,
  evalText,
  openingName,
  analysisStatus,
  reviewFailed = false,
  hasArrow,
  showArrow,
  onToggleArrow,
  onStart,
  onResume,
  showStartButton,
  perspectiveColor = null,
  onShowLine,
  onShowStory,
  onRetry,
  className,
}: CurrentMoveCardProps) {
  // Swiping only works with touch, so only touch screens are told about it.
  const touch = useMediaQuery('(pointer: coarse)');

  if (ply === 0 || !move) {
    return (
      <Card className={cn('flex flex-col gap-3 p-4', className)} aria-live="polite">
        <div>
          <p className="text-xs text-muted">Starting position</p>
          <h2 className="text-base font-semibold">{openingName ?? 'Ready to review'}</h2>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          Step through the game to see how every move was rated and what the engine would have
          played.{' '}
          {touch
            ? 'Use the buttons below the board, or swipe across the board.'
            : 'Use the arrow keys or the buttons below the board.'}
        </p>
        {showStartButton && totalPlies > 0 && (
          <Button variant="primary" onClick={onStart}>
            <Play aria-hidden="true" className="h-4 w-4" />
            Start review
          </Button>
        )}
      </Card>
    );
  }

  const label = `${moveNumberLabel(move.moveNumber, move.color)} ${move.san}`;
  const mover = perspectiveColor === move.color ? 'You' : move.color === 'w' ? 'White' : 'Black';
  const played = `${mover} played ${label}`;

  if (!moveReview) {
    return (
      <Card className={cn('flex flex-col gap-2 p-4', className)} aria-live="polite">
        <p className="text-xs text-muted">{mover === 'You' ? 'Your move' : mover}</p>
        <h2 className="text-base font-semibold">{label}</h2>
        {reviewFailed ? (
          <p className="text-sm text-muted">The rating for this move could not be calculated.</p>
        ) : analysisStatus === 'running' || analysisStatus === 'preparing' ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="h-3.5 w-3.5" label="Analysing" />
            Analysing this move…
          </p>
        ) : analysisStatus === 'paused' || analysisStatus === 'failed' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">This move has not been analysed yet.</p>
            <Button size="sm" onClick={onResume}>
              <Play aria-hidden="true" className="h-3.5 w-3.5" />
              Resume analysis
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">No engine analysis is available for this move.</p>
        )}
      </Card>
    );
  }

  const { classification, best, playedLine, why, bestIdea } = moveReview;
  const meta = CLASSIFICATION_META[classification];
  const showBest = !!best && best.uci !== moveReview.uci && !NO_BEST_LINE.has(classification);
  const after = nextMoveNumber(move);
  // A story is worth playing when it shows a tactic, a mate or material changing hands;
  // otherwise the engine line is offered instead.
  const canShowWhy = !!why && why.movesUci.length > 0 && storyMatters(why) && !!onShowStory;
  const canShowBestIdea =
    !!bestIdea && bestIdea.movesUci.length > 0 && storyMatters(bestIdea) && !!onShowStory;
  // "Show why" already plays the line after the move; the raw continuation is the fallback.
  const showContinuation =
    !canShowWhy && !!playedLine && playedLine.pvSan.length > 0 && classification !== 'book';

  return (
    <Card className={cn('flex flex-col gap-3 p-4', className)} aria-live="polite">
      <div className="flex items-start gap-3">
        <ClassificationIcon classification={classification} size={28} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{played}</p>
          <h2 className="text-base leading-snug font-semibold" style={{ color: meta.colorVar }}>
            {verdictText(move.san, classification)}
          </h2>
        </div>
        {evalText && (
          <span
            className="tabular shrink-0 rounded-md bg-surface-2 px-2 py-1 text-sm font-semibold"
            aria-label={`Evaluation ${evalText}`}
          >
            {evalText}
          </span>
        )}
      </div>

      {moveReview.explanation && (
        <p className="text-sm leading-relaxed">{moveReview.explanation}</p>
      )}
      {canShowWhy && why && (
        <Button
          variant="primary"
          onClick={() => onShowStory?.('why')}
          aria-label={`Show ${storyTitle(why.kind, move.san, classification).replace(/^Why/, 'why')}`}
          className="self-stretch sm:self-start"
        >
          <Lightbulb aria-hidden="true" className="h-4 w-4" />
          Show why
        </Button>
      )}
      {/* The explanation already names the opening; the ECO code adds the reference. */}
      {classification === 'book' && moveReview.opening && (
        <p className="text-sm text-muted">ECO {moveReview.opening.eco}</p>
      )}

      {showBest && best && (
        <LineBlock
          action={
            canShowBestIdea ? (
              <ShowLineButton
                label={`Show what ${best.san} would have done`}
                text="Show"
                onClick={() => onShowStory?.('best')}
              />
            ) : onShowLine && best.pvUci.length > 0 ? (
              <ShowLineButton label="Show the best line" onClick={() => onShowLine('best')} />
            ) : undefined
          }
          title={
            <>
              Best was <strong className="font-semibold">{best.san}</strong>{' '}
              <span className="tabular text-muted">({formatScore(best.score)})</span>
            </>
          }
        >
          {formatLine(best.pvSan, move.moveNumber, move.color)}
        </LineBlock>
      )}

      {showContinuation && playedLine && (
        <LineBlock
          action={
            onShowLine ? (
              <ShowLineButton
                label="Show the engine continuation"
                onClick={() => onShowLine('played')}
              />
            ) : undefined
          }
          title={
            REPLY_MATTERS.has(classification) ? (
              <>
                Opponent&apos;s best reply:{' '}
                <strong className="font-semibold">{playedLine.san}</strong>
              </>
            ) : (
              'Engine continuation'
            )
          }
        >
          {formatLine(playedLine.pvSan, after.moveNumber, after.color)}
        </LineBlock>
      )}

      {onRetry && (
        <Button onClick={onRetry} className="self-stretch sm:self-start">
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Retry: find a better move
        </Button>
      )}

      {hasArrow && (
        <button
          type="button"
          role="switch"
          aria-checked={showArrow}
          onClick={() => onToggleArrow(!showArrow)}
          className="-my-2 inline-flex min-h-10 items-center gap-2 self-start rounded-md pr-2 text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          {showArrow ? (
            <Eye aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          Best-move arrow
          <span aria-hidden="true" className="font-semibold">
            {showArrow ? 'On' : 'Off'}
          </span>
        </button>
      )}
    </Card>
  );
}
