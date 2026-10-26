/**
 * Variations: moves the user tries on the board, or an engine line shown as moves you can
 * step through. Pure functions over an immutable `Variation`, so they are easy to test.
 */
import { Chess } from 'chess.js';
import type { Classification, Color, LineStory, ParsedGame, Square } from '@/core/types';
import { parseUci } from '@/core/notation';

export interface VariationMove {
  uci: string;
  san: string;
  from: Square;
  to: Square;
  fenBefore: string;
  fenAfter: string;
  /** Full-move number as printed ("12" in 12... Nf6). */
  moveNumber: number;
  color: Color;
  /** The move gives check. */
  check: boolean;
}

/**
 * explore = the user's own moves; line = an engine line opened from the move card;
 * story = "show why": a short line that explains a move, with its motifs drawn on the board.
 */
export type VariationKind = 'explore' | 'line' | 'story';

/** What a story variation tells, and about which move. */
export interface StoryContext {
  story: LineStory;
  /**
   * Whose side the board takes: "you" when the review knows it, otherwise the side whose
   * move is reviewed. Their tactics are drawn green, tactics against them red.
   */
  player: Color;
  /** Colour of the side that played the reviewed move. */
  mover: Color;
  /**
   * The story starts in the game position after the reviewed move (a refutation); false
   * when it starts before it (the better move, or an idea that begins with the move).
   */
  afterMove: boolean;
  /** The reviewed move, e.g. "31. Rg8", for "After 31. Rg8" / "Instead of 31. Rg8". */
  anchorLabel: string;
  /** SAN and label of the reviewed move, for titles ("Why Rg8 is a blunder"). */
  san: string;
  classification: Classification;
}

export interface Variation {
  kind: VariationKind;
  /** The variation starts in the position after this many game moves. */
  startPly: number;
  startFen: string;
  moves: VariationMove[];
  /** How many of `moves` are on the board (0 = the starting position). */
  index: number;
  /** Heading for engine lines, e.g. "Best line". */
  title?: string;
  /** Set for kind 'story'. */
  story?: StoryContext;
}

/** Plays a UCI move in a position; null when it is malformed or illegal. */
export function playUciMove(fen: string, uci: string): VariationMove | null {
  const parsed = parseUci(uci.toLowerCase());
  if (!parsed) return null;
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  try {
    const move = chess.move(parsed);
    return {
      uci: move.lan,
      san: move.san,
      from: move.from,
      to: move.to,
      fenBefore: move.before,
      fenAfter: move.after,
      moveNumber: Number(move.before.split(' ')[5]) || 1,
      color: move.color,
      check: chess.inCheck(),
    };
  } catch {
    return null; // chess.js throws on illegal moves
  }
}

/** Plays a UCI line from `fen`, stopping at the first illegal move. */
export function lineMoves(fen: string, pvUci: readonly string[]): VariationMove[] {
  const moves: VariationMove[] = [];
  let position = fen;
  for (const uci of pvUci) {
    const move = playUciMove(position, uci);
    if (!move) break;
    moves.push(move);
    position = move.fenAfter;
  }
  return moves;
}

/** FEN of the game position after `ply` moves. */
export function gameFenAt(game: ParsedGame, ply: number): string {
  return ply > 0 ? (game.moves[ply - 1]?.fenAfter ?? game.initialFen) : game.initialFen;
}

/** FEN currently shown for a variation. */
export function variationFen(variation: Variation): string {
  return variation.index > 0
    ? (variation.moves[variation.index - 1]?.fenAfter ?? variation.startFen)
    : variation.startFen;
}

/** The variation move that led to the shown position (undefined at its start). */
export function currentVariationMove(variation: Variation): VariationMove | undefined {
  return variation.index > 0 ? variation.moves[variation.index - 1] : undefined;
}

export function seekVariation(variation: Variation, index: number): Variation {
  const clamped = Math.min(variation.moves.length, Math.max(0, index));
  return clamped === variation.index ? variation : { ...variation, index: clamped };
}

