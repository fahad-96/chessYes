import { gameAccuracy, moveAccuracy } from './accuracy';
import { classifyMove } from './classify';
import { explainMove } from './explain';
import { detectSacrifice } from './material';
import { legalMoveCount, pvToSan, sideToMove } from './notation';
import type { OpeningBook, OpeningInfo } from './openings';
import { THRESHOLDS } from './thresholds';
import {
  CLASSIFICATIONS,
  type Classification,
  type Color,
  type EngineLine,
  type GameReview,
  type MoveReview,
  type ParsedGame,
  type ParsedMove,
  type PlayerReview,
  type PositionAnalysis,
  type Score,
  type SuggestedLine,
} from './types';
import { positionWhiteWinPercent, scoreToWinPercent, winPercentFor } from './winPercent';

/** Bump when GameReview's shape or the classification rules change. */
export const REVIEW_FORMAT_VERSION = 1;

/** Maximum number of key moments highlighted in a review. */
export const MAX_KEY_MOMENTS = 8;

export interface BuildReviewOptions {
  book: OpeningBook | null;
  engine: { name: string; depth: number; multiPv: number };
}

/**
 * Turns engine analyses into a full game review. Pure and synchronous.
 *
 * @param analyses analyses[i] is the position BEFORE move i+1 (index 0 = start
 *   position, index moves.length = final position). The array may be shorter than
 *   moves.length + 1 (analysis still running) or contain nulls (not analysed yet):
 *   a move is reviewed only when both the position before and after it are
 *   available, and reviewing stops at the first gap. `whiteWinPercents` likewise
 *   covers the contiguous analysed prefix.
 */
export function buildGameReview(
  game: ParsedGame,
  analyses: (PositionAnalysis | null)[],
  options: BuildReviewOptions,
): GameReview {
  const positions = analysedPrefix(analyses, game.moves.length + 1);
  const whiteWinPercents = positions.map(positionWhiteWinPercent);
  const bookPlies = countBookPlies(game.moves, options.book);

  const moves: MoveReview[] = [];
  for (let i = 0; i + 1 < positions.length; i++) {
    const move = game.moves[i];
    const before = positions[i];
    const whiteBefore = whiteWinPercents[i];
    const whiteAfter = whiteWinPercents[i + 1];
    const after = positions[i + 1];
    if (!move || !before || !after || whiteBefore === undefined || whiteAfter === undefined) {
      break;
    }
    moves.push(
      reviewMove({
        move,
        previousMove: game.moves[i - 1],
        before,
        after,
        whiteBefore,
        whiteAfter,
        inBook: i < bookPlies,
        book: options.book,
      }),
    );
  }

  const firstMover = sideToMove(game.initialFen);
  const accuracy = gameAccuracy(whiteWinPercents, firstMover);
  const white: PlayerReview = { accuracy: accuracy.white, counts: emptyCounts() };
  const black: PlayerReview = { accuracy: accuracy.black, counts: emptyCounts() };
  for (const move of moves) {
    const player = move.color === 'w' ? white : black;
    player.counts[move.classification] += 1;
  }

  const review: GameReview = {
    version: REVIEW_FORMAT_VERSION,
    engine: options.engine,
    moves,
    white,
    black,
    whiteWinPercents,
    keyMoments: pickKeyMoments(moves),
  };
  const opening = deepestOpening(game.moves, bookPlies, options.book);
  if (opening) review.opening = opening;
  return review;
}

interface ReviewMoveInput {
  move: ParsedMove;
  previousMove: ParsedMove | undefined;
  before: PositionAnalysis;
  after: PositionAnalysis;
  /** White's win % in the positions before and after the move. */
  whiteBefore: number;
  whiteAfter: number;
  inBook: boolean;
  book: OpeningBook | null;
}

function reviewMove(input: ReviewMoveInput): MoveReview {
  const { move, previousMove, before, after, inBook, book } = input;
  const color = move.color;
  const winBefore = winPercentFor(input.whiteBefore, color);
  const winAfter = winPercentFor(input.whiteAfter, color);
  const winLoss = Math.max(0, winBefore - winAfter);

  const secondScore = before.lines[1]?.score;
  const winSecondBest =
    secondScore === undefined ? undefined : winPercentFor(scoreToWinPercent(secondScore), color);
  const legalMoves = legalMoveCount(move.fenBefore);

  // Sacrifice detection replays capture sequences, so only run it when the
  // result can change the label (Brilliant needs a nearly lossless move).
  const mayBeBrilliant = !inBook && legalMoves !== 1 && winLoss <= THRESHOLDS.brilliant.maxLoss;
  const sacrifice = mayBeBrilliant ? detectSacrifice(move.fenBefore, move.uci) : null;

  const classification = classifyMove({
    color,
    uci: move.uci,
    winBefore,
    winAfter,
    winSecondBest,
    bestUci: before.lines[0]?.pv[0],
    legalMoveCount: legalMoves,
    inBook,
    previousMove: previousMove && { to: previousMove.to, wasCapture: !!previousMove.captured },
    isCapture: !!move.captured,
    to: move.to,
    sacrifice,
    mateBefore: mateFor(before.lines[0]?.score, color),
    // Delivering checkmate is the end of a forced mate, not the loss of one.
    mateAfter: after.terminal === 'checkmate' ? 0 : mateFor(after.lines[0]?.score, color),
  });

  const best = suggestedLine(move.fenBefore, before.lines[0]);
  const secondBest = suggestedLine(move.fenBefore, before.lines[1]);
  const playedLine = suggestedLine(move.fenAfter, after.lines[0]);
  const evalAfter = after.lines[0]?.score ?? null;
  const opening = inBook ? openingAt(book, move.fenAfter) : undefined;

  const explanation = explainMove({
    classification,
    color,
    san: move.san,
    uci: move.uci,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter,
    winBefore,
    winAfter,
    evalAfter,
    evalBest: before.lines[0]?.score ?? null,
    best,
    secondBest,
    playedLine,
    sacrifice: sacrifice ?? undefined,
    opening,
    isCheckmate: move.isCheckmate,
  });

  const review: MoveReview = {
    ply: move.ply,
    color,
    san: move.san,
    uci: move.uci,
    classification,
    winBefore,
    winAfter,
    winLoss,
    accuracy: moveAccuracy(winBefore, winAfter),
    evalAfter,
    whiteWinAfter: input.whiteAfter,
    explanation,
  };
  // Optional fields are omitted rather than set to undefined, so `'best' in move`
  // and deep equality behave the same before and after a structured clone.
  if (best) review.best = best;
  if (secondBest) review.secondBest = secondBest;
  if (playedLine) review.playedLine = playedLine;
  if (sacrifice) review.sacrifice = sacrifice;
  if (opening) review.opening = opening;
  return review;
}

