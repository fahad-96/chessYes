import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameReview, MoveReview, ParsedGame, ParsedMove, SuggestedLine } from '@/core/types';
import { checkMove, type MoveVerdict } from '@/practice/checkMove';
import { analysePosition, evaluateMoverWin } from '@/practice/interactiveEngine';
import { errorMessage, isAbortError } from './reviewHelpers';
import { isRetryable, knownMoves, type RetryResult } from './retry';
import { lineMoves, playUciMove, type VariationMove } from './variation';

/** Pause between the moves played out after a solved (or revealed) retry. */
export const RETRY_LINE_STEP_MS = 800;
/** Moves of the engine's line shown after the solving move (the reply and your follow-up). */
const LINE_PLIES_AFTER = 2;

export type RetryStatus =
  /** Waiting for the user's move. */
  | 'solving'
  /** The engine is judging the move. */
  | 'checking'
  /** A decent move, but there is a clearly better one: try again. */
  | 'good'
  /** The move does not fix the mistake; the board shows it and the opponent's best reply. */
  | 'wrong'
  | 'solved'
  /** The user asked for the solution. */
  | 'revealed';

export interface RetryItem {
  ply: number;
  move: ParsedMove;
  moveReview: MoveReview & { best: SuggestedLine };
  status: RetryStatus;
  /** 0 = none, 1 = the piece to move, 2 = the best-move arrow. */
  hints: number;
  /** The latest move the user tried. */
  attempt: VariationMove | null;
  verdict: MoveVerdict | null;
  /** The latest try was the move played in the game. */
  gameMove: boolean;
  /** The opponent's best reply to a wrong try, when known. */
  reply: VariationMove | null;
  replyPending: boolean;
  /** Moves played out after solving or revealing: the solving move, then the engine's line. */
  line: VariationMove[];
  /** How many of `line` are on the board. */
  lineIndex: number;
  error: string | null;
}

export interface RetrySession {
  /** single = one move from the move card; learn = every retryable move in turn. */
  mode: 'single' | 'learn';
  plies: number[];
  /** Position in `plies` of the move being retried. */
  index: number;
  /** Outcome of every move finished so far, in order. */
  results: { ply: number; result: RetryResult }[];
  /** Null once a learn session has gone through every move (the score is shown). */
  item: RetryItem | null;
}

function createItem(game: ParsedGame, review: GameReview, ply: number): RetryItem | null {
  const move = game.moves[ply - 1];
  const moveReview = review.moves[ply - 1];
  if (!move || !isRetryable(moveReview)) return null;
  return {
    ply,
    move,
    moveReview,
    status: 'solving',
    hints: 0,
    attempt: null,
    verdict: null,
    gameMove: false,
    reply: null,
    replyPending: false,
    line: [],
    lineIndex: 0,
    error: null,
  };
}

/** The item for plies[index] or later, skipping any that cannot be retried. */
function itemFrom(
  game: ParsedGame,
  review: GameReview,
  plies: readonly number[],
  index: number,
): { index: number; item: RetryItem | null } {
  for (let i = index; i < plies.length; i++) {
    const item = createItem(game, review, plies[i]!);
    if (item) return { index: i, item };
  }
  return { index: plies.length, item: null };
}

function resultOf(item: RetryItem): RetryResult {
  if (item.status === 'solved') return 'solved';
  if (item.status === 'revealed') return 'revealed';
  return 'skipped';
}

export interface RetryControls {
  session: RetrySession | null;
  /** Starts retrying `plies` (one ply for a single retry). */
  start: (plies: readonly number[], mode: RetrySession['mode']) => void;
  /** Handles a move made on the board; false rejects it (the board snaps back). */
  tryMove: (uci: string) => boolean;
  /** Next hint; after the second hint this shows the solution. */
  hint: () => void;
  reveal: () => void;
  tryAgain: () => void;
  /** Continue after a solve, or skip the current move. */
  next: () => void;
  exit: () => void;
}

/**
 * State for retrying mistakes: the move being retried, the user's tries (judged with
 * checkMove and the interactive engine, never blocking the UI), hints, and the score of a
 * "Learn from your mistakes" session.
 */
