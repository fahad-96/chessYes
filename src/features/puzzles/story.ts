import type { BoardArrow } from '@/components/Board';
import { describeLine, materialBaseline, type DescribeLineOptions } from '@/core/tactics';
import type { Color, Motif, Square } from '@/core/types';
import { formatLineFrom } from '@/practice/line';
import { solutionPlies } from './attempt';
import type { Puzzle } from './generate';

/**
 * "Why does the solution work?" for a finished puzzle: the tactics story of the
 * engine's line ("Nf6+ forks the king and queen and wins the queen") and the arrows
 * that show it on the board. Pure, so it is tested without a board.
 */

export interface PuzzleStory {
  /** One or two plain sentences about the solution, written for the player. */
  text: string;
  /** The plies worth showing on the board: a prefix of the puzzle's solution. */
  movesUci: string[];
  /** Tactical patterns along `movesUci` (Motif.step indexes into it). */
  motifs: Motif[];
  /** True when the tactics could not be described and the text only names the line. */
  fallback: boolean;
}

type StoryInput = Pick<
  Puzzle,
  'fen' | 'color' | 'solution' | 'solutionSan' | 'themes' | 'lastMove'
>;

/**
 * Tells the story of the puzzle's solution with the tactics module. Falls back to a
 * sentence built from the line and the puzzle's themes when that fails (it throws, or
 * returns a line that does not start with the solution), so this never throws.
 */
export function puzzleStory(puzzle: StoryInput): PuzzleStory {
  try {
    // Told as an idea, in the present tense ("Nf6+ forks the king and queen and wins the
    // queen"): it is read after the puzzle is solved, not as a missed chance.
    const options: DescribeLineOptions = { kind: 'idea', player: puzzle.color };
    // Taking back what the opponent's last move captured is a trade, not a piece won: its
    // material is counted from before that capture when the solution takes back at once.
    const previous = puzzle.lastMove;
    if (previous?.san.includes('x')) {
      const square = previous.uci.slice(2, 4) as Square;
      options.previousCaptureOn = square;
      if (puzzle.solution[0]?.slice(2, 4) === square) {
        options.startFen = materialBaseline(puzzle.fen, previous.fenBefore, puzzle.color);
      }
    }
    const story = describeLine(puzzle.fen, puzzle.solution, options);
    const first = story.movesUci[0]?.toLowerCase();
    const text = story.text.trim();
    if (text && first && first === puzzle.solution[0]?.toLowerCase()) {
      const plies = story.movesUci.length;
      return {
        text,
        movesUci: story.movesUci,
        // Only motifs on the shown plies can be drawn.
        motifs: story.motifs.filter((motif) => motif.step >= 0 && motif.step < plies),
        fallback: false,
      };
    }
  } catch {
    // The tactics module could not read the line: name the line instead.
  }
  return fallbackStory(puzzle);
}

/** The line with move numbers and what it achieves, from the puzzle's themes. */
export function fallbackStory(puzzle: StoryInput): PuzzleStory {
  const mate = puzzle.themes.includes('mate');
  const plies = solutionPlies(puzzle.solution.length, mate);
  const line = formatLineFrom(puzzle.fen, puzzle.solutionSan, plies);
  const first = puzzle.solutionSan[0] ?? '';
  let text: string;
  if (mate) text = plies === 1 ? `${line} is checkmate.` : `${line} ends in checkmate.`;
  else if (puzzle.themes.includes('material')) text = `${line} wins material.`;
  else if (puzzle.themes.includes('defence')) text = `${first} is the move that holds: ${line}.`;
  else text = `The best line: ${line}.`;
  return { text, movesUci: puzzle.solution.slice(0, plies), motifs: [], fallback: true };
}

/** Motifs drawn as a single line to the far piece: an arrow to each would overlap. */
const LINE_MOTIFS: ReadonlySet<Motif['type']> = new Set(['pin', 'skewer']);

/**
 * Arrows for the motifs created by the move at `step` of the story: from the piece
 * that executes the tactic to each piece it hits (a fork gets an arrow per target; a
 * pin or skewer one arrow through the line). The player's own tactics use the "best"
 * colour, the opponent's the "threat" colour.
 */
export function motifArrows(motifs: readonly Motif[], step: number, player: Color): BoardArrow[] {
  const arrows: BoardArrow[] = [];
  const seen = new Set<string>();
  for (const motif of motifs) {
    if (motif.step !== step) continue;
    const kind: BoardArrow['kind'] = motif.by === player ? 'best' : 'threat';
    const targets = LINE_MOTIFS.has(motif.type)
      ? [farthest(motif.square, motif.targets)].filter((t): t is Square => t !== undefined)
      : motif.targets;
    for (const target of targets) {
      const key = `${motif.square}${target}`;
      if (target === motif.square || seen.has(key)) continue;
      seen.add(key);
      arrows.push({ from: motif.square, to: target, kind });
    }
  }
  return arrows;
}

function farthest(from: Square, targets: readonly Square[]): Square | undefined {
  let best: Square | undefined;
  let bestDistance = -1;
  for (const target of targets) {
    const distance = Math.max(
      Math.abs(target.charCodeAt(0) - from.charCodeAt(0)),
      Math.abs(Number(target[1]) - Number(from[1])),
    );
    if (distance > bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}
