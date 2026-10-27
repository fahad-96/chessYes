import { Chess } from 'chess.js';
import type { Move } from 'chess.js';
import { materialBalance } from './material';
import { parseUci } from './notation';
import { bestMoveSentence } from './tactics';
import { PIECE_VALUES } from './thresholds';
import type {
  Classification,
  Color,
  LineStory,
  PieceSymbol,
  SacrificeInfo,
  Score,
  Square,
  SuggestedLine,
} from './types';
import { scoreToWinPercent, winPercentFor } from './winPercent';

export interface ExplainInput {
  classification: Classification;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  winBefore: number;
  winAfter: number;
  /** Evaluation (White POV) after the move; null when the game ended with it. */
  evalAfter: Score | null;
  /** Evaluation (White POV) of the best line before the move. */
  evalBest: Score | null;
  best?: SuggestedLine;
  secondBest?: SuggestedLine;
  /** Engine continuation after the played move (starts with the opponent's reply). */
  playedLine?: SuggestedLine;
  sacrifice?: SacrificeInfo;
  opening?: { eco: string; name: string };
  isCheckmate: boolean;
  /**
   * The line that shows why the move got its label (tactics.describeLine): the opponent's
   * refutation of an error, or the idea behind a good move.
   */
  why?: LineStory;
  /** For moves that were not the best: what the engine's best move would have achieved. */
  bestIdea?: LineStory;
  /**
   * Where material the better move wins is counted from, when not `fenBefore`: the position
   * before the opponent's capture that the move may take back (tactics.materialBaseline),
   * so that taking back is not called winning material.
   */
  baselineFen?: string;
}

/**
 * Plain-English explanation of a move, 1-3 short sentences, no jargon beyond
 * standard chess terms. Rule-based (no AI): it leads with the story of the line when
 * there is one (a fork, a pin, a hanging piece, a mate: see tactics.describeLine), and
 * otherwise looks at mates for/against, material won or lost along the engine lines,
 * the sacrifice and the size of the swing. It always names the better move for
 * non-best moves, e.g. "Blunder. This leaves your rook on g8 unprotected: Bxg8 takes it
 * for free. Best was Rxg7, which wins the undefended pawn on g7."
 */
export function explainMove(input: ExplainInput): string {
  if (input.isCheckmate) return 'Checkmate! Well played.';
  switch (input.classification) {
    case 'book':
      return input.opening ? `Book move. This is the ${input.opening.name}.` : 'Book move.';
    case 'forced':
      return 'The only legal move.';
    case 'brilliant':
      return explainBrilliant(input);
    case 'great':
      return explainGreat(input);
    case 'best':
      return explainBest(input);
    case 'excellent':
    case 'good':
      return explainSoundMove(input);
    case 'inaccuracy':
    case 'mistake':
    case 'blunder':
    case 'missedWin':
      return explainError(input);
  }
}

/** Describes who is better from White's win %, e.g. "White is winning", "The position is equal". */
export function describeAdvantage(whiteWinPercent: number): string {
  const { side, level } = advantage(whiteWinPercent);
  if (!side) return 'The position is equal';
  return `${side === 'w' ? 'White' : 'Black'} is ${level}`;
}

// ---------------------------------------------------------------------------
// Who is better
// ---------------------------------------------------------------------------

type Level = 'winning' | 'clearly better' | 'slightly better' | 'equal';

/**
 * Where each standing starts, as a win % on the calibrated scale (winPercent.ts): winning
 * from about +4.7, clearly better from about +1.7, slightly better from about +0.6.
 */
const STANDING = { winning: 72, clearlyBetter: 58, slightlyBetter: 53 } as const;

/** The describeAdvantage buckets; `side` is null when the position is equal. */
function advantage(whiteWin: number): { side: Color | null; level: Level } {
  if (whiteWin >= STANDING.winning) return { side: 'w', level: 'winning' };
  if (whiteWin >= STANDING.clearlyBetter) return { side: 'w', level: 'clearly better' };
  if (whiteWin >= STANDING.slightlyBetter) return { side: 'w', level: 'slightly better' };
  if (whiteWin > 100 - STANDING.slightlyBetter) return { side: null, level: 'equal' };
  if (whiteWin > 100 - STANDING.clearlyBetter) return { side: 'b', level: 'slightly better' };
  if (whiteWin > 100 - STANDING.winning) return { side: 'b', level: 'clearly better' };
  return { side: 'b', level: 'winning' };
}

