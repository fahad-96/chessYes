import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  ArrowRight,
  Eye,
  Lightbulb,
  RotateCcw,
  SkipForward,
  Sparkles,
  SquareArrowOutUpRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Board, type BoardArrow, type BoardBadge } from '@/components/Board';
import { ClassificationIcon } from '@/components/ClassificationIcon';
import { ListenButton } from '@/components/ListenButton';
import { SquareHighlight } from '@/components/SquareHighlight';
import { CLASSIFICATION_META } from '@/components/classificationMeta';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { parseUci } from '@/core/notation';
import type { Square } from '@/core/types';
import { cn } from '@/lib/cn';
import { formatGameDate } from '@/lib/format';
import { checkMove } from '@/practice/checkMove';
import { pieceHint } from '@/practice/hints';
import { evaluateMoverWin } from '@/practice/interactiveEngine';
import { lineMoveLabels, moveLabelAt, playLine, type LineFrame } from '@/practice/line';
import { useSettings } from '@/state/settings';
import {
  INITIAL_ATTEMPT,
  acceptsMoves,
  attemptReducer,
  isFinished,
  type AttemptState,
} from './attempt';
import type { Puzzle } from './generate';
import type { PuzzleOutcome } from './progress';
import { motifArrows, puzzleStory, type PuzzleStory } from './story';
import { THEME_LABELS } from './themes';

/** Pause between the moves of a solution line played on the board. */
const STEP_MS = 700;
/** Longer pause on a move that sets up a tactic, so its arrows can be taken in. */
const MOTIF_STEP_MS = 1800;
/** A rejected move stays on the board at least this long, so it is seen before it resets. */
const MIN_FEEDBACK_MS = 450;

/** Why this puzzle is shown: never tried, brought back by the schedule, or practised early. */
export type PuzzleStatus = 'new' | 'review' | 'ahead';

export interface PuzzleTrainerProps {
  puzzle: Puzzle;
  status: PuzzleStatus;
  /** Called once per attempt, as soon as its result is known. */
  onOutcome: (outcome: PuzzleOutcome) => void;
  onNext: () => void;
  onSkip: () => void;
  /** Shown under the puzzle panel (stats on wide screens). */
  aside?: ReactNode;
}

/** The solution line on the board after the attempt. */
interface Playback {
  frames: LineFrame[];
  /** -1 = the puzzle position. */
  index: number;
  playing: boolean;
}

