import { gameAccuracy, moveAccuracy } from './accuracy';
import { DEFAULT_ACCURACY_MODEL, type AccuracyModel } from './accuracyModel';
import { classifyMove } from './classify';
import { explainMove } from './explain';
import { detectSacrifice, isRegainedAtOnce, materialBalance, staticExchange } from './material';
import { isInCheck, legalMoveCount, pvToSan, sideToMove } from './notation';
import type { OpeningBook, OpeningInfo } from './openings';
import { describeLine, findMotifs, materialBaseline, type DescribeLineOptions } from './tactics';
import { THRESHOLDS } from './thresholds';
import {
  CLASSIFICATIONS,
  type Classification,
  type Color,
  type EngineLine,
  type GameReview,
  type LineStory,
  type MoveReview,
  type ParsedGame,
  type ParsedMove,
  type PlayerReview,
  type PositionAnalysis,
  type SacrificeInfo,
  type Score,
  type SuggestedLine,
} from './types';
import { positionWhiteWinPercent, scoreToWinPercent, winPercentFor } from './winPercent';

/** Bump when GameReview's shape or the classification rules change. */
export const REVIEW_FORMAT_VERSION = 6;

/** Maximum number of key moments highlighted in a review. */
export const MAX_KEY_MOMENTS = 8;

