import { Chess } from 'chess.js';
import { materialBalance, staticExchange } from '@/core/material';
import { parseUci, positionKey } from '@/core/notation';
import type { Classification, Color, GameSource, Square } from '@/core/types';
import type { LibraryEntry, LibraryMove, Perspective } from '@/library/library';

/**
 * Puzzles from the player's own mistakes. Pure functions over library entries, so the
 * rules can be tested without a browser and changed in one place.
 *
 * A move of the player (the entry's perspective) becomes a puzzle when:
 *
 * 1. It was a Mistake, Blunder or Miss. Inaccuracies are left out: a small slip
 *    rarely has one answer you can "find", and the prompt calls the game move a mistake.
 * 2. The engine's best move is known and differs from the move played.
 * 3. The best move is clearly the one to find: there is no second line to compare with
 *    (the review ran with MultiPV 1), or the second-best move keeps at least
 *    `minGapToSecond` points of win % less, or the best line ends in checkmate (another
 *    mating move is then accepted too, because checkMove judges by win %).
 * 4. Lost positions: the best move must not just keep a lost position lost. With best
 *    play the player must still have `minWinBefore` % or more (about −2.3 pawns); below
 *    that, "the best move" is only the slowest way to lose, which makes a poor puzzle.
 *    A move that saves a draw is evaluated near 50 %, so drawing defences pass this rule
 *    on their own and are tagged "defence".
 *
 * Positions that come up in several games become one puzzle (see generatePuzzles).
 */

/**
 * Every tunable number behind puzzle selection. Win % values are on the calibrated scale of
 * the review (core/winPercent.ts), about half as steep as the Lichess scale these rules were
 * first written for (gap 10, at least 30 %): the numbers below keep the same positions.
 */
export const PUZZLE_RULES = {
  /** Win % points between the best and second-best move for the best move to be "the" move. */
  minGapToSecond: 6,
  /** The player's win % with best play must be at least this (below is a lost position). */
  minWinBefore: 39,
  /** Pawn units the best line must win for the "material" theme. */
  minMaterialGain: 2,
  /** "defence" when the player's win % with best play is below this. */
  defenceBelow: 50,
  /**
   * "endgame" when at most this many queens, rooks, bishops and knights (both sides
   * together) are on the board, the rule Lichess uses to find the endgame phase.
   */
  endgameMaxPieces: 6,
} as const;

export const PUZZLE_THEMES = ['mate', 'material', 'defence', 'missed-win', 'endgame'] as const;
export type PuzzleTheme = (typeof PUZZLE_THEMES)[number];

/** Whose mistakes these are: the player the games were looked up for. */
export interface PuzzlePlayer {
  platform: Perspective['platform'];
  /** Lower-cased username. */
  username: string;
}

export interface Puzzle {
  /** `<gameId>#<ply>`, stable across sessions (progress is stored under it). */
  id: string;
  gameId: string;
  /** Ply of the mistake in the game (1-based), for the link to the review. */
  ply: number;
  /** Position to solve (before the mistake). */
  fen: string;
  /** The side to find the move for (the player). */
  color: Color;
  /** The engine's best line in UCI; solution[0] is the move to find. */
  solution: string[];
  solutionSan: string[];
  /**
   * The opponent's move that led to the position, when known (for the board highlight).
   * `fenBefore` is set when it was a capture that started an exchange: the solution may
   * take back what it took, which the story does not count as material won.
   */
  lastMove?: { uci: string; san: string; fenBefore?: string };
  /** The move played in the game. */
  playedUci: string;
  playedSan: string;
  playedClassification: Classification;
  /** Player's win % with the best move. */
  winBefore: number;
  /** Player's win % after the move played. */
  winAfter: number;
  themes: PuzzleTheme[];
  /** Opponent's name in that game. */
  opponent: string;
  /** When the game was played (epoch ms). */
  date: number;
  source: GameSource;
  player: PuzzlePlayer;
  /** How many reviewed games reached this position with the same mistake (1 or more). */
  occurrences: number;
}

const CANDIDATES: ReadonlySet<Classification> = new Set(['mistake', 'blunder', 'missedWin']);

