import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { Color, GameRecord, ParsedGame, Square } from '@/core/types';
import { annotatedPgn } from '@/core/annotatedPgn';
import { moveNumberLabel, parseUci, sideToMove } from '@/core/notation';
import { reviewForViewer } from '@/core/perspective';
import { storyMatters } from '@/core/tactics';
import { ENGINE_NAME } from '@/engine/stockfish';
import {
  Board,
  type BoardArrow,
  type BoardBadge,
  type BoardInteraction,
  type BoardOrientation,
} from '@/components/Board';
import { squareAtPoint } from '@/components/boardGeometry';
import { EvalBar, type EvalBarValue } from '@/components/EvalBar';
import { EvalGraph, GRAPH_MARKER_CLASSIFICATIONS } from '@/components/EvalGraph';
import { MoveList } from '@/components/MoveList';
import { SquareHighlight } from '@/components/SquareHighlight';
import { Card } from '@/components/ui/Card';
import { useSettings } from '@/state/settings';
import { cn } from '@/lib/cn';
import { AnalysisCard } from './AnalysisCard';
import { StoryCaption, TourBar } from './BoardCaption';
import { BoardNav } from './BoardNav';
import { CurrentMoveCard } from './CurrentMoveCard';
import { KeyMoments } from './KeyMoments';
import { PlayerStrip } from './PlayerStrip';
import { RetryPanel } from './RetryPanel';
import { ReviewHeader } from './ReviewHeader';
import { ReviewErrorView, ReviewSkeleton } from './ReviewStates';
import { ShareMenu } from './ShareMenu';
import { StoryPanel } from './StoryPanel';
import { SummaryCard } from './SummaryCard';
import { VariationPanel } from './VariationPanel';
import { VoiceToggle } from './VoiceToggle';
import { useReviewKeyboard } from './keyboard';
import { isRetryable, retryablePlies } from './retry';
import {
  arrowsForMove,
  clockAtPly,
  evalBarValueAt,
  evalTextAt,
  initialOrientation,
} from './reviewHelpers';
import { initialPly, pgnFileName, reviewLink } from './share';
import { storyDuration, storyFrame, storyStart, storyTitle, storyTone } from './story';
import { useSwipe, type SwipeDirection } from './swipe';
import { useCoach } from './useCoach';
import { useGameReview, type GameReviewState } from './useGameReview';
import { useLiveAnalysis } from './useLiveAnalysis';
import { useMediaQuery } from './useMediaQuery';
import { useRetrySession, type RetryItem } from './useRetrySession';
import { useVariation } from './useVariation';
import {
  applyBoardMove,
  currentVariationMove,
  extendVariation,
  lineVariation,
  storyVariation,
  variationFen,
  type Variation,
} from './variation';

const NO_WIN_PERCENTS: readonly number[] = [];

/**
 * On phones the cards are below the board: bring the board back into view when something
 * starts playing on it. (On desktop the board column is sticky and always visible.)
 */