export interface BuildReviewOptions {
  book: OpeningBook | null;
  engine: { name: string; depth: number; multiPv: number };
  /**
   * The scale of the accuracies, game and per move (see accuracyModel.ts). Defaults to
   * 'calibrated'. Labels, win % and the eval graph always use the calibrated win %.
   */
  accuracyModel?: AccuracyModel;
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
 *
 * Win % values (labels, MoveReview.winBefore/winAfter, whiteWinPercents) are on the
 * calibrated scale that thresholds.ts is tuned for; only the accuracies follow
 * `options.accuracyModel`.
 */
export function buildGameReview(
  game: ParsedGame,
  analyses: (PositionAnalysis | null)[],
  options: BuildReviewOptions,
): GameReview {
  const accuracyModel = options.accuracyModel ?? DEFAULT_ACCURACY_MODEL;
  const positions = analysedPrefix(analyses, game.moves.length + 1);
  const whiteWinPercents = positions.map((position) => positionWhiteWinPercent(position));
  let bookPlies = countBookPlies(game.moves, options.book);

  const moves: MoveReview[] = [];
  for (let i = 0; i + 1 < positions.length; i++) {
    const move = game.moves[i];
    const pair = judgedPair(positions[i], positions[i + 1]);
    if (!move || !pair) break;
    const [before, after] = pair;
    const whiteBefore = positionWhiteWinPercent(before);
    const whiteAfter = positionWhiteWinPercent(after);
    if (i < bookPlies && leavesBook(move, before, after, whiteBefore, whiteAfter)) bookPlies = i;
    const previousReview = moves[i - 1];
    moves.push(
      reviewMove({
        move,
        previousMove: game.moves[i - 1],
        earlierMove: game.moves[i - 2],
        before,
        after,
        whiteBefore,
        whiteAfter,
        inBook: i < bookPlies,
        book: options.book,
        opponentGift:
          previousReview && ERRORS.has(previousReview.classification)
            ? previousReview.winLoss
            : undefined,
        accuracyModel,
      }),
    );
  }

  const firstMover = sideToMove(game.initialFen);
  const accuracyWinPercents =
    accuracyModel === 'calibrated'
      ? whiteWinPercents
      : positions.map((position) => positionWhiteWinPercent(position, accuracyModel));
  const accuracy = gameAccuracy(accuracyWinPercents, firstMover, accuracyModel);
  const white: PlayerReview = { accuracy: accuracy.white, counts: emptyCounts() };
  const black: PlayerReview = { accuracy: accuracy.black, counts: emptyCounts() };
  for (const move of moves) {
    const player = move.color === 'w' ? white : black;
    player.counts[move.classification] += 1;
  }

  const review: GameReview = {
    version: REVIEW_FORMAT_VERSION,
    engine: options.engine,
    accuracyModel,
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
  /** The move before `previousMove`. */
  earlierMove: ParsedMove | undefined;
  before: PositionAnalysis;
  after: PositionAnalysis;
  /** White's win % in the positions before and after the move. */
  whiteBefore: number;
  whiteAfter: number;
  inBook: boolean;
  book: OpeningBook | null;
  /** Win % the opponent's previous move gave away, when it was graded an error. */
  opponentGift: number | undefined;
  accuracyModel: AccuracyModel;
}

function reviewMove(input: ReviewMoveInput): MoveReview {
  const { move, previousMove, earlierMove, before, after, inBook, book } = input;
  const color = move.color;
  const winBefore = winPercentFor(input.whiteBefore, color);
  const winAfter = winPercentFor(input.whiteAfter, color);
  const winLoss = Math.max(0, winBefore - winAfter);
  const best = suggestedLine(move.fenBefore, before.lines[0]);
  const baselineFor = tradeBaseline(move, previousMove, earlierMove);

  const secondScore = before.lines[1]?.score;
  const winSecondBest =
    secondScore === undefined ? undefined : winPercentFor(scoreToWinPercent(secondScore), color);
  const legalMoves = legalMoveCount(move.fenBefore);

  // Sacrifice detection replays capture sequences, so only run it when the
  // result can change the label (Brilliant needs a nearly lossless move). Once the
  // game is over on the board nothing can be taken, so nothing was offered.
  const mayBeBrilliant =
    !inBook &&
    legalMoves !== 1 &&
    after.terminal === undefined &&
    winLoss <= THRESHOLDS.brilliant.maxLoss;
  const sacrifice = mayBeBrilliant ? realSacrifice(move, after) : null;
  const bestUci = before.lines[0]?.pv[0];
  // What the best line wins only matters where it can make a Miss: an error by win % that is
  // not the engine's move and does not leave the mover clearly worse. The same story
  // explains the error later (tellStories), so it is only computed once.
  const mayBeMiss =
    !inBook &&
    legalMoves !== 1 &&
    best !== undefined &&
    best.uci !== move.uci &&
    winLoss > THRESHOLDS.loss.good &&
    winAfter >= THRESHOLDS.miss.minWinAfter;
  const playedLine = suggestedLine(move.fenAfter, after.lines[0]);
  const bestLineGain = mayBeMiss
    ? missedStory(move, previousMove, best, baselineFor(best.uci)).materialSwing
    : undefined;
  // ...and what the line after the move played wins anyway (the refutation, also reused).
  const playedLineGain =
    mayBeMiss && playedLine ? refutationStory(move, playedLine).materialSwing : undefined;

  const classification = classifyMove({
    color,
    uci: move.uci,
    winBefore,
    winAfter,
    winSecondBest,
    bestUci,
    legalMoveCount: legalMoves,
    inBook,
    previousMove: previousMove && { to: previousMove.to, wasCapture: !!previousMove.captured },
    isCapture: !!move.captured,
    to: move.to,
    // Only needed to rule out Great, which only the engine's top move can be.
    captureGain:
      move.captured && move.uci === bestUci ? staticExchange(move.fenBefore, move.to) : undefined,
    inCheck: previousMove ? previousMove.isCheck : isInCheck(move.fenBefore),
    isCheckmate: move.isCheckmate,
    sacrifice,
    mateBefore: mateFor(before.lines[0]?.score, color),
    bestLineGain,
    playedLineGain,
    opponentGift: input.opponentGift,
  });

  const secondBest = suggestedLine(move.fenBefore, before.lines[1]);
  const evalAfter = after.lines[0]?.score ?? null;
  const opening = inBook ? openingAt(book, move.fenAfter) : undefined;
  const { why, bestIdea } = tellStories({
    move,
    previousMove,
    classification,
    best,
    playedLine,
    ideaBaseline: baselineFor(move.uci),
    missedBaseline: baselineFor(best?.uci),
  });

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
    why,
    bestIdea,
    baselineFen: baselineFor(best?.uci),
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
    accuracy: moveAccuracyFor(input, winBefore, winAfter),
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
  if (why) review.why = why;
  if (bestIdea) review.bestIdea = bestIdea;
  if (opening) review.opening = opening;
  return review;
}

/**
 * The move's accuracy on the review's accuracy scale: from the move's own (calibrated) win %
 * values, or for the Lichess scale from that model's win % of the same two positions.
 */
function moveAccuracyFor(input: ReviewMoveInput, winBefore: number, winAfter: number): number {
  const model = input.accuracyModel;
  if (model === 'calibrated') return moveAccuracy(winBefore, winAfter, model);
  const color = input.move.color;
  return moveAccuracy(
    winPercentFor(positionWhiteWinPercent(input.before, model), color),
    winPercentFor(positionWhiteWinPercent(input.after, model), color),
    model,
  );
}

const ERRORS: ReadonlySet<Classification> = new Set([
  'inaccuracy',
  'mistake',
  'blunder',
  'missedWin',
]);

interface StoryInput {
  move: ParsedMove;
  previousMove: ParsedMove | undefined;
  classification: Classification;
  best: SuggestedLine | undefined;
  playedLine: SuggestedLine | undefined;
  /** Where the material of the move's idea and of the best move's line is counted from. */
  ideaBaseline: string;
  missedBaseline: string;
}

/**
 * Where the material a line starting with a given move wins is counted from: the position
 * before the opponent's last move when that move captured (starting an exchange rather
 * than taking back) and the line's first move takes back on that square, so that taking
 * back is not called winning material; otherwise the position before the move.
 */
function tradeBaseline(
  move: ParsedMove,
  previousMove: ParsedMove | undefined,
  earlierMove: ParsedMove | undefined,
): (firstUci: string | undefined) => string {
  const startsTrade =
    previousMove?.captured && !(earlierMove?.captured && earlierMove.to === previousMove.to);
  return (firstUci) =>
    startsTrade && previousMove && firstUci?.slice(2, 4) === previousMove.to
      ? materialBaseline(move.fenBefore, previousMove.fenBefore, move.color)
      : move.fenBefore;
}

/**
 * The lines that show why a move got its label (see tactics.describeLine):
 * - Inaccuracies, Mistakes, Blunders and Misses: `why` is the opponent's refutation
 *   (the engine line after the move) and `bestIdea` what the engine's move would have done.
 * - Brilliant and Great moves: `why` is the idea, the move followed by the engine line.
 * - Best and Excellent moves: the idea too, but only when the move itself sets up a
 *   tactic that pays off in the line (a fork, a pin, a winning capture...).
 * Book, Forced and Good moves, and checkmating moves, get no story.
 */
function tellStories(input: StoryInput): { why?: LineStory; bestIdea?: LineStory } {
  const { move, previousMove, classification, best, playedLine } = input;
  if (move.isCheckmate) return {};
  const player = move.color;
  // A capture just before the line makes taking back on that square a trade.
  const recapture = previousMove?.captured ? previousMove.to : undefined;

  if (ERRORS.has(classification)) {
    const why = playedLine ? refutationStory(move, playedLine) : undefined;
    const bestIdea =
      best && best.uci !== move.uci
        ? missedStory(move, previousMove, best, input.missedBaseline)
        : undefined;
    return { why, bestIdea };
  }

  const ideaLine = [move.uci, ...(playedLine?.pvUci ?? [])];
  const idea = () =>
    story(move.fenBefore, ideaLine, {
      kind: 'idea',
      player,
      previousCaptureOn: recapture,
      startFen: input.ideaBaseline,
    });
  if (classification === 'brilliant' || classification === 'great') return { why: idea() };
  if (classification === 'best' || classification === 'excellent') {
    if (!hasMotif(move.fenBefore, move.uci)) return {};
    const why = idea();
    if (!why.motifs.some((motif) => motif.step === 0)) return {};
    // Getting back material the mover was already down is no discovery.
    const balance = materialBalance(input.ideaBaseline) * (player === 'w' ? 1 : -1);
    return balance < 0 && balance + why.materialSwing <= 0 ? {} : { why };
  }
  return {};
}

/**
 * Engine lines in SAN, stories and motif checks are memoised: buildGameReview runs again
 * every time the streaming analysis adds a position, while earlier moves keep the same
 * lines (replaying lines with chess.js is most of a review's cost). Each cache is keyed
 * by everything the result depends on and bounded, oldest entries out first.
 */
const CACHE_SIZE = 2000;
const storyCache = new Map<string, LineStory>();
const motifCache = new Map<string, boolean>();
const sanCache = new Map<string, string[]>();

/** What the opponent does after the move played: the engine line after it. */
function refutationStory(move: ParsedMove, playedLine: SuggestedLine): LineStory {
  return story(move.fenAfter, playedLine.pvUci, {
    kind: 'refutation',
    player: move.color,
    reviewedSan: move.san,
    previousCaptureOn: move.captured ? move.to : undefined,
    startFen: move.fenBefore,
  });
}

/** What the engine's best move would have achieved: its line from the position before. */
function missedStory(
  move: ParsedMove,
  previousMove: ParsedMove | undefined,
  best: SuggestedLine,
  startFen: string,
): LineStory {
  return story(move.fenBefore, best.pvUci, {
    kind: 'missed',
    player: move.color,
    // A capture just before the line makes taking back on that square a trade.
    previousCaptureOn: previousMove?.captured ? previousMove.to : undefined,
    startFen,
  });
}

function story(fen: string, pv: string[], options: DescribeLineOptions): LineStory {
  const key = [
    options.kind,
    options.player,
    options.previousCaptureOn ?? '',
    options.reviewedSan ?? '',
    options.startFen ?? '',
    fen,
    pv.join(' '),
  ].join('|');
  return remember(storyCache, key, () => describeLine(fen, pv, options));
}

function hasMotif(fen: string, uci: string): boolean {
  return remember(motifCache, `${fen}|${uci}`, () => findMotifs(fen, uci).length > 0);
}

function remember<T>(cache: Map<string, T>, key: string, compute: () => T): T {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const value = compute();
  if (cache.size >= CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}

/**
 * The move's sacrifice, unless the engine line after it wins the material straight back
 * (material.isRegainedAtOnce): that is a trick, not a sacrifice. A line that ends in a
 * forced mate for the mover keeps the sacrifice, whatever happens to the material.
 */
function realSacrifice(move: ParsedMove, after: PositionAnalysis): SacrificeInfo | null {
  const sacrifice = detectSacrifice(move.fenBefore, move.uci);
  const line = after.lines[0];
  if (!sacrifice || !line) return sacrifice;
  const mates = (mateFor(line.score, move.color) ?? 0) > 0;
  return !mates && isRegainedAtOnce(move.fenBefore, move.uci, line.pv) ? null : sacrifice;
}

/**
 * The analyses a move is judged by. The verification pass replaces some analyses with
 * deeper ones (PositionAnalysis.unverified keeps the replaced one), and a position belongs
 * to two moves: a move uses the verified analyses only when both of its positions were
 * verified (a finished game needs no search, so it counts as verified), and otherwise the
 * full pass's analyses of both, never a deeper search on one side and a shallower one on
 * the other.
 */
function judgedPair(
  before: PositionAnalysis | undefined,
  after: PositionAnalysis | undefined,
): [PositionAnalysis, PositionAnalysis] | null {
  if (!before || !after) return null;
  const verified = (analysis: PositionAnalysis) =>
    analysis.unverified !== undefined || analysis.terminal !== undefined;
  if (verified(before) && verified(after)) return [before, after];
  return [before.unverified ?? before, after.unverified ?? after];
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
 * A checkmate is never theory, even when a trap line in the book ends with it.
 * Computed over the whole game, independent of how far the analysis has got
 * (buildGameReview may end the book earlier, see leavesBook).
 */
function countBookPlies(moves: ParsedMove[], book: OpeningBook | null): number {
  if (!book) return 0;
  let plies = 0;
  for (const move of moves) {
    if (move.isCheckmate || !book.has(move.fenAfter)) break;
    plies++;
  }
  return plies;
}

/**
 * Whether a move in a book position ends the book anyway because the engine shows it
 * throws the game away: it loses more than an Inaccuracy's worth of win % (unless it is
 * the engine's own top move) or allows a forced mate. The book holds trap lines, such as
 * Fool's Mate, that contain the losing move; that move is a decision to grade, not theory.
 */
function leavesBook(
  move: ParsedMove,
  before: PositionAnalysis,
  after: PositionAnalysis,
  whiteBefore: number,
  whiteAfter: number,
): boolean {
  const loss = winPercentFor(whiteBefore, move.color) - winPercentFor(whiteAfter, move.color);
  const isEngineBest = before.lines[0]?.pv[0] === move.uci;
  if (!isEngineBest && loss > THRESHOLDS.loss.inaccuracy) return true;
  return (mateFor(after.lines[0]?.score, move.color) ?? 0) < 0;
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
  // A copy, so that no review shares (and could change) the cached array.
  const pvSan = [...remember(sanCache, `${fen}|${line.pv.join(' ')}`, () => pvToSan(fen, line.pv))];
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
 * then the costliest Misses, Blunders and Mistakes. Returned in game order.
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
