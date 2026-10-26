import type { ReactNode } from 'react';
import {
  ArrowRight,
  Check,
  Eye,
  Lightbulb,
  RotateCcw,
  SkipForward,
  Target,
  Trophy,
  X,
} from 'lucide-react';
import type { Color, ParsedMove } from '@/core/types';
import { moveNumberLabel } from '@/core/notation';
import { CLASSIFICATION_META } from '@/components/classificationMeta';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { formatLine } from './reviewHelpers';
import { pieceHint } from '@/practice/hints';
import { colorName, sessionScore, type RetryResult } from './retry';
import type { RetryItem, RetrySession } from './useRetrySession';

export interface RetryPanelProps {
  session: RetrySession;
  moves: readonly ParsedMove[];
  /** The colour "you" played, when known: "you played Nf5" instead of "Black played Nf5". */
  perspectiveColor: Color | null;
  onHint: () => void;
  onReveal: () => void;
  onTryAgain: () => void;
  onNext: () => void;
  onExit: () => void;
  /** Starts a new session with the moves that were not solved. */
  onRetryMissed: (plies: number[]) => void;
  className?: string;
}

function moveLabel(move: Pick<ParsedMove, 'moveNumber' | 'color' | 'san'>): string {
  return `${moveNumberLabel(move.moveNumber, move.color)} ${move.san}`;
}

/** "In the game you played 12... Nf5, a blunder." */
function gameContext(item: RetryItem, perspectiveColor: Color | null): string {
  const meta = CLASSIFICATION_META[item.moveReview.classification];
  const who = perspectiveColor === item.move.color ? 'you' : colorName(item.move.color);
  return `In the game ${who} played ${moveLabel(item.move)}, ${meta.article} ${meta.phrase}.`;
}

function ItemBody({ item, perspectiveColor }: { item: RetryItem; perspectiveColor: Color | null }) {
  const { attempt, moveReview, move } = item;
  const best = moveReview.best;
  const opponent = colorName(move.color === 'w' ? 'b' : 'w');
  const hint = item.hints >= 1 ? pieceHint(move.fenBefore, best.uci) : null;

  switch (item.status) {
    case 'checking':
      return (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="h-3.5 w-3.5" label="Checking" />
          Checking {attempt?.san}…
        </p>
      );
    case 'good':
      return (
        <p className="text-sm leading-relaxed">
          <strong className="font-semibold">{attempt?.san}</strong> is good, but there&apos;s a
          stronger move — try again.
        </p>
      );
    case 'wrong': {
      const lead = item.gameMove ? 'That’s the move from the game.' : 'Not quite.';
      return (
        <p className="text-sm leading-relaxed">
          <strong className="font-semibold text-danger">{lead}</strong>{' '}
          {item.reply ? (
            <>
              After {attempt?.san}, {opponent} has{' '}
              <strong className="font-semibold">{item.reply.san}</strong>.
            </>
          ) : item.replyPending ? (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Spinner className="h-3 w-3" label="Looking for the reply" />
              Looking at the reply…
            </span>
          ) : (
            `${attempt?.san ?? 'That move'} does not fix the problem.`
          )}
        </p>
      );
    }
    case 'solved': {
      const isBest = item.verdict === 'best';
      return (
        <p className="text-sm leading-relaxed">
          {isBest ? (
            <>That&apos;s the engine&apos;s top move.</>
          ) : (
            <>
              Almost as good as the engine&apos;s top move,{' '}
              <strong className="font-semibold">{best.san}</strong>.
            </>
          )}
          {isBest && best.pvSan.length > 1 && (
            <span className="mt-1 block font-mono text-xs text-muted">
              {formatLine(best.pvSan, move.moveNumber, move.color, 3)}
            </span>
          )}
        </p>
      );
    }
    case 'revealed':
      return (
        <p className="font-mono text-xs leading-relaxed text-muted">
          {formatLine(best.pvSan, move.moveNumber, move.color, 4)}
        </p>
      );
    case 'solving':
    default:
      return (
        <div className="flex flex-col gap-1 text-sm leading-relaxed">
          {item.error ? (
            <p className="text-danger" role="alert">
              {item.error}
            </p>
          ) : (
            <p className="text-muted">{gameContext(item, perspectiveColor)}</p>
          )}
          {hint && (
            <p>
              <Lightbulb aria-hidden="true" className="mr-1 inline h-4 w-4 text-accent" />
              {hint.text}
              {item.hints >= 2 && ' The arrow shows where.'}
            </p>
          )}
        </div>
      );
  }
}

function title(item: RetryItem): string {
  if (item.status === 'solved') {
    return item.verdict === 'best'
      ? `Correct! ${item.attempt?.san ?? ''} is the best move`
      : `Excellent! ${item.attempt?.san ?? ''} works too`;
  }
  if (item.status === 'revealed') return `The best move was ${item.moveReview.best.san}`;
  return `Find a better move for ${colorName(item.move.color)}`;
}

