import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, ChessKnight, ChessPawn, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { NotFoundError } from '@/sources/http';
import { loadProfile, type PlayerProfile } from '@/features/games/playerGames';
import { PLATFORM_LABELS, parseUsernameInput, validateUsername } from '@/features/home/username';
import { useSettings, type Platform } from '@/state/settings';

type Step = 'choose' | 'username' | 'done';
const STEPS: Step[] = ['choose', 'username', 'done'];

export interface ConnectAccountDialogProps {
  open: boolean;
  /** Closes the dialog. `skipped` when the player chose to go on without an account. */
  onClose: (skipped: boolean) => void;
}

/**
 * "Connect your account": pick Chess.com or Lichess, type the username once, and Chess Yes
 * remembers it (settings.account) so /home opens on the player's own games from then on.
 * The username is checked against the site before it is saved. Nothing else is asked for:
 * the games are public.
 *
 * A modal <dialog> (focus trap, Escape, an inert page behind it, blurred by ::backdrop).
 */
export function ConnectAccountDialog({ open, onClose }: ConnectAccountDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const setSettings = useSettings((s) => s.set);
  const addRecent = useSettings((s) => s.addRecent);
  const [step, setStep] = useState<Step>('choose');
  const [platform, setPlatform] = useState<Platform>('chesscom');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const inputId = useId();
  const titleId = useId();

  // Each opening starts again at the first step.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep('choose');
      setValue('');
      setError(null);
      setProfile(null);
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const choose = (next: Platform) => {
    setPlatform(next);
    setError(null);
    setStep('username');
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checking) return;
    const parsed = parseUsernameInput(value);
    // A pasted profile link decides the site.
    const target = parsed.platform ?? platform;
    const problem = validateUsername(target, parsed.username);
    if (problem) {
      setError(problem);
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setChecking(true);
    setError(null);
    try {
      const found = await loadProfile(target, parsed.username.trim(), controller.signal);
      const account = { platform: target, username: found.username };
      setSettings({ account, skippedConnect: false });
      addRecent(account);
      setPlatform(target);
      setProfile(found);
      setStep('done');
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof NotFoundError
          ? `There is no ${PLATFORM_LABELS[target]} player called “${parsed.username.trim()}”.`
          : `Could not reach ${PLATFORM_LABELS[target]}. Check your connection and try again.`,
      );
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="kb-glass kb-modal"
      // Escape (or the browser's own close request) before connecting means "not now", the
      // same as continuing without an account.
      onClose={() => onClose(useSettings.getState().account === null)}
    >
      <div className="relative px-6 pt-6 pb-8 sm:px-10 sm:pt-7 sm:pb-10">
        {step === 'username' && (
          <button
            type="button"
            onClick={() => setStep('choose')}
            aria-label="Back"
            className="absolute top-5 left-4 inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <ol className="flex justify-center gap-1.5" aria-label={`Step ${stepIndex + 1} of 3`}>
          {STEPS.map((s, index) => (
            <li
              key={s}
              className={cn(
                'h-1.5 rounded-full transition-all',
                index <= stepIndex ? 'w-8 bg-brand' : 'w-5 bg-hover',
              )}
            />
          ))}
        </ol>

        {step === 'choose' && (
          <div className="mt-6 text-center">
            <h2 id={titleId} className="font-display text-4xl leading-tight tracking-tight">
              Connect your account
            </h2>
            <p className="mt-2 text-muted">Your coach learns from your real games.</p>
            <div className="mt-7 flex flex-col gap-3">
              <PlatformButton
                icon={ChessPawn}
                label="Connect Chess.com"
                onClick={() => choose('chesscom')}
              />
              <PlatformButton
                icon={ChessKnight}
                label="Connect Lichess"
                onClick={() => choose('lichess')}
              />
            </div>
            <p className="mt-5 text-xs text-muted">
              Just your public username. No password, no sign-up.
            </p>
            <button
              type="button"
              onClick={() => onClose(true)}
              className="mt-4 text-sm font-medium text-text underline-offset-4 hover:underline"
            >
              Don’t have an account? Continue without one
            </button>
          </div>
        )}

        {step === 'username' && (
          <form onSubmit={(event) => void onSubmit(event)} noValidate className="mt-6 text-center">
            <h2 id={titleId} className="font-display text-4xl leading-tight tracking-tight">
              {PLATFORM_LABELS[platform]} account
            </h2>
            <p className="mt-2 text-muted">Type your username once. We’ll remember it.</p>
            <label htmlFor={inputId} className="sr-only">
              {PLATFORM_LABELS[platform]} username
            </label>
            <Input
              id={inputId}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) setError(null);
              }}
              placeholder={`${PLATFORM_LABELS[platform]} username`}
              aria-invalid={error ? true : undefined}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              inputSize="xl"
              autoFocus
              className="mt-7 w-full text-center text-base"
            />
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="mt-4 w-full"
              disabled={checking || !value.trim()}
            >
              {checking ? (
                <>
                  <Spinner className="h-4 w-4" label="Checking the username" />
                  Checking…
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </form>
        )}

        {step === 'done' && (
          <div className="mt-6 text-center">
            <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand/15 text-brand">
              <Check className="h-7 w-7" aria-hidden="true" />
            </span>
            <h2 id={titleId} className="mt-4 font-display text-4xl leading-tight tracking-tight">
              You’re all set
            </h2>
            <p className="mt-2 text-muted">
              Connected to {PLATFORM_LABELS[platform]} as{' '}
              <span className="font-semibold text-text">{profile?.username}</span>. Your games are
              ready to review.
            </p>
            <Button
              variant="primary"
              size="lg"
              className="mt-7 w-full"
              autoFocus
              onClick={() => onClose(false)}
            >
              Show my games
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </dialog>
  );
}

function PlatformButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof ChessPawn;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-glass-border bg-hover text-base font-semibold shadow-[inset_0_-3px_0_0_rgb(0_0_0/0.12)] transition-colors hover:border-brand/50 hover:bg-brand/10"
    >
      <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
      {label}
    </button>
  );
}