/** Key of a player, e.g. "lichess/drnykterstein". */
export function playerKey(player: PuzzlePlayer): string {
  return `${player.platform}/${player.username.toLowerCase()}`;
}

/**
 * Builds the puzzles for every entry that has a perspective (entries without one are
 * skipped: whose mistakes would they be?).
 *
 * The same position (piece placement, side to move, castling rights) reached in several
 * games becomes one puzzle per player: the oldest occurrence is kept, so a puzzle keeps
 * its id (and its practice history) when a newer game repeats the mistake, and
 * `occurrences` counts the games.
 *
 * @returns puzzles from the newest game to the oldest, in move order within a game.
 */
export function generatePuzzles(entries: readonly LibraryEntry[]): Puzzle[] {
  const byPosition = new Map<string, Puzzle>();
  for (const entry of entries) {
    const perspective = entry.perspective;
    if (!perspective) continue;
    entry.moves.forEach((move, index) => {
      if (move.color !== perspective.color) return;
      const previous = entry.moves[index - 1];
      const earlier = entry.moves[index - 2];
      const puzzle = puzzleFromMove(
        entry,
        perspective,
        move,
        previous?.ply === move.ply - 1 ? previous : undefined,
        earlier?.ply === move.ply - 2 ? earlier : undefined,
      );
      if (!puzzle) return;
      const key = `${playerKey(puzzle.player)} ${positionKey(puzzle.fen)}`;
      const existing = byPosition.get(key);
      if (!existing) {
        byPosition.set(key, puzzle);
      } else {
        const occurrences = existing.occurrences + 1;
        const keep = isOlder(puzzle, existing) ? puzzle : existing;
        byPosition.set(key, { ...keep, occurrences });
      }
    });
  }
  return [...byPosition.values()].sort(
    (a, b) => b.date - a.date || a.gameId.localeCompare(b.gameId) || a.ply - b.ply,
  );
}

function isOlder(a: Puzzle, b: Puzzle): boolean {
  return a.date < b.date || (a.date === b.date && a.id < b.id);
}

/**
 * The puzzle for one move, or null when the move does not qualify (rules at the top).
 * `previous` is the opponent's move just before it and `earlier` the move before that,
 * when known.
 */
export function puzzleFromMove(
  entry: LibraryEntry,
  perspective: Perspective,
  move: LibraryMove,
  previous?: LibraryMove,
  earlier?: LibraryMove,
): Puzzle | null {
  const { best } = move;
  if (move.color !== perspective.color || !CANDIDATES.has(move.classification)) return null;
  if (!best || best.uci.toLowerCase() === move.uci.toLowerCase()) return null;
  if (move.winBefore < PUZZLE_RULES.minWinBefore) return null;

  // The stored line normally starts with the best move; fall back to the move alone.
  const pv = best.pvUci[0]?.toLowerCase() === best.uci.toLowerCase() ? best.pvUci : [best.uci];
  const line = analyseLine(move.fenBefore, pv, previous?.fenBefore);
  if (!line) return null;

  const clearlyBest =
    move.winSecondBest === undefined ||
    move.winBefore - move.winSecondBest >= PUZZLE_RULES.minGapToSecond ||
    line.mate;
  if (!clearlyBest) return null;

  const winsMaterial = line.materialGain >= PUZZLE_RULES.minMaterialGain;

  const themes: PuzzleTheme[] = [];
  if (line.mate) themes.push('mate');
  if (winsMaterial) themes.push('material');
  if (move.winBefore < PUZZLE_RULES.defenceBelow) themes.push('defence');
  if (move.classification === 'missedWin') themes.push('missed-win');
  if (isEndgame(move.fenBefore)) themes.push('endgame');

  const { record } = entry;
  const puzzle: Puzzle = {
    id: `${entry.gameId}#${move.ply}`,
    gameId: entry.gameId,
    ply: move.ply,
    fen: move.fenBefore,
    color: move.color,
    solution: line.uci,
    solutionSan: line.san,
    playedUci: move.uci,
    playedSan: move.san,
    playedClassification: move.classification,
    winBefore: move.winBefore,
    winAfter: move.winAfter,
    themes,
    opponent: perspective.color === 'w' ? record.black.name : record.white.name,
    date: record.endTime ?? record.startTime ?? entry.reviewedAt,
    source: record.source,
    player: { platform: perspective.platform, username: perspective.username.toLowerCase() },
    occurrences: 1,
  };
  if (previous) {
    puzzle.lastMove = { uci: previous.uci, san: previous.san };
    if (startsExchange(previous, earlier)) puzzle.lastMove.fenBefore = previous.fenBefore;
  }
  return puzzle;
}

