import { describe, expect, it } from 'vitest';
import { pvToSan, sideToMove, uciToSan } from '@/core/notation';
import type { Classification, GameRecord } from '@/core/types';
import {
  LIBRARY_VERSION,
  emptyCounts,
  type LibraryEntry,
  type LibraryMove,
  type Perspective,
} from '@/library/library';
import {
  PUZZLE_RULES,
  analyseLine,
  countThemes,
  generatePuzzles,
  isEndgame,
  libraryPlayers,
  playerKey,
} from './generate';

/** 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? — White mates with Qxf7#. */
const SCHOLAR = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
/** Knight fork: Nc7+ wins the rook on a8. */
const FORK = 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1';
/** Two rooks against a bare king: Ra7 and Rb8# (mate in two). */
const LADDER = '7k/8/8/8/8/8/R7/1R4K1 w - - 0 41';
/** A quiet middlegame position (Italian Game), Black to move. */
const ITALIAN = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 5';

interface MoveSpec {
  ply: number;
  fen: string;
  uci: string;
  classification: Classification;
  winBefore: number;
  winAfter: number;
  winSecondBest?: number;
  best?: string[];
}

function libMove(spec: MoveSpec): LibraryMove {
  const move: LibraryMove = {
    ply: spec.ply,
    color: sideToMove(spec.fen),
    san: uciToSan(spec.fen, spec.uci) ?? '??',
    uci: spec.uci,
    fenBefore: spec.fen,
    classification: spec.classification,
    winBefore: spec.winBefore,
    winAfter: spec.winAfter,
    winLoss: Math.max(0, spec.winBefore - spec.winAfter),
    accuracy: 50,
  };
  if (spec.winSecondBest !== undefined) move.winSecondBest = spec.winSecondBest;
  if (spec.best) {
    const pvSan = pvToSan(spec.fen, spec.best);
    move.best = { uci: spec.best[0]!, san: pvSan[0]!, pvUci: spec.best, pvSan };
  }
  return move;
}

function libEntry(
  gameId: string,
  moves: LibraryMove[],
  // null = no perspective (a default parameter would replace undefined).
  perspective: Perspective | null = { platform: 'lichess', username: 'me', color: 'w' },
  endTime = 1_000,
): LibraryEntry {
  const record: GameRecord = {
    id: gameId,
    source: perspective?.platform ?? 'pgn',
    white: { name: perspective?.color === 'b' ? 'Rival' : 'Me' },
    black: { name: perspective?.color === 'b' ? 'Me' : 'Rival' },
    result: '*',
    timeClass: 'blitz',
    variant: 'standard',
    endTime,
    pgn: '',
  };
  const entry: LibraryEntry = {
    v: LIBRARY_VERSION,
    gameId,
    record,
    reviewedAt: endTime + 1,
    engine: { name: 'Stockfish', depth: 16, multiPv: 2 },
    accuracyModel: 'calibrated',
    white: { accuracy: 80, counts: emptyCounts() },
    black: { accuracy: 80, counts: emptyCounts() },
    moves,
  };
  if (perspective) entry.perspective = perspective;
  return entry;
}

const scholarMiss = (overrides: Partial<MoveSpec> = {}) =>
  libMove({
    ply: 7,
    fen: SCHOLAR,
    uci: 'd2d3',
    classification: 'missedWin',
    winBefore: 97.5,
    winAfter: 55,
    winSecondBest: 60,
    best: ['h5f7'],
    ...overrides,
  });

const forkMiss = (overrides: Partial<MoveSpec> = {}) =>
  libMove({
    ply: 41,
    fen: FORK,
    uci: 'e1d2',
    classification: 'blunder',
    winBefore: 90,
    winAfter: 40,
    winSecondBest: 45,
    best: ['b5c7', 'e8d7', 'c7a8'],
    ...overrides,
  });