const RESULT_META: Record<RetryResult, { label: string; icon: ReactNode; className: string }> = {
  solved: {
    label: 'Found',
    icon: <Check aria-hidden="true" className="h-4 w-4" />,
    className: 'text-success',
  },
  revealed: {
    label: 'Solution shown',
    icon: <Eye aria-hidden="true" className="h-4 w-4" />,
    className: 'text-muted',
  },
  skipped: {
    label: 'Skipped',
    icon: <SkipForward aria-hidden="true" className="h-4 w-4" />,
    className: 'text-muted',
  },
};

function SessionSummary({
  session,
  moves,
  onExit,
  onRetryMissed,
}: Pick<RetryPanelProps, 'session' | 'moves' | 'onExit' | 'onRetryMissed'>) {
  const { solved, total } = sessionScore(session.results.map((entry) => entry.result));
  const missed = session.results
    .filter((entry) => entry.result !== 'solved')
    .map((entry) => entry.ply);
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Trophy aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted">Learn from your mistakes</p>
          <h2 className="text-base leading-snug font-semibold">
            You found {solved} of {total} better {total === 1 ? 'move' : 'moves'}
          </h2>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-line/60 text-sm">
        {session.results.map(({ ply, result }) => {
          const move = moves[ply - 1];
          const meta = RESULT_META[result];
          if (!move) return null;
          return (
            <li key={ply} className="flex items-center justify-between gap-2 py-1.5">
              <span className="tabular">{moveLabel(move)}</span>
              <span className={cn('inline-flex items-center gap-1.5 text-xs', meta.className)}>
                {meta.icon}
                {meta.label}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onExit} className="flex-1">
          Back to review
        </Button>
        {missed.length > 0 && (
          <Button onClick={() => onRetryMissed(missed)} className="flex-1">
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Retry the missed {missed.length === 1 ? 'one' : 'ones'}
          </Button>
        )}
      </div>
    </>
  );
}

/** The retry flow: the prompt, feedback on each try, hints, and the session score. */
export function RetryPanel({
  session,
  moves,
  perspectiveColor,
  onHint,
  onReveal,
  onTryAgain,
  onNext,
  onExit,
  onRetryMissed,
  className,
}: RetryPanelProps) {
  const item = session.item;
  const learn = session.mode === 'learn';
  const total = session.plies.length;

  if (!item) {
    return (
      <Card className={cn('flex flex-col gap-3 p-4', className)} aria-live="polite">
        <SessionSummary
          session={session}
          moves={moves}
          onExit={onExit}
          onRetryMissed={onRetryMissed}
        />
      </Card>
    );
  }

  const canMove = item.status === 'solving' || item.status === 'good';
  const done = item.status === 'solved' || item.status === 'revealed';
  const isLast = session.index >= total - 1;

  return (
    <Card
      className={cn('flex flex-col gap-3 p-4', className)}
      aria-label={learn ? 'Learn from your mistakes' : 'Retry this move'}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            done ? 'bg-success/15 text-success' : 'bg-accent/15 text-accent',
          )}
        >
          {done ? (
            <Check aria-hidden="true" className="h-5 w-5" />
          ) : (
            <Target aria-hidden="true" className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            {learn ? `Learn from your mistakes · ${session.index + 1} of ${total}` : 'Retry'}
          </p>
          <h2 className="text-base leading-snug font-semibold" aria-live="polite">
            {title(item)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label={learn ? 'Stop learning' : 'Stop retrying'}
          title="Stop (Esc)"
          className="-mt-1 -mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>

      {learn && (
        <div
          className="h-1 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={session.index}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${(session.index / Math.max(1, total)) * 100}%` }}
          />
        </div>
      )}

      <div aria-live="polite">
        <ItemBody item={item} perspectiveColor={perspectiveColor} />
      </div>

      <div className="flex flex-wrap gap-2">
        {done ? (
          <Button variant="primary" onClick={onNext} className="flex-1">
            {learn && isLast ? 'See your score' : 'Continue'}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        ) : item.status === 'wrong' ? (
          <Button variant="primary" onClick={onTryAgain} className="flex-1">
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Try again
          </Button>
        ) : item.hints < 2 ? (
          <Button onClick={onHint} disabled={!canMove} className="flex-1">
            <Lightbulb aria-hidden="true" className="h-4 w-4" />
            {item.hints === 0 ? 'Hint' : 'Another hint'}
          </Button>
        ) : (
          <Button onClick={onReveal} disabled={!canMove} className="flex-1">
            <Eye aria-hidden="true" className="h-4 w-4" />
            Show solution
          </Button>
        )}
        {!done && learn && (
          <Button variant="ghost" onClick={onNext} className="flex-1 sm:flex-none">
            <SkipForward aria-hidden="true" className="h-4 w-4" />
            Skip
          </Button>
        )}
      </div>
    </Card>
  );
}
