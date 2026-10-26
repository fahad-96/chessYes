import { useId, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ChartLine,
  ClipboardPaste,
  History,
  ListChecks,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useSettings, type Platform } from '@/state/settings';
import { ClassificationLegend } from './ClassificationLegend';
import { HeroPreview } from './HeroPreview';
import { PLATFORM_LABELS, parseUsernameInput, playerPath, validateUsername } from './username';

const PLATFORM_OPTIONS = [
  { value: 'chesscom', label: PLATFORM_LABELS.chesscom },
  { value: 'lichess', label: PLATFORM_LABELS.lichess },
] as const;

const FEATURES = [
  {
    icon: ListChecks,
    title: 'Every move classified',
    body: 'From Brilliant to Blunder, each move is judged by how much it changed your winning chances, with the best move and a plain-English explanation.',
  },
  {
    icon: ChartLine,
    title: 'Accuracy and eval graph',
    body: 'Accuracy for both players and an evaluation graph that shows exactly where the game turned.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    body: 'Stockfish runs on your device. No account and no tracking: your games and analyses stay in your browser.',
  },
];

/** Landing page: username search, recent searches and a short pitch. */
export default function HomePage() {
  return (
    <div className="space-y-12 pb-6 sm:space-y-16 sm:pt-6">
      <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
            Free and open source
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-5xl">
            Free chess game review
          </h1>
          <p className="mt-3 max-w-xl text-base text-pretty text-muted sm:text-lg">
            Enter your username, pick a game, and see every move explained. Stockfish runs on your
            device — no account, no paywall.
          </p>
          <SearchForm />
          <RecentSearches />
        </div>
        <div className="hidden lg:block">
          <HeroPreview />
        </div>
      </section>

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="sr-only">
          Features
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <Card className="h-full p-5">
                <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <ClassificationLegend />
    </div>
  );
}

function SearchForm() {
  const navigate = useNavigate();
  const addRecent = useSettings((s) => s.addRecent);
  const lastPlatform = useSettings((s) => s.recent[0]?.platform);
  const [platform, setPlatform] = useState<Platform>(lastPlatform ?? 'chesscom');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseUsernameInput(value);
    // A pasted profile URL decides the platform.
    const target = parsed.platform ?? platform;
    if (target !== platform) setPlatform(target);
    const problem = validateUsername(target, parsed.username);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    const username = parsed.username.trim();
    addRecent({ platform: target, username });
    navigate(playerPath(target, username));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 max-w-xl">
      <Card className="space-y-3 p-3 sm:p-4">
        <SegmentedControl
          label="Game site"
          value={platform}
          onChange={(next) => {
            setPlatform(next);
            setError(null);
          }}
          options={PLATFORM_OPTIONS}
          fullWidth
          className="sm:inline-flex sm:w-auto"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={inputId}
            ref={inputRef}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            placeholder={`${PLATFORM_LABELS[platform]} username`}
            aria-label={`${PLATFORM_LABELS[platform]} username`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            inputSize="xl"
            className="sm:flex-1"
          />
          <Button type="submit" variant="primary" size="lg">
            Find games
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </Card>
      <Link
        to="/import"
        className="mt-3 inline-flex items-center gap-1.5 rounded-md text-sm text-muted underline-offset-4 hover:text-text hover:underline"
      >
        <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
        Or paste a PGN
      </Link>
    </form>
  );
}

function RecentSearches() {
  const recent = useSettings((s) => s.recent);
  const addRecent = useSettings((s) => s.addRecent);
  const remove = useSettings((s) => s.removeRecent);
  if (recent.length === 0) return null;

  return (
    <div className="mt-6 max-w-xl">
      <h2 className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted uppercase">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        Recent
      </h2>
      <ul className="flex flex-wrap gap-2">
        {recent.map((r) => (
          <li
            key={`${r.platform}:${r.username}`}
            className="inline-flex max-w-full items-center rounded-full border border-line bg-surface text-sm"
          >
            <Link
              to={playerPath(r.platform, r.username)}
              onClick={() => addRecent(r)}
              className="inline-flex h-10 min-w-0 items-center gap-2 rounded-l-full pr-1 pl-3 hover:text-accent sm:h-8"
            >
              <span className="truncate font-medium">{r.username}</span>
              <span className="shrink-0 text-xs text-muted">{PLATFORM_LABELS[r.platform]}</span>
            </Link>
            <button
              type="button"
              onClick={() => remove(r)}
              aria-label={`Remove ${r.username} (${PLATFORM_LABELS[r.platform]}) from recent searches`}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-text sm:mr-1 sm:h-6 sm:w-6"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
