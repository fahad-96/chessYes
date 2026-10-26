/**
 * "Show why" on the board: what a story variation shows at each step (arrows for the
 * motif, rings for a trapped piece or a sacrifice, the caption under the board) and how
 * long auto-play dwells on it. Pure functions over a `Variation` of kind 'story', so they
 * are easy to test.
 */
import { Chess } from 'chess.js';
import type { BoardArrow } from '@/components/Board';
import type {
  Classification,
  Color,
  LineStory,
  Motif,
  ParsedMove,
  PieceSymbol,
  Square,
} from '@/core/types';
import { CLASSIFICATION_META } from '@/components/classificationMeta';
import { moveNumberLabel, positionKey } from '@/core/notation';
import type { StoryContext, Variation, VariationMove } from './variation';

/** Auto-play pause on an ordinary step of a story. */
export const STORY_STEP_MS = 1000;
/** Longer pause on the step where the motif appears, so its arrows can be taken in. */
export const STORY_MOTIF_STEP_MS = 1800;

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/**
 * Where a story starts in the game: after the reviewed move (a refutation, or an idea told
 * from the reply on), or before it (the better move, or an idea that begins with the move).
 */
export function storyStart(
  story: Pick<LineStory, 'fen'>,
  move: Pick<ParsedMove, 'ply' | 'fenAfter'>,
): { startPly: number; afterMove: boolean } {
  const afterMove = positionKey(story.fen) === positionKey(move.fenAfter);
  return { startPly: afterMove ? move.ply : move.ply - 1, afterMove };
}

/** Caption for the start of a story: "After 31. Rg8", "Instead of 31. Rg8"... */
function startCaption(context: StoryContext): string {
  if (context.afterMove) return `After ${context.anchorLabel}`;
  if (context.story.kind === 'missed') return `Instead of ${context.anchorLabel}`;
  return `The idea behind ${context.anchorLabel}`;
}

/** Heading for the story panel: "Why Rg8 is a blunder", "What Rxg7 would have done". */
export function storyTitle(
  kind: LineStory['kind'],
  san: string,
  classification: Classification,
  bestSan?: string,
): string {
  if (kind === 'missed') return bestSan ? `What ${bestSan} would have done` : 'The better move';
  const meta = CLASSIFICATION_META[classification];
  if (classification === 'forced') return `Why ${san} was forced`;
  if (classification === 'best') return `Why ${san} is the best move`;
  return `Why ${san} is ${meta.article} ${meta.phrase}`;
}

/** Motifs created by the move at `step` (0 = the first move of the line). */
export function motifsAt(story: LineStory, step: number): Motif[] {
  return story.motifs.filter((motif) => motif.step === step);
}