type Tense = 'present' | 'past' | 'conditional';

const VERBS: Record<Tense, { you: string; it: string }> = {
  present: { you: 'are', it: 'is' },
  past: { you: 'were', it: 'was' },
  conditional: { you: 'would be', it: 'would be' },
};

/**
 * The mover's standing in the second person, e.g. "you are clearly better",
 * "the position was equal", "your opponent would be winning".
 * With `only`, a small advantage reads "you are only slightly better".
 */
function standing(moverWin: number, tense: Tense, { only = false } = {}): string {
  // Passing the mover's win % where White's is expected makes side 'w' mean the mover.
  const { side, level } = advantage(moverWin);
  const verb = VERBS[tense];
  if (!side) return `the position ${verb.it} equal`;
  if (side === 'b') return `your opponent ${verb.it} ${level}`;
  return `you ${verb.you} ${only && level === 'slightly better' ? 'only ' : ''}${level}`;
}

/** Bucket of a win % from the mover's side: 3 = winning ... 0 = equal ... -3 = losing. */
function standingRank(moverWin: number): number {
  const { side, level } = advantage(moverWin);
  const size = { winning: 3, 'clearly better': 2, 'slightly better': 1, equal: 0 }[level];
  return side === 'b' ? -size : size;
}

// ---------------------------------------------------------------------------
// Explanations per label
// ---------------------------------------------------------------------------

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const ERROR_LABELS: Partial<Record<Classification, string>> = {
  inaccuracy: 'Inaccuracy.',
  mistake: 'Mistake.',
  blunder: 'Blunder.',
  missedWin: 'Miss.',
};

function explainBrilliant(input: ExplainInput): string {
  const { sacrifice, why } = input;
  // The line itself when it shows the sacrifice taken and what it leads to (describeLine
  // opens with "You sacrifice" when the reply takes the piece and it is not won back).
  if (ideaPays(why) && why.text.startsWith('You sacrifice')) return `Brilliant! ${why.text}`;
  const intro = sacrifice ? `Brilliant! ${describeSacrifice(sacrifice, input.uci)}` : 'Brilliant!';

  const mate = mateFor(input.evalAfter ?? input.playedLine?.score, input.color);
  if (mate) return `${intro} ${mateFollows(mate)}`;

  const reply = parseUci(input.playedLine?.pvUci[0] ?? '');
  const outlook = standing(input.winAfter, 'present');
  if (sacrifice && reply && reply.to !== sacrifice.square) {
    return `${intro} Your opponent does best not to take it, and ${outlook}.`;
  }
  return `${intro} It is sound: ${outlook}.`;
}

function describeSacrifice({ piece, square, material }: SacrificeInfo, uci: string): string {
  if (piece === 'r' && material === PIECE_VALUES.r - PIECE_VALUES.n) {
    return `You sacrifice the exchange on ${square}.`;
  }
  // The offered piece is not always the one that moved (a defender can step away).
  const verb = parseUci(uci)?.to === square ? 'sacrifice' : 'offer';
  return `You ${verb} your ${PIECE_NAMES[piece]} on ${square}.`;
}

function explainGreat(input: ExplainInput): string {
  const keeps =
    input.winAfter >= STANDING.winning
      ? 'keeps you winning'
      : input.winAfter >= STANDING.slightlyBetter
        ? 'keeps your advantage'
        : input.winAfter > 100 - STANDING.slightlyBetter
          ? 'keeps the balance'
          : 'keeps you in the game';
  if (ideaPays(input.why)) {
    return `Great move! ${input.why.text} It is the only move that ${keeps}.`;
  }
  const first = `Great move! This is the only move that ${keeps}.`;
  return input.secondBest ? `${first} ${describeAlternative(input, input.secondBest)}` : first;
}

/** What the engine's second choice would have allowed, for "Great" moves. */
function describeAlternative(input: ExplainInput, second: SuggestedLine): string {
  const mate = mateFor(second.score, opposite(input.color));
  if (mate) return `${second.san} would allow mate in ${mate}.`;

  const picture = materialPicture(input);
  const secondEnd = settleLine(input.fenBefore, second.pvUci, input.color);
  const loss = picture && secondEnd ? lossComparedWithBest(picture, secondEnd, input.color) : null;
  // A single pawn rarely explains why only one move works; the swing says more.
  if (loss && loss.amount >= 2) return `${second.san} would lose ${loss.noun}.`;

  const secondWin = winPercentFor(scoreToWinPercent(second.score), input.color);
  return `After ${second.san} instead, ${standing(secondWin, 'conditional', { only: true })}.`;
}