export function useRetrySession(game: ParsedGame, review: GameReview | null): RetryControls {
  const [session, setSession] = useState<RetrySession | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const cancelWork = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);
  useEffect(() => cancelWork, [cancelWork]);

  /** Updates the current item, unless the user has moved on to another one meanwhile. */
  const updateItem = useCallback((ply: number, update: (item: RetryItem) => RetryItem) => {
    setSession((current) =>
      current?.item?.ply === ply ? { ...current, item: update(current.item) } : current,
    );
  }, []);

  const start = useCallback(
    (plies: readonly number[], mode: RetrySession['mode']) => {
      cancelWork();
      if (!review) return;
      const first = itemFrom(game, review, plies, 0);
      if (!first.item) return;
      setSession({ mode, plies: [...plies], index: first.index, results: [], item: first.item });
    },
    [cancelWork, game, review],
  );

  const exit = useCallback(() => {
    cancelWork();
    setSession(null);
  }, [cancelWork]);

  const item = session?.item ?? null;

  const findReply = useCallback(
    async (ply: number, attempt: VariationMove, signal: AbortSignal) => {
      updateItem(ply, (current) => ({ ...current, replyPending: true }));
      try {
        const analysis = await analysePosition(attempt.fenAfter, {
          depth: 12,
          maxTimeMs: 1000,
          multiPv: 1,
          signal,
        });
        const uci = analysis.lines[0]?.pv[0];
        const reply = uci ? playUciMove(attempt.fenAfter, uci) : null;
        updateItem(ply, (current) =>
          current.attempt === attempt ? { ...current, reply, replyPending: false } : current,
        );
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        updateItem(ply, (current) => ({ ...current, replyPending: false }));
      }
    },
    [updateItem],
  );

  const judge = useCallback(
    async (current: RetryItem, attempt: VariationMove, signal: AbortSignal) => {
      const { moveReview, move, ply } = current;
      try {
        const result = await checkMove({
          fen: move.fenBefore,
          uci: attempt.uci,
          bestUci: moveReview.best.uci,
          winBest: moveReview.winBefore,
          known: knownMoves(moveReview),
          evaluate: evaluateMoverWin,
          signal,
        });
        if (signal.aborted) return;
        const { verdict } = result;
        if (verdict === 'best' || verdict === 'excellent') {
          const follow =
            attempt.uci === moveReview.best.uci
              ? lineMoves(attempt.fenAfter, moveReview.best.pvUci.slice(1, 1 + LINE_PLIES_AFTER))
              : [];
          updateItem(ply, (item) => ({
            ...item,
            status: 'solved',
            verdict,
            line: [attempt, ...follow],
            lineIndex: 1,
          }));
          return;
        }
        if (verdict === 'good') {
          updateItem(ply, (item) => ({ ...item, status: 'good', verdict }));
          return;
        }
        // Wrong: say what the move allows. The second choice's line is already known.
        const second = moveReview.secondBest;
        const knownReply =
          second && second.uci === attempt.uci && second.pvUci[1]
            ? playUciMove(attempt.fenAfter, second.pvUci[1])
            : null;
        updateItem(ply, (item) => ({ ...item, status: 'wrong', verdict, reply: knownReply }));
        if (!knownReply) await findReply(ply, attempt, signal);
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        console.error('Could not check the move', error);
        updateItem(ply, (item) => ({
          ...item,
          status: 'solving',
          attempt: null,
          error: `Could not check this move: ${errorMessage(error)}`,
        }));
      }
    },
    [findReply, updateItem],
  );

  const tryMove = useCallback(
    (uci: string): boolean => {
      if (!item || (item.status !== 'solving' && item.status !== 'good')) return false;
      const attempt = playUciMove(item.move.fenBefore, uci);
      if (!attempt) return false;
      cancelWork();

      if (attempt.uci === item.move.uci) {
        // The game move: the review already knows it was an error and how it is punished.
        const replyUci = item.moveReview.playedLine?.uci;
        const reply = replyUci ? playUciMove(attempt.fenAfter, replyUci) : null;
        updateItem(item.ply, (current) => ({
          ...current,
          status: 'wrong',
          verdict: 'wrong',
          gameMove: true,
          attempt,
          reply,
          replyPending: false,
          error: null,
        }));
        return true;
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      const checking: RetryItem = {
        ...item,
        status: 'checking',
        attempt,
        verdict: null,
        gameMove: false,
        reply: null,
        replyPending: false,
        error: null,
      };
      updateItem(item.ply, () => checking);
      void judge(checking, attempt, controller.signal);
      return true;
    },
    [cancelWork, item, judge, updateItem],
  );

  const hint = useCallback(() => {
    if (!item || (item.status !== 'solving' && item.status !== 'good')) return;
    updateItem(item.ply, (current) => ({ ...current, hints: Math.min(2, current.hints + 1) }));
  }, [item, updateItem]);

  const reveal = useCallback(() => {
    if (!item || item.status === 'solved' || item.status === 'revealed') return;
    cancelWork();
    const line = lineMoves(
      item.move.fenBefore,
      item.moveReview.best.pvUci.slice(0, 1 + LINE_PLIES_AFTER),
    );
    updateItem(item.ply, (current) => ({
      ...current,
      status: 'revealed',
      attempt: null,
      reply: null,
      replyPending: false,
      line,
      lineIndex: line.length > 0 ? 1 : 0,
      error: null,
    }));
  }, [cancelWork, item, updateItem]);

  const tryAgain = useCallback(() => {
    if (!item) return;
    cancelWork();
    updateItem(item.ply, (current) => ({
      ...current,
      status: 'solving',
      attempt: null,
      verdict: null,
      gameMove: false,
      reply: null,
      replyPending: false,
      error: null,
    }));
  }, [cancelWork, item, updateItem]);

  const next = useCallback(() => {
    cancelWork();
    setSession((current) => {
      if (!current?.item || !review) return null;
      if (current.mode === 'single') return null;
      const results = [
        ...current.results,
        { ply: current.item.ply, result: resultOf(current.item) },
      ];
      const following = itemFrom(game, review, current.plies, current.index + 1);
      return { ...current, results, index: following.index, item: following.item };
    });
  }, [cancelWork, game, review]);

  // Play out the solving line one move at a time.
  useEffect(() => {
    if (!item || (item.status !== 'solved' && item.status !== 'revealed')) return;
    if (item.lineIndex >= item.line.length) return;
    const ply = item.ply;
    const timer = setTimeout(
      () => updateItem(ply, (current) => ({ ...current, lineIndex: current.lineIndex + 1 })),
      RETRY_LINE_STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [item, updateItem]);

  return { session, start, tryMove, hint, reveal, tryAgain, next, exit };
}