/**
 * Plays a move at the shown position of a variation. Repeating the variation's next move
 * steps forward; any other move replaces everything after the shown position (and turns an
 * engine line into the user's own variation). Null when the move is illegal.
 */
export function playInVariation(variation: Variation, uci: string): Variation | null {
  const next = variation.moves[variation.index];
  if (next && next.uci === uci.toLowerCase()) return { ...variation, index: variation.index + 1 };
  const move = playUciMove(variationFen(variation), uci);
  if (!move) return null;
  return {
    kind: 'explore',
    startPly: variation.startPly,
    startFen: variation.startFen,
    moves: [...variation.moves.slice(0, variation.index), move],
    index: variation.index + 1,
  };
}

/**
 * Plays an engine line from the shown position: its moves replace everything after it, and
 * the board advances by one move (the rest can be stepped through). Unchanged if the line
 * does not start with a legal move.
 */
export function extendVariation(variation: Variation, pvUci: readonly string[]): Variation {
  const moves = lineMoves(variationFen(variation), pvUci);
  if (moves.length === 0) return variation;
  return {
    kind: 'explore',
    startPly: variation.startPly,
    startFen: variation.startFen,
    moves: [...variation.moves.slice(0, variation.index), ...moves],
    index: variation.index + 1,
  };
}

/** An engine line as a variation starting after `startPly` game moves (null if empty). */
export function lineVariation(
  game: ParsedGame,
  startPly: number,
  pvUci: readonly string[],
  title: string,
): Variation | null {
  const startFen = gameFenAt(game, startPly);
  const moves = lineMoves(startFen, pvUci);
  if (moves.length === 0) return null;
  return { kind: 'line', startPly, startFen, moves, index: 0, title };
}

/**
 * A story as a variation starting after `startPly` game moves; null when its first move is
 * not legal in `story.fen`. The moves are replayed from the FEN, so SAN always matches it.
 */
export function storyVariation(startPly: number, context: StoryContext): Variation | null {
  const moves = lineMoves(context.story.fen, context.story.movesUci);
  if (moves.length === 0) return null;
  return {
    kind: 'story',
    startPly,
    startFen: context.story.fen,
    moves,
    index: 0,
    story: context,
  };
}

export type BoardMoveResult =
  /** The move is the game's next move: step forward in the game instead. */
  { type: 'game'; ply: number } | { type: 'variation'; variation: Variation } | { type: 'illegal' };

/**
 * What a move made on the board does. At a game position (or at the start of a variation)
 * the game's own next move steps forward in the game; anything else starts or extends a
 * variation from the position shown.
 */
export function applyBoardMove(
  game: ParsedGame,
  ply: number,
  variation: Variation | null,
  uci: string,
): BoardMoveResult {
  const move = uci.toLowerCase();
  if (variation) {
    const next = variation.moves[variation.index];
    if (variation.index > 0 || next?.uci === move) {
      const updated = playInVariation(variation, move);
      return updated ? { type: 'variation', variation: updated } : { type: 'illegal' };
    }
  }
  const branchPly = variation ? variation.startPly : ply;
  if (game.moves[branchPly]?.uci === move) return { type: 'game', ply: branchPly + 1 };
  const startFen = variation ? variation.startFen : gameFenAt(game, branchPly);
  const played = playUciMove(startFen, move);
  if (!played) return { type: 'illegal' };
  return {
    type: 'variation',
    variation: { kind: 'explore', startPly: branchPly, startFen, moves: [played], index: 1 },
  };
}

export interface NumberedMove {
  /** Index into `moves` + 1: seeking to it shows the position after this move. */
  index: number;
  /** "12." before White's moves and "12..." before a first move by Black, otherwise null. */
  number: string | null;
  san: string;
}

/** Moves with the numbers to print before them: "12. Nf3 Nc6 13. Bb5" / "12... Nc6 13. Bb5". */
export function numberedMoves(moves: readonly VariationMove[]): NumberedMove[] {
  return moves.map((move, i) => ({
    index: i + 1,
    number: move.color === 'w' ? `${move.moveNumber}.` : i === 0 ? `${move.moveNumber}...` : null,
    san: move.san,
  }));
}