function explainBest(input: ExplainInput): string {
  if (ideaPays(input.why)) return `Best move. ${input.why.text}`;
  const mate = mateFor(input.evalAfter, input.color);
  if (mate) return `Best move. ${mateFollows(mate)}`;
  if (loadPosition(input.fenAfter)?.isStalemate()) {
    return 'Best move. It is stalemate, so the game is drawn.';
  }
  return 'Best move.';
}

function explainSoundMove(input: ExplainInput): string {
  const best = input.best && input.best.san !== input.san ? input.best.san : null;
  if (input.classification === 'excellent') {
    if (ideaPays(input.why)) {
      const text = `Excellent move. ${input.why.text}`;
      return best ? `${text} ${best} was slightly stronger.` : text;
    }
    return best
      ? `Excellent move. The engine's top choice was ${best}, but this is almost as strong.`
      : 'Excellent move.';
  }
  return best ? `Good move, though ${best} was more precise.` : 'Good move.';
}

function explainError(input: ExplainInput): string {
  const reason = findReason(input);
  const parts = [ERROR_LABELS[input.classification], reason.text];
  if (!reason.namesBest && input.best) parts.push(adviseBest(input, input.best));
  return parts.filter(Boolean).join(' ');
}

interface Reason {
  text: string;
  /** True when the sentence already names the better move. */
  namesBest: boolean;
}

/**
 * The most concrete reason a move was bad, checked in order: the game ends in a draw,
 * it allows mate, it throws away a mate, it loses material, it misses material,
 * and finally a plain description of the swing.
 */
function findReason(input: ExplainInput): Reason {
  const { color, best, playedLine } = input;

  const draw = drawnAfter(input.fenAfter);
  if (draw) return { text: draw, namesBest: false };

  const mateAgainst = mateFor(input.evalAfter ?? playedLine?.score, opposite(color));
  if (mateAgainst) {
    const wasLosing = mateFor(input.evalBest ?? best?.score, opposite(color)) !== null;
    // The mating line move by move, when the story shows the mate the engine announces.
    if (!wasLosing && input.why?.mateIn === mateAgainst) {
      return { text: input.why.text, namesBest: false };
    }
    return { text: allowsMate(mateAgainst, playedLine?.san, wasLosing), namesBest: false };
  }

  const mateBefore = mateFor(input.evalBest ?? best?.score, color);
  if (mateBefore && best) {
    const stillMating = mateFor(input.evalAfter, color) !== null;
    if (!stillMating && input.bestIdea?.mateIn === mateBefore) {
      return { text: input.bestIdea.text, namesBest: true };
    }
    return { text: missedMate(mateBefore, best.san, stillMating), namesBest: true };
  }

  return (
    storyReason(input) ?? materialReason(input) ?? { text: describeSwing(input), namesBest: false }
  );
}

/** Whether an idea story shows a payoff worth telling: a mate, a tactic or material won. */
function ideaPays(story: LineStory | undefined): story is LineStory {
  if (story?.kind !== 'idea') return false;
  return story.mateIn !== undefined || story.motifs.length > 0 || story.materialSwing >= 1;
}

/** Whether a 'missed' story names something concrete the best move achieves. */
function missedPays(story: LineStory | undefined): story is LineStory {
  return story?.kind === 'missed' && (story.motifs.length > 0 || story.materialSwing >= 1);
}

/**
 * The refutation, when it shows material lost that the best line keeps ("Your opponent
 * replies Nd5+, forking your king and queen, and wins the queen."), or else the missed
 * idea, when the best line wins material the played line does not.
 */