describe('generatePuzzles', () => {
  it('turns a missed mate into a puzzle with the full context', () => {
    const [puzzle, ...rest] = generatePuzzles([libEntry('lichess/abc', [scholarMiss()])]);
    expect(rest).toHaveLength(0);
    expect(puzzle).toMatchObject({
      id: 'lichess/abc#7',
      gameId: 'lichess/abc',
      ply: 7,
      fen: SCHOLAR,
      color: 'w',
      solution: ['h5f7'],
      solutionSan: ['Qxf7#'],
      playedUci: 'd2d3',
      playedSan: 'd3',
      playedClassification: 'missedWin',
      winBefore: 97.5,
      winAfter: 55,
      opponent: 'Rival',
      date: 1_000,
      source: 'lichess',
      player: { platform: 'lichess', username: 'me' },
      occurrences: 1,
    });
    expect(puzzle?.themes).toEqual(['mate', 'missed-win']);
  });

  it('tags a fork that wins a rook as material and endgame', () => {
    const [puzzle] = generatePuzzles([libEntry('g', [forkMiss()])]);
    expect(puzzle?.solutionSan).toEqual(['Nc7+', 'Kd7', 'Nxa8']);
    expect(puzzle?.themes).toEqual(['material', 'endgame']);
  });

  it('only uses the perspective player’s moves', () => {
    const asBlack = libEntry('g', [forkMiss()], {
      platform: 'lichess',
      username: 'me',
      color: 'b',
    });
    expect(generatePuzzles([asBlack])).toEqual([]);
  });

  it('skips entries without a perspective', () => {
    expect(generatePuzzles([libEntry('pgn/x', [scholarMiss()], null)])).toEqual([]);
  });

  it('skips moves without a best move, or where the best move was played', () => {
    const noBest = scholarMiss({ best: undefined });
    const playedBest = scholarMiss({ uci: 'h5f7' });
    expect(generatePuzzles([libEntry('g', [noBest, playedBest])])).toEqual([]);
  });

  it('only takes mistakes, blunders and misses', () => {
    for (const classification of [
      'best',
      'excellent',
      'good',
      'book',
      'great',
      'inaccuracy',
    ] as const) {
      expect(generatePuzzles([libEntry('g', [forkMiss({ classification })])])).toEqual([]);
    }
    for (const classification of ['mistake', 'blunder', 'missedWin'] as const) {
      expect(generatePuzzles([libEntry('g', [forkMiss({ classification })])])).toHaveLength(1);
    }
  });

  it('leaves out inaccuracies even when the best line wins material or mates', () => {
    const fork = forkMiss({ classification: 'inaccuracy', winBefore: 70, winAfter: 62 });
    const mate = scholarMiss({ classification: 'inaccuracy', winAfter: 90 });
    expect(generatePuzzles([libEntry('a', [fork]), libEntry('b', [mate])])).toEqual([]);
  });

  it('requires the best move to stand out from the second best', () => {
    const close = forkMiss({ winBefore: 90, winSecondBest: 85 });
    const gap = forkMiss({ winBefore: 90, winSecondBest: 90 - PUZZLE_RULES.minGapToSecond });
    const unknown = forkMiss({ winSecondBest: undefined });
    expect(generatePuzzles([libEntry('a', [close])])).toEqual([]);
    expect(generatePuzzles([libEntry('b', [gap])])).toHaveLength(1);
    expect(generatePuzzles([libEntry('c', [unknown])])).toHaveLength(1);
  });

  it('keeps a mating line even when the second best is close', () => {
    expect(generatePuzzles([libEntry('g', [scholarMiss({ winSecondBest: 97.5 })])])).toHaveLength(
      1,
    );
    // Mate in two (Ra7, then Rb8#), where other moves mate a move later.
    const ladder = libMove({
      ply: 81,
      fen: LADDER,
      uci: 'g1f2',
      classification: 'missedWin',
      winBefore: 100,
      winAfter: 60,
      winSecondBest: 99.5,
      best: ['a2a7', 'h8g8', 'b1b8'],
    });
    const [puzzle] = generatePuzzles([libEntry('g', [ladder])]);
    expect(puzzle?.solutionSan).toEqual(['Ra7', 'Kg8', 'Rb8#']);
    expect(puzzle?.themes).toContain('mate');
  });

  it('does not let a quiet best move through when the second best is close', () => {
    const quiet = libMove({
      ply: 10,
      fen: ITALIAN,
      uci: 'a7a6',
      classification: 'mistake',
      winBefore: 50,
      winAfter: 38,
      winSecondBest: 47,
      best: ['e8g8', 'c1g5', 'h7h6'],
    });
    const me: Perspective = { platform: 'lichess', username: 'me', color: 'b' };
    expect(generatePuzzles([libEntry('g', [quiet], me)])).toEqual([]);
  });

  it('skips positions that stay lost with the best move, and tags defences', () => {
    const lost = forkMiss({ winBefore: 25, winAfter: 5, winSecondBest: 10 });
    const holding = forkMiss({ winBefore: 45, winAfter: 20, winSecondBest: 25 });
    expect(generatePuzzles([libEntry('a', [lost])])).toEqual([]);
    const [puzzle] = generatePuzzles([libEntry('b', [holding])]);
    expect(puzzle?.themes).toContain('defence');
  });

  it('merges a position reached in several games into the oldest puzzle', () => {
    const me: Perspective = { platform: 'lichess', username: 'me', color: 'w' };
    const puzzles = generatePuzzles([
      libEntry('new', [scholarMiss()], me, 3_000),
      libEntry('old', [scholarMiss()], me, 1_000),
      libEntry('middle', [scholarMiss({ ply: 9 })], me, 2_000),
    ]);
    expect(puzzles).toHaveLength(1);
    expect(puzzles[0]).toMatchObject({ id: 'old#7', occurrences: 3 });
  });

  it('keeps the same position apart for different players', () => {
    const puzzles = generatePuzzles([
      libEntry('a', [scholarMiss()], { platform: 'lichess', username: 'me', color: 'w' }),
      libEntry('b', [scholarMiss()], { platform: 'chesscom', username: 'me', color: 'w' }),
    ]);
    expect(puzzles).toHaveLength(2);
  });

  it('sorts puzzles from the newest game, in move order', () => {
    const me: Perspective = { platform: 'lichess', username: 'me', color: 'w' };
    const puzzles = generatePuzzles([
      libEntry('old', [forkMiss()], me, 1_000),
      libEntry(
        'new',
        [
          scholarMiss(),
          // Another fork (knight from d5), so it is not merged with the one from "old".
          forkMiss({
            ply: 61,
            fen: 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 31',
            best: ['d5c7', 'e8d7', 'c7a8'],
          }),
        ],
        me,
        2_000,
      ),
    ]);
    expect(puzzles.map((p) => p.id)).toEqual(['new#7', 'new#61', 'old#41']);
  });

  it('remembers the opponent’s last move for the board highlight', () => {
    const before = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
    const reply = libMove({
      ply: 6,
      fen: before,
      uci: 'g8f6',
      classification: 'blunder',
      winBefore: 50,
      winAfter: 2.5,
    });
    const [puzzle] = generatePuzzles([libEntry('g', [reply, scholarMiss()])]);
    expect(puzzle?.lastMove).toEqual({ uci: 'g8f6', san: 'Nf6' });
  });

  it('keeps the position before a capture that started an exchange, for the story', () => {
    const spec = { classification: 'good' as const, winBefore: 50, winAfter: 50 };
    // ...Nxe4 starts an exchange; after Bxe4 (taking back on e4) it only continues one.
    const capture = libMove({ ...spec, ply: 6, fen: ITALIAN, uci: 'f6e4' });
    const quiet = libMove({ ...spec, ply: 5, fen: FORK, uci: 'e1d1' });
    const takesOnE4 = libMove({
      ...spec,
      ply: 5,
      fen: '4k3/8/8/8/4p3/3B4/8/4K3 w - - 0 1',
      uci: 'd3e4',
    });
    const [started] = generatePuzzles([libEntry('g', [quiet, capture, scholarMiss()])]);
    expect(started?.lastMove).toEqual({ uci: 'f6e4', san: 'Nxe4', fenBefore: ITALIAN });
    const [continued] = generatePuzzles([libEntry('g', [takesOnE4, capture, scholarMiss()])]);
    expect(continued?.lastMove).toEqual({ uci: 'f6e4', san: 'Nxe4' });
  });

  it('ignores a best line whose first move is illegal', () => {
    expect(generatePuzzles([libEntry('g', [scholarMiss({ best: ['a1a8'] })])])).toEqual([]);
  });
});

