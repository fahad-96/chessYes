import { Chess } from 'chess.js';
import type { Move } from 'chess.js';
import { materialBalance } from './material';
import { parseUci } from './notation';
import { PIECE_VALUES, THRESHOLDS } from './thresholds';
import type { Color, LineStory, Motif, MotifType, PieceSymbol, Square } from './types';

/**
 * Tactical pattern detection and line storytelling: turns an engine line into
 * "Nf6+ forks the king and queen and wins the queen". Pure: chess.js plays the moves
 * (legality, SAN, checkmate) and a small attack map of its own finds the patterns, so
 * no extra legal-move generation is needed per square.
 *
 * Precision comes before recall: a wrong "fork" is worse than none. findMotifs reports
 * what a single move sets up; describeLine only keeps the motifs that pay off in the line
 * that follows (a forked piece is captured, a mate is delivered...).
 */

export interface DescribeLineOptions {
  kind: LineStory['kind'];
  /** The player whose move is being reviewed: the story is written for them ("you", "your"). */
  player: Color;
  /** Maximum plies to show; the line is cut earlier once it becomes quiet. Default 6. */
  maxPlies?: number;
  /**
   * When the line is the reply to the reviewed move, the move itself in SAN. A capture
   * there tells which square the line's first move takes back on (see previousCaptureOn).
   */
  reviewedSan?: string;
  /**
   * The square the move leading to `fen` captured on, if it was a capture. Taking back on
   * that square is a trade, not a hanging piece. Derived from `reviewedSan` when omitted.
   */
  previousCaptureOn?: Square;
  /**
   * The position material is counted from, for the wording and for judging whether a
   * motif leaves the side ahead (default `fen`). For a refutation, pass the position
   * before the reviewed move, so that taking back what that move captured reads as a
   * trade rather than as material won.
   */
  startFen?: string;
}

/** Plies shown by default before the line is cut. */
const DEFAULT_MAX_PLIES = 6;
/**
 * Longest line shown: a mate in 6 in full, or a line whose horizon falls inside a run of
 * captures and checks, played on until that run ends.
 */
const MAX_LINE_PLIES = 11;
/** Mates up to this length are spelled out move by move in the text. */
const MAX_LISTED_MATE = 3;

/**
 * Motifs created by playing `uci` in `fen` (all with step 0, `by` = the mover).
 * Returns [] for illegal or malformed moves. Definitions (P = the moved piece):
 *
 * - checkmate / back-rank-mate: the move mates. It is a back-rank mate when a rook or
 *   queen mates along the king's first rank and the king's own pieces block all but at
 *   most one of the squares in front of it. Nothing else is reported for a mating move.
 * - double-check: two pieces give check. discovered-check: one piece gives check and it
 *   is not P (the move opened its line).
 * - fork: P attacks two or more enemy pieces (not pawns) that each matter: the king
 *   (check), or a piece P could take at a profit if it were the mover's turn again (worth
 *   more than P, or not defended well enough, by static exchange). At least one target
 *   must be newly attacked, and the opponent must not be able to take P without losing
 *   material.
 * - pin: a bishop, rook or queen (P, or a piece whose line P opened) attacks a knight,
 *   bishop, rook or queen with the king (absolute) or a more valuable piece (relative)
 *   right behind it on the same line. A relative pin also needs the piece behind to be
 *   worth taking: worth more than the pinner or undefended. The pinned piece must not be
 *   able to take the pinner along the line, and the pinner must not be free to take.
 * - skewer: the same line through the king, or through a piece worth more than both the
 *   slider and the piece behind it; the piece behind (not a pawn) must be worth taking.
 * - discovered-attack: P's departure opens a friendly slider's line to an enemy piece
 *   (not the king) that the slider could take at a profit.
 * - hanging-piece: P captures a piece and the opponent cannot win anything back on that
 *   square (the piece was undefended, or not defended well enough).
 * - promotion: a pawn promotes and the new piece cannot be won back at once.
 * Pins, skewers and checks that already existed before the move are not reported.
 * Trapped pieces are not detected: doing that reliably needs a search.
 */
export function findMotifs(fen: string, uci: string): Motif[] {
  const parsed = parseUci(uci);
  const chess = loadPosition(fen);
  if (!parsed || !chess) return [];
  let move: Move;
  try {
    move = chess.move(parsed);
  } catch {
    return []; // chess.js throws on illegal moves
  }
  const ply = makePly(move, chess.inCheck() && chess.isCheckmate());
  return detectMotifs(ply).map((found) => toMotif(found, 0, move.color));
}

/**
 * Walks `pvUci` from `fen`, keeps the plies that matter (until the tactic has played
 * out and the position is quiet, or mate), finds the motifs along the way and writes
 * the story text. Stops at the first illegal move.
 *
 * - The line is played to the last quiet position within `maxPlies` (no check, and the
 *   next move is not a capture or promotion), or on to the end of a run of captures and
 *   checks still going on there (11 plies at most; a line cut at that limit is not taken
 *   for a finished exchange). It is shown up to the move that cashes in the tactic (and
 *   its recapture) when the rest leaves the material as it is, without trailing moves
 *   that capture nothing and set up nothing. A line that neither wins material nor holds
 *   a motif keeps only its first move (two for an idea), or runs until its material
 *   settles. A line that ends in checkmate within 11 plies is shown in full.
 * - Only motifs by the side carrying out the story are kept (the opponent for a
 *   refutation, the player otherwise), and only when they pay off within the line: the
 *   side ends up at least a pawn ahead over the whole line and from that move on, and
 *   actually captures one of the targets; or the line ends in their checkmate.
 * - Material is counted from `startFen` (default `fen`), which also sets materialSwing.
 * - The text is one or two sentences for the player, for example "Your opponent replies
 *   Nd5+, forking your king and queen, and wins the queen." or "You sacrifice the rook on
 *   h7: after Kxh7, Nf6+ forks the king and queen and wins the queen." Without a motif it
 *   names the material won, and otherwise is a neutral sentence (see storyMatters). A
 *   sacrifice it opens with is also set on the story (LineStory.sacrifice).
 */
export function describeLine(
  fen: string,
  pvUci: string[],
  options: DescribeLineOptions,
): LineStory {
  const { kind, player } = options;
  const maxPlies = Math.max(1, options.maxPlies ?? DEFAULT_MAX_PLIES);
  const side = kind === 'refutation' ? opposite(player) : player;
  const story: LineStory = {
    kind,
    fen,
    movesUci: [],
    movesSan: [],
    motifs: [],
    materialSwing: 0,
    text: '',
  };

  // One ply more than can be shown tells whether the position at the cut is really quiet.
  const walked = walkLine(fen, pvUci, MAX_LINE_PLIES + 1);
  if (walked.length === 0) return story;
  const steps = walked.slice(0, MAX_LINE_PLIES);

  const mates = steps.at(-1)?.checkmate === true;
  const settled = mates ? steps.length : settledEnd(steps, maxPlies, walked[MAX_LINE_PLIES]);
  const previousCapture = options.previousCaptureOn ?? captureSquareOfSan(options.reviewedSan);
  const line: Line = {
    steps,
    side,
    startFen: options.startFen ?? fen,
    recapture: previousCapture ? indexOf(previousCapture) : null,
  };
  const found = keptMotifs(line, settled);
  const end = mates ? settled : storyEnd(line, settled, found, kind === 'idea' ? 2 : 1);
  const kept = found.filter((motif) => motif.step < end);

  const shown = steps.slice(0, end);
  const shownLine: Line = { ...line, steps: shown };
  const last = shown.at(-1)!;
  story.movesUci = shown.map((step) => step.uci);
  story.movesSan = shown.map((step) => step.san);
  story.motifs = kept.map((motif) => toMotif(motif, motif.step, side));
  story.materialSwing = sideMaterial(last.move.after, player) - sideMaterial(line.startFen, player);
  if (last.checkmate) {
    story.mateIn = shown.filter((step) => step.mover === last.mover).length;
  }
  const sacrifice = findSacrifice(shownLine, kind, story.materialSwing);
  if (sacrifice) story.sacrifice = { piece: sacrifice.piece, square: squareOf(sacrifice.square) };
  story.text = writeStory({
    kind,
    line: shownLine,
    kept,
    mateKind: kept.some((motif) => motif.type === 'back-rank-mate') ? 'back-rank' : 'plain',
    sacrifice,
    materialSwing: story.materialSwing,
  });
  return story;
}

