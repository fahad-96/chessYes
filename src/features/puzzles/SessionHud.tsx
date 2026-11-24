import { ArrowLeft, Crown, Flame, Heart, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { SESSION_LIVES, type PuzzleSession } from './session';

function Hearts({ lives, className }: { lives: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex gap-1.5', className)}
      aria-label={`${lives} of ${SESSION_LIVES} lives left`}
    >
      {Array.from({ length: SESSION_LIVES }, (_, i) => (
        <Heart
          key={i}
          aria-hidden="true"
          className={cn(
            'h-6 w-6 transition-all',
            i < lives
              ? 'fill-[#ef4444] text-[#ef4444] drop-shadow-[0_2px_6px_rgb(239_68_68/0.45)]'
              : 'scale-90 text-muted/50',
          )}
        />
      ))}
    </span>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The session's scoreboard: score, lives, best and streak (beside the board on large screens). */
export function SessionHud({ session, className }: { session: PuzzleSession; className?: string }) {
  return (
    <Card className={cn('flex flex-col gap-4 p-5', className)}>
      <div className="flex items-center justify-between">
        <Link
          to="/home"
          aria-label="Home"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-text"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <h2 className="font-display text-3xl leading-none tracking-tight">Puzzle session</h2>
        <span className="w-9" aria-hidden="true" />
      </div>
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-glass-border bg-hover py-5">
        <p
          className="tabular font-display text-7xl leading-none"
          aria-label={`Score ${session.score}`}
        >
          {pad(session.score)}
        </p>
        <Hearts lives={session.lives} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Tile icon={Crown} label="All-time best" value={session.best} />
        <Tile icon={Flame} label="Streak" value={session.streak} />
      </div>
    </Card>
  );
}

function Tile({ icon: Icon, label, value }: { icon: typeof Crown; label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-glass-border bg-hover py-3">
      <span className="inline-flex items-center gap-1.5 text-sm text-muted">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </span>
      <span className="tabular text-2xl font-bold">{value}</span>
    </div>
  );
}

/** One line of the scoreboard above the board on smaller screens. */
export function SessionStrip({
  session,
  className,
}: {
  session: PuzzleSession;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-2xl border border-glass-border bg-hover px-4 py-2.5',
        className,
      )}
    >
      <span
        className="tabular font-display text-3xl leading-none"
        aria-label={`Score ${session.score}`}
      >
        {pad(session.score)}
      </span>
      <Hearts lives={session.lives} />
      <span className="inline-flex items-center gap-3 text-sm text-muted">
        <span className="inline-flex items-center gap-1" title="Streak">
          <Flame className="h-4 w-4" aria-hidden="true" />
          {session.streak}
        </span>
        <span className="inline-flex items-center gap-1" title="All-time best">
          <Crown className="h-4 w-4" aria-hidden="true" />
          {session.best}
        </span>
      </span>
    </div>
  );
}

/** Shown in place of the board when the last life is gone. */
export function SessionOver({
  session,
  newBest,
  onRestart,
}: {
  session: PuzzleSession;
  newBest: boolean;
  onRestart: () => void;
}) {
  return (
    <Card className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
      <Hearts lives={0} />
      <h2 className="font-display text-5xl leading-none tracking-tight">Out of lives</h2>
      <p className="text-muted">
        You solved <span className="font-semibold text-text">{session.score}</span>{' '}
        {session.score === 1 ? 'puzzle' : 'puzzles'} this session.
        {newBest && (
          <span className="mt-1 block font-semibold text-brand">A new personal best!</span>
        )}
      </p>
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <Button variant="primary" size="lg" className="flex-1" onClick={onRestart} autoFocus>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Play again
        </Button>
        <Link
          to="/home"
          className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-glass-border bg-hover px-6 font-medium hover:border-brand/40"
        >
          Back home
        </Link>
      </div>
    </Card>
  );
}