function arrowFor(uci: string | undefined, kind: BoardArrow['kind']): BoardArrow | null {
  const parsed = uci ? parseUci(uci) : null;
  return parsed ? { from: parsed.from, to: parsed.to, kind } : null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * One puzzle: the board, the prompt and feedback, hints and the solution.
 * Mount it with `key={puzzle.id}` (plus a counter) so every attempt starts fresh.
 */
export function PuzzleTrainer({
  puzzle,
  status,
  onOutcome,
  onNext,
  onSkip,
  aside,
}: PuzzleTrainerProps) {
  const [state, dispatch] = useReducer(attemptReducer, INITIAL_ATTEMPT);
  /** The move being checked or just rejected, shown on the board. */
  const [moveFrame, setMoveFrame] = useState<LineFrame | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const showBoardBadges = useSettings((s) => s.showBoardBadges);
  const controllerRef = useRef<AbortController | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  const orientation = puzzle.color === 'w' ? 'white' : 'black';
  const bestUci = puzzle.solution[0] ?? '';
  const finished = isFinished(state);
  const { phase } = state;

  // Why the solution works, and the plies that show it (the story cuts the line once the
  // tactic has played out).
  const story = useMemo(() => puzzleStory(puzzle), [puzzle]);
  const solutionFrames = useMemo(
    () => playLine(puzzle.fen, story.movesUci),
    [puzzle.fen, story.movesUci],
  );
  const hint = useMemo(() => pieceHint(puzzle.fen, bestUci), [puzzle.fen, bestUci]);
  const startLastMove = useMemo<[Square, Square] | undefined>(() => {
    const parsed = puzzle.lastMove ? parseUci(puzzle.lastMove.uci) : null;
    return parsed ? [parsed.from, parsed.to] : undefined;
  }, [puzzle.lastMove]);

  // Report the result once, as soon as it is known.
  const reported = useRef(false);
  useEffect(() => {
    if (state.outcome && !reported.current) {
      reported.current = true;
      onOutcome(state.outcome);
    }
  }, [state.outcome, onOutcome]);

  // Cancel a running engine check when the puzzle goes away.
  useEffect(() => () => controllerRef.current?.abort(), []);

  // Play the solution line one move at a time, pausing on the moves that set up a tactic.
  useEffect(() => {
    if (!playback?.playing) return;
    const lingers = story.motifs.some((motif) => motif.step === playback.index);
    const timer = setTimeout(
      () =>
        setPlayback((current) => {
          if (!current) return current;
          const index = current.index + 1;
          return { ...current, index, playing: index < current.frames.length - 1 };
        }),
      lingers ? MOTIF_STEP_MS : STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [playback, story.motifs]);

  // When the attempt ends, the next puzzle is one key press away.
  useEffect(() => {
    if (finished) nextButtonRef.current?.focus({ preventScroll: true });
  }, [finished]);

  // Enter moves on once the puzzle is done (buttons and links handle Enter themselves).
  useEffect(() => {
    if (!finished) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('button, a, input, select, textarea, [role="dialog"]')) return;
      event.preventDefault();
      onNext();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finished, onNext]);

  const onMove = useCallback(
    (uci: string) => {
      if (!acceptsMoves(state)) return false;
      const frame = playLine(puzzle.fen, [uci])[0];
      if (!frame) return false;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setMoveFrame(frame);
      dispatch({ type: 'move', uci, san: frame.san });
      const started = Date.now();
      void checkMove({
        fen: puzzle.fen,
        uci,
        bestUci,
        winBest: puzzle.winBefore,
        // The move from the game is already evaluated: no need to ask the engine.
        known: [{ uci: puzzle.playedUci, win: puzzle.winAfter }],
        evaluate: (fenAfter, signal) => evaluateMoverWin(fenAfter, signal),
        signal: controller.signal,
      })
        .then((result) => ({ verdict: result.verdict, engineDown: false }))
        // checkMove recognises the solution without the engine, so it only fails (for
        // other moves) when the engine cannot run or the check was cancelled.
        .catch(() => ({ verdict: 'wrong' as const, engineDown: true }))
        .then(async ({ verdict, engineDown }) => {
          if (verdict !== 'best' && verdict !== 'excellent') {
            await wait(MIN_FEEDBACK_MS - (Date.now() - started));
          }
          if (controller.signal.aborted) return;
          dispatch({ type: 'verdict', verdict, engineDown });
          if (verdict === 'best') {
            // The player's move is the first frame; the rest of the line follows.
            setPlayback({ frames: solutionFrames, index: 0, playing: solutionFrames.length > 1 });
          } else if (verdict === 'good') {
            setMoveFrame(null); // back to the puzzle position for another try
          }
        });
      return true;
    },
    [state, puzzle, bestUci, solutionFrames],
  );

  const retry = () => {
    setMoveFrame(null);
    dispatch({ type: 'retry' });
  };
  const showHint = () => {
    if (phase.kind === 'wrong') setMoveFrame(null);
    dispatch({ type: 'hint' });
  };
  const playSolution = () =>
    setPlayback({ frames: solutionFrames, index: -1, playing: solutionFrames.length > 0 });
  const reveal = () => {
    setMoveFrame(null);
    dispatch({ type: 'reveal' });
    playSolution();
  };
  const seekFrame = (index: number) =>
    setPlayback({ frames: solutionFrames, index, playing: false });

  // What the board shows.
  const shownFrame = playback ? (playback.frames[playback.index] ?? null) : moveFrame;
  const atStart = shownFrame === null;
  const playbackIndex = playback?.index ?? null;
  const arrows = useMemo<BoardArrow[]>(() => {
    // Along the solution line: the tactic each move sets up (fork targets, pins...).
    if (playbackIndex !== null && playbackIndex >= 0) {
      return motifArrows(story.motifs, playbackIndex, puzzle.color);
    }
    if (!atStart) return [];
    const wanted: (BoardArrow | null)[] = finished
      ? [arrowFor(bestUci, 'best'), arrowFor(puzzle.playedUci, 'played')]
      : state.hints >= 2
        ? [arrowFor(bestUci, 'best')]
        : [];
    return wanted.filter((arrow): arrow is BoardArrow => arrow !== null);
  }, [
    playbackIndex,
    story.motifs,
    puzzle.color,
    atStart,
    finished,
    state.hints,
    bestUci,
    puzzle.playedUci,
  ]);
  // The first hint also marks the piece on the board (until the arrow replaces it).
  const highlight = !finished && atStart && state.hints === 1 && hint ? hint.square : null;
  const badge = useMemo<BoardBadge | null>(() => {
    if (!showBoardBadges || phase.kind !== 'solved' || !shownFrame) return null;
    // Only on the player's own winning move: the move itself, or frame 0 of the line
    // when that move was the engine's.
    const ownMove = playback === null || (playback.index === 0 && phase.verdict === 'best');
    return ownMove ? { square: shownFrame.lastMove[1], classification: phase.verdict } : null;
  }, [showBoardBadges, phase, shownFrame, playback]);

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      <section
        aria-label="Puzzle board"
        className="md:mx-auto md:w-full md:max-w-[max(20rem,calc(100dvh-26rem))] lg:sticky lg:top-20 lg:max-w-[calc(100dvh-14rem)] lg:min-w-[22rem]"
      >
        <div className="relative">
          <Board
            fen={shownFrame?.fen ?? puzzle.fen}
            orientation={orientation}
            lastMove={shownFrame?.lastMove ?? startLastMove}
            check={shownFrame?.check ?? false}
            arrows={arrows}
            badge={badge}
            interactive={acceptsMoves(state) ? { color: orientation, onMove } : null}
          />
          {highlight && (
            <SquareHighlight
              square={highlight}
              orientation={orientation}
              label={`Hint: the piece on ${highlight}`}
            />
          )}
        </div>
      </section>

      <div className="flex min-w-0 flex-col gap-3 lg:gap-4">
        <Card className="flex flex-col gap-4 p-4">
          <PuzzleHeading puzzle={puzzle} status={status} />
          <Feedback puzzle={puzzle} state={state} hintText={hint?.text ?? null} />
          {finished && (
            <SolutionBlock
              puzzle={puzzle}
              story={story}
              ownMove={phase.kind === 'solved' && phase.verdict === 'excellent'}
              frames={solutionFrames}
              playback={playback}
              onSeek={seekFrame}
              onReplay={playSolution}
            />
          )}
          <Actions
            state={state}
            canHint={hint !== null}
            onRetry={retry}
            onHint={showHint}
            onReveal={reveal}
            onSkip={onSkip}
            onNext={onNext}
            nextButtonRef={nextButtonRef}
          />
          {finished && (
            <Link
              to={`/review/${puzzle.gameId}?ply=${puzzle.ply}`}
              className="-my-1 inline-flex min-h-10 items-center gap-1.5 self-start rounded-md text-sm text-muted underline-offset-4 hover:text-text hover:underline"
            >
              <SquareArrowOutUpRight aria-hidden="true" className="h-4 w-4" />
              Open this moment in the game review
            </Link>
          )}
        </Card>
        {aside}
      </div>
    </div>
  );
}

function PuzzleHeading({ puzzle, status }: { puzzle: Puzzle; status: PuzzleStatus }) {
  const date = formatGameDate(puzzle.date);
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="min-w-0 text-xs leading-relaxed break-words text-muted">
        From your game vs <span className="font-medium text-text">{puzzle.opponent}</span>
        {date && <> · {date}</>}
        {puzzle.occurrences > 1 && <> · came up in {puzzle.occurrences} games</>}
      </p>
      <Badge tone={status === 'review' ? 'accent' : 'outline'}>
        {status === 'review' ? 'Review' : status === 'ahead' ? 'Extra practice' : 'New'}
      </Badge>
    </div>
  );
}

