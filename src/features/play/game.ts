import { Chess, type Move } from 'chess.js';
import type { Color, GameResult, Square } from '@/core/types';
import { engineName, isLevelId } from './levels';

/**
 * A game against the engine, as plain data: the moves are the whole truth, and every
 * position is replayed from them with chess.js. All functions here are pure.
 */

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** The human player's name in the record and PGN; the review URL's ?as= uses it too. */
export const PLAYER_NAME = 'You';

export type EndReason =
  'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty-move' | 'resignation';

export interface GameOutcome {
  result: Exclude<GameResult, '*'>;
  reason: EndReason;
  /** Epoch ms. */
  endedAt: number;
}

export interface PlayGame {
  /** Unique per game (start time and a random suffix), so a stale engine reply is spotted. */
  id: string;
  /** The human player's colour. */
  player: Color;
  /** Engine strength, 1-8 (levels.ts). */
  level: number;
  /** Moves in UCI from the starting position, e.g. ["e2e4", "e7e5"]. */
  moves: string[];
  /** Epoch ms. */
  startedAt: number;
  outcome: GameOutcome | null;
}

export function newGame(player: Color, level: number, now: number, random = Math.random): PlayGame {
  const suffix = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return {
    id: `${now.toString(36)}-${suffix}`,
    player,
    level,
    moves: [],
    startedAt: now,
    outcome: null,
  };
}

export function opposite(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

/** The side to move after `moves` from the starting position. */
export function sideToMoveAfter(moves: readonly string[]): Color {
  return moves.length % 2 === 0 ? 'w' : 'b';
}

function moveFromUci(chess: Chess, uci: string): Move | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null; // illegal in this position
  }
}

/** chess.js after replaying `moves` from the start, or null if one of them is illegal. */
export function replay(moves: readonly string[]): Chess | null {
  const chess = new Chess();
  for (const uci of moves) {
    if (!moveFromUci(chess, uci)) return null;
  }
  return chess;
}

/** How the position on the board ends the game, or null while it goes on. */
export function boardOutcome(chess: Chess): Omit<GameOutcome, 'endedAt'> | null {
  if (chess.isCheckmate()) {
    // The side to move is mated.
    return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
  }
  if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient' };
  if (chess.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'threefold' };
  if (chess.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: 'fifty-move' };
  return null;
}

/**
 * The game after `uci` is played, with the outcome filled in when the move ends the game.
 * Null when the game is over or the move is not legal.
 */
export function playMove(game: PlayGame, uci: string, now: number): PlayGame | null {
  if (game.outcome) return null;
  const chess = replay(game.moves);
  if (!chess || !moveFromUci(chess, uci)) return null;
  const ending = boardOutcome(chess);
  return {
    ...game,
    moves: [...game.moves, uci],
    outcome: ending ? { ...ending, endedAt: now } : null,
  };
}

/** The human player resigns. Null when the game is already over. */
export function resign(game: PlayGame, now: number): PlayGame | null {
  if (game.outcome) return null;
  return {
    ...game,
    outcome: { result: game.player === 'w' ? '0-1' : '1-0', reason: 'resignation', endedAt: now },
  };
}

/** Whether takeBack can undo a move of the player's: not after resigning, nor before moving. */
export function canTakeBack(game: PlayGame): boolean {
  if (game.outcome?.reason === 'resignation') return false;
  const firstOwnMove = game.player === 'w' ? 0 : 1;
  return game.moves.length > firstOwnMove;
}

/**
 * Undoes the player's last move, and the engine's reply to it if there was one, so it is
 * the player's turn again. A game that ended on the board goes on again.
 */
export function takeBack(game: PlayGame): PlayGame | null {
  if (!canTakeBack(game)) return null;
  const moves = [...game.moves];
  // Remove moves until the one just removed was the player's.
  while (moves.length > 0) {
    moves.pop();
    if (sideToMoveAfter(moves) === game.player) break;
  }
  return { ...game, moves, outcome: null };
}

/** True when the engine should move now. */
export function isEngineTurn(game: PlayGame): boolean {
  return game.outcome === null && sideToMoveAfter(game.moves) !== game.player;
}

/** What the board and the move list show for the current position. */
export interface PlayPosition {
  fen: string;
  /** Moves in SAN, in order. */
  san: string[];
  lastMove?: [Square, Square];
  check: boolean;
  /** Legal moves in UCI (empty when the game is over on the board). */
  legalMoves: string[];
}

export function positionOf(game: PlayGame): PlayPosition {
  const chess = replay(game.moves) ?? new Chess();
  const history = chess.history({ verbose: true });
  const last = history.at(-1);
  return {
    fen: chess.fen(),
    san: history.map((move) => move.san),
    lastMove: last ? [last.from, last.to] : undefined,
    check: chess.inCheck(),
    legalMoves: chess.moves({ verbose: true }).map((move) => move.lan),
  };
}