function storyReason(input: ExplainInput): Reason | null {
  const { why, bestIdea, color } = input;
  const picture = materialPicture(input);
  if (!picture) return null;
  if (why?.kind === 'refutation' && (why.motifs.length > 0 || why.materialSwing <= -1)) {
    const end = lineEnd(why);
    const line = end ? { fen: end, material: moverMaterial(end, color) } : null;
    if (line && lossComparedWithBest(picture, line, color)) {
      return { text: why.text, namesBest: false };
    }
  }
  if (missedPays(bestIdea)) {
    const played = settleLine(input.fenAfter, input.playedLine?.pvUci ?? [], color);
    if (played && picture.best.material - played.material >= 1) {
      return { text: bestIdea.text, namesBest: true };
    }
  }
  return null;
}

/** Stories are reused across rebuilds of a review, so their end positions are too. */
const lineEnds = new WeakMap<LineStory, string | null>();

/** The position at the end of a story's shown line, or null if it cannot be replayed. */
function lineEnd(story: LineStory): string | null {
  if (lineEnds.has(story)) return lineEnds.get(story) ?? null;
  const chess = loadPosition(story.fen);
  let fen: string | null = null;
  if (chess && story.movesUci.every((uci) => playUci(chess, uci))) fen = chess.fen();
  lineEnds.set(story, fen);
  return fen;
}

function allowsMate(moves: number, firstSan: string | undefined, wasLosing: boolean): string {
  const start = firstSan ? `, starting with ${firstSan}` : '';
  if (wasLosing) return `This speeds up the mate: now it is mate in ${moves}${start}.`;
  if (moves === 1) {
    return firstSan ? `This allows mate in 1 with ${firstSan}.` : 'This allows mate in 1.';
  }
  return `This allows a forced mate in ${moves}${start}.`;
}

function missedMate(moves: number, bestSan: string, stillMating: boolean): string {
  if (stillMating) return `You had a faster mate: mate in ${moves} with ${bestSan}.`;
  return moves === 1
    ? `You had mate in 1 with ${bestSan}.`
    : `You had a forced mate in ${moves}, starting with ${bestSan}.`;
}

/** Material the played line loses, or material the best line wins that it does not. */
function materialReason(input: ExplainInput): Reason | null {
  const picture = materialPicture(input);
  const played = settleLine(input.fenAfter, input.playedLine?.pvUci ?? [], input.color);
  if (!picture || !played) return null;

  const loss = lossComparedWithBest(picture, played, input.color);
  if (loss) return { text: describeLoss(input, loss, played), namesBest: false };

  // Only blame the move for material the best line would have won.
  const gain = missedGain(input, picture, played);
  if (input.best && gain) {
    return { text: `You missed ${input.best.san}, which wins ${gain}.`, namesBest: true };
  }
  return null;
}

/**
 * What the best line wins, counted from the baseline (ExplainInput.baselineFen), when it
 * also wins more than the played line: "a pawn", "the exchange"... or null.
 */
function missedGain(
  input: ExplainInput,
  { best }: MaterialPicture,
  played: SettledLine | null,
): string | null {
  const baselineFen = input.baselineFen ?? input.fenBefore;
  if (best.material - moverMaterial(baselineFen, input.color) < 1) return null;
  if (played && best.material - played.material < 1) return null;
  return gainNoun(baselineFen, best.fen, input.color);
}

/** "This hangs your knight on f5: exf5 wins it." or "This loses the exchange after Nc7+." */
function describeLoss(input: ExplainInput, loss: Loss, played: SettledLine): string {
  const { color, playedLine } = input;
  const reply = parseUci(playedLine?.pvUci[0] ?? '');
  const replySan = playedLine?.san;
  if (!reply || !replySan) return `This loses ${loss.noun}.`;

  const victim = pieceAt(input.fenAfter, reply.to);
  const playedTo = parseUci(input.uci)?.to;
  // Taking back on the square the move just captured on is a bad trade, not a hanging piece.
  const isRecapture = playedTo === reply.to && pieceAt(input.fenBefore, playedTo) !== null;
  if (victim && victim.color === color && !isRecapture) {
    const { type } = victim;
    // The captured piece must be what is actually lost, not something traded back.
    const change = materialChange(loss.referenceFen, played.fen, color);
    if (type === 'p' && loss.amount === 1 && change.p <= -1) {
      // A pawn taken back at once (exd5 cxd5) is a trade; the lost pawn is another one.
      const takenBack = parseUci(playedLine?.pvUci[1] ?? '')?.to === reply.to;
      if (!takenBack) return `This loses the pawn on ${reply.to} to ${replySan}.`;
    }
    if (type !== 'p' && type !== 'k') {
      // Knights and bishops are worth the same: a knight traded for a bishop is not lost.
      const lostOfType = type === 'n' || type === 'b' ? -(change.n + change.b) : -change[type];
      if (lostOfType >= 1 && loss.amount >= PIECE_VALUES[type] / 2) {
        return `This hangs your ${PIECE_NAMES[type]} on ${reply.to}: ${replySan} wins it.`;
      }
    }
  }
  return `This loses ${loss.noun} after ${replySan}.`;
}