/**
 * Whether a story shows something concrete: a motif, a mate, a sacrifice, or material going
 * the story's way (lost after a bad move, won by a good or a better one). Other stories
 * carry only the moves and a neutral sentence, and are not worth playing on the board:
 * material the player wins in their own refutation, or loses in an idea, contradicts the
 * move's label. A missed move's sacrifice that wins nothing back within the line (giving
 * up the queen to stop a mate) is told neutrally too, so it does not count on its own.
 */
export function storyMatters(story: LineStory): boolean {
  if (story.motifs.length > 0 || story.mateIn !== undefined) return true;
  if (story.sacrifice && story.kind !== 'missed') return true;
  return story.kind === 'refutation' ? story.materialSwing <= -1 : story.materialSwing >= 1;
}

/**
 * The position to count a line's material from when `fen` follows the opponent's move:
 * the position before that move when the player had more material there (the move
 * captured, so taking back is no gain), otherwise `fen` itself.
 */
export function materialBaseline(
  fen: string,
  fenBeforeOpponent: string | undefined,
  player: Color,
): string {
  if (!fenBeforeOpponent || !loadPosition(fenBeforeOpponent)) return fen;
  return sideMaterial(fenBeforeOpponent, player) > sideMaterial(fen, player)
    ? fenBeforeOpponent
    : fen;
}

const MISSED_PREFIX = 'You missed ';

/**
 * "Best was Nf6+, which forks the king and queen and wins the queen." for a 'missed'
 * story that names a concrete gain, or null (mates and neutral stories are left to the
 * caller, which knows the engine's mate count).
 */
export function bestMoveSentence(story: LineStory): string | null {
  if (story.kind !== 'missed' || !story.text.startsWith(MISSED_PREFIX)) return null;
  return `Best was ${story.text.slice(MISSED_PREFIX.length)}`;
}

// ---------------------------------------------------------------------------
// Board model: 64 squares, index = rank * 8 + file (a1 = 0, h1 = 7, h8 = 63)
// ---------------------------------------------------------------------------

interface Piece {
  type: PieceSymbol;
  color: Color;
}

type Board = readonly (Piece | null)[];
type Direction = readonly [file: number, rank: number];