function revealBoard(smooth: boolean) {
  const board = document.querySelector('section[aria-label="Board"]');
  // Already in view below the sticky app header.
  if (!board || board.getBoundingClientRect().top >= 48) return;
  board.scrollIntoView?.({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
}
const NO_ARROWS: readonly BoardArrow[] = [];

/** Route component for /review/<GameRecord.id>. */
export default function ReviewPage() {
  const gameId = useParams()['*'] ?? '';
  if (!gameId) {
    return (
      <ReviewErrorView
        error={{
          kind: 'not-found',
          title: 'No game selected',
          message: 'Open a game from a player’s game list, or import a PGN, to review it.',
          retryable: false,
        }}
        onRetry={() => undefined}
      />
    );
  }
  // Keyed by game so every game starts with fresh state (ply 0, no stale analysis).
  return <ReviewScreen key={gameId} gameId={gameId} />;
}

function ReviewScreen({ gameId }: { gameId: string }) {
  const state = useGameReview(gameId);
  const { load } = state;
  if (load.status === 'loading') return <ReviewSkeleton />;
  if (load.status === 'error') return <ReviewErrorView error={load.error} onRetry={state.retry} />;
  return <ReviewView state={state} record={load.record} game={load.game} />;
}

function toOrientation(color: Color): BoardOrientation {
  return color === 'w' ? 'white' : 'black';
}

function arrowFor(uci: string | undefined, kind: BoardArrow['kind']): BoardArrow | null {
  const parsed = uci ? parseUci(uci) : null;
  return parsed ? { from: parsed.from, to: parsed.to, kind } : null;
}

/** Everything the board shows at once, whichever mode it is in. */
interface BoardRing {
  square: Square;
  label: string;
}

const NO_RINGS: readonly BoardRing[] = [];

interface BoardView {
  fen: string;
  lastMove?: [Square, Square];
  check: boolean;
  arrows: readonly BoardArrow[];
  badge: BoardBadge | null;
  /** Rings around squares (the first retry hint, a trapped piece in a story...), each with
   * what it means for screen readers. */
  rings: readonly BoardRing[];
  /** Whether moves can be made on the board. */
  movable: boolean;
  /** Restricts moves to one side (retrying a move); otherwise the side to move. */
  moverColor?: Color;
}

/** The board while retrying a move: the user's tries, hints and the solution being played. */
function retryBoardView(item: RetryItem, game: ParsedGame): BoardView {
  const { move, moveReview, attempt } = item;
  const previous = game.moves[item.ply - 2];
  const base: BoardView = {
    fen: move.fenBefore,
    lastMove: previous ? [previous.from, previous.to] : undefined,
    check: previous?.isCheck ?? false,
    arrows: NO_ARROWS,
    badge: null,
    rings: NO_RINGS,
    movable: false,
  };
  const bestArrow = item.hints >= 2 ? arrowFor(moveReview.best.uci, 'best') : null;

  switch (item.status) {
    case 'solving':
    case 'good': {
      const hintSquare = item.hints >= 1 ? (parseUci(moveReview.best.uci)?.from ?? null) : null;
      const tried = item.status === 'good' ? arrowFor(attempt?.uci, 'played') : null;
      return {
        ...base,
        arrows: [tried, bestArrow].filter((arrow): arrow is BoardArrow => arrow !== null),
        rings: hintSquare
          ? [{ square: hintSquare, label: `Hint: the piece on ${hintSquare}` }]
          : NO_RINGS,
        movable: true,
        moverColor: move.color,
      };
    }
    case 'checking':
    case 'wrong': {
      if (!attempt) return base;
      const reply = item.status === 'wrong' ? arrowFor(item.reply?.uci, 'threat') : null;
      return {
        ...base,
        fen: attempt.fenAfter,
        lastMove: [attempt.from, attempt.to],
        check: attempt.check,
        arrows: reply ? [reply] : NO_ARROWS,
      };
    }
    case 'solved':
    case 'revealed': {
      const shown = item.line[item.lineIndex - 1];
      if (!shown) return base;
      const solving = item.status === 'solved' && item.lineIndex === 1;
      return {
        ...base,
        fen: shown.fenAfter,
        lastMove: [shown.from, shown.to],
        check: shown.check,
        badge: solving
          ? { square: shown.to, classification: item.verdict === 'best' ? 'best' : 'excellent' }
          : null,
      };
    }
  }
}

interface ReviewViewProps {
  state: GameReviewState;
  record: GameRecord;
  game: ParsedGame;
}

function ReviewView({ state, record, game }: ReviewViewProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const totalPlies = game.moves.length;
  const { analyses, analysis } = state;
  const perspectiveColor = state.perspective?.color ?? null;
  // The texts of the opponent's moves address the viewer ("You reply Rxg7+ and win their
  // pawn"); the exported PGN keeps the original wording (state.review).
  const review = useMemo(
    () => state.review && reviewForViewer(state.review, perspectiveColor),
    [state.review, perspectiveColor],
  );
  const location = useLocation();

  // A shared link can open at a move: /review/<id>?ply=N.
  const [ply, setPly] = useState(() => initialPly(location.search, totalPlies));
  const [orientation, setOrientation] = useState<BoardOrientation>(() =>
    perspectiveColor
      ? toOrientation(perspectiveColor)
      : initialOrientation(
          record,
          useSettings.getState().recent.map((search) => search.username),
        ),
  );
  const showBestMoveArrow = useSettings((s) => s.showBestMoveArrow);
  const showEvalBar = useSettings((s) => s.showEvalBar);
  const showBoardBadges = useSettings((s) => s.showBoardBadges);
  const updateSettings = useSettings((s) => s.set);

  const variationControls = useVariation();
  const { variation } = variationControls;
  const retry = useRetrySession(game, review);
  const session = retry.session;
  const retryItem = session?.item ?? null;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${record.white.name} vs ${record.black.name} · Kibitz`;
    return () => {
      document.title = previousTitle;
    };
  }, [record]);

  // The perspective can become known after the first render; it sets the side at the
  // bottom unless the user has already flipped the board.
  const flippedRef = useRef(false);
  useEffect(() => {
    if (perspectiveColor && !flippedRef.current) setOrientation(toOrientation(perspectiveColor));
  }, [perspectiveColor]);

  // Retrying shows the board from the mover's side; the previous side comes back afterwards.
  const savedOrientationRef = useRef<BoardOrientation | null>(null);
  const retryPly = retryItem?.ply ?? null;
  const retryMover = retryItem?.move.color ?? null;
  useEffect(() => {
    if (retryMover) setOrientation(toOrientation(retryMover));
  }, [retryPly, retryMover]);
  const sessionActive = session !== null;
  useEffect(() => {
    if (sessionActive || !savedOrientationRef.current) return;
    setOrientation(savedOrientationRef.current);
    savedOrientationRef.current = null;
  }, [sessionActive]);

  const {
    close: closeVariation,
    open: openVariation,
    update: updateVariation,
    seek: seekVariation,
    step: stepVariation,
  } = variationControls;
  const { start: startRetrySession, exit: exitRetry } = retry;
  const startRetry = useCallback(
    (plies: readonly number[], mode: 'single' | 'learn') => {
      if (plies.length === 0) return;
      savedOrientationRef.current ??= orientation;
      closeVariation();
      startRetrySession(plies, mode);
      // The move is played on the board, which may have scrolled away on a phone.
      if (!isDesktop) revealBoard(true);
    },
    [closeVariation, orientation, startRetrySession, isDesktop],
  );

  /** Jumps to a game position, leaving any variation or retry. */
  const seek = useCallback(
    (target: number) => {
      exitRetry();
      closeVariation();
      setPly(Math.min(totalPlies, Math.max(0, target)));
    },
    [closeVariation, exitRetry, totalPlies],
  );
  const flip = useCallback(() => {
    flippedRef.current = true;
    setOrientation((current) => (current === 'white' ? 'black' : 'white'));
  }, []);
  const start = useCallback(() => seek(1), [seek]);

  /** Steps through the variation when one is open, otherwise through the game. */
  const step = useCallback(
    (delta: number) => {
      if (retryItem) return;
      if (variation) stepVariation(delta);
      else setPly((current) => Math.min(totalPlies, Math.max(0, current + delta)));
    },
    [retryItem, variation, stepVariation, totalPlies],
  );

  /** The "show why" story of the move at `target` as a variation, if the review has one. */
  const storyFor = useCallback(
    (target: number, which: 'why' | 'best'): Variation | null => {
      const targetMove = game.moves[target - 1];
      const targetReview = review?.moves[target - 1];
      const story = which === 'why' ? targetReview?.why : targetReview?.bestIdea;
      // A line with no tactic, mate or material in it has nothing to show.
      if (!targetMove || !targetReview || !story || !storyMatters(story)) return null;
      const { startPly, afterMove } = storyStart(story, targetMove);
      return storyVariation(startPly, {
        story,
        afterMove,
        player: perspectiveColor ?? targetMove.color,
        mover: targetMove.color,
        anchorLabel: `${moveNumberLabel(targetMove.moveNumber, targetMove.color)} ${targetMove.san}`,
        san: targetMove.san,
        classification: targetReview.classification,
      });
    },
    [game, review, perspectiveColor],
  );
  const showStory = useCallback(
    (which: 'why' | 'best') => {
      const next = storyFor(ply, which);
      if (!next) return;
      openVariation(next);
      if (!isDesktop) revealBoard(true);
    },
    [storyFor, ply, openVariation, isDesktop],
  );
  /**
   * Shows a key moment for the voice tour: the move, and its story playing when it has one
   * (what the better move would have done, when the reply itself shows nothing).
   */
  const showMoment = useCallback(
    (target: number) => {
      seek(target);
      const story = storyFor(target, 'why') ?? storyFor(target, 'best');
      if (!story) return 0;
      openVariation(story);
      return storyDuration(story);
    },
    [seek, storyFor, openVariation],
  );
  const coach = useCoach({
    game,
    review,
    ply,
    variation: retryItem ? null : variation,
    busy: session !== null,
    showMoment,
  });
  const { stopTour, tour, startTour: startCoachTour } = coach;
  const startTour = useCallback(() => {
    // The key moments are far below the board on phones; on desktop the tour bar and the
    // story panel appear at the top of the side column.
    if (isDesktop) window.scrollTo?.({ top: 0, behavior: 'smooth' });
    else revealBoard(true);
    startCoachTour();
  }, [startCoachTour, isDesktop]);

  const moveCardRef = useRef<HTMLDivElement>(null);
  /**
   * Jumps to a move picked from the move list or the key moments, further down the page,
   * and brings what was played into view: the board on phones (the explanation follows it),
   * the explanation on desktop (the board column is always in view there).
   */
  const showMove = useCallback(
    (target: number) => {
      seek(target);
      if (!isDesktop) {
        revealBoard(true);
        return;
      }
      // Once the card shows the new move.
      requestAnimationFrame(() =>
        moveCardRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
      );
    },
    [seek, isDesktop],
  );
  const togglePlay = variationControls.togglePlay;

  useReviewKeyboard({
    play: () => {
      if (retryItem || !variation || variation.kind === 'explore') return false;
      togglePlay();
    },
    prev: () => step(-1),
    next: () => step(1),
    first: () => {
      if (retryItem) return;
      if (variation) seekVariation(0);
      else setPly(0);
    },
    last: () => {
      if (retryItem) return;
      if (variation) seekVariation(variation.moves.length);
      else setPly(totalPlies);
    },
    flip,
    exit: () => {
      if (tour) {
        stopTour();
        closeVariation();
      } else if (session) exitRetry();
      else if (variation) closeVariation();
      else return false;
    },
  });

  const move = ply > 0 ? game.moves[ply - 1] : undefined;
  const moveReview = ply > 0 ? review?.moves[ply - 1] : undefined;

  // Live engine lines for the variation on the board.
  const shownVariation: Variation | null = retryItem ? null : variation;
  const shownStory = shownVariation?.kind === 'story' ? shownVariation : null;
  const variationPosition = shownVariation ? variationFen(shownVariation) : null;
  // Stories explain a line that is already analysed; only free variations need the engine.
  const live = useLiveAnalysis(shownStory ? null : variationPosition);
  const liveEval = useMemo<EvalBarValue | null>(
    () => (live.analysis ? evalBarValueAt([live.analysis], 0) : null),
    [live.analysis],
  );
  // While the next position is being analysed the bar keeps the last value instead of
  // jumping back to the middle.
  const [lastLiveEval, setLastLiveEval] = useState<EvalBarValue | null>(null);
  useEffect(() => {
    if (liveEval) setLastLiveEval(liveEval);
  }, [liveEval]);

  const gameArrows = useMemo(
    () => arrowsForMove(moveReview, showBestMoveArrow),
    [moveReview, showBestMoveArrow],
  );
  // The arrow switch is only offered where the move has an arrow to show.
  const hasArrow = useMemo(() => arrowsForMove(moveReview, true).length > 0, [moveReview]);

  const frame = useMemo(() => (shownStory ? storyFrame(shownStory) : null), [shownStory]);

  const view = useMemo<BoardView>(() => {
    if (retryItem) return retryBoardView(retryItem, game);
    if (shownStory) {
      const current = currentVariationMove(shownStory);
      const branchMove = game.moves[shownStory.startPly - 1];
      const context = shownStory.story;
      // At the start of a refutation or an idea the board is the game position after the
      // move, so it keeps the move's badge.
      const badge =
        showBoardBadges && !current && branchMove && context?.afterMove
          ? { square: branchMove.to, classification: context.classification }
          : null;
      return {
        fen: variationFen(shownStory),
        lastMove: current
          ? [current.from, current.to]
          : branchMove
            ? [branchMove.from, branchMove.to]
            : undefined,
        check: current ? current.check : (branchMove?.isCheck ?? false),
        arrows: frame?.arrows ?? NO_ARROWS,
        badge,
        rings: (frame?.highlights ?? []).map((square) => ({
          square,
          label: `Look at the piece on ${square}`,
        })),
        movable: true,
      };
    }
    if (shownVariation) {
      const current = currentVariationMove(shownVariation);
      const branchMove = game.moves[shownVariation.startPly - 1];
      let arrows: readonly BoardArrow[] = NO_ARROWS;
      if (showBestMoveArrow) {
        // An engine line shows where it goes next; a free variation shows the engine's choice.
        const next =
          shownVariation.kind === 'line'
            ? shownVariation.moves[shownVariation.index]?.uci
            : live.analysis?.lines[0]?.pv[0];
        const arrow = arrowFor(next, 'best');
        if (arrow) arrows = [arrow];
      }
      return {
        fen: variationFen(shownVariation),
        lastMove: current
          ? [current.from, current.to]
          : branchMove
            ? [branchMove.from, branchMove.to]
            : undefined,
        check: current ? current.check : (branchMove?.isCheck ?? false),
        arrows,
        badge: null,
        rings: NO_RINGS,
        movable: true,
      };
    }
    return {
      fen: move?.fenAfter ?? game.initialFen,
      lastMove: move ? [move.from, move.to] : undefined,
      check: move?.isCheck ?? false,
      arrows: gameArrows,
      badge:
        showBoardBadges && move && moveReview
          ? { square: move.to, classification: moveReview.classification }
          : null,
      rings: NO_RINGS,
      movable: true,
    };
  }, [
    retryItem,
    shownStory,
    frame,
    shownVariation,
    game,
    move,
    moveReview,
    gameArrows,
    showBoardBadges,
    showBestMoveArrow,
    live.analysis,
  ]);

  const { tryMove } = retry;
  const onBoardMove = useCallback(
    (uci: string): boolean => {
      if (retryItem) return tryMove(uci);
      const result = applyBoardMove(game, ply, variation, uci);
      if (result.type === 'illegal') return false;
      if (result.type === 'game') {
        closeVariation();
        setPly(result.ply);
      } else {
        updateVariation(result.variation);
      }
      return true;
    },
    [retryItem, tryMove, game, ply, variation, closeVariation, updateVariation],
  );
  const interactive = useMemo<BoardInteraction | null>(
    () =>
      view.movable
        ? {
            color: view.moverColor ? toOrientation(view.moverColor) : undefined,
            onMove: onBoardMove,
          }
        : null,
    [view.movable, view.moverColor, onBoardMove],
  );

  const evalValue = useMemo<EvalBarValue | null>(() => {
    // While retrying, the bar shows the position before the move and gives nothing away.
    if (retryItem) return evalBarValueAt(analyses, retryItem.ply - 1);
    // A story starts from an analysed game position whose evaluation already includes it.
    if (shownStory) return evalBarValueAt(analyses, shownStory.startPly);
    if (shownVariation) {
      const atBranch =
        shownVariation.index === 0 ? evalBarValueAt(analyses, shownVariation.startPly) : null;
      return atBranch ?? liveEval ?? lastLiveEval;
    }
    return evalBarValueAt(analyses, ply);
  }, [retryItem, shownStory, shownVariation, analyses, ply, liveEval, lastLiveEval]);
  const evalText = useMemo(() => evalTextAt(analyses, ply), [analyses, ply]);

  const onSwipe = useCallback(
    // Swiping left pulls the next move in, like turning a page.
    (direction: SwipeDirection) => step(direction === 'left' ? 1 : -1),
    [step],
  );
  const viewFen = view.fen;
  const swipeAllowed = useCallback(
    (event: PointerEvent) => {
      if (retryItem) return false;
      // A gesture that starts on a piece of the side to move drags the piece instead.
      const square = squareAtPoint(
        event.currentTarget.getBoundingClientRect(),
        event.clientX,
        event.clientY,
        orientation,
      );
      if (!square) return true;
      try {
        return new Chess(viewFen).get(square)?.color !== sideToMove(viewFen);
      } catch {
        return true;
      }
    },
    [retryItem, orientation, viewFen],
  );
  const swipeHandlers = useSwipe(onSwipe, undefined, swipeAllowed);

  const describePly = useCallback(
    (target: number) => {
      const targetMove = game.moves[target - 1];
      const label = targetMove
        ? `${moveNumberLabel(targetMove.moveNumber, targetMove.color)} ${targetMove.san}`
        : 'Start position';
      const score = evalTextAt(analyses, target);
      return score ? `${label} · ${score}` : label;
    },
    [game, analyses],
  );
  const markers = useMemo(
    () =>
      (review?.moves ?? [])
        .filter((m) => GRAPH_MARKER_CLASSIFICATIONS.includes(m.classification))
        .map((m) => ({ ply: m.ply, classification: m.classification })),
    [review],
  );
  const classifications = useMemo(
    () => (review?.moves ?? []).map((m) => m.classification),
    [review],
  );
  const reviewedMoves = review?.moves.length ?? 0;
  const pendingFromPly = reviewedMoves >= totalPlies ? Number.POSITIVE_INFINITY : reviewedMoves + 1;
  const learnPlies = useMemo(
    () => retryablePlies(review, perspectiveColor),
    [review, perspectiveColor],
  );

  // Clocks and the side to move follow the position on the board.
  const clockPly = retryItem ? retryItem.ply - 1 : shownVariation ? shownVariation.startPly : ply;
  const toMove = sideToMove(view.fen);
  const gameOverShown = !retryItem && !shownVariation && ply >= totalPlies;
  const bottomColor: Color = orientation === 'white' ? 'w' : 'b';
  const topColor: Color = bottomColor === 'w' ? 'b' : 'w';
  const renderStrip = (color: Color) => (
    <PlayerStrip
      player={color === 'w' ? record.white : record.black}
      color={color}
      clock={clockAtPly(game.moves, clockPly, color, record.timeControl)}
      toMove={toMove === color && !gameOverShown}
    />
  );

  const openingName = review?.opening?.name ?? record.openingName ?? null;
  // The engine settings behind the numbers on screen, not those of a deeper run in progress.
  const engineLabel = `${ENGINE_NAME} · depth ${state.reviewPreset.depth}`;

  const showLine = useCallback(
    (which: 'best' | 'played') => {
      if (!move || !moveReview) return;
      const line = which === 'best' ? moveReview.best : moveReview.playedLine;
      if (!line) return;
      const next = lineVariation(
        game,
        which === 'best' ? ply - 1 : ply,
        line.pvUci,
        which === 'best' ? `Best line instead of ${move.san}` : `Engine line after ${move.san}`,
      );
      if (next) openVariation(next);
    },
    [game, move, moveReview, ply, openVariation],
  );

  const boardBlock = (
    <div className="flex w-full gap-2 lg:gap-3">
      {showEvalBar && (
        <EvalBar
          value={evalValue}
          orientation={orientation}
          showLabel={isDesktop}
          className={cn('shrink-0', isDesktop ? 'w-6' : 'w-2.5')}
        />
      )}
      {/* Horizontal swipes step through the game; vertical scrolling and pinch-zoom stay native. */}
      <div className="relative min-w-0 flex-1 touch-pan-y touch-pinch-zoom" {...swipeHandlers}>
        <Board
          fen={view.fen}
          orientation={orientation}
          lastMove={view.lastMove}
          check={view.check}
          arrows={view.arrows}
          badge={view.badge}
          interactive={interactive}
        />
        {view.rings.map((ring) => (
          <SquareHighlight
            key={ring.square}
            square={ring.square}
            orientation={orientation}
            label={ring.label}
          />
        ))}
      </div>
    </div>
  );

  const analysisCard = (
    <AnalysisCard
      analysis={analysis}
      totalPlies={totalPlies}
      showingPreviousAnalysis={state.showingPreviousAnalysis}
      previousPresetLabel={state.reviewPreset.label}
      onStop={state.stop}
      onResume={state.resume}
    />
  );

  const summaryCard = (
    <SummaryCard
      record={record}
      review={review}
      reviewFailed={state.reviewFailed}
      totalPlies={totalPlies}
      atStart={isDesktop && ply === 0 && !shownVariation}
      onStart={start}
      canAnalyseDeeper={state.canAnalyseDeeper}
      onAnalyseDeeper={state.analyseDeeper}
      engineLabel={engineLabel}
      learnCount={learnPlies.length}
      learnScope={perspectiveColor ? 'yours' : 'both'}
      onLearn={session ? undefined : () => startRetry(learnPlies, 'learn')}
    />
  );

  const currentMoveCard = (
    // Scrolled to when a move is picked from a list below; clear of the sticky header.
    <div ref={moveCardRef} className="scroll-mt-20">
      <CurrentMoveCard
        ply={ply}
        totalPlies={totalPlies}
        move={move}
        moveReview={moveReview}
        evalText={evalText}
        openingName={openingName}
        analysisStatus={analysis.status}
        reviewFailed={state.reviewFailed}
        hasArrow={hasArrow}
        showArrow={showBestMoveArrow}
        onToggleArrow={(show) => updateSettings({ showBestMoveArrow: show })}
        onStart={start}
        onResume={state.resume}
        showStartButton={!isDesktop}
        perspectiveColor={perspectiveColor}
        onShowLine={showLine}
        onShowStory={showStory}
        onRetry={isRetryable(moveReview) ? () => startRetry([ply], 'single') : undefined}
      />
    </div>
  );

  const sidePanel = session ? (
    <RetryPanel
      session={session}
      moves={game.moves}
      perspectiveColor={perspectiveColor}
      onHint={retry.hint}
      onReveal={retry.reveal}
      onTryAgain={retry.tryAgain}
      onNext={retry.next}
      onExit={retry.exit}
      onRetryMissed={(plies) => startRetry(plies, 'learn')}
    />
  ) : shownStory?.story ? (
    <StoryPanel
      variation={shownStory}
      title={storyTitle(
        shownStory.story.story.kind,
        shownStory.story.san,
        shownStory.story.classification,
        shownStory.moves[0]?.san,
      )}
      playing={variationControls.playing}
      onSeek={seekVariation}
      onStep={stepVariation}
      onTogglePlay={togglePlay}
      onClose={closeVariation}
    />
  ) : shownVariation && variationPosition ? (
    <VariationPanel
      variation={shownVariation}
      playing={variationControls.playing}
      fen={variationPosition}
      live={live}
      engineName={ENGINE_NAME}
      onSeek={seekVariation}
      onStep={stepVariation}
      onTogglePlay={variationControls.togglePlay}
      onClose={closeVariation}
      onPlayLine={(pv) => updateVariation(extendVariation(shownVariation, pv))}
    />
  ) : null;

  const graphCard = (
    <Card className="p-3 sm:p-4">
      <h2 className="mb-2 text-sm font-semibold">Evaluation</h2>
      <EvalGraph
        whiteWinPercents={review?.whiteWinPercents ?? NO_WIN_PERCENTS}
        totalPlies={totalPlies}
        currentPly={ply}
        onSeek={seek}
        markers={markers}
        describePly={describePly}
        height={isDesktop ? 96 : 72}
      />
    </Card>
  );

  const movesCard = (
    <Card className="p-2">
      <h2 className="px-2 pt-1 pb-2 text-sm font-semibold">Moves</h2>
      <MoveList
        moves={game.moves}
        classifications={classifications}
        currentPly={ply}
        onSelect={showMove}
        pendingFromPly={pendingFromPly}
        className={isDesktop ? 'max-h-80' : 'max-h-72'}
      />
    </Card>
  );

  const keyMoments = (
    <KeyMoments
      review={review}
      moves={game.moves}
      currentPly={ply}
      onSelect={showMove}
      onNarrate={coach.supported && coach.tourPlies.length > 0 ? startTour : undefined}
      narrating={!!tour}
      onStopNarrating={stopTour}
    />
  );

  const nav = (className?: string, framed?: boolean) =>
    shownVariation ? (
      <BoardNav
        ply={shownVariation.index}
        totalPlies={shownVariation.moves.length}
        onSeek={seekVariation}
        onFlip={flip}
        onTogglePlay={shownVariation.kind === 'explore' ? undefined : togglePlay}
        playing={variationControls.playing}
        framed={framed}
        className={className}
      />
    ) : (
      <BoardNav
        ply={ply}
        totalPlies={totalPlies}
        onSeek={seek}
        onFlip={flip}
        stepsDisabled={!!retryItem}
        framed={framed}
        className={className}
      />
    );

  const shareMenu = (
    <ShareMenu
      compact={!isDesktop}
      getLink={() => reviewLink(window.location.href, ply)}
      getFen={() => view.fen}
      getPgn={() => record.pgn}
      annotatedReady={!!review && review.moves.length >= totalPlies}
      getAnnotatedPgn={() => (state.review ? annotatedPgn(game, record, state.review) : record.pgn)}
      annotatedFileName={pgnFileName(record)}
    />
  );

  const headerActions = (
    <>
      {coach.supported && <VoiceToggle on={coach.narrate} onChange={coach.setNarrate} />}
      {shareMenu}
    </>
  );

  // The step of a story, right under the board.
  const storyCaption =
    shownStory?.story && frame ? (
      <StoryCaption caption={frame.caption} tone={storyTone(shownStory.story)} />
    ) : null;
  const tourBar = tour ? (
    <TourBar
      index={tour.index}
      total={tour.total}
      label={tour.label}
      onNext={coach.nextMoment}
      onStop={stopTour}
    />
  ) : null;

  if (isDesktop) {
    // A full-height layout: the board column fills the screen under the app header, and the
    // review panel scrolls on its own with the move controls pinned at its bottom, so the
    // board can be as large as the screen allows and the controls never leave the screen.
    return (
      <div className="grid h-[calc(100dvh-6rem)] min-h-[30rem] w-full grid-cols-[minmax(0,1fr)_400px] gap-6">
        <section
          aria-label="Board"
          className="flex min-h-0 min-w-0 flex-col items-center justify-center"
        >
          {/* The board is square, so the column's width follows the height left after the
              player strips (and the caption while a story plays); the eval bar and its gap
              (2.25rem) add to the width, not the height. */}
          <div
            className={cn(
              'flex w-full min-w-[22rem] flex-col gap-1.5',
              showEvalBar
                ? storyCaption
                  ? 'max-w-[calc(100dvh-12.5rem)]'
                  : 'max-w-[calc(100dvh-9.25rem)]'
                : storyCaption
                  ? 'max-w-[calc(100dvh-14.75rem)]'
                  : 'max-w-[calc(100dvh-11.5rem)]',
            )}
          >
            {renderStrip(topColor)}
            {boardBlock}
            {renderStrip(bottomColor)}
            {storyCaption}
          </div>
        </section>
        <aside aria-label="Game review" className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* Once the user steps through the game, the current move and the graph come first
              so they stay next to the board instead of further down the panel. */}
          <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2 [scrollbar-gutter:stable]">
            <ReviewHeader record={record} review={review} compact actions={headerActions} />
            {tourBar}
            {analysisCard}
            {sidePanel}
            {!session && ply === 0 && summaryCard}
            {!session && currentMoveCard}
            {graphCard}
            {(session || ply > 0) && summaryCard}
            {movesCard}
            {keyMoments}
          </div>
          {nav()}
        </aside>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* The app layout already provides the 16px side gutters. */}
      <div className="mx-auto w-full max-w-2xl">
        <ReviewHeader record={record} review={review} compact actions={headerActions} />
        {/* On tablets the board is also limited by the screen height, so the current move
            stays visible above the move bar. */}
        <section
          aria-label="Board"
          className="mt-3 flex scroll-mt-16 flex-col gap-1.5 md:mx-auto md:max-w-[max(20rem,calc(100dvh-30rem))]"
        >
          {renderStrip(topColor)}
          {boardBlock}
          {renderStrip(bottomColor)}
          {storyCaption}
          {tourBar}
        </section>
        <div className="mt-3 flex flex-col gap-3">
          {sidePanel}
          {analysisCard}
          {!session && currentMoveCard}
          {graphCard}
          {summaryCard}
          {movesCard}
          {keyMoments}
        </div>
      </div>
      {/* Last child of the page so it stays pinned to the bottom of the screen. The bar spans
          the full width (the -mx-4 undoes the layout gutters); the buttons stay centred. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-3 border-t border-line bg-surface/95 px-4 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur">
        {nav('mx-auto max-w-2xl', false)}
      </div>
    </div>
  );
}