/** Plain description of how the evaluation moved, from the mover's side. */
function describeSwing(input: ExplainInput): string {
  const { winBefore, winAfter } = input;
  if (input.classification === 'missedWin') {
    // A Miss can leave the mover well ahead (a mate let go for +10): "and now you are
    // winning" would read as praise.
    if (standingRank(winAfter) >= 2) {
      return `You let the chance slip, though you are still ${advantage(winAfter).level}.`;
    }
    return `You let the chance slip, and now ${standing(winAfter, 'present', { only: true })}.`;
  }
  const before = standingRank(winBefore);
  const after = standingRank(winAfter);
  const levelAfter = advantage(winAfter).level;
  if (before === after) {
    if (after > 0) return `You are still ${levelAfter}, but this gives away part of your edge.`;
    if (after < 0) return `Your opponent is still ${levelAfter}, and this makes defending harder.`;
    return 'The position is still roughly equal, but this gives away some of your chances.';
  }
  if (before < 0 && after < 0) {
    return `Your opponent was ${advantage(winBefore).level}; now they are ${levelAfter}.`;
  }
  return `${capitalize(standing(winBefore, 'past'))}, but now ${standing(winAfter, 'present', { only: true })}.`;
}

/** "Best was Nd2, keeping the position equal." */
function adviseBest(input: ExplainInput, best: SuggestedLine): string {
  const mate = mateFor(input.evalBest ?? best.score, input.color);
  const picture = mate ? null : materialPicture(input);
  const played = picture
    ? settleLine(input.fenAfter, input.playedLine?.pvUci ?? [], input.color)
    : null;
  // "Best was Nf6+, which forks the king and queen and wins the queen.", when the best line
  // wins more than the move played (both may simply take back the same piece).
  const beatsPlayed = !!picture && (!played || picture.best.material - played.material >= 1);
  const idea = beatsPlayed && missedPays(input.bestIdea) ? bestMoveSentence(input.bestIdea) : null;
  if (idea) return idea;
  const gain = picture ? missedGain(input, picture, played) : null;

  let why: string;
  if (mate) why = mate === 1 ? ', which is checkmate' : `, with mate in ${mate}`;
  else if (gain) why = `, which wins ${gain}`;
  else if (input.winBefore >= STANDING.winning) why = ', keeping a winning position';
  else if (input.winBefore >= STANDING.clearlyBetter) why = ', keeping a clear advantage';
  else if (input.winBefore >= STANDING.slightlyBetter) why = ', keeping a slight edge';
  else if (input.winBefore > 100 - STANDING.slightlyBetter) why = ', keeping the position equal';
  else why = ', the toughest defense';
  return `Best was ${best.san}${why}.`;
}

function mateFollows(moves: number): string {
  return moves === 1 ? 'Mate follows on the next move.' : `It forces mate in ${moves} more moves.`;
}

// ---------------------------------------------------------------------------
// Material along engine lines
// ---------------------------------------------------------------------------

/** How many plies of an engine line are read before measuring material. */
const LOOKAHEAD_PLIES = 6;
/** Extra plies allowed so a capture sequence still running at the horizon can finish. */
const EXCHANGE_GRACE_PLIES = 2;

interface SettledLine {
  /** Position where the material is measured. */
  fen: string;
  /** Mover's material balance there (pawn units, mover minus opponent). */
  material: number;
}

/** Material now and at the end of the engine's best line, both from the mover's side. */
interface MaterialPicture {
  start: SettledLine;
  best: SettledLine;
}

function materialPicture(input: ExplainInput): MaterialPicture | null {
  if (!loadPosition(input.fenBefore)) return null;
  const start = { fen: input.fenBefore, material: moverMaterial(input.fenBefore, input.color) };
  const best = input.best ? settleLine(input.fenBefore, input.best.pvUci, input.color) : null;
  return { start, best: best ?? start };
}

