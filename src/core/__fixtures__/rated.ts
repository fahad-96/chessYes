/**
 * Rated games with the accuracies their Chess.com game reviews published, and Kibitz's own
 * analyses of them (Stockfish 19 lite, depth 16, MultiPV 2, the Standard preset), taken
 * from the dataset the calibrated model was fitted on (see accuracyModel.ts). The first is
 * the game that started the calibration; the others are the first game of each other
 * rating band in the dataset. Player names and clocks are left out.
 *
 * Each JSON file holds the moves and one string per position (index 0 = start position):
 * either a terminal state ("checkmate", "stalemate", ...) or the engine lines, best first,
 * separated by " | ", each written as "<cp|mate> <value, White's view> <pv in UCI...>",
 * with the PV cut to 12 plies.
 */
import { parsePgn } from '../pgn';
import type { EngineLine, ParsedGame, PositionAnalysis, TerminalState } from '../types';

interface RatedFixture {
  source: string;
  timeClass: string;
  ratingBand: string;
  ratings: { white: number; black: number };
  published: { white: number; black: number };
  moves: string;
  positions: string[];
}

export interface RatedGame extends Omit<RatedFixture, 'moves' | 'positions'> {
  /** The game id on Chess.com. */
  id: string;
  game: ParsedGame;
  analyses: PositionAnalysis[];
}

const DEPTH = 16;
const TERMINAL_STATES: readonly string[] = [
  'checkmate',
  'stalemate',
  'insufficient',
  'threefold',
  'fifty-move',
] satisfies TerminalState[];

function decodeLine(text: string): EngineLine {
  const [type, value, ...pv] = text.trim().split(' ');
  if ((type !== 'cp' && type !== 'mate') || value === undefined) {
    throw new Error(`Bad engine line in a rated fixture: ${text}`);
  }
  return { pv, score: { type, value: Number(value) }, depth: DEPTH };
}

function decodePosition(fen: string, text: string): PositionAnalysis {
  if (TERMINAL_STATES.includes(text)) {
    return { fen, depth: 0, lines: [], terminal: text as TerminalState };
  }
  return { fen, depth: DEPTH, lines: text.split('|').map(decodeLine) };
}

function decode(id: string, fixture: RatedFixture): RatedGame {
  const { moves, positions, ...rest } = fixture;
  const game = parsePgn(moves);
  const fens = [game.initialFen, ...game.moves.map((move) => move.fenAfter)];
  if (fens.length !== positions.length) {
    throw new Error(`Rated fixture ${id}: ${positions.length} positions for ${fens.length}`);
  }
  const analyses = positions.map((text, i) => decodePosition(fens[i] ?? '', text));
  return { ...rest, id, game, analyses };
}

/** The game that started the calibration: 838 vs 819, 10-minute rapid, 1-0. */
export const USER_GAME_ID = '185991061138';

const files = import.meta.glob<RatedFixture>('./rated/*.json', {
  eager: true,
  import: 'default',
});

/** Every rated fixture, the game that started the calibration first. */
export const RATED_GAMES: RatedGame[] = Object.entries(files)
  .map(([path, fixture]) => decode(path.replace(/^.*\/(\d+)\.json$/, '$1'), fixture))
  .sort((a, b) => Number(b.id === USER_GAME_ID) - Number(a.id === USER_GAME_ID));
