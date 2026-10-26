import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Color, GameRecord, ParsedGame, Square } from '@/core/types';
import { moveNumberLabel, sideToMove } from '@/core/notation';
import { ENGINE_NAME } from '@/engine/stockfish';
import { Board, type BoardBadge, type BoardOrientation } from '@/components/Board';
import { EvalBar } from '@/components/EvalBar';
import { EvalGraph, GRAPH_MARKER_CLASSIFICATIONS } from '@/components/EvalGraph';
import { MoveList } from '@/components/MoveList';
import { Card } from '@/components/ui/Card';
import { useSettings } from '@/state/settings';
import { cn } from '@/lib/cn';
import { AnalysisCard } from './AnalysisCard';
import { BoardNav } from './BoardNav';
import { CurrentMoveCard } from './CurrentMoveCard';
import { KeyMoments } from './KeyMoments';
import { PlayerStrip } from './PlayerStrip';
import { ReviewHeader } from './ReviewHeader';
import { ReviewErrorView, ReviewSkeleton } from './ReviewStates';
import { SummaryCard } from './SummaryCard';
import { useReviewKeyboard } from './keyboard';
import {
  arrowsForMove,
  clockAtPly,
  evalBarValueAt,
  evalTextAt,
  initialOrientation,
} from './reviewHelpers';
import { useSwipe, type SwipeDirection } from './swipe';
import { useGameReview, type GameReviewState } from './useGameReview';
import { useMediaQuery } from './useMediaQuery';

const NO_WIN_PERCENTS: readonly number[] = [];

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

interface ReviewViewProps {
  state: GameReviewState;
  record: GameRecord;
  game: ParsedGame;
}