/**
 * Plays an engine line from `fen` and measures material at the last quiet position
 * within LOOKAHEAD_PLIES: the side to move is not in check and the line's next move is
 * not a capture, promotion or check (the end of a fully played line also counts).
 * Measuring at the last quiet point rather than the first means material that the
 * line wins back a few moves later is not reported as lost. If the horizon falls in
 * the middle of an exchange, up to EXCHANGE_GRACE_PLIES more plies let it finish.
 * Returns null when no quiet position is found or `fen` is invalid.
 */
function settleLine(fen: string, pv: readonly string[], mover: Color): SettledLine | null {
  const chess = loadPosition(fen);
  if (!chess) return null;

  const maxPlies = LOOKAHEAD_PLIES + EXCHANGE_GRACE_PLIES;
  const positions = [{ fen: chess.fen(), inCheck: chess.inCheck() }];
  // forcing[i]: whether the move played from positions[i] is a capture, promotion or check.
  const forcing: boolean[] = [];
  for (const uci of pv) {
    const move = playUci(chess, uci);
    if (!move) break; // the rest of the line is unusable here: treat this as its end
    forcing.push(Boolean(move.captured || move.promotion) || chess.inCheck());
    if (positions.length > maxPlies) break; // only needed to know if this move is forcing
    positions.push({ fen: chess.fen(), inCheck: chess.inCheck() });
  }

  const last = positions.length - 1;
  const isQuiet = (ply: number) => {
    const next = forcing[ply];
    return next === undefined || (!next && !positions[ply]?.inCheck);
  };

  const horizon = Math.min(LOOKAHEAD_PLIES, last);
  let settled = -1;
  for (let ply = 0; ply <= horizon; ply++) if (isQuiet(ply)) settled = ply;
  for (let ply = horizon + 1; settled < horizon && ply <= last; ply++) {
    if (isQuiet(ply)) settled = ply;
  }

  const position = positions[settled];
  return position ? { fen: position.fen, material: moverMaterial(position.fen, mover) } : null;
}

interface Loss {
  /** Pawn units lost. */
  amount: number;
  /** "your queen", "the exchange", "a pawn", ... */
  noun: string;
  /** Position the loss is measured against. */
  referenceFen: string;
}

/**
 * Material a line loses that the best line keeps. It is measured against the end of
 * the best line, so a sacrifice both lines make is not blamed on the move; when the
 * best line wins material, it is measured against the current position instead (the
 * missed gain is reported separately).
 */
function lossComparedWithBest(
  { start, best }: MaterialPicture,
  line: SettledLine,
  mover: Color,
): Loss | null {
  if (best.material - line.material < 1 || start.material - line.material < 1) return null;
  const reference = best.material > start.material ? start : best;
  const amount = reference.material - line.material;
  return {
    amount,
    noun: lossNoun(reference.fen, line.fen, mover),
    referenceFen: reference.fen,
  };
}

function moverMaterial(fen: string, color: Color): number {
  const balance = materialBalance(fen);
  return color === 'w' ? balance : -balance;
}

type Material = Record<'p' | 'n' | 'b' | 'r' | 'q', number>;

const PIECES_BY_VALUE = ['q', 'r', 'b', 'n'] as const;
const NUMBER_WORDS = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

/** The mover's piece count minus the opponent's, by type. */
function pieceDifference(fen: string, mover: Color): Material {
  const difference: Material = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const char of fen.split(' ')[0] ?? '') {
    const type = char.toLowerCase();
    if (!(type in difference)) continue; // kings, digits and slashes
    const isMover = (char !== type) === (mover === 'w');
    difference[type as keyof Material] += isMover ? 1 : -1;
  }
  return difference;
}

/**
 * How the material balance moved for the mover between two positions, piece by piece
 * (positive = the mover gained on that piece type). Looking at the balance rather than
 * at each side's losses turns "knight lost, two pawns won" into one trade.
 */
function materialChange(fromFen: string, toFen: string, mover: Color): Material {
  const before = pieceDifference(fromFen, mover);
  const after = pieceDifference(toFen, mover);
  return {
    p: after.p - before.p,
    n: after.n - before.n,
    b: after.b - before.b,
    r: after.r - before.r,
    q: after.q - before.q,
  };
}