/** The prompt and what happened to the last move; announced to screen readers. */
function Feedback({
  puzzle,
  state,
  hintText,
}: {
  puzzle: Puzzle;
  state: AttemptState;
  hintText: string | null;
}) {
  const { phase } = state;
  const side = puzzle.color === 'w' ? 'White' : 'Black';
  const other = puzzle.color === 'w' ? 'Black' : 'White';
  const strong = (text: string) => <strong className="font-semibold text-text">{text}</strong>;
  let title: ReactNode;
  let body: ReactNode = null;
  let tone = 'text-text';

  switch (phase.kind) {
    case 'solving':
      title = (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-line',
              puzzle.color === 'w' ? 'bg-white' : 'bg-neutral-900',
            )}
          />
          Find the best move for {side}
        </>
      );
      body = (
        <>
          {puzzle.lastMove && (
            <>
              {other} just played {strong(puzzle.lastMove.san)}.{' '}
            </>
          )}
          Your move in the game was a mistake. Can you find the best one?
        </>
      );
      break;
    case 'checking':
      title = (
        <>
          <Spinner className="h-4 w-4" label="Checking" />
          Checking {phase.san}…
        </>
      );
      break;
    case 'good':
      title = <>{phase.san} is good, but there’s a stronger move</>;
      body = 'Try again: look for the move that keeps the most.';
      tone = 'text-c-good';
      break;
    case 'wrong':
      tone = 'text-danger';
      if (phase.engineDown) {
        title = <>{phase.san} isn’t the engine’s move</>;
        body =
          'The engine could not start, so other good moves can’t be checked right now. Try again or show the solution.';
      } else if (phase.uci === puzzle.playedUci) {
        title = 'That’s the move you played in the game';
        body = `${phase.san} was a mistake then too. Try again or show the solution.`;
      } else {
        title = <>{phase.san} isn’t the best move</>;
        body = 'It gives away too much. Try again or show the solution.';
      }
      break;
    case 'solved': {
      title = 'Solved!';
      tone = 'text-success';
      const verdict =
        phase.verdict === 'best' ? (
          <>{strong(phase.san)} is the best move.</>
        ) : (
          <>
            {strong(phase.san)} works too: it keeps almost everything. The engine’s choice was{' '}
            {strong(puzzle.solutionSan[0] ?? '')}.
          </>
        );
      const repeat =
        state.outcome === 'failed'
          ? state.hints > 0
            ? ' You used a hint, so this puzzle will come back soon.'
            : ' It took more than one try, so this puzzle will come back soon.'
          : '';
      body = (
        <>
          {verdict}
          {repeat}
        </>
      );
      break;
    }
    case 'revealed':
      title = (
        <>
          The best move was <span className="text-c-best">{puzzle.solutionSan[0]}</span>
        </>
      );
      body = 'This puzzle will come back soon for another try.';
      break;
  }

  return (
    <div aria-live="polite" className="flex flex-col gap-1.5">
      <h2 className={cn('flex items-center gap-2 text-lg leading-snug font-semibold', tone)}>
        {title}
      </h2>
      {body && <p className="text-sm leading-relaxed text-muted">{body}</p>}
      {!isFinished(state) && state.hints > 0 && hintText && (
        <p className="mt-1 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
          <Lightbulb aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span>
            {hintText}
            {state.hints >= 2 && ' The arrow shows the best move.'}
          </span>
        </p>
      )}
    </div>
  );
}