/** Who won, from the human player's side: "win", "loss" or "draw". */
export function outcomeForPlayer(game: PlayGame): 'win' | 'loss' | 'draw' | null {
  const result = game.outcome?.result;
  if (!result) return null;
  if (result === '1/2-1/2') return 'draw';
  const whiteWon = result === '1-0';
  return whiteWon === (game.player === 'w') ? 'win' : 'loss';
}

/** One line on how the game ended, e.g. "You won by checkmate" or "Draw by repetition". */
export function describeOutcome(game: PlayGame): string | null {
  const outcome = game.outcome;
  if (!outcome) return null;
  const engine = engineName(game.level);
  const winner =
    outcomeForPlayer(game) === 'win'
      ? PLAYER_NAME
      : outcomeForPlayer(game) === 'loss'
        ? engine
        : '';
  switch (outcome.reason) {
    case 'checkmate':
      return `${winner} won by checkmate`;
    case 'resignation':
      return `${winner} won by resignation`;
    case 'stalemate':
      return 'Draw by stalemate';
    case 'insufficient':
      return 'Draw by insufficient material';
    case 'threefold':
      return 'Draw by repetition';
    case 'fifty-move':
      return 'Draw by 50-move rule';
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Escapes a PGN tag value (backslashes and double quotes). */
function tagValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * The finished (or unfinished) game as PGN, ready for recordFromPgn: the players, an
 * untimed time control, the UTC start and end, the result and how the game ended.
 */
export function toPgn(game: PlayGame): string {
  const engine = engineName(game.level);
  const start = new Date(game.startedAt);
  const end = new Date(game.outcome?.endedAt ?? game.startedAt);
  const date = (d: Date) =>
    `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
  const time = (d: Date) =>
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const result = game.outcome?.result ?? '*';
  const tags: [string, string][] = [
    ['Event', 'Casual game against Stockfish'],
    ['Site', 'Chess Yes'],
    ['Date', date(start)],
    ['White', game.player === 'w' ? PLAYER_NAME : engine],
    ['Black', game.player === 'b' ? PLAYER_NAME : engine],
    ['Result', result],
    ['TimeControl', '-'],
    ['UTCDate', date(start)],
    ['UTCTime', time(start)],
    ['EndDate', date(end)],
    ['EndTime', time(end)],
  ];
  const ending = describeOutcome(game);
  if (ending) tags.push(['Termination', ending]);

  const { san } = positionOf(game);
  const tokens: string[] = [];
  san.forEach((move, index) => {
    if (index % 2 === 0) tokens.push(`${index / 2 + 1}.`);
    tokens.push(move);
  });
  tokens.push(result);
  const header = tags.map(([name, value]) => `[${name} "${tagValue(value)}"]`).join('\n');
  return `${header}\n\n${wrap(tokens, 80)}\n`;
}

/** Joins tokens with spaces into lines of at most `width` characters (PGN export format). */
function wrap(tokens: readonly string[], width: number): string {
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > width) {
      lines.push(line);
      line = token;
    } else {
      line = line ? `${line} ${token}` : token;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/**
 * A saved game read back from storage, or null when it is not a valid game (an older
 * format, edited storage, or moves that are no longer legal).
 */
export function sanitizeGame(value: unknown): PlayGame | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (raw.player !== 'w' && raw.player !== 'b') return null;
  if (!isLevelId(raw.level)) return null;
  if (typeof raw.startedAt !== 'number' || !Number.isFinite(raw.startedAt)) return null;
  if (!Array.isArray(raw.moves) || !raw.moves.every((move) => typeof move === 'string')) {
    return null;
  }
  const moves = raw.moves as string[];
  const chess = replay(moves);
  if (!chess) return null;

  let outcome: GameOutcome | null = null;
  if (raw.outcome !== null && raw.outcome !== undefined) {
    const stored = raw.outcome as Record<string, unknown>;
    const reasons: EndReason[] = [
      'checkmate',
      'stalemate',
      'insufficient',
      'threefold',
      'fifty-move',
      'resignation',
    ];
    const results = ['1-0', '0-1', '1/2-1/2'];
    if (
      typeof stored !== 'object' ||
      !results.includes(stored.result as string) ||
      !reasons.includes(stored.reason as EndReason) ||
      typeof stored.endedAt !== 'number'
    ) {
      return null;
    }
    outcome = {
      result: stored.result as GameOutcome['result'],
      reason: stored.reason as EndReason,
      endedAt: stored.endedAt,
    };
  }
  // A game the board says is over is over, whatever was stored.
  if (!outcome) {
    const ending = boardOutcome(chess);
    if (ending) outcome = { ...ending, endedAt: raw.startedAt };
  }
  return {
    id: raw.id,
    player: raw.player,
    level: raw.level,
    moves,
    startedAt: raw.startedAt,
    outcome,
  };
}