function squareOf(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${'abcdefgh'[file]}${rank + 1}` as Square;
}

function coords(square: Square): [number, number] {
  return [square.charCodeAt(0) - 97, Number(square[1]) - 1];
}

/**
 * The long-range piece of `by` that a move from `vacated` uncovered against `target`: the
 * first piece behind `vacated` on the line from `target`, if it is a rook, bishop or queen
 * of `by` that moves along that line. Null when there is none (not a discovery).
 */
export function uncoveredAttacker(
  fen: string,
  vacated: Square,
  target: Square,
  by: Color,
): Square | null {
  const [tf, tr] = coords(target);
  const [vf, vr] = coords(vacated);
  const df = Math.sign(vf - tf);
  const dr = Math.sign(vr - tr);
  const aligned = (df === 0 || dr === 0 || Math.abs(vf - tf) === Math.abs(vr - tr)) && !!(df || dr);
  if (!aligned) return null;
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const diagonal = df !== 0 && dr !== 0;
  let passed = false;
  for (let f = tf + df, r = tr + dr; ; f += df, r += dr) {
    const square = squareOf(f, r);
    if (!square) return null;
    if (square === vacated) {
      passed = true;
      continue;
    }
    const piece = chess.get(square);
    if (!piece) continue;
    if (!passed || piece.color !== by) return null;
    const slides = piece.type === 'q' || piece.type === (diagonal ? 'b' : 'r');
    return slides ? square : null;
  }
}

/** King-move distance between two squares (equal along a line for collinear squares). */
function distance(a: Square, b: Square): number {
  const [af, ar] = coords(a);
  const [bf, br] = coords(b);
  return Math.max(Math.abs(af - bf), Math.abs(ar - br));
}

/**
 * Arrows for one motif in the position after the move that created it (`move`):
 * - fork: from the forking piece to every target;
 * - pin / skewer: from the piece through the near target to the one behind it (targets
 *   come most valuable first, so the far one is found by distance);
 * - discovered attack / check: from the uncovered piece to the target;
 * - double check: from both checking pieces to the king;
 * - mates, hanging pieces: from the piece to its target.
 * Green when the motif is the player's own, red when it is aimed at the player.
 */
export function motifArrows(motif: Motif, move: VariationMove, player: Color): BoardArrow[] {
  const kind: BoardArrow['kind'] = motif.by === player ? 'best' : 'threat';
  const arrow = (from: Square, to: Square): BoardArrow => ({ from, to, kind });
  const [first] = motif.targets;
  let arrows: BoardArrow[] = [];
  switch (motif.type) {
    case 'fork':
      arrows = motif.targets.map((target) => arrow(motif.square, target));
      break;
    case 'pin':
    case 'skewer': {
      const far = [...motif.targets].sort(
        (a, b) => distance(motif.square, b) - distance(motif.square, a),
      )[0];
      if (far) arrows = [arrow(motif.square, far)];
      break;
    }
    case 'discovered-attack':
    case 'discovered-check':
      arrows = motif.targets.map((target) =>
        arrow(
          uncoveredAttacker(move.fenAfter, move.from, target, motif.by) ?? motif.square,
          target,
        ),
      );
      break;
    case 'double-check':
      arrows = motif.targets.flatMap((target) => {
        const uncovered = uncoveredAttacker(move.fenAfter, move.from, target, motif.by);
        return [arrow(move.to, target), ...(uncovered ? [arrow(uncovered, target)] : [])];
      });
      break;
    case 'checkmate':
    case 'back-rank-mate':
    case 'hanging-piece':
      if (first) arrows = [arrow(motif.square, first)];
      break;
    case 'trapped-piece':
    case 'promotion':
      break;
  }
  // Drop zero-length and repeated arrows (a discovery and a fork can share one).
  const seen = new Set<string>();
  return arrows.filter((a) => {
    const key = `${a.from}${a.to}`;
    if (a.from === a.to || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The side a story is good for: the refuting side, or the mover for an idea or a better move. */
export function storyBeneficiary(context: Pick<StoryContext, 'story' | 'mover'>): Color {
  if (context.story.kind !== 'refutation') return context.mover;
  return context.mover === 'w' ? 'b' : 'w';
}

/** 'threat' when the story shows what happens to the player, 'idea' when it is theirs. */
export function storyTone(
  context: Pick<StoryContext, 'story' | 'mover' | 'player'>,
): 'threat' | 'idea' {
  return storyBeneficiary(context) === context.player ? 'idea' : 'threat';
}

/** Colour of an arrow for a move in the story played by `color`. */
function moveArrowKind(color: Color, context: StoryContext): BoardArrow['kind'] {
  if (color === context.player) return 'best';
  // The opponent's moves are a threat when the line goes their way, otherwise just moves.
  return storyTone(context) === 'threat' ? 'threat' : 'played';
}

export interface StoryFrame {
  arrows: BoardArrow[];
  /**
   * Squares to ring: a trapped piece, the square a pawn promotes on, the piece just
   * sacrificed, and targets next to the piece that hits them (an arrow one square long
   * hides under the pieces).
   */
  highlights: Square[];
  /** First caption line: "31... Bxg8 — wins the rook", or where the line starts. */
  caption: string;
  /** What happens at this step: the sacrifice and the motifs (empty when none). */
  phrases: string[];
}

/** "sacrifices the rook on h7" for the first move of a story that gives material away. */
function sacrificePhrase(story: LineStory, move: VariationMove): string | null {
  const { sacrifice } = story;
  if (!sacrifice) return null;
  // The piece taken is not always the one that moved (a defender can step away).
  const verb = sacrifice.square === move.to ? 'sacrifices' : 'offers';
  return `${verb} the ${PIECE_NAMES[sacrifice.piece]} on ${sacrifice.square}`;
}

/** What the capture or promotion in a move does, for steps without a motif. */
function plainPhrase(move: VariationMove): string | null {
  if (move.san.endsWith('#')) return 'checkmate';
  let chess: Chess;
  try {
    chess = new Chess(move.fenBefore);
  } catch {
    return null;
  }
  const captured = chess.get(move.to);
  if (captured) return `takes the ${PIECE_NAMES[captured.type]}`;
  const promotion = /=([QRBN])/.exec(move.san)?.[1];
  if (promotion) return `promotes to a ${PIECE_NAMES[promotion.toLowerCase() as PieceSymbol]}`;
  // En passant: a pawn moving diagonally onto an empty square.
  if (/^[a-h]x/.test(move.san)) return 'takes the pawn';
  return null;
}

/** Joins phrases: "a", "a and b", "a, b and c". */
function joinPhrases(phrases: readonly string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? '';
  return `${phrases.slice(0, -1).join(', ')} and ${phrases.at(-1)}`;
}

/**
 * What the board shows for a story at its current step. At the start: an arrow for the
 * first move and "After 31. Rg8" (or "Instead of 31. Rg8" for the better move). After each
 * move: that move's motifs (arrows, rings and phrases), the sacrifice it makes, and its caption.
 */
export function storyFrame(variation: Variation): StoryFrame | null {
  const context = variation.story;
  if (variation.kind !== 'story' || !context) return null;
  const { story } = context;
  if (variation.index === 0) {
    const first = variation.moves[0];
    return {
      arrows: first
        ? [{ from: first.from, to: first.to, kind: moveArrowKind(first.color, context) }]
        : [],
      highlights: [],
      caption: startCaption(context),
      phrases: [],
    };
  }
  const step = variation.index - 1;
  const move = variation.moves[step];
  if (!move) return null;
  const motifs = motifsAt(story, step);
  const arrows = motifs.flatMap((motif) => motifArrows(motif, move, context.player));
  const sacrifice = step === 0 ? sacrificePhrase(story, move) : null;
  const highlights = new Set<Square>();
  if (sacrifice && story.sacrifice) highlights.add(story.sacrifice.square);
  for (const motif of motifs) {
    if (motif.type === 'trapped-piece') highlights.add(motif.targets[0] ?? motif.square);
    if (motif.type === 'promotion') highlights.add(motif.square);
  }
  for (const arrow of arrows) if (distance(arrow.from, arrow.to) <= 1) highlights.add(arrow.to);
  const phrases = [sacrifice, ...motifs.map((motif) => motif.phrase)].filter(
    (phrase): phrase is string => !!phrase,
  );
  const plain = phrases.length === 0 ? plainPhrase(move) : null;
  const label = `${moveNumberLabel(move.moveNumber, move.color)} ${move.san}`;
  const phrase = joinPhrases(plain ? [plain] : phrases);
  return {
    arrows,
    highlights: [...highlights],
    caption: phrase ? `${label} — ${phrase}` : label,
    phrases,
  };
}

/** How long auto-play stays on the current step before the next move. */
export function storyStepDelay(variation: Variation): number {
  const context = variation.story;
  if (variation.kind !== 'story' || !context || variation.index === 0) return STORY_STEP_MS;
  const step = variation.index - 1;
  const sacrifice = step === 0 && context.story.sacrifice !== undefined;
  return sacrifice || motifsAt(context.story, step).length > 0
    ? STORY_MOTIF_STEP_MS
    : STORY_STEP_MS;
}

/** Roughly how long a story takes to play from the start to its last move. */
export function storyDuration(variation: Variation): number {
  let total = 0;
  for (let index = 0; index < variation.moves.length; index++) {
    total += storyStepDelay({ ...variation, index });
  }
  return total;
}

/**
 * The outcome chip of a story: "+3" / "−5" for the material `player` wins or loses along
 * the line, or "Mate in 3"; `good` when it goes their way. Null when nothing changes.
 */
export function storyOutcome(variation: Variation): { text: string; good: boolean } | null {
  const context = variation.story;
  if (!context) return null;
  const { story, player, mover } = context;
  if (story.mateIn !== undefined) {
    const lastMover = variation.moves.at(-1)?.color;
    return { text: `Mate in ${story.mateIn}`, good: lastMover === player };
  }
  // The swing is counted for the side that played the move; the board takes `player`'s side.
  const swing = Math.round(mover === player ? story.materialSwing : -story.materialSwing);
  if (Math.abs(swing) < 1) return null;
  return { text: swing > 0 ? `+${swing}` : `−${Math.abs(swing)}`, good: swing > 0 };
}