interface SolutionBlockProps {
  puzzle: Puzzle;
  story: PuzzleStory;
  /** The player solved it with a different good move: the story is the engine's line. */
  ownMove: boolean;
  frames: LineFrame[];
  playback: Playback | null;
  onSeek: (index: number) => void;
  onReplay: () => void;
}

/**
 * Why the solution works, what was played in the game, the solution line (each move
 * clickable) and the themes.
 */
function SolutionBlock({
  puzzle,
  story,
  ownMove,
  frames,
  playback,
  onSeek,
  onReplay,
}: SolutionBlockProps) {
  const meta = CLASSIFICATION_META[puzzle.playedClassification];
  const labels = useMemo(() => lineMoveLabels(puzzle.fen, frames.length), [puzzle.fen, frames]);
  const current = playback?.index ?? null;
  const tokenClass = (active: boolean) =>
    cn(
      'inline-flex h-10 items-center rounded-md px-2 font-mono text-sm transition-colors sm:h-8',
      active
        ? 'bg-accent/15 text-text ring-1 ring-accent/50'
        : 'text-muted hover:bg-surface-3 hover:text-text',
    );

  return (
    <div className="flex flex-col gap-3">
      <StoryCard story={story} title={ownMove ? 'The engine’s idea' : 'Why it works'} />

      <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm leading-relaxed">
        <ClassificationIcon
          classification={puzzle.playedClassification}
          size={20}
          decorative
          className="mt-px"
        />
        <span>
          In the game you played{' '}
          <strong className="font-semibold whitespace-nowrap">
            {moveLabelAt(puzzle.fen)} {puzzle.playedSan}
            {meta.symbol}
          </strong>{' '}
          — <span style={{ color: meta.colorVar }}>{meta.label}</span>
        </span>
      </p>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Solution</h3>
          <button
            type="button"
            onClick={onReplay}
            className="-mr-2 inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:text-text"
          >
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            Replay
          </button>
        </div>
        <ol aria-label="Solution line" className="mt-1 flex flex-wrap items-center gap-y-1">
          <li>
            <button
              type="button"
              aria-current={current === -1 ? 'step' : undefined}
              onClick={() => onSeek(-1)}
              className={tokenClass(current === -1)}
            >
              Start
            </button>
          </li>
          {frames.map((frame, index) => (
            <li key={`${index}-${frame.uci}`} className="flex items-center">
              {labels[index] && (
                <span aria-hidden="true" className="pl-1.5 font-mono text-xs text-muted">
                  {labels[index]}
                </span>
              )}
              <button
                type="button"
                aria-current={current === index ? 'step' : undefined}
                onClick={() => onSeek(index)}
                className={tokenClass(current === index)}
              >
                {frame.san}
              </button>
            </li>
          ))}
        </ol>
        {current === -1 && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {/* Same colours as the board's "best" and "played" arrows (Board.tsx). */}
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[#22a35a]" />
              Best move
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[#4a7fd9]" />
              Your move in the game
            </span>
          </p>
        )}
      </div>

      {puzzle.themes.length > 0 && (
        <ul aria-label="Themes" className="flex flex-wrap gap-1.5">
          {puzzle.themes.map((theme) => (
            <li key={theme}>
              <Badge tone="neutral">{THEME_LABELS[theme]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The tactics story of the solution, with a button to hear it. */
function StoryCard({ story, title }: { story: PuzzleStory; title: string }) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-c-best/30 bg-c-best/10 py-2.5 pr-1.5 pl-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-c-best">
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          {title}
        </h3>
        <ListenButton text={story.text} autoPlay className="-my-1.5" />
      </div>
      <p className="mt-1 pr-1.5 text-sm leading-relaxed text-text">{story.text}</p>
    </section>
  );
}

interface ActionsProps {
  state: AttemptState;
  canHint: boolean;
  onRetry: () => void;
  onHint: () => void;
  onReveal: () => void;
  onSkip: () => void;
  onNext: () => void;
  nextButtonRef: RefObject<HTMLButtonElement | null>;
}

function Actions({
  state,
  canHint,
  onRetry,
  onHint,
  onReveal,
  onSkip,
  onNext,
  nextButtonRef,
}: ActionsProps) {
  const { phase } = state;
  if (isFinished(state)) {
    return (
      <div className="flex flex-col gap-1.5">
        {/* A plain <button> so the ref reaches the element (focus after the attempt). */}
        <button
          ref={nextButtonRef}
          type="button"
          onClick={onNext}
          className={buttonClass('primary', 'lg')}
        >
          Next puzzle
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
        <p className="hidden text-center text-xs text-muted sm:block">
          or press <kbd className="rounded border border-line px-1 font-sans">Enter</kbd>
        </p>
      </div>
    );
  }
  const checking = phase.kind === 'checking';
  return (
    <div className="flex flex-wrap gap-2">
      {phase.kind === 'wrong' && (
        <Button variant="primary" onClick={onRetry} className="flex-1">
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Try again
        </Button>
      )}
      {canHint && state.hints < 2 && (
        <Button onClick={onHint} disabled={checking} className="flex-1">
          <Lightbulb aria-hidden="true" className="h-4 w-4" />
          {state.hints === 0 ? 'Hint' : 'Show arrow'}
        </Button>
      )}
      <Button onClick={onReveal} disabled={checking} className="flex-1">
        <Eye aria-hidden="true" className="h-4 w-4" />
        Show solution
      </Button>
      {phase.kind !== 'wrong' && (
        <Button variant="ghost" onClick={onSkip} disabled={checking} aria-label="Skip for now">
          <SkipForward aria-hidden="true" className="h-4 w-4" />
          Skip
        </Button>
      )}
    </div>
  );
}
