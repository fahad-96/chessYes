import { useId, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { ArrowLeft, ChevronRight, FileUp, Sparkles, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { readPgnHeaders, splitPgnGames } from '@/core/pgn';
import type { GameRecord } from '@/core/types';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import { isReviewable, reviewPath } from '@/features/games/gameList';
import { cn } from '@/lib/cn';
import { recordFromPgn, savePgnGame } from '@/sources/pgnImport';
import {
  CHESSCOM_LINK_MESSAGE,
  MAX_LISTED_GAMES,
  MAX_PGN_FILE_BYTES,
  NO_GAMES_MESSAGE,
  OPERA_GAME_PGN,
  notPgnMessage,
  parseGameLink,
  summarizePgnHeaders,
  type PgnSummary,
} from './importHelpers';

interface Candidate {
  pgn: string;
  summary: PgnSummary;
}

/** /import: paste or upload a PGN and review it. */
export default function ImportPage() {
  useDocumentTitle('Import PGN · Kibitz');
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [candidates, setCandidates] = useState<{ list: Candidate[]; total: number } | null>(null);
  const textareaId = useId();
  const fileInputId = useId();
  const errorId = `${textareaId}-error`;

  async function review(pgn: string) {
    setBusy(true);
    setError(null);
    let record: GameRecord;
    try {
      record = recordFromPgn(pgn);
    } catch (err) {
      const message = errorMessage(err);
      setError(notPgnMessage(pgn, message) ?? message);
      setBusy(false);
      return;
    }
    if (!isReviewable(record)) {
      setError(`Only standard chess can be reviewed, and this game is “${record.variant}”.`);
      setBusy(false);
      return;
    }
    try {
      await savePgnGame(record);
    } catch {
      // Storage can be unavailable (private browsing); the review still opens from router state,
      // it just cannot be reloaded later.
    }
    navigate(reviewPath(record.id), { state: { record } });
  }

  function start(source: string) {
    setCandidates(null);
    const input = source.trim();
    if (!input) {
      setError('Paste a PGN or choose a .pgn file first.');
      return;
    }
    const link = parseGameLink(input);
    if (link?.site === 'lichess') {
      navigate(reviewPath(`lichess/${link.gameId}`));
      return;
    }
    if (link?.site === 'chesscom') {
      setError(CHESSCOM_LINK_MESSAGE);
      return;
    }
    let games: string[];
    try {
      games = splitPgnGames(input);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    if (games.length === 0) {
      setError(NO_GAMES_MESSAGE);
      return;
    }
    if (games.length === 1) {
      void review(games[0]!);
      return;
    }
    setError(null);
    const list = games.slice(0, MAX_LISTED_GAMES).map((pgn) => ({ pgn, summary: summarize(pgn) }));
    setCandidates({ list, total: games.length });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    start(text);
  }

  async function loadFile(file: File) {
    if (file.size > MAX_PGN_FILE_BYTES) {
      setError(
        `That file is too large (${Math.round(file.size / 1024 / 1024)} MB). The limit is 10 MB.`,
      );
      return;
    }
    try {
      const content = await file.text();
      setText(content);
      start(content);
    } catch {
      setError('Could not read that file.');
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    event.target.value = '';
    if (file) void loadFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  }

  if (candidates) {
    return (
      <GamePicker
        candidates={candidates.list}
        total={candidates.total}
        busy={busy}
        error={error}
        onPick={(pgn) => void review(pgn)}
        onBack={() => {
          setCandidates(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Import a PGN</h1>
        <p className="mt-1.5 text-muted">
          Paste a game in PGN format or a Lichess game link, or open a .pgn file. Everything stays
          on your device.
        </p>
      </header>

      <form onSubmit={onSubmit}>
        <Card
          className={cn('space-y-3 p-3 transition-colors sm:p-4', dragging && 'ring-2 ring-accent')}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            // dragleave also fires when moving onto a child element; ignore those.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={onDrop}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={textareaId} className="text-sm font-medium">
              PGN
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="h-10 sm:h-8"
              onClick={() => {
                setText(OPERA_GAME_PGN);
                setError(null);
              }}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Try an example
            </Button>
          </div>
          <Textarea
            id={textareaId}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError(null);
            }}
            rows={10}
            placeholder={'[White "…"]\n[Black "…"]\n\n1. e4 e5 2. Nf3 Nc6 …'}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="min-h-48 resize-y font-mono"
          />
          {error && (
            <p id={errorId} role="alert" className="flex items-start gap-2 text-sm text-danger">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="break-words">{error}</span>
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <input
                id={fileInputId}
                type="file"
                accept=".pgn,application/x-chess-pgn,application/vnd.chess-pgn,text/plain"
                onChange={onFileChange}
                className="peer sr-only"
              />
              {/* The real input is visually hidden; its focus ring is drawn on the label. */}
              <label
                htmlFor={fileInputId}
                className={buttonClass(
                  'secondary',
                  'md',
                  'w-full cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent sm:w-auto',
                )}
              >
                <FileUp className="h-4 w-4" aria-hidden="true" />
                Open .pgn file
              </label>
            </div>
            <Button type="submit" variant="primary" disabled={busy} className="w-full sm:w-auto">
              {busy ? <Spinner label="Opening game" /> : null}
              Review game
            </Button>
          </div>
        </Card>
      </form>

      <p className="text-sm text-muted">
        Tip: you can drop a .pgn file onto the box. Files with several games let you pick one.
      </p>
    </div>
  );
}

interface GamePickerProps {
  candidates: Candidate[];
  total: number;
  busy: boolean;
  error: string | null;
  onPick: (pgn: string) => void;
  onBack: () => void;
}

/** Lets the user choose one game from a multi-game PGN. */
function GamePicker({ candidates, total, busy, error, onPick, onBack }: GamePickerProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Paste another PGN
      </button>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Pick a game</h1>
        <p className="tabular mt-1 text-muted">
          {total > candidates.length
            ? `This PGN has ${total} games; showing the first ${candidates.length}.`
            : `This PGN has ${total} games.`}
        </p>
      </header>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="break-words">{error}</span>
        </p>
      )}
      <ul className="space-y-2" aria-busy={busy}>
        {candidates.map(({ pgn, summary }, index) => (
          <li key={index}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(pgn)}
              className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60 sm:px-4"
            >
              <span className="tabular w-8 shrink-0 text-right text-xs text-muted">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {summary.white} <span className="text-muted">vs</span> {summary.black}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {[summary.event, summary.date].filter(Boolean).join(' · ') || 'No event details'}
                </span>
              </span>
              {summary.result && (
                <span className="tabular shrink-0 rounded-md bg-surface-3 px-2 py-0.5 text-xs font-semibold">
                  {summary.result}
                </span>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function summarize(pgn: string): PgnSummary {
  try {
    return summarizePgnHeaders(readPgnHeaders(pgn));
  } catch {
    return summarizePgnHeaders({});
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'PgnError') return error.message;
  const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
  return `Could not read this PGN${detail}.`;
}
