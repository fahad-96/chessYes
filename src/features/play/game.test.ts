import { describe, expect, it } from 'vitest';
import { parsePgn } from '@/core/pgn';
import { recordFromPgn } from '@/sources/pgnImport';
import {
  PLAYER_NAME,
  START_FEN,
  canTakeBack,
  describeOutcome,
  isEngineTurn,
  newGame,
  outcomeForPlayer,
  playMove,
  positionOf,
  resign,
  sanitizeGame,
  takeBack,
  toPgn,
  type PlayGame,
} from './game';

const T0 = Date.UTC(2026, 10, 24, 9, 30, 0);

function playAll(game: PlayGame, moves: string[]): PlayGame {
  return moves.reduce((current, uci, index) => {
    const next = playMove(current, uci, T0 + (index + 1) * 1000);
    if (!next) throw new Error(`Illegal move ${uci} at ply ${index + 1}`);
    return next;
  }, game);
}

/** 1.f3 e5 2.g4 Qh4#: the fastest mate, Black wins. */
const FOOLS_MATE = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];

describe('a game against the engine', () => {
  it('starts from the initial position with nobody to blame yet', () => {
    const game = newGame('w', 3, T0, () => 0.5);
    expect(game.moves).toEqual([]);
    expect(game.outcome).toBeNull();
    expect(game.id).toMatch(/^[0-9a-z]+-[0-9a-z]{4}$/);
    expect(positionOf(game).fen).toBe(START_FEN);
    expect(isEngineTurn(game)).toBe(false);
    expect(isEngineTurn(newGame('b', 3, T0))).toBe(true);
  });

  it('plays legal moves and rejects illegal ones', () => {
    const game = newGame('w', 3, T0);
    const after = playMove(game, 'e2e4', T0);
    expect(after?.moves).toEqual(['e2e4']);
    expect(isEngineTurn(after!)).toBe(true);
    expect(playMove(game, 'e2e5', T0)).toBeNull();
    expect(playMove(game, 'nonsense', T0)).toBeNull();
  });

  it('shows the position, the moves in SAN and the last move', () => {
    const game = playAll(newGame('w', 3, T0), ['e2e4', 'e7e5', 'g1f3']);
    const position = positionOf(game);
    expect(position.san).toEqual(['e4', 'e5', 'Nf3']);
    expect(position.lastMove).toEqual(['g1', 'f3']);
    expect(position.check).toBe(false);
    expect(position.legalMoves).toContain('b8c6');
  });

  it('promotes with the piece in the UCI move', () => {
    // White pawn on b7, kings far apart.
    const moves = ['a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5a6', 'c8b7', 'a6b7', 'b8c6'];
    const game = playAll(newGame('w', 3, T0), moves);
    const promoted = playMove(game, 'b7a8n', T0);
    expect(positionOf(promoted!).san.at(-1)).toBe('bxa8=N');
  });

  it('ends the game on checkmate', () => {
    const game = playAll(newGame('w', 4, T0), FOOLS_MATE);
    expect(game.outcome).toMatchObject({ result: '0-1', reason: 'checkmate' });
    expect(outcomeForPlayer(game)).toBe('loss');
    expect(describeOutcome(game)).toBe('Stockfish level 4 won by checkmate');
    expect(isEngineTurn(game)).toBe(false);
    expect(playMove(game, 'a2a3', T0)).toBeNull();
    expect(positionOf(game).legalMoves).toEqual([]);
  });

  it('ends the game on a threefold repetition', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const game = playAll(newGame('b', 2, T0), [...shuffle, ...shuffle]);
    expect(game.outcome).toMatchObject({ result: '1/2-1/2', reason: 'threefold' });
    expect(outcomeForPlayer(game)).toBe('draw');
    expect(describeOutcome(game)).toBe('Draw by repetition');
  });

  it('lets the player resign, which the engine wins', () => {
    const asWhite = resign(playAll(newGame('w', 5, T0), ['e2e4']), T0 + 5000);
    expect(asWhite?.outcome).toEqual({ result: '0-1', reason: 'resignation', endedAt: T0 + 5000 });
    expect(describeOutcome(asWhite!)).toBe('Stockfish level 5 won by resignation');
    const asBlack = resign(newGame('b', 5, T0), T0);
    expect(asBlack?.outcome?.result).toBe('1-0');
    expect(resign(asWhite!, T0)).toBeNull();
  });

  describe('take-backs', () => {
    it('undo the engine reply and the player move', () => {
      const game = playAll(newGame('w', 3, T0), ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
      expect(takeBack(game)?.moves).toEqual(['e2e4', 'e7e5']);
    });

    it('undo only the player move while the engine is thinking', () => {
      const game = playAll(newGame('w', 3, T0), ['e2e4', 'e7e5', 'g1f3']);
      expect(takeBack(game)?.moves).toEqual(['e2e4', 'e7e5']);
    });

    it('work for Black, back to the engine first move', () => {
      const game = playAll(newGame('b', 3, T0), ['e2e4', 'e7e5', 'g1f3']);
      expect(takeBack(game)?.moves).toEqual(['e2e4']);
    });

    it('reopen a game lost on the board', () => {
      const lost = playAll(newGame('w', 3, T0), FOOLS_MATE);
      const back = takeBack(lost);
      expect(back?.moves).toEqual(['f2f3', 'e7e5']);
      expect(back?.outcome).toBeNull();
    });

    it('are not possible before the player has moved or after resigning', () => {
      expect(canTakeBack(newGame('w', 3, T0))).toBe(false);
      expect(canTakeBack(playAll(newGame('b', 3, T0), ['e2e4']))).toBe(false);
      expect(canTakeBack(resign(playAll(newGame('w', 3, T0), ['e2e4', 'e7e5']), T0)!)).toBe(false);
      expect(takeBack(newGame('w', 3, T0))).toBeNull();
    });
  });
});