describe('analyseLine', () => {
  it('measures material at the end of the line', () => {
    expect(analyseLine(FORK, ['b5c7', 'e8d7', 'c7a8'])).toMatchObject({
      materialGain: 5,
      mate: false,
      san: ['Nc7+', 'Kd7', 'Nxa8'],
    });
  });

  it('lets the side to move finish the exchange when the line stops mid-trade', () => {
    // Qxd5 grabs a pawn, but exd5 wins the queen.
    const fen = '4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1';
    expect(analyseLine(fen, ['d1d5'])?.materialGain).toBe(1 - 9);
  });

  it('does not count taking a piece back as winning material', () => {
    // Black just played ...Bxf3; gxf3 only restores the balance.
    const before = 'rn1qkbnr/ppp1pppp/8/3p4/6b1/5N2/PPPPPPPP/RNBQKB1R b KQkq - 2 2';
    const now = 'rn1qkbnr/ppp1pppp/8/3p4/8/5b2/PPPPPPPP/RNBQKB1R w KQkq - 0 3';
    expect(analyseLine(now, ['g2f3'])?.materialGain).toBe(3);
    expect(analyseLine(now, ['g2f3'], before)?.materialGain).toBe(0);
  });

  it('detects mate and stops at illegal moves', () => {
    expect(analyseLine(SCHOLAR, ['h5f7', 'e8e7'])).toMatchObject({ mate: true, uci: ['h5f7'] });
    expect(analyseLine(SCHOLAR, ['h5h8'])).toBeNull();
    expect(analyseLine('not a fen', ['e2e4'])).toBeNull();
  });
});

describe('helpers', () => {
  it('recognises endgames by the number of pieces', () => {
    expect(isEndgame(FORK)).toBe(true);
    expect(isEndgame(SCHOLAR)).toBe(false);
    // Exactly six pieces besides kings and pawns.
    expect(isEndgame('r2qk3/8/8/1n6/8/8/1N6/R2QK3 w - - 0 1')).toBe(true);
    expect(isEndgame('r2qk3/8/8/1n6/8/8/1N6/R2QKB2 w - - 0 1')).toBe(false);
  });

  it('counts themes and lists players by their latest game', () => {
    const me: Perspective = { platform: 'lichess', username: 'Me', color: 'w' };
    const you: Perspective = { platform: 'chesscom', username: 'you', color: 'w' };
    const entries = [
      libEntry('a', [forkMiss()], me, 1_000),
      libEntry('b', [scholarMiss()], you, 2_000),
      libEntry('c', [scholarMiss()], null, 3_000),
    ];
    expect(libraryPlayers(entries).map(playerKey)).toEqual(['chesscom/you', 'lichess/me']);
    expect(countThemes(generatePuzzles(entries))).toEqual({
      mate: 1,
      material: 1,
      defence: 0,
      'missed-win': 1,
      endgame: 1,
    });
  });
});