/**
 * The analyses usable for the review: the longest prefix without gaps, capped at
 * `maxLength`. A position the engine returned nothing for (no line, not terminal)
 * counts as a gap, so a bad analysis yields a partial review instead of a crash.
 */
function analysedPrefix(
  analyses: (PositionAnalysis | null)[],
  maxLength: number,
): PositionAnalysis[] {
  const prefix: PositionAnalysis[] = [];
  for (const analysis of analyses.slice(0, maxLength)) {
    if (!analysis || (analysis.terminal === undefined && analysis.lines.length === 0)) break;
    prefix.push(analysis);
  }
  return prefix;
}

/**
 * Number of leading moves that stay in the opening book. Once a move leaves the
 * book, later transpositions back into it do not count: the game is out of theory.
 * Computed over the whole game, independent of how far the analysis has got.
 */
function countBookPlies(moves: ParsedMove[], book: OpeningBook | null): number {
  if (!book) return 0;
  let plies = 0;
  for (const move of moves) {
    if (!book.has(move.fenAfter)) break;
    plies++;
  }
  return plies;
}

function openingAt(book: OpeningBook | null, fen: string): OpeningInfo | undefined {
  const info = book?.lookup(fen);
  return info ? { eco: info.eco, name: info.name } : undefined;
}

/** The last named opening seen while the game was in book, with the last book ply. */
function deepestOpening(
  moves: ParsedMove[],
  bookPlies: number,
  book: OpeningBook | null,
): GameReview['opening'] {
  const bookMoves = moves.slice(0, bookPlies);
  const lastBookMove = bookMoves.at(-1);
  if (!lastBookMove) return undefined;
  for (const move of bookMoves.reverse()) {
    const opening = openingAt(book, move.fenAfter);
    if (opening) return { ...opening, lastBookPly: lastBookMove.ply };
  }
  return undefined;
}

/** Signed moves to mate from `color`'s point of view, or undefined for a centipawn score. */
function mateFor(score: Score | undefined, color: Color): number | undefined {
  if (score?.type !== 'mate') return undefined;
  return color === 'w' ? score.value : -score.value;
}

/** A SuggestedLine for an engine line, or undefined when its first move is not legal. */
function suggestedLine(fen: string, line: EngineLine | undefined): SuggestedLine | undefined {
  if (!line) return undefined;
  const pvSan = pvToSan(fen, line.pv);
  const san = pvSan[0];
  const uci = line.pv[0];
  if (san === undefined || uci === undefined) return undefined;
  // Keep the UCI and SAN lines aligned in case the PV contains an illegal tail.
  return { uci, san, score: line.score, pvUci: line.pv.slice(0, pvSan.length), pvSan };
}

function emptyCounts(): Record<Classification, number> {
  const counts = {} as Record<Classification, number>;
  for (const classification of CLASSIFICATIONS) counts[classification] = 0;
  return counts;
}

const SETBACKS: ReadonlySet<Classification> = new Set(['missedWin', 'blunder', 'mistake']);

/**
 * Up to MAX_KEY_MOMENTS plies worth stopping at: Brilliant and Great moves first,
 * then the costliest Missed Wins, Blunders and Mistakes. Returned in game order.
 * Exported for tests.
 */
export function pickKeyMoments(moves: MoveReview[]): number[] {
  const highlightRank = (m: MoveReview) => (m.classification === 'brilliant' ? 0 : 1);
  const highlights = moves
    .filter((m) => m.classification === 'brilliant' || m.classification === 'great')
    .sort((a, b) => highlightRank(a) - highlightRank(b) || a.ply - b.ply);
  const setbacks = moves
    .filter((m) => SETBACKS.has(m.classification))
    .sort((a, b) => b.winLoss - a.winLoss || a.ply - b.ply);

  return [...highlights, ...setbacks]
    .slice(0, MAX_KEY_MOMENTS)
    .map((m) => m.ply)
    .sort((a, b) => a - b);
}