function ReviewView({ state, record, game }: ReviewViewProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const totalPlies = game.moves.length;
  const { review, analyses, analysis } = state;

  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<BoardOrientation>(() =>
    initialOrientation(
      record,
      useSettings.getState().recent.map((search) => search.username),
    ),
  );
  const showBestMoveArrow = useSettings((s) => s.showBestMoveArrow);
  const showEvalBar = useSettings((s) => s.showEvalBar);
  const showBoardBadges = useSettings((s) => s.showBoardBadges);
  const updateSettings = useSettings((s) => s.set);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${record.white.name} vs ${record.black.name} · Kibitz`;
    return () => {
      document.title = previousTitle;
    };
  }, [record]);

  const seek = useCallback(
    (target: number) => setPly(Math.min(totalPlies, Math.max(0, target))),
    [totalPlies],
  );
  const step = useCallback(
    (delta: number) => setPly((current) => Math.min(totalPlies, Math.max(0, current + delta))),
    [totalPlies],
  );
  const flip = useCallback(
    () => setOrientation((current) => (current === 'white' ? 'black' : 'white')),
    [],
  );
  const start = useCallback(() => seek(1), [seek]);

  useReviewKeyboard({
    prev: () => step(-1),
    next: () => step(1),
    first: () => seek(0),
    last: () => seek(totalPlies),
    flip,
  });
  const onSwipe = useCallback(
    // Swiping left pulls the next move in, like turning a page.
    (direction: SwipeDirection) => step(direction === 'left' ? 1 : -1),
    [step],
  );
  const swipeHandlers = useSwipe(onSwipe);

  const move = ply > 0 ? game.moves[ply - 1] : undefined;
  const moveReview = ply > 0 ? review?.moves[ply - 1] : undefined;
  const fen = move?.fenAfter ?? game.initialFen;
  const lastMove = useMemo<[Square, Square] | undefined>(
    () => (move ? [move.from, move.to] : undefined),
    [move],
  );
  const arrows = useMemo(
    () => arrowsForMove(moveReview, showBestMoveArrow),
    [moveReview, showBestMoveArrow],
  );
  const badge = useMemo<BoardBadge | null>(
    () =>
      showBoardBadges && move && moveReview
        ? { square: move.to, classification: moveReview.classification }
        : null,
    [showBoardBadges, move, moveReview],
  );
  const evalValue = useMemo(() => evalBarValueAt(analyses, ply), [analyses, ply]);
  const evalText = useMemo(() => evalTextAt(analyses, ply), [analyses, ply]);

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

  const toMove = sideToMove(fen);
  const bottomColor: Color = orientation === 'white' ? 'w' : 'b';
  const topColor: Color = bottomColor === 'w' ? 'b' : 'w';
  const renderStrip = (color: Color) => (
    <PlayerStrip
      player={color === 'w' ? record.white : record.black}
      color={color}
      clock={clockAtPly(game.moves, ply, color, record.timeControl)}
      toMove={toMove === color && ply < totalPlies}
    />
  );

  const openingName = review?.opening?.name ?? record.openingName ?? null;
  const engineLabel = `${ENGINE_NAME} · depth ${analysis.preset.depth}`;

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
      <div className="min-w-0 flex-1 touch-pan-y" {...swipeHandlers}>
        <Board
          fen={fen}
          orientation={orientation}
          lastMove={lastMove}
          check={move?.isCheck ?? false}
          arrows={arrows}
          badge={badge}
        />
      </div>
    </div>
  );

  const analysisCard = (
    <AnalysisCard
      analysis={analysis}
      totalPlies={totalPlies}
      showingPreviousAnalysis={state.showingPreviousAnalysis}
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
      atStart={isDesktop && ply === 0}
      onStart={start}
      canAnalyseDeeper={state.canAnalyseDeeper}
      onAnalyseDeeper={state.analyseDeeper}
      engineLabel={engineLabel}
    />
  );

  const currentMoveCard = (
    <CurrentMoveCard
      ply={ply}
      totalPlies={totalPlies}
      move={move}
      moveReview={moveReview}
      evalText={evalText}
      openingName={openingName}
      analysisStatus={analysis.status}
      reviewFailed={state.reviewFailed}
      showArrow={showBestMoveArrow}
      onToggleArrow={(show) => updateSettings({ showBestMoveArrow: show })}
      onStart={start}
      onResume={state.resume}
      showStartButton={!isDesktop}
    />
  );

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
        onSelect={seek}
        pendingFromPly={pendingFromPly}
        className={isDesktop ? 'max-h-80' : 'max-h-72'}
      />
    </Card>
  );

  const keyMoments = (
    <KeyMoments review={review} moves={game.moves} currentPly={ply} onSelect={seek} />
  );

  const nav = (className?: string) => (
    <BoardNav ply={ply} totalPlies={totalPlies} onSeek={seek} onFlip={flip} className={className} />
  );

  if (isDesktop) {
    return (
      <div className="w-full">
        <ReviewHeader record={record} review={review} />
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_400px] items-start gap-6">
          <section
            aria-label="Board"
            className="sticky top-20 mx-auto flex w-full max-w-[calc(100dvh-19.5rem)] min-w-[22rem] flex-col gap-2"
          >
            {renderStrip(topColor)}
            {boardBlock}
            {renderStrip(bottomColor)}
            {nav('mt-1')}
          </section>
          <aside aria-label="Game review" className="flex min-w-0 flex-col gap-4">
            {analysisCard}
            {summaryCard}
            {currentMoveCard}
            {graphCard}
            {movesCard}
            {keyMoments}
          </aside>
        </div>
      </div>
    );
  }

  return (
    // The app layout already provides the 16px side gutters.
    <div className="mx-auto w-full max-w-2xl">
      <ReviewHeader record={record} review={review} compact />
      <section aria-label="Board" className="mt-3 flex flex-col gap-1.5">
        {renderStrip(topColor)}
        {boardBlock}
        {renderStrip(bottomColor)}
      </section>
      <div className="mt-3 flex flex-col gap-3">
        {analysisCard}
        {currentMoveCard}
        {graphCard}
        {summaryCard}
        {movesCard}
        {keyMoments}
      </div>
      {/* Last child of the page so it stays pinned to the bottom of the screen. */}
      {nav(
        cn(
          'sticky bottom-0 z-20 -mx-4 mt-3 rounded-none border-x-0 border-b-0 bg-surface/95 backdrop-blur',
          'pb-[max(0.25rem,env(safe-area-inset-bottom))]',
        ),
      )}
    </div>
  );
}