describe('toPgn', () => {
  it('writes a game the importer reads back with the players, result and ending', () => {
    const game = playAll(newGame('b', 6, T0), FOOLS_MATE);
    const pgn = toPgn(game);
    expect(pgn).toContain('[White "Stockfish level 6"]');
    expect(pgn).toContain(`[Black "${PLAYER_NAME}"]`);
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toContain('1. f3 e5 2. g4 Qh4# 0-1');

    const record = recordFromPgn(pgn);
    expect(record.id).toMatch(/^pgn\//);
    expect(record.white.name).toBe('Stockfish level 6');
    expect(record.black.name).toBe(PLAYER_NAME);
    expect(record.result).toBe('0-1');
    expect(record.termination).toBe('You won by checkmate');
    expect(record.endTime).toBe(T0 + 4000);
    expect(parsePgn(record.pgn).moves).toHaveLength(4);
  });

  it('records a resignation as the ending', () => {
    const game = resign(playAll(newGame('w', 2, T0), ['e2e4', 'e7e5']), T0 + 60_000)!;
    const record = recordFromPgn(toPgn(game));
    expect(record.result).toBe('0-1');
    expect(record.termination).toBe('Stockfish level 2 won by resignation');
  });

  it('wraps long games at 80 characters', () => {
    // The closed Ruy Lopez, 22 plies: longer than one line of movetext.
    const ruyLopez = [
      'e2e4',
      'e7e5',
      'g1f3',
      'b8c6',
      'f1b5',
      'a7a6',
      'b5a4',
      'g8f6',
      'e1g1',
      'f8e7',
      'f1e1',
      'b7b5',
      'a4b3',
      'd7d6',
      'c2c3',
      'e8g8',
      'h2h3',
      'c6a5',
      'b3c2',
      'c7c5',
      'd2d4',
      'd8c7',
    ];
    const pgn = toPgn(playAll(newGame('w', 2, T0), ruyLopez));
    const movetext = pgn.split('\n\n')[1]!.trim().split('\n');
    expect(movetext.length).toBeGreaterThan(1);
    for (const line of pgn.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(parsePgn(pgn).moves).toHaveLength(22);
  });
});

describe('sanitizeGame', () => {
  const stored = playAll(newGame('w', 3, T0), ['e2e4', 'e7e5']);

  it('keeps a valid stored game', () => {
    expect(sanitizeGame(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it('drops games that are not valid', () => {
    expect(sanitizeGame(null)).toBeNull();
    expect(sanitizeGame('game')).toBeNull();
    expect(sanitizeGame({ ...stored, player: 'x' })).toBeNull();
    expect(sanitizeGame({ ...stored, level: 12 })).toBeNull();
    expect(sanitizeGame({ ...stored, moves: ['e2e5'] })).toBeNull();
    expect(sanitizeGame({ ...stored, moves: 'e2e4' })).toBeNull();
    expect(
      sanitizeGame({ ...stored, outcome: { result: 'win', reason: 'resignation' } }),
    ).toBeNull();
  });

  it('marks a game over when the stored moves end it', () => {
    const mated = { ...newGame('w', 3, T0), moves: FOOLS_MATE };
    expect(sanitizeGame(mated)?.outcome).toMatchObject({ result: '0-1', reason: 'checkmate' });
  });
});