/** Whether `move` captured without taking back what `earlier` had just captured. */
function startsExchange(move: LibraryMove, earlier: LibraryMove | undefined): boolean {
  if (!move.san.includes('x')) return false;
  const to = move.uci.slice(2, 4);
  return !(earlier?.san.includes('x') && earlier.uci.slice(2, 4) === to);
}

interface LineFacts {
  /** The legal part of the line. */
  uci: string[];
  san: string[];
  /** The line ends in checkmate. */
  mate: boolean;
  /** Material the mover wins along the line, pawn units (can be negative). */
  materialGain: number;
}

/**
 * Replays the best line and measures what it wins. Returns null when the position is
 * invalid or the first move is illegal (a corrupt entry).
 *
 * Material is compared at the end of the line, after letting the side to move there
 * finish the exchange on the square of the last move (a static exchange), so a line cut
 * off in the middle of a trade is not counted as winning or losing a piece. The baseline
 * is the position before the move, or, when the opponent has just captured, the position
 * before that capture: simply taking a piece back does not "win material".
 */
export function analyseLine(
  fen: string,
  pv: readonly string[],
  fenBeforeOpponent?: string,
): LineFacts | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null; // invalid FEN
  }
  const mover = chess.turn();
  const uci: string[] = [];
  const san: string[] = [];
  let lastTo: Square | null = null;
  for (const step of pv) {
    const parsed = parseUci(step);
    if (!parsed) break;
    try {
      const move = chess.move(parsed);
      uci.push(step.toLowerCase());
      san.push(move.san);
      lastTo = move.to;
    } catch {
      break; // chess.js throws on illegal moves
    }
  }
  if (uci.length === 0 || !lastTo) return null;

  const mate = chess.isCheckmate();
  const forMover = (balance: number) => (mover === 'w' ? balance : -balance);
  let end = forMover(materialBalance(chess.fen()));
  if (!chess.isGameOver()) {
    const exchange = staticExchange(chess.fen(), lastTo);
    end += chess.turn() === mover ? exchange : -exchange;
  }
  let baseline = forMover(materialBalance(fen));
  if (fenBeforeOpponent) {
    baseline = Math.max(baseline, forMover(materialBalance(fenBeforeOpponent)));
  }
  return { uci, san, mate, materialGain: end - baseline };
}

/** Whether the position is an endgame (few pieces besides kings and pawns). */
export function isEndgame(fen: string): boolean {
  const placement = fen.split(' ')[0] ?? '';
  const pieces = placement.replace(/[^qrbnQRBN]/g, '').length;
  return pieces <= PUZZLE_RULES.endgameMaxPieces;
}

/** How many puzzles have each theme. */
export function countThemes(puzzles: readonly Puzzle[]): Record<PuzzleTheme, number> {
  const counts = Object.fromEntries(PUZZLE_THEMES.map((theme) => [theme, 0])) as Record<
    PuzzleTheme,
    number
  >;
  for (const puzzle of puzzles) {
    for (const theme of puzzle.themes) counts[theme]++;
  }
  return counts;
}

/** The players that have reviewed games in the library, most recent game first. */
export function libraryPlayers(entries: readonly LibraryEntry[]): PuzzlePlayer[] {
  const seen = new Map<string, PuzzlePlayer>();
  const sorted = [...entries].sort(
    (a, b) =>
      (b.record.endTime ?? b.reviewedAt) - (a.record.endTime ?? a.reviewedAt) ||
      b.reviewedAt - a.reviewedAt,
  );
  for (const entry of sorted) {
    if (!entry.perspective) continue;
    const player = {
      platform: entry.perspective.platform,
      username: entry.perspective.username.toLowerCase(),
    };
    const key = playerKey(player);
    if (!seen.has(key)) seen.set(key, player);
  }
  return [...seen.values()];
}