const FILES = 'abcdefgh';
const STRAIGHT: Direction[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAGONAL: Direction[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ALL_DIRECTIONS = [...STRAIGHT, ...DIAGONAL];
const KNIGHT_JUMPS: Direction[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

function readBoard(fen: string): Board {
  const board: (Piece | null)[] = new Array<Piece | null>(64).fill(null);
  const rows = (fen.split(' ')[0] ?? '').split('/');
  rows.forEach((row, i) => {
    let file = 0;
    for (const char of row) {
      if (char >= '1' && char <= '8') {
        file += Number(char);
        continue;
      }
      const type = char.toLowerCase() as PieceSymbol;
      if (file < 8 && i < 8) board[(7 - i) * 8 + file] = { type, color: char === type ? 'b' : 'w' };
      file++;
    }
  });
  return board;
}

function indexOf(square: Square): number {
  return (Number(square[1]) - 1) * 8 + FILES.indexOf(square[0] ?? 'a');
}

function squareOf(index: number): Square {
  return `${FILES[index % 8]}${Math.floor(index / 8) + 1}` as Square;
}

function rankOf(index: number): number {
  return Math.floor(index / 8);
}

function offset(index: number, [df, dr]: Direction): number | null {
  const file = (index % 8) + df;
  const rank = Math.floor(index / 8) + dr;
  return file >= 0 && file < 8 && rank >= 0 && rank < 8 ? rank * 8 + file : null;
}

function slidesAlong(type: PieceSymbol, [df, dr]: Direction): boolean {
  const straight = df === 0 || dr === 0;
  return type === 'q' || (type === 'r' && straight) || (type === 'b' && !straight);
}

function isSlider(piece: Piece | null | undefined): boolean {
  return piece?.type === 'b' || piece?.type === 'r' || piece?.type === 'q';
}

/** The first occupied square from `from` (excluded) along `direction`, or null. */
function firstPiece(board: Board, from: number, direction: Direction): number | null {
  for (let sq = offset(from, direction); sq !== null; sq = offset(sq, direction)) {
    if (board[sq]) return sq;
  }
  return null;
}

/** Unit direction from `a` to `b` when they share a rank, file or diagonal, else null. */
function directionBetween(a: number, b: number): Direction | null {
  const df = (b % 8) - (a % 8);
  const dr = rankOf(b) - rankOf(a);
  if (a === b || (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr))) return null;
  return [Math.sign(df), Math.sign(dr)];
}

/** Squares the piece on `from` attacks; a slider's ray stops at (and includes) the first piece. */
function attacksFrom(board: Board, from: number): number[] {
  const piece = board[from];
  if (!piece) return [];
  const targets: number[] = [];
  const add = (sq: number | null) => {
    if (sq !== null) targets.push(sq);
  };
  if (piece.type === 'p') {
    const dr = piece.color === 'w' ? 1 : -1;
    add(offset(from, [-1, dr]));
    add(offset(from, [1, dr]));
  } else if (piece.type === 'n') {
    for (const jump of KNIGHT_JUMPS) add(offset(from, jump));
  } else if (piece.type === 'k') {
    for (const direction of ALL_DIRECTIONS) add(offset(from, direction));
  } else {
    for (const direction of ALL_DIRECTIONS) {
      if (!slidesAlong(piece.type, direction)) continue;
      for (let sq = offset(from, direction); sq !== null; sq = offset(sq, direction)) {
        targets.push(sq);
        if (board[sq]) break;
      }
    }
  }
  return targets;
}

/** Squares of `color`'s pieces that attack `target` directly (no x-rays, pins ignored). */
function attackersOf(board: Board, target: number, color: Color): number[] {
  const attackers: number[] = [];
  for (let sq = 0; sq < 64; sq++) {
    if (board[sq]?.color === color && attacksFrom(board, sq).includes(target)) attackers.push(sq);
  }
  return attackers;
}

function findKing(board: Board, color: Color): number | null {
  const index = board.findIndex((piece) => piece?.type === 'k' && piece.color === color);
  return index === -1 ? null : index;
}

/**
 * Whether the piece on `from` may go to `to` without exposing its own king along a line,
 * that is, unless it is pinned and `to` leaves the pin line. (A king's own safety is
 * checked by the callers.)
 */
function staysLegal(board: Board, from: number, to: number): boolean {
  const piece = board[from];
  if (!piece || piece.type === 'k') return true;
  const king = findKing(board, piece.color);
  const direction = king === null ? null : directionBetween(king, from);
  if (king === null || !direction || firstPiece(board, king, direction) !== from) return true;
  const pinner = firstPiece(board, from, direction);
  const attacker = pinner === null ? null : board[pinner];
  if (pinner === null || !attacker || attacker.color === piece.color) return true;
  if (!slidesAlong(attacker.type, direction)) return true;
  for (let sq = offset(king, direction); sq !== null; sq = offset(sq, direction)) {
    if (sq === to) return true;
    if (sq === pinner) break;
  }
  return false;
}

/** Value used to order pieces: the king counts as the most valuable. */
function rank(type: PieceSymbol): number {
  return type === 'k' ? 100 : PIECE_VALUES[type];
}

function promotionBonus(piece: Piece, to: number): number {
  const lastRank = piece.color === 'w' ? 7 : 0;
  return piece.type === 'p' && rankOf(to) === lastRank ? PIECE_VALUES.q - PIECE_VALUES.p : 0;
}

/** `board` after the piece on `from` goes to `to` (a pawn reaching the last rank queens). */
function withMove(board: Board, from: number, to: number): Board {
  const next = board.slice();
  const piece = board[from]!;
  next[to] = promotionBonus(piece, to) > 0 ? { type: 'q', color: piece.color } : piece;
  next[from] = null;
  return next;
}

/** The cheapest piece of `color` that can legally capture on `square`, or null. */
function cheapestAttacker(board: Board, square: number, color: Color): number | null {
  let best: number | null = null;
  for (const from of attackersOf(board, square, color)) {
    const piece = board[from]!;
    if (best !== null && rank(piece.type) >= rank(board[best]!.type)) continue;
    if (!staysLegal(board, from, square)) continue;
    if (
      piece.type === 'k' &&
      attackersOf(withMove(board, from, square), square, opposite(color)).length > 0
    ) {
      continue; // the king may not take a defended piece
    }
    best = from;
  }
  return best;
}

/**
 * Static exchange: the most material (pawn units, >= 0) `side` can win by starting a
 * capture sequence on `square`, both sides taking with their cheapest piece and free to stop.
 */
function exchangeGain(board: Board, square: number, side: Color): number {
  const target = board[square];
  if (!target || target.color === side || target.type === 'k') return 0;
  const attacker = cheapestAttacker(board, square, side);
  if (attacker === null) return 0;
  const bonus = promotionBonus(board[attacker]!, square);
  const next = withMove(board, attacker, square);
  return Math.max(
    0,
    PIECE_VALUES[target.type] + bonus - exchangeGain(next, square, opposite(side)),
  );
}

/**
 * What capturing on `to` with the piece on `from` nets after the best recaptures
 * (can be negative), or null when that capture is not possible.
 */
function captureGain(board: Board, from: number, to: number): number | null {
  const piece = board[from];
  const target = board[to];
  if (!piece || !target || target.color === piece.color || target.type === 'k') return null;
  if (!attacksFrom(board, from).includes(to) || !staysLegal(board, from, to)) return null;
  const next = withMove(board, from, to);
  if (piece.type === 'k' && attackersOf(next, to, target.color).length > 0) return null;
  return (
    PIECE_VALUES[target.type] + promotionBonus(piece, to) - exchangeGain(next, to, target.color)
  );
}

/** Whether the opponent can capture the piece on `square` without losing material. */
function canBeTakenSafely(board: Board, square: number): boolean {
  const piece = board[square];
  if (!piece) return false;
  return attackersOf(board, square, opposite(piece.color)).some((from) => {
    const gain = captureGain(board, from, square);
    return gain !== null && gain >= 0;
  });
}

// ---------------------------------------------------------------------------
// Motif detection for one move
// ---------------------------------------------------------------------------

/** One move with the boards around it. */
interface Ply {
  move: Move;
  mover: Color;
  before: Board;
  after: Board;
  to: number;
  /** Squares the mover's pieces landed on, and the squares they left (same order). */
  landed: number[];
  left: number[];
  /** Squares that became empty: `left`, plus the pawn taken en passant. */
  opened: number[];
  checkmate: boolean;
}

interface Subject {
  square: number;
  type: PieceSymbol;
}

/** A motif while it is being worked on: subjects keep their piece types for the wording. */
interface Found {
  type: MotifType;
  /** Square of the piece that carries it out. */
  square: number;
  /** In reading order: forked pieces by value, pinned then behind, front then behind... */
  subjects: Subject[];
  /** Hanging pieces: whether nothing defended the captured piece at all. */
  undefended?: boolean;
  /** Promotions: the new piece. */
  promoted?: PieceSymbol;
}

interface Kept extends Found {
  step: number;
}

/** Order in which motifs are listed and, for the story, which one leads. */
const MOTIF_ORDER: MotifType[] = [
  'back-rank-mate',
  'checkmate',
  'fork',
  'skewer',
  'pin',
  'double-check',
  'discovered-check',
  'discovered-attack',
  'trapped-piece',
  'hanging-piece',
  'promotion',
];

function makePly(move: Move, checkmate: boolean): Ply {
  const to = indexOf(move.to);
  const landed = [to];
  const left = [indexOf(move.from)];
  const backRank = move.color === 'w' ? '1' : '8';
  if (move.isKingsideCastle()) {
    landed.push(indexOf(`f${backRank}` as Square));
    left.push(indexOf(`h${backRank}` as Square));
  } else if (move.isQueensideCastle()) {
    landed.push(indexOf(`d${backRank}` as Square));
    left.push(indexOf(`a${backRank}` as Square));
  }
  const opened = [...left];
  if (move.isEnPassant()) opened.push(indexOf(`${move.to[0]}${move.from[1]}` as Square));
  return {
    move,
    mover: move.color,
    before: readBoard(move.before),
    after: readBoard(move.after),
    to,
    landed,
    left,
    opened,
    checkmate,
  };
}

function detectMotifs(ply: Ply): Found[] {
  const { after, mover } = ply;
  const king = findKing(after, opposite(mover));
  if (king === null) return [];
  const checkers = attackersOf(after, king, mover);
  if (ply.checkmate) return [mateMotif(ply, king, checkers)];

  const found: Found[] = [];
  const kingSubject = { square: king, type: 'k' as const };
  if (checkers.length >= 2) {
    found.push({ type: 'double-check', square: ply.to, subjects: [kingSubject] });
  } else if (checkers[0] !== undefined && !ply.landed.includes(checkers[0])) {
    found.push({ type: 'discovered-check', square: checkers[0], subjects: [kingSubject] });
  }
  ply.landed.forEach((square, i) => {
    const fork = findFork(ply, square, ply.left[i] ?? square);
    if (fork) found.push(fork);
  });
  found.push(...findLineMotifs(ply));
  found.push(...findDiscoveredAttacks(ply, found));
  const hanging = findHangingCapture(ply);
  if (hanging) found.push(hanging);
  const promotion = findPromotion(ply);
  if (promotion) found.push(promotion);
  return found.sort((a, b) => MOTIF_ORDER.indexOf(a.type) - MOTIF_ORDER.indexOf(b.type));
}

function mateMotif(ply: Ply, king: number, checkers: number[]): Found {
  const checker = checkers.find((sq) => ply.landed.includes(sq)) ?? checkers[0] ?? ply.to;
  const type = isBackRankMate(ply.after, king, checker) ? 'back-rank-mate' : 'checkmate';
  return { type, square: checker, subjects: [{ square: king, type: 'k' }] };
}

/**
 * A rook or queen mates along the king's first rank, and the king's own pieces stand on
 * all but at most one of the squares in front of it (the rest are covered).
 */
function isBackRankMate(board: Board, king: number, checker: number): boolean {
  const color = board[king]?.color;
  const piece = board[checker];
  const backRank = color === 'w' ? 0 : 7;
  if (!color || !piece || (piece.type !== 'r' && piece.type !== 'q')) return false;
  if (rankOf(king) !== backRank || rankOf(checker) !== backRank) return false;
  const forward = color === 'w' ? 1 : -1;
  const front = [-1, 0, 1]
    .map((df) => offset(king, [df, forward]))
    .filter((sq): sq is number => sq !== null);
  const blocked = front.filter((sq) => board[sq]?.color === color).length;
  return blocked >= 1 && blocked >= front.length - 1;
}

function findFork(ply: Ply, square: number, origin: number): Found | null {
  const { after } = ply;
  const piece = after[square];
  if (!piece) return null;
  const subjects: Subject[] = [];
  for (const target of attacksFrom(after, square)) {
    const victim = after[target];
    // Pawns do not make a fork: a check that also hits a pawn only picks the pawn up.
    if (!victim || victim.color === piece.color || victim.type === 'p') continue;
    if (victim.type === 'k') {
      if (piece.type !== 'k') subjects.push({ square: target, type: 'k' });
      continue;
    }
    const gain = captureGain(after, square, target);
    if (gain !== null && gain > 0) subjects.push({ square: target, type: victim.type });
  }
  if (subjects.length < 2) return null;
  // A piece that already hit every target from its old square creates nothing new.
  const before = new Set(attacksFrom(ply.before, origin));
  if (subjects.every((subject) => before.has(subject.square))) return null;
  if (canBeTakenSafely(after, square)) return null;
  subjects.sort((a, b) => rank(b.type) - rank(a.type));
  return { type: 'fork', square, subjects };
}

/** Pins and skewers by sliders that moved, or whose line the move opened. */
function findLineMotifs(ply: Ply): Found[] {
  const { after, mover } = ply;
  const lines: { slider: number; direction: Direction }[] = [];
  for (const square of ply.landed) {
    const piece = after[square];
    if (!isSlider(piece)) continue;
    for (const direction of ALL_DIRECTIONS) {
      if (slidesAlong(piece!.type, direction)) lines.push({ slider: square, direction });
    }
  }
  for (const square of ply.opened) {
    for (const direction of ALL_DIRECTIONS) {
      const back: Direction = [-direction[0], -direction[1]];
      const slider = firstPiece(after, square, back);
      const piece = slider === null ? null : after[slider];
      if (slider === null || piece?.color !== mover || ply.landed.includes(slider)) continue;
      if (isSlider(piece) && slidesAlong(piece.type, direction)) lines.push({ slider, direction });
    }
  }

  const found: Found[] = [];
  for (const { slider, direction } of lines) {
    const motif = lineMotif(after, slider, direction);
    if (!motif || existedBefore(ply.before, motif.subjects, mover)) continue;
    if (found.some((other) => other.subjects[0]?.square === motif.subjects[0]?.square)) continue;
    if (!canBeTakenSafely(after, slider)) found.push(motif);
  }
  return found;
}

/** A pin or skewer along one ray of the slider on `slider`, or null. */
function lineMotif(board: Board, slider: number, direction: Direction): Found | null {
  const piece = board[slider];
  const frontSquare = firstPiece(board, slider, direction);
  const backSquare = frontSquare === null ? null : firstPiece(board, frontSquare, direction);
  const front = frontSquare === null ? null : board[frontSquare];
  const back = backSquare === null ? null : board[backSquare];
  if (!piece || !front || !back || frontSquare === null || backSquare === null) return null;
  if (front.color === piece.color || back.color === piece.color) return null;
  const subjects = [
    { square: frontSquare, type: front.type },
    { square: backSquare, type: back.type },
  ];

  if (front.type !== 'k' && front.type !== 'p') {
    const pinnedToKing = back.type === 'k';
    const worthTaking =
      rank(back.type) > rank(piece.type) || attackersOf(board, backSquare, back.color).length === 0;
    const relative = rank(back.type) > rank(front.type) && worthTaking;
    // A pinned rook, bishop or queen on its own line can simply take the pinner.
    if ((pinnedToKing || relative) && !slidesAlong(front.type, direction)) {
      return { type: 'pin', square: slider, subjects };
    }
  }
  if (back.type !== 'k' && back.type !== 'p') {
    const mustMove =
      front.type === 'k' ||
      (rank(front.type) > rank(piece.type) && rank(front.type) > rank(back.type));
    // Once the front piece steps aside, taking the piece behind must win something.
    const withoutFront = board.slice();
    withoutFront[frontSquare] = null;
    const worthTaking =
      rank(back.type) > rank(piece.type) ||
      attackersOf(withoutFront, backSquare, back.color).length === 0;
    if (mustMove && worthTaking) return { type: 'skewer', square: slider, subjects };
  }
  return null;
}

/** Whether the same two pieces were already lined up against a slider of `mover` before. */
function existedBefore(before: Board, subjects: Subject[], mover: Color): boolean {
  const [front, back] = subjects;
  if (!front || !back) return false;
  if (before[front.square]?.type !== front.type || before[back.square]?.type !== back.type) {
    return false;
  }
  const direction = directionBetween(back.square, front.square);
  if (!direction || firstPiece(before, back.square, direction) !== front.square) return false;
  const slider = firstPiece(before, front.square, direction);
  const piece = slider === null ? null : before[slider];
  return piece?.color === mover && isSlider(piece) && slidesAlong(piece.type, direction);
}

function findDiscoveredAttacks(ply: Ply, found: Found[]): Found[] {
  const { after, mover } = ply;
  const attacks: Found[] = [];
  for (const square of ply.opened) {
    for (const direction of ALL_DIRECTIONS) {
      const slider = firstPiece(after, square, [-direction[0], -direction[1]]);
      const piece = slider === null ? null : after[slider];
      if (slider === null || piece?.color !== mover || ply.landed.includes(slider)) continue;
      if (!isSlider(piece) || !slidesAlong(piece.type, direction)) continue;
      const target = firstPiece(after, square, direction);
      const victim = target === null ? null : after[target];
      if (target === null || !victim || victim.color === mover || victim.type === 'k') continue;
      const gain = captureGain(after, slider, target);
      if (gain === null || gain <= 0) continue;
      const covered = [...found, ...attacks].some(
        (other) => other.square === slider && other.subjects.some((s) => s.square === target),
      );
      if (!covered) {
        attacks.push({
          type: 'discovered-attack',
          square: slider,
          subjects: [{ square: target, type: victim.type }],
        });
      }
    }
  }
  return attacks;
}

function findHangingCapture(ply: Ply): Found | null {
  const { move } = ply;
  if (!move.captured) return null;
  // The opponent must not win anything back on the square.
  if (exchangeGain(ply.after, ply.to, opposite(ply.mover)) > 0) return null;
  const square = move.isEnPassant() ? (ply.opened.at(-1) ?? ply.to) : ply.to;
  const defenders = attackersOf(ply.before, square, opposite(ply.mover));
  return {
    type: 'hanging-piece',
    square: ply.to,
    subjects: [{ square, type: move.captured }],
    undefended: defenders.length === 0,
  };
}

function findPromotion(ply: Ply): Found | null {
  const { promotion } = ply.move;
  if (!promotion || exchangeGain(ply.after, ply.to, opposite(ply.mover)) > 0) return null;
  return { type: 'promotion', square: ply.to, subjects: [], promoted: promotion };
}

function toMotif(found: Found, step: number, by: Color): Motif {
  const targets = [...found.subjects]
    .sort((a, b) => rank(b.type) - rank(a.type))
    .map((subject) => squareOf(subject.square));
  return {
    type: found.type,
    step,
    by,
    square: squareOf(found.square),
    targets,
    phrase: motifPhrase(found, 'the', 'verb'),
  };
}

// ---------------------------------------------------------------------------
// Walking a line
// ---------------------------------------------------------------------------

interface Step extends Ply {
  uci: string;
  san: string;
  /** Whether the move gives check. */
  check: boolean;
}

/** Plays up to `limit` moves of `pv`, stopping at the first illegal one or at checkmate. */
function walkLine(fen: string, pv: readonly string[], limit: number): Step[] {
  const chess = loadPosition(fen);
  if (!chess) return [];
  const steps: Step[] = [];
  for (const uci of pv.slice(0, limit)) {
    const parsed = parseUci(uci);
    if (!parsed) break;
    let move: Move;
    try {
      move = chess.move(parsed);
    } catch {
      break; // chess.js throws on illegal moves
    }
    const check = chess.inCheck();
    const checkmate = check && chess.isCheckmate();
    steps.push({ ...makePly(move, checkmate), uci, san: move.san, check });
    if (checkmate) break;
  }
  return steps;
}

/**
 * Number of plies up to the last quiet position within `maxPlies`: the side to move is
 * not in check and the line's next move is not a capture, promotion or check. If the
 * horizon falls inside a run of captures and checks, the line runs on to the end of it.
 * `next` is the move after the last step when the engine line goes on; only a line that
 * really ends there (no `next`) counts as quiet at its end, so a line cut short is never
 * mistaken for a finished exchange.
 */
function settledEnd(steps: Step[], maxPlies: number, next: Step | undefined): number {
  const n = steps.length;
  const forcing = (step: Step | undefined) =>
    Boolean(step && (step.move.captured || step.move.promotion || step.check));
  const quiet = (k: number) =>
    (k === n && !next) || (!steps[k - 1]?.check && !forcing(k === n ? next : steps[k]));
  const horizon = Math.min(maxPlies, n);
  let end = 0;
  for (let k = 1; k <= horizon; k++) if (quiet(k)) end = k;
  for (let k = horizon + 1; end < horizon && k <= n; k++) if (quiet(k)) end = k;
  return end === 0 ? horizon : end;
}

/** A line being told, with what is needed to count its material. */
interface Line {
  steps: Step[];
  /** Who carries out the story: the opponent for a refutation, the player otherwise. */
  side: Color;
  /** Position material is counted from (see DescribeLineOptions.startFen). */
  startFen: string;
  /** Square the move before the line captured on, if it captured. */
  recapture: number | null;
}

/** Whether step `i` only takes back on the square the move before it captured on. */
function isRecapture(line: Line, i: number): boolean {
  const step = line.steps[i];
  const square = i === 0 ? line.recapture : capturedOn(line.steps[i - 1]);
  return Boolean(step?.move.captured) && step?.to === square;
}

/** Motifs by the line's side within the first `end` steps that pay off there (see describeLine). */
function keptMotifs(line: Line, end: number): Kept[] {
  const { steps, side } = line;
  const last = steps[end - 1];
  if (!last) return [];
  const finalMaterial = sideMaterial(last.move.after, side);
  const mates = last.checkmate && last.mover === side;
  // A trick that does not leave the side ahead over the whole line is not the point of it
  // (a pawn picked up after a sacrifice that is not won back, a trade that evens out).
  if (!mates && finalMaterial - sideMaterial(line.startFen, side) < 1) return [];
  const kept: Kept[] = [];

  for (let i = 0; i < end; i++) {
    const step = steps[i]!;
    if (step.mover !== side) continue;
    const gain = finalMaterial - sideMaterial(step.move.before, side);
    const recapture = isRecapture(line, i);
    for (const found of detectMotifs(step)) {
      if (paysOff(found, { steps, i, end, side, gain, mates, recapture })) {
        kept.push({ ...found, step: i });
      }
    }
  }
  // Taking a piece that a fork or pin went after is its payoff, not another idea; nor is a
  // pawn picked up by the forking move itself.
  const tactic = kept.find((motif) => motif.type !== 'hanging-piece' && motif.type !== 'promotion');
  return kept.filter(
    (motif) => !tactic || motif.type !== 'hanging-piece' || motif.step < tactic.step,
  );
}

/** The motif the story leads with: the strongest kind, then the earliest. */
function mainMotif(kept: Kept[]): Kept | undefined {
  return [...kept].sort(
    (a, b) => MOTIF_ORDER.indexOf(a.type) - MOTIF_ORDER.indexOf(b.type) || a.step - b.step,
  )[0];
}

/**
 * Where the shown line ends: right after the move that cashes in the main motif (or the
 * main capture when there is no motif) and its recapture, provided the rest of the
 * settled line leaves the material as it is; then trailing moves that capture nothing
 * and set up nothing are dropped, down to `minPlies`. A line that neither wins material
 * nor holds a motif is cut to `minPlies` straight away (or where its material settles).
 */
function storyEnd(line: Line, settled: number, kept: Kept[], minPlies: number): number {
  const { steps, side } = line;
  const main = mainMotif(kept);
  const won =
    sideMaterial(steps[settled - 1]!.move.after, side) - sideMaterial(line.startFen, side);
  if (!main && won < 1) {
    // Up to the first moves, or on until the material settles: cutting a line the side
    // loses material in any earlier would show a gain it gives back (storyMatters keeps
    // such lines off the board anyway).
    const material = (k: number) => sideMaterial(steps[k - 1]!.move.after, side);
    let end = Math.min(minPlies, settled);
    while (end < settled && material(end) !== material(settled)) end++;
    return end;
  }
  const payoff = main ? payoffStep(steps, settled, main, side) : decisiveCapture(line, settled);
  let end = settled;
  const payoffStepAt = payoff === null ? undefined : steps[payoff];
  if (payoff !== null && payoffStepAt) {
    let cut = payoff + 1;
    const next = steps[cut];
    if (cut < settled && next?.move.captured && next.to === payoffStepAt.to) cut++;
    const material = (k: number) => sideMaterial(steps[k - 1]!.move.after, side);
    if (cut <= settled && material(cut) === material(settled)) end = cut;
  }
  const eventful = (i: number) =>
    Boolean(steps[i]?.move.captured || steps[i]?.move.promotion) ||
    kept.some((motif) => motif.step === i);
  while (end > Math.min(minPlies, settled) && !eventful(end - 1)) end--;
  return end;
}

/** The step where `motif` pays off: its target falls, or the move itself wins material. */
function payoffStep(steps: Step[], end: number, motif: Kept, side: Color): number | null {
  if (motif.type === 'hanging-piece' || motif.type === 'promotion') return motif.step;
  const targets = motif.subjects.filter((subject) => subject.type !== 'k');
  for (let j = motif.step; j < end; j++) {
    const step = steps[j]!;
    if (step.mover !== side || !step.move.captured) continue;
    // Checks cash in with any capture; the other motifs when a target falls.
    if (targets.length === 0 || targets.some((target) => target.square === step.to)) return j;
  }
  return null;
}

/**
 * The side's capture of the most valuable piece within the first `end` steps, not
 * counting recaptures (of what the move before took); when the side only recaptures, its
 * most valuable recapture (taking back with profit: a rook won for a knight). Null when the
 * side captures nothing.
 */
function decisiveCapture(line: Line, end: number): number | null {
  const { steps, side } = line;
  const pick = (recaptures: boolean) => {
    let decisive: number | null = null;
    for (let i = 0; i < end; i++) {
      const captured = steps[i]!.move.captured;
      const best = decisive === null ? undefined : steps[decisive]!.move.captured;
      if (steps[i]!.mover !== side || !captured || isRecapture(line, i) !== recaptures) continue;
      if (!best || rank(captured) > rank(best)) decisive = i;
    }
    return decisive;
  };
  return pick(false) ?? pick(true);
}

/**
 * Whether the line's gain can be told as the capture at step `i`'s ("Rxg6 wins the
 * exchange"): no material changed hands in the line before it, the capture (with the reply
 * that takes back on its square, if any) wins at least half of the line's gain, and the
 * side wins nothing more afterwards (it may give a little back). A capture after a
 * promotion, a trade, or one that is followed by further gains is not the story.
 */
function captureAccountsFor(line: Line, i: number): boolean {
  const { steps, side } = line;
  const step = steps[i]!;
  const reply = steps[i + 1];
  const end = reply?.move.captured && reply.to === step.to ? i + 1 : i;
  const after = (k: number) => sideMaterial(steps[k]!.move.after, side);
  // Taking back what the move before the line captured only completes that trade.
  const first = i > 0 && isRecapture(line, 0) ? 1 : 0;
  const start = sideMaterial(steps[first]!.move.before, side);
  if (sideMaterial(step.move.before, side) !== start) return false;
  const total = after(steps.length - 1) - sideMaterial(line.startFen, side);
  if (2 * (after(end) - start) < total) return false;
  for (let k = end + 1; k < steps.length; k++) if (after(k) > after(k - 1)) return false;
  return true;
}

interface PayoffContext {
  steps: Step[];
  i: number;
  end: number;
  side: Color;
  /** Material the side gains from this move to the end of the shown line. */
  gain: number;
  /** Whether the shown line ends in the side's checkmate. */
  mates: boolean;
  /** Whether the move takes back on the square the move before it captured on. */
  recapture: boolean;
}

function paysOff(found: Found, context: PayoffContext): boolean {
  const { steps, i, end, side, gain, mates } = context;
  switch (found.type) {
    case 'checkmate':
    case 'back-rank-mate':
      return true;
    case 'promotion':
    case 'double-check':
    case 'discovered-check':
      return mates || gain >= 1;
    case 'hanging-piece':
      return gain >= 1 && !context.recapture;
    default:
      // Fork, pin, skewer, discovered attack: one of the targets must actually fall.
      return (
        gain >= 1 &&
        steps
          .slice(i + 1, end)
          .some(
            (step) =>
              step.mover === side &&
              found.subjects.some(
                (subject) =>
                  subject.type !== 'k' &&
                  step.to === subject.square &&
                  step.move.captured === subject.type,
              ),
          )
      );
  }
}

function capturedOn(step: Step | undefined): number | null {
  return step?.move.captured ? step.to : null;
}

/** The destination of a capture in SAN ("Bxf6", "exd8=Q+"), or null for other moves. */
function captureSquareOfSan(san: string | undefined): Square | null {
  if (!san?.includes('x')) return null;
  const squares = san.match(/[a-h][1-8]/g);
  return (squares?.at(-1) as Square | undefined) ?? null;
}

interface Sacrifice {
  piece: PieceSymbol;
  square: number;
  exchange: boolean;
}

/**
 * The side's first move gives material away when the reply captures and the side is at
 * least THRESHOLDS.brilliant.minSacrifice down afterwards, and still after its next move
 * (unless that move mates): material won straight back is a trade, not a sacrifice.
 *
 * Giving up material is no choice, so no sacrifice, when the first move answers a check,
 * takes back what the move before the line captured, or leaves a piece to be taken that
 * stood where it was and could already be won. Nor is it one, in a refutation, when the
 * player does not come out behind: the opponent's "sacrifice" then does not work.
 */
function findSacrifice(
  line: Line,
  kind: LineStory['kind'],
  materialSwing: number,
): Sacrifice | null {
  const { steps, side } = line;
  const [first, reply, answer] = steps;
  if (!first || !reply || first.mover !== side || !reply.move.captured) return null;
  if (kind === 'refutation' && materialSwing >= 0 && !steps.at(-1)?.checkmate) return null;
  const start = sideMaterial(first.move.before, side);
  const down = start - sideMaterial(reply.move.after, side);
  if (down < THRESHOLDS.brilliant.minSacrifice) return null;
  if (answer && !answer.checkmate) {
    if (start - sideMaterial(answer.move.after, side) < THRESHOLDS.brilliant.minSacrifice) {
      return null;
    }
  }
  const king = findKing(first.before, side);
  if (king !== null && attackersOf(first.before, king, opposite(side)).length > 0) return null;
  if (isRecapture(line, 0)) return null;
  const victim = first.before[reply.to];
  const stayed = !first.landed.includes(reply.to) && victim?.color === side;
  if (stayed && exchangeGain(first.before, reply.to, opposite(side)) > 0) return null;
  const piece = reply.move.captured;
  const exchange = piece === 'r' && down === PIECE_VALUES.r - PIECE_VALUES.n;
  return { piece, square: reply.to, exchange };
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const NUMBER_WORDS = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

type Owner = 'the' | 'your';
type Form = 'verb' | 'gerund';

const VERBS: Record<MotifType, { verb: string; gerund: string }> = {
  fork: { verb: 'forks', gerund: 'forking' },
  pin: { verb: 'pins', gerund: 'pinning' },
  skewer: { verb: 'skewers', gerund: 'skewering' },
  'discovered-attack': { verb: 'uncovers', gerund: 'uncovering' },
  'discovered-check': { verb: 'gives', gerund: 'giving' },
  'double-check': { verb: 'gives', gerund: 'giving' },
  'hanging-piece': { verb: 'wins', gerund: 'winning' },
  'trapped-piece': { verb: 'traps', gerund: 'trapping' },
  promotion: { verb: 'makes', gerund: 'making' },
  checkmate: { verb: 'delivers', gerund: 'delivering' },
  'back-rank-mate': { verb: 'delivers', gerund: 'delivering' },
};

function countOf(count: number, name: string): string {
  return count === 1 ? `a ${name}` : `${NUMBER_WORDS[count] ?? count} ${name}s`;
}

/** "the king and queen", "both your rooks", "the king and two rooks". */
function pieceList(types: PieceSymbol[], owner: Owner): string {
  const first = types[0];
  if (types.length === 2 && first !== undefined && types.every((type) => type === first)) {
    return `both ${owner === 'your' ? 'your ' : ''}${PIECE_NAMES[first]}s`;
  }
  const groups = [...new Set(types)].map((type) => {
    const count = types.filter((other) => other === type).length;
    return count === 1
      ? PIECE_NAMES[type]
      : `${NUMBER_WORDS[count] ?? count} ${PIECE_NAMES[type]}s`;
  });
  const joined =
    groups.length === 1 ? groups[0] : `${groups.slice(0, -1).join(', ')} and ${groups.at(-1)}`;
  return `${owner} ${joined}`;
}

/** "forks the king and queen", "pinning your knight to your queen"... */
function motifPhrase(found: Found, owner: Owner, form: Form): string {
  const verb = VERBS[found.type][form];
  const [first, second] = found.subjects;
  const name = (subject: Subject | undefined) => (subject ? PIECE_NAMES[subject.type] : 'piece');
  switch (found.type) {
    case 'fork':
      return `${verb} ${pieceList(
        found.subjects.map((subject) => subject.type),
        owner,
      )}`;
    case 'pin':
      return `${verb} ${owner} ${name(first)} to ${owner} ${name(second)}`;
    case 'skewer':
      return `${verb} ${pieceList([first?.type ?? 'k', second?.type ?? 'p'], owner)}`;
    case 'discovered-attack':
      return `${verb} an attack on ${owner} ${name(first)}`;
    case 'discovered-check':
      return `${verb} a discovered check`;
    case 'double-check':
      return `${verb} a double check`;
    case 'hanging-piece': {
      const where = first ? ` on ${squareOf(first.square)}` : '';
      return `${verb} ${owner} ${found.undefended ? 'undefended ' : ''}${name(first)}${where}`;
    }
    case 'trapped-piece':
      return `${verb} ${owner} ${name(first)}`;
    case 'promotion':
      return `${verb} a new ${PIECE_NAMES[found.promoted ?? 'q']}`;
    case 'checkmate':
      return `${verb} checkmate`;
    case 'back-rank-mate':
      return `${verb} a back-rank mate`;
  }
}

/** Motifs whose phrase already says what is won, so no "and wins ..." follows. */
function isSelfContained(type: MotifType): boolean {
  return type === 'hanging-piece' || type === 'promotion' || type === 'trapped-piece';
}

type Material = Record<'p' | 'n' | 'b' | 'r' | 'q', number>;
const PIECES_BY_VALUE = ['q', 'r', 'b', 'n'] as const;

/** `side`'s piece count minus the opponent's, by type. */
function pieceDifference(fen: string, side: Color): Material {
  const difference: Material = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const char of fen.split(' ')[0] ?? '') {
    const type = char.toLowerCase();
    if (!(type in difference)) continue; // kings, digits and slashes
    const isSide = (char !== type) === (side === 'w');
    difference[type as keyof Material] += isSide ? 1 : -1;
  }
  return difference;
}

interface Winnings {
  /** "the queen", "the exchange", "the queen for a knight", "a rook and a pawn"... */
  noun: string;
  /** The same as a margin, for "you come out ... ahead" ("a piece"); null when pieces went back. */
  margin: string | null;
}

/**
 * What `side` won between two positions. Null when the side did not come out at least a
 * pawn ahead. Knights won for bishops cancel out.
 */
function winnings(fromFen: string, toFen: string, side: Color): Winnings | null {
  const before = pieceDifference(fromFen, side);
  const after = pieceDifference(toFen, side);
  const won: Material = {
    p: after.p - before.p,
    n: after.n - before.n,
    b: after.b - before.b,
    r: after.r - before.r,
    q: after.q - before.q,
  };
  if (won.n * won.b < 0) {
    const traded = Math.min(Math.abs(won.n), Math.abs(won.b));
    won.n -= Math.sign(won.n) * traded;
    won.b -= Math.sign(won.b) * traded;
  }
  const value = won.q * 9 + won.r * 5 + (won.n + won.b) * 3 + won.p;
  if (value < 1) return null;

  const gained = PIECES_BY_VALUE.filter((type) => won[type] > 0);
  const given = PIECES_BY_VALUE.filter((type) => won[type] < 0);
  if (gained.length === 0) {
    const pawns = countOf(won.p, 'pawn');
    if (given.length === 0) return { noun: pawns, margin: pawns };
    const back = given.map((type) => countOf(-won[type], PIECE_NAMES[type])).join(' and ');
    return { noun: `${pawns} for ${back}`, margin: null };
  }

  let noun: string;
  let margin: string;
  const minors = won.n + won.b;
  const top = gained[0]!;
  if (won.r === 1 && minors === -1 && won.q === 0 && gained.length === 1) {
    noun = margin = 'the exchange';
    given.length = 0;
  } else if (gained.every((type) => type === 'n' || type === 'b')) {
    noun = minors === 1 ? `the ${PIECE_NAMES[top]}` : `${NUMBER_WORDS[minors] ?? minors} pieces`;
    margin = minors === 1 ? 'a piece' : noun;
  } else if (gained.length === 1 && won[top] === 1) {
    noun = `the ${PIECE_NAMES[top]}`;
    margin = countOf(1, PIECE_NAMES[top]);
  } else {
    noun = margin = gained.map((type) => countOf(won[type], PIECE_NAMES[type])).join(' and ');
  }

  // Pawns won count too when pieces went back: "the queen and a pawn for a rook".
  const pawnsWon = won.p > 0 ? countOf(won.p, 'pawn') : null;
  const back = given.map((type) => countOf(-won[type], PIECE_NAMES[type]));
  if (won.p < 0) back.push(countOf(-won.p, 'pawn'));
  const withPawns = pawnsWon ? `${noun} and ${pawnsWon}` : noun;
  if (back.length > 0) return { noun: `${withPawns} for ${back.join(' and ')}`, margin: null };
  return { noun: withPawns, margin: pawnsWon ? `${margin} and ${pawnsWon}` : margin };
}

interface StoryInput {
  kind: LineStory['kind'];
  /** The shown line. */
  line: Line;
  /** The motifs that pay off within the shown line (see keptMotifs). */
  kept: Kept[];
  mateKind: 'back-rank' | 'plain';
  sacrifice: Sacrifice | null;
  /** Material won (+) or lost (-) by the player over the shown line. */
  materialSwing: number;
}

/** Longest run of moves spelled out inside a sentence; longer runs read "a few moves later". */
const MAX_LISTED_MOVES = 4;

function writeStory(input: StoryInput): string {
  const { steps, side } = input.line;
  const last = steps.at(-1);
  if (last?.checkmate && last.mover === side) return mateText(input);
  // The story leads with the strongest motif that explains what the line wins.
  const main = mainMotif(
    input.kept.filter((motif) => explainsGain(input, motif) && !winsBack(input, motif)),
  );
  return (main && motifText(input, main)) ?? materialText(input) ?? neutralText(input);
}

/**
 * Whether a capture or promotion later in the line only wins back a piece the side lost
 * earlier in it: "Bxc3 wins the queen" after the side's own queen fell is no story (a pawn
 * given up on the way is: "Qxh8 wins the rook").
 */
function winsBack({ line }: StoryInput, motif: Kept): boolean {
  const { steps, side } = line;
  const step = steps[motif.step];
  if (!isSelfContained(motif.type) || motif.step === 0 || !step) return false;
  return pieceMaterial(step.move.before, side) < pieceMaterial(steps[0]!.move.before, side);
}

/** `side`'s material balance in pieces only (no pawns), in pawn units. */
function pieceMaterial(fen: string, side: Color): number {
  const difference = pieceDifference(fen, side);
  return PIECES_BY_VALUE.reduce((sum, type) => sum + difference[type] * PIECE_VALUES[type], 0);
}

/**
 * Whether the line from the motif on wins at least half of what the side wins over the
 * whole line: a pawn picked up at the end of a line that wins a rook earlier is not its
 * story. (A capture that only starts the winning sequence is completed by laterWinnings.)
 */
function explainsGain({ line }: StoryInput, motif: Kept): boolean {
  const { steps, side, startFen } = line;
  const end = sideMaterial(steps.at(-1)!.move.after, side);
  const fromMotif = end - sideMaterial(steps[motif.step]!.move.before, side);
  return 2 * fromMotif >= end - sideMaterial(startFen, side);
}

/** Material a capture or a promotion wins by itself: the piece taken, or the new piece. */
function ownGain(motif: Found): number {
  if (motif.type === 'promotion') return PIECE_VALUES[motif.promoted ?? 'q'] - PIECE_VALUES.p;
  const victim = motif.subjects[0];
  return victim && victim.type !== 'k' ? PIECE_VALUES[victim.type] : 0;
}

/**
 * What the line wins after a capture or promotion that is only its start ("Bxb7 wins the
 * pawn on b7 and then the exchange"): null unless the move's own gain is less than half of
 * what the side wins from that move to the end of the line.
 */
function laterWinnings({ line }: StoryInput, motif: Kept): string | null {
  const { steps, side } = line;
  const step = steps[motif.step];
  const last = steps.at(-1);
  if (!isSelfContained(motif.type) || !step || !last) return null;
  const total = sideMaterial(last.move.after, side) - sideMaterial(step.move.before, side);
  if (2 * ownGain(motif) >= total) return null;
  return winnings(step.move.after, last.move.after, side)?.noun ?? null;
}

function sanRange(steps: Step[], from: number, to: number): string {
  return steps
    .slice(from, to)
    .map((step) => step.san)
    .join(' ');
}

function sacrificeName({ piece, square, exchange }: Sacrifice): string {
  const what = exchange ? 'the exchange' : `the ${PIECE_NAMES[piece]}`;
  return `${what} on ${squareOf(square)}`;
}

/**
 * How a sentence reaches step `k` (k >= 1) of the line, ready for a clause such as
 * "Nf6+ forks the king and queen": "After Kxh7, ", "You sacrifice the rook on h7: after
 * Kxh7, ", "You missed Ba3: a few moves later, "...
 */
function lead({ kind, line, sacrifice }: StoryInput, k: number): string {
  const { steps } = line;
  const first = steps[0]!.san;
  const from = sacrifice || kind === 'missed' ? 1 : 0;
  const listed = k - from <= MAX_LISTED_MOVES;
  const moves = sanRange(steps, from, k);
  if (kind === 'missed') {
    const what = `${MISSED_PREFIX}${sacrifice ? `the sacrifice ${first}` : first}`;
    return listed ? `${what}: after ${moves}, ` : `${what}: a few moves later, `;
  }
  if (sacrifice) {
    const who = kind === 'refutation' ? 'Your opponent sacrifices' : 'You sacrifice';
    const name = sacrificeName(sacrifice);
    return listed ? `${who} ${name}: after ${moves}, ` : `${who} ${name}, and a few moves later `;
  }
  return listed ? `After ${moves}, ` : `After ${first} and a few more moves, `;
}

function mateText({ kind, line, sacrifice, mateKind }: StoryInput): string {
  const { steps } = line;
  const last = steps.at(-1)!;
  const moves = steps.filter((step) => step.mover === last.mover).length;
  const first = steps[0]!.san;
  const all = sanRange(steps, 0, steps.length);
  const listed = moves <= MAX_LISTED_MATE;
  const backRank = mateKind === 'back-rank';

  if (kind === 'refutation' || kind === 'missed') {
    const start = kind === 'refutation' ? 'This allows' : 'You had';
    if (moves === 1) return `${start} mate in 1 with ${first}.`;
    if (backRank && listed) return `${start} a back-rank mate: ${all}.`;
    if (listed) return `${start} mate in ${moves}: ${all}.`;
    return `${start} mate in ${moves}, starting with ${first}.`;
  }

  const rest = sanRange(steps, 1, steps.length);
  if (sacrifice) {
    const name = sacrificeName(sacrifice);
    if (moves === 2) {
      const mate = backRank ? 'a back-rank mate' : 'checkmate';
      return `You sacrifice ${name}: after ${steps[1]!.san}, ${last.san} is ${mate}.`;
    }
    return listed
      ? `You sacrifice ${name} and force mate in ${moves}: ${rest}.`
      : `You sacrifice ${name} and force mate in ${moves}.`;
  }
  if (moves === 1) return `${first} is checkmate.`;
  if (listed) return `${first} forces mate in ${moves}: ${rest}.`;
  return `${first} starts a forced mate in ${moves}.`;
}

function motifText(input: StoryInput, main: Kept): string | null {
  const { kind, line } = input;
  const { steps, side } = line;
  const step = steps[main.step];
  const last = steps.at(-1);
  if (!step || !last) return null;
  const k = main.step;
  const owner: Owner = kind === 'refutation' ? 'your' : 'the';
  const won = isSelfContained(main.type)
    ? null
    : winnings(step.move.before, last.move.after, side)?.noun;
  const later = laterWinnings(input, main);
  const then = later ? ` and then ${main.type === 'hanging-piece' ? '' : 'wins '}${later}` : '';
  const wins = won ? ` and wins ${won}` : then;
  const verb = motifPhrase(main, owner, 'verb');
  const clause = `${step.san} ${verb}${wins}`;

  if (k > 0) return `${lead(input, k)}${clause}.`;
  if (kind === 'idea') return `${clause}.`;
  if (kind === 'missed') return `${MISSED_PREFIX}${step.san}, which ${verb}${wins}.`;

  const victim = main.subjects[0];
  // Everything the move left en prise is simply gone: "takes it for free".
  if (main.type === 'hanging-piece' && main.undefended && victim && victim.type !== 'k') {
    if (-input.materialSwing >= PIECE_VALUES[victim.type]) {
      const where = `${PIECE_NAMES[victim.type]} on ${squareOf(victim.square)}`;
      const free = `${step.san} takes it for free${later ? ` and then wins ${later}` : ''}`;
      // A piece that could already be taken before the move was not left by it, only not saved.
      return wasAlreadyHanging(line, victim)
        ? `Your ${where} is still hanging: ${free}.`
        : `This leaves your ${where} unprotected: ${free}.`;
    }
  }
  if (isSelfContained(main.type)) return `Your opponent replies ${step.san} and ${verb}${then}.`;
  const gerund = motifPhrase(main, owner, 'gerund');
  return `Your opponent replies ${step.san}, ${gerund}${won ? `, and wins ${won}` : ''}.`;
}

/**
 * Whether the player's piece on `victim`'s square already stood there, and could already be
 * won, in the position before the reviewed move (line.startFen, when it is a different one).
 */
function wasAlreadyHanging(line: Line, victim: Subject): boolean {
  const first = line.steps[0];
  if (!first || line.startFen.split(' ')[0] === first.move.before.split(' ')[0]) return false;
  const board = readBoard(line.startFen);
  const piece = board[victim.square];
  if (piece?.type !== victim.type || piece.color === line.side) return false;
  return exchangeGain(board, victim.square, line.side) > 0;
}

/**
 * The material the line wins when no motif tells the story: "Your opponent replies Nxe5
 * and wins a pawn." for a single capture that wins it, "..., you come out a piece ahead."
 * otherwise.
 */
function materialText(input: StoryInput): string | null {
  const { kind, line, sacrifice } = input;
  const { steps, side } = line;
  const first = steps[0]!;
  const last = steps.at(-1)!;
  const won = winnings(line.startFen, last.move.after, side);
  if (!won) return sacrifice ? sacrificeOnly(input, sacrifice) : null;
  if (kind === 'missed') return `${MISSED_PREFIX}${first.san}, which wins ${won.noun}.`;

  const decisive = decisiveCapture(line, steps.length);
  const capture = decisive === null ? undefined : steps[decisive];
  const captures = steps.filter(
    (step, i) =>
      step.mover === side && step.move.captured && (i === decisive || !isRecapture(line, i)),
  ).length;
  if (decisive !== null && capture && captures === 1 && captureAccountsFor(line, decisive)) {
    if (decisive > 0) return `${lead(input, decisive)}${capture.san} wins ${won.noun}.`;
    if (kind === 'refutation') return `Your opponent replies ${capture.san} and wins ${won.noun}.`;
    return `${capture.san} wins ${won.noun}.`;
  }
  const opponent = kind === 'refutation';
  const outcome = won.margin
    ? `${opponent ? 'your opponent comes' : 'you come'} out ${won.margin} ahead`
    : `${opponent ? 'your opponent wins' : 'you win'} ${won.noun}`;
  return `${lead(input, steps.length)}${outcome}.`;
}

function sacrificeOnly({ kind }: StoryInput, sacrifice: Sacrifice): string | null {
  if (kind === 'idea') return `You sacrifice ${sacrificeName(sacrifice)}.`;
  if (kind === 'refutation') return `Your opponent sacrifices ${sacrificeName(sacrifice)}.`;
  return null;
}

function neutralText({ kind, line }: StoryInput): string {
  const first = line.steps[0]!.san;
  if (kind === 'refutation') return `Your opponent's best reply is ${first}.`;
  if (kind === 'idea') return `${first} is the strongest move here.`;
  return `${first} was the strongest move.`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function loadPosition(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null; // invalid FEN
  }
}

/** `side`'s material balance in pawn units (side minus opponent). */
function sideMaterial(fen: string, side: Color): number {
  const balance = materialBalance(fen);
  return side === 'w' ? balance : -balance;
}

function opposite(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}