function negate(material: Material): Material {
  return { p: -material.p, n: -material.n, b: -material.b, r: -material.r, q: -material.q };
}

function countOf(count: number, name: string): string {
  return count === 1 ? `a ${name}` : `${NUMBER_WORDS[count] ?? count} ${name}s`;
}

/**
 * Cancels minor pieces taken against minor pieces given back (knights and bishops are
 * worth the same), so a knight won for a bishop is no material at all.
 */
function netMinors(won: Material): Material {
  const traded = Math.min(Math.abs(won.n), Math.abs(won.b));
  if (traded === 0 || Math.sign(won.n) === Math.sign(won.b)) return won;
  const n = won.n - Math.sign(won.n) * traded;
  const b = won.b - Math.sign(won.b) * traded;
  return { ...won, n, b };
}

/** "a rook and a bishop": the pieces (not pawns) with a negative count. */
function piecesGivenBack(won: Material): string {
  return PIECES_BY_VALUE.filter((type) => won[type] < 0)
    .map((type) => countOf(-won[type], PIECE_NAMES[type]))
    .join(' and ');
}

/**
 * Names a material swing: "the queen", "a knight for a pawn", "the exchange", "two pawns".
 * `changed` holds what changes hands in the direction being described (positive = taken).
 */
function materialNoun(changed: Material, kind: 'gain' | 'loss'): string {
  const won = netMinors(changed);
  const top = PIECES_BY_VALUE.find((type) => won[type] > 0);
  if (!top) {
    const onlyPawns = PIECES_BY_VALUE.every((type) => won[type] === 0);
    return onlyPawns && won.p > 0 ? countOf(won.p, 'pawn') : 'material';
  }

  const minors = won.n + won.b;
  if (top === 'r' && won.r === 1 && minors === -1 && won.q >= 0) return 'the exchange';
  const queen =
    won.q === 1 ? (kind === 'gain' ? 'the queen' : 'your queen') : countOf(won.q, 'queen');
  const back = piecesGivenBack(won);
  if (back) return top === 'q' ? `${queen} for ${back}` : 'material';

  let noun: string;
  if (top === 'q') noun = queen;
  else if (top === 'r') noun = countOf(won.r, 'rook');
  else if (minors > 1) noun = `${NUMBER_WORDS[minors] ?? minors} pieces`;
  else if (kind === 'loss') noun = 'a piece';
  else noun = won.n > 0 ? 'a knight' : 'a bishop';

  if (won.p < 0) return `${noun} for ${countOf(-won.p, 'pawn')}`;
  if (won.p > 0) return `${noun} and ${countOf(won.p, 'pawn')}`;
  return noun;
}

/** What the mover gives up between two positions: "your queen", "a piece for two pawns", ... */
function lossNoun(fromFen: string, toFen: string, mover: Color): string {
  return materialNoun(negate(materialChange(fromFen, toFen, mover)), 'loss');
}

/** What the mover wins between two positions: "the queen", "a knight", "the exchange", ... */
function gainNoun(fromFen: string, toFen: string, mover: Color): string {
  return materialNoun(materialChange(fromFen, toFen, mover), 'gain');
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A sentence when the move ends the game in a draw on the board, else null. */
function drawnAfter(fen: string): string | null {
  const chess = loadPosition(fen);
  if (chess?.isStalemate()) return 'This stalemates your opponent, so the game is a draw.';
  if (chess?.isInsufficientMaterial()) {
    return 'This leaves too little material for either side to mate, so the game is a draw.';
  }
  return null;
}

function pieceAt(
  fen: string,
  square: Square | undefined,
): { type: PieceSymbol; color: Color } | null {
  if (!square) return null;
  return loadPosition(fen)?.get(square) ?? null;
}

function playUci(chess: Chess, uci: string): Move | null {
  const parsed = parseUci(uci);
  if (!parsed) return null;
  try {
    return chess.move(parsed);
  } catch {
    return null; // chess.js throws on illegal moves
  }
}

function loadPosition(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null; // invalid FEN
  }
}

/** Moves to mate for `color`, or null when the score is not a forced mate for that side. */
function mateFor(score: Score | null | undefined, color: Color): number | null {
  if (!score || score.type !== 'mate') return null;
  const moves = color === 'w' ? score.value : -score.value;
  return moves > 0 ? moves : null;
}

function opposite(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
