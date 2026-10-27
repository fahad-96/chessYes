import { describe, expect, it } from 'vitest';
import { moveAccuracy } from '@/core/accuracy';
import { START_FEN } from '@/core/notation';
import type { Classification, Color, GameRecord, GameResult, TimeClass } from '@/core/types';
import {
  LIBRARY_VERSION,
  emptyCounts,
  type LibraryEntry,
  type LibraryMove,
} from '@/library/library';
import {
  ENDGAME_MATERIAL,
  accuracyTrend,
  baseTimeSeconds,
  biggestMistakes,
  byTimeClass,
  endingOf,
  endingStats,
  entryColor,
  insightGames,
  labelRates,
  mean,
  movingAverage,
  nonPawnMaterial,
  openingCosts,
  openingFamily,
  openingStats,
  outcomeForColor,
  overview,
  phaseAccuracy,
  phaseOf,
  playerEntries,
  resolveFamily,
  scorePercent,
  sortOpeningRows,
  timeTrouble,
  type PlayerEntry,
} from './stats';

let nextId = 1;

const HIKARU = { name: 'Hikaru', rating: 3000 };
const OPPONENT = { name: 'Opponent', rating: 2800 };

function game(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    id: `chesscom/hikaru/2026/10/${nextId++}`,
    source: 'chesscom',
    white: HIKARU,
    black: OPPONENT,
    result: '1-0',
    timeClass: 'blitz',
    variant: 'standard',
    endTime: 1_700_000_000_000 + nextId * 60_000,
    pgn: '',
    ...overrides,
  };
}

/** Hikaru's game with the given colour and result from his side. */
function played(color: Color, outcome: 'win' | 'loss' | 'draw', extra: Partial<GameRecord> = {}) {
  const result: GameResult =
    outcome === 'draw' ? '1/2-1/2' : (outcome === 'win') === (color === 'w') ? '1-0' : '0-1';
  return color === 'w'
    ? game({ result, ...extra })
    : game({ white: OPPONENT, black: HIKARU, result, ...extra });
}

describe('results from the player’s side', () => {
  it('counts wins, draws and losses for the player, not for White', () => {
    const games = [
      played('w', 'win'),
      played('b', 'win'), // 0-1: a win for Hikaru as Black
      played('b', 'loss'), // 1-0: a loss as Black
      played('w', 'draw'),
      played('w', 'loss'),
    ];
    const result = overview(games, 'Hikaru');
    expect(result.all).toEqual({ games: 5, wins: 2, draws: 1, losses: 2 });
    expect(result.white).toEqual({ games: 3, wins: 1, draws: 1, losses: 1 });
    expect(result.black).toEqual({ games: 2, wins: 1, draws: 0, losses: 1 });
    expect(scorePercent(result.all)).toBeCloseTo(50);
    expect(scorePercent(result.black)).toBeCloseTo(50);
  });

  it('matches the username case-insensitively', () => {
    const games = [played('w', 'win'), played('b', 'loss')];
    expect(overview(games, 'HIKARU').all).toEqual({ games: 2, wins: 1, draws: 0, losses: 1 });
    expect(overview(games, '  hikaru ').white.wins).toBe(1);
  });

  it('ignores unfinished games and games the player did not play', () => {
    const games = [
      played('w', 'win'),
      game({ result: '*' }),
      game({ white: { name: 'Someone' }, black: { name: 'Else' }, result: '1-0' }),
    ];
    expect(overview(games, 'hikaru').all.games).toBe(1);
    expect(insightGames(games, 'hikaru')).toHaveLength(1);
  });

  it('keeps only standard chess for insights', () => {
    const games = [played('w', 'win'), played('w', 'win', { variant: 'chess960' })];
    expect(insightGames(games, 'hikaru').map((g) => g.variant)).toEqual(['standard']);
  });

  it('has no score without finished games', () => {
    expect(scorePercent({ games: 0, wins: 0, draws: 0, losses: 0 })).toBeNull();
  });

  it('derives the outcome from a colour', () => {
    expect(outcomeForColor(game({ result: '0-1' }), 'b')).toBe('win');
    expect(outcomeForColor(game({ result: '0-1' }), 'w')).toBe('loss');
    expect(outcomeForColor(game({ result: '1/2-1/2' }), 'w')).toBe('draw');
    expect(outcomeForColor(game({ result: '*' }), 'w')).toBe('unknown');
  });
});

describe('byTimeClass', () => {
  it('groups by time class, fastest first, with the player’s rating oldest first', () => {
    const games = [
      played('w', 'win', {
        timeClass: 'rapid',
        endTime: 3000,
        white: { name: 'Hikaru', rating: 2900 },
      }),
      played('b', 'loss', {
        timeClass: 'bullet',
        endTime: 2000,
        black: { name: 'hikaru', rating: 3300 },
      }),
      played('w', 'draw', {
        timeClass: 'rapid',
        endTime: 1000,
        white: { name: 'Hikaru', rating: 2880 },
      }),
      played('w', 'win', { timeClass: 'rapid', endTime: undefined }),
    ];
    const groups = byTimeClass(games, 'hikaru');
    expect(groups.map((g) => g.timeClass)).toEqual<TimeClass[]>(['bullet', 'rapid']);
    const rapid = groups[1]!;
    expect(rapid.results).toEqual({ games: 3, wins: 2, draws: 1, losses: 0 });
    // The undated game counts for results but has no point on the rating line.
    expect(rapid.ratings.map((p) => [p.time, p.rating])).toEqual([
      [1000, 2880],
      [3000, 2900],
    ]);
    expect(groups[0]!.ratings).toEqual([{ time: 2000, rating: 3300, gameId: games[1]!.id }]);
  });

  it('leaves casual games off the rating line but counts their results', () => {
    const games = [
      played('w', 'win', { endTime: 1000, rated: true, white: { name: 'Hikaru', rating: 3000 } }),
      played('w', 'loss', { endTime: 2000, rated: false, white: { name: 'Hikaru', rating: 3000 } }),
      played('w', 'win', { endTime: 3000, white: { name: 'Hikaru', rating: 3010 } }),
    ];
    const [blitz] = byTimeClass(games, 'hikaru');
    expect(blitz!.results.games).toBe(3);
    expect(blitz!.ratings.map((p) => p.time)).toEqual([1000, 3000]);
  });
});

describe('endings', () => {
  it.each([
    ['Hikaru won by checkmate', '1-0', 'checkmate'],
    ['Hikaru won by resignation', '1-0', 'resignation'],
    ['Hikaru won on time', '0-1', 'time'],
    ['Hikaru won - game abandoned', '1-0', 'abandonment'],
    ['Game drawn by agreement', '1/2-1/2', 'agreement'],
    ['Game drawn by repetition', '1/2-1/2', 'repetition'],
    ['Game drawn by stalemate', '1/2-1/2', 'stalemate'],
    ['Game drawn by insufficient material', '1/2-1/2', 'insufficient'],
    ['Game drawn by timeout vs insufficient material', '1/2-1/2', 'time-vs-insufficient'],
    ['Game drawn by 50-move rule', '1/2-1/2', 'fifty-move'],
    // Kibitz's Lichess descriptions.
    ['Night-King96 won by checkmate', '0-1', 'checkmate'],
    ['Checkmate', '1-0', 'checkmate'],
    ['DrNykterstein won (opponent left the game)', '1-0', 'abandonment'],
    ['Draw by stalemate', '1/2-1/2', 'stalemate'],
    ['Draw (timeout vs insufficient material)', '1/2-1/2', 'time-vs-insufficient'],
    ['Draw (insufficient material)', '1/2-1/2', 'insufficient'],
    ['Draw', '1/2-1/2', 'other'],
    [undefined, '1-0', 'other'],
    // The winner's name never decides the ending.
    ['CheckMate99 won by resignation', '1-0', 'resignation'],
    ['TimeoutKing won by checkmate', '0-1', 'checkmate'],
    ['Resigner won on time', '1-0', 'time'],
    ['won won by resignation', '1-0', 'resignation'],
  ] as const)('reads "%s" (%s) as %s', (termination, result, expected) => {
    expect(endingOf(game({ termination, result }))).toBe(expected);
  });

  it('tallies endings per result from the player’s side, other last', () => {
    const games = [
      played('w', 'win', { termination: 'Hikaru won on time' }),
      played('b', 'win', { termination: 'Hikaru won on time' }),
      played('b', 'win', { termination: 'Hikaru won by resignation' }),
      played('w', 'win', { termination: 'Something new' }),
      played('w', 'win', { termination: 'Something else' }),
      played('w', 'win', { termination: 'Even more' }),
      played('w', 'loss', { termination: 'Opponent won by checkmate' }),
      played('b', 'draw', { termination: 'Game drawn by repetition' }),
    ];
    const stats = endingStats(games, 'hikaru');
    expect(stats.wins).toEqual([
      { ending: 'time', count: 2 },
      { ending: 'resignation', count: 1 },
      { ending: 'other', count: 3 },
    ]);
    expect(stats.losses).toEqual([{ ending: 'checkmate', count: 1 }]);
    expect(stats.draws).toEqual([{ ending: 'repetition', count: 1 }]);
  });
});

describe('opening families', () => {
  it('takes the part before the colon', () => {
    expect(openingFamily('Sicilian Defense: Najdorf Variation, English Attack')).toBe(
      'Sicilian Defense',
    );
    expect(openingFamily('Queen’s Gambit Declined')).toBe('Queen’s Gambit Declined');
  });

  it('matches names without a colon to the longest known family', () => {
    const known = new Set(['Sicilian Defense', 'Queen’s Pawn Game', 'Queen’s Pawn']);
    expect(resolveFamily('Sicilian Defense Najdorf Variation', known)).toBe('Sicilian Defense');
    expect(resolveFamily('Queen’s Pawn Game London System', known)).toBe('Queen’s Pawn Game');
    expect(resolveFamily('Sicilian Defenses', known)).toBe('Sicilian Defenses');
    expect(resolveFamily('French Defense: Winawer', known)).toBe('French Defense');
    expect(resolveFamily('  ', known)).toBe('Unnamed opening');
  });

  it('splits by colour with score, opponent rating and game ids', () => {
    const najdorf = (record: GameRecord) => ({ ...record, eco: 'B90' });
    const games = [
      najdorf(played('b', 'win', { white: { name: 'A', rating: 2700 } })),
      najdorf(played('b', 'draw', { white: { name: 'B', rating: 2900 } })),
      najdorf(played('b', 'loss', { white: { name: 'C' } })),
      played('w', 'win'),
      played('w', 'win', { eco: 'C00' }),
    ];
    const family = (record: GameRecord) =>
      record.eco === 'B90'
        ? 'Sicilian Defense'
        : record.eco === 'C00'
          ? 'French Defense'
          : undefined;
    const { white, black } = openingStats(games, 'hikaru', family);
    expect(black).toHaveLength(1);
    const sicilian = black[0]!;
    expect(sicilian.family).toBe('Sicilian Defense');
    expect(sicilian.color).toBe('b');
    expect(sicilian.results).toEqual({ games: 3, wins: 1, draws: 1, losses: 1 });
    expect(sicilian.score).toBeCloseTo(50);
    // Only rated opponents count towards the average.
    expect(sicilian.opponentRating).toBe(2800);
    expect(sicilian.gameIds).toEqual(games.slice(0, 3).map((g) => g.id));
    expect(white.map((row) => row.family).sort()).toEqual(['French Defense', 'Unnamed opening']);
  });

  it('sorts by any column, ties by games then name', () => {
    const row = (family: string, games: number, score: number, opponentRating: number | null) => ({
      family,
      color: 'w' as const,
      results: { games, wins: 0, draws: 0, losses: games },
      score,
      opponentRating,
      gameIds: [],
    });
    const rows = [row('b', 5, 60, 2500), row('a', 2, 60, null), row('c', 9, 40, 2700)];
    const names = (key: Parameters<typeof sortOpeningRows>[1], dir: 'asc' | 'desc') =>
      sortOpeningRows(rows, key, dir).map((r) => r.family);
    expect(names('games', 'desc')).toEqual(['c', 'b', 'a']);
    expect(names('family', 'asc')).toEqual(['a', 'b', 'c']);
    expect(names('score', 'desc')).toEqual(['b', 'a', 'c']);
    expect(names('opponent', 'desc')).toEqual(['c', 'b', 'a']);
    expect(names('opponent', 'asc')).toEqual(['b', 'c', 'a']);
  });
});

describe('moving average', () => {
  it('averages the trailing window, starting with fewer values', () => {
    expect(movingAverage([10, 20, 30, 40, 50], 3)).toEqual([10, 15, 20, 30, 40]);
  });

  it('handles a window of one, a window longer than the data and empty input', () => {
    expect(movingAverage([1, 2, 3], 1)).toEqual([1, 2, 3]);
    expect(movingAverage([1, 2, 3], 10)).toEqual([1, 1.5, 2]);
    expect(movingAverage([], 5)).toEqual([]);
  });

  it('mean of nothing is null', () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2])).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// Library entries
// ---------------------------------------------------------------------------

interface MoveSpec {
  color: Color;
  classification?: Classification;
  winBefore?: number;
  winAfter?: number;
  fenBefore?: string;
  clock?: number;
}

function move(ply: number, spec: MoveSpec): LibraryMove {
  const winBefore = spec.winBefore ?? 50;
  const winAfter = spec.winAfter ?? winBefore;
  const result: LibraryMove = {
    ply,
    color: spec.color,
    san: `m${ply}`,
    uci: 'e2e4',
    fenBefore: spec.fenBefore ?? START_FEN,
    classification: spec.classification ?? 'best',
    winBefore,
    winAfter,
    winLoss: Math.max(0, winBefore - winAfter),
    accuracy: moveAccuracy(winBefore, winAfter),
  };
  if (spec.clock !== undefined) result.clock = spec.clock;
  return result;
}

/** Alternating moves (White first) from specs without a colour. */
function moves(specs: Omit<MoveSpec, 'color'>[]): LibraryMove[] {
  return specs.map((spec, i) => move(i + 1, { color: i % 2 === 0 ? 'w' : 'b', ...spec }));
}

function entry(
  record: GameRecord,
  options: {
    moves?: LibraryMove[];
    white?: number;
    black?: number;
    whiteCounts?: Partial<Record<Classification, number>>;
    blackCounts?: Partial<Record<Classification, number>>;
    opening?: string;
    perspective?: LibraryEntry['perspective'];
  } = {},
): LibraryEntry {
  const result: LibraryEntry = {
    v: LIBRARY_VERSION,
    gameId: record.id,
    record,
    reviewedAt: record.endTime ?? 0,
    engine: { name: 'Stockfish', depth: 12, multiPv: 2 },
    accuracyModel: 'calibrated',
    white: { accuracy: options.white ?? 90, counts: { ...emptyCounts(), ...options.whiteCounts } },
    black: { accuracy: options.black ?? 80, counts: { ...emptyCounts(), ...options.blackCounts } },
    moves: options.moves ?? moves([{}, {}]),
  };
  if (options.opening) result.opening = { eco: 'B90', name: options.opening };
  if (options.perspective) result.perspective = options.perspective;
  return result;
}

describe('player entries', () => {
  it('uses the saved perspective, else the names on the same site', () => {
    const named = entry(played('b', 'win'));
    expect(entryColor(named, 'chesscom', 'HIKARU')).toBe('b');
    expect(entryColor(named, 'lichess', 'hikaru')).toBeNull();
    const renamed = entry(game({ white: { name: 'Hikaru2' }, black: { name: 'X' } }), {
      perspective: { platform: 'chesscom', username: 'hikaru', color: 'w' },
    });
    expect(entryColor(renamed, 'chesscom', 'Hikaru')).toBe('w');
    expect(entryColor(renamed, 'chesscom', 'someone')).toBeNull();
  });

  it('keeps the player’s games with at least one move of theirs, oldest first', () => {
    const newer = entry(played('w', 'win', { endTime: 2000 }));
    const older = entry(played('b', 'loss', { endTime: 1000 }));
    const noMoves = entry(played('b', 'win', { endTime: 3000 }), { moves: moves([{}]) });
    const stranger = entry(game({ white: { name: 'A' }, black: { name: 'B' } }));
    const result = playerEntries([newer, older, noMoves, stranger], 'chesscom', 'hikaru');
    expect(result.map((e) => [e.entry.gameId, e.color])).toEqual([
      [older.gameId, 'b'],
      [newer.gameId, 'w'],
    ]);
  });

  it('builds the accuracy trend for the player’s side', () => {
    const entries = playerEntries(
      [
        entry(played('w', 'win', { endTime: 1 }), { white: 90, black: 70 }),
        entry(played('b', 'win', { endTime: 2 }), { white: 60, black: 80 }),
        entry(played('w', 'win', { endTime: 3 }), { white: 70, black: 50 }),
      ],
      'chesscom',
      'hikaru',
    );
    const trend = accuracyTrend(entries, 2);
    expect(trend.map((p) => p.accuracy)).toEqual([90, 80, 70]);
    expect(trend.map((p) => p.opponentAccuracy)).toEqual([70, 60, 50]);
    expect(trend.map((p) => p.average)).toEqual([90, 85, 75]);
  });

  it('compares labels per game with the opponents', () => {
    const entries: PlayerEntry[] = [
      {
        entry: entry(played('w', 'win'), {
          whiteCounts: { blunder: 1, brilliant: 1 },
          blackCounts: { blunder: 2, missedWin: 1 },
        }),
        color: 'w',
      },
      {
        entry: entry(played('b', 'loss'), {
          whiteCounts: { mistake: 3 },
          blackCounts: { blunder: 1, inaccuracy: 2 },
        }),
        color: 'b',
      },
    ];
    const rates = Object.fromEntries(labelRates(entries).map((r) => [r.label, r]));
    expect(rates.blunder).toMatchObject({ you: 2, opponents: 2, youPerGame: 1 });
    expect(rates.mistake).toMatchObject({ you: 0, opponents: 3, opponentsPerGame: 1.5 });
    expect(rates.missedWin).toMatchObject({ you: 0, opponents: 1 });
    expect(rates.brilliant).toMatchObject({ you: 1, opponents: 0 });
    expect(rates.inaccuracy).toMatchObject({ you: 2, opponents: 0 });
  });
});

describe('phases', () => {
  // Real positions from the fixture games in src/core/__fixtures__/games.
  /** Gourisetti123 - Ilan_RK, before 25...c4: rook + knight vs rook + bishop. */
  const ROOK_MINOR_EACH = '2r3k1/5ppp/8/P1p5/1n6/4P1PP/5PB1/5RK1 b - - 0 25';
  /** Same game, before 29...Rc8: rook vs rook + bishop. */
  const ROOK_VS_ROOK_BISHOP = '1r3k2/5ppp/B7/8/2p5/4P1PP/5P2/2R3K1 b - - 0 29';
  /** Ten Hertog - Van Foreest, before 35...Kd6: a rook each. */
  const ROOK_ENDING = '8/2k3rp/2p1pp2/1p5R/p3P1P1/5P2/P2K3P/8 b - - 0 35';
  /** Kasparov - Topalov 1999, before 40...c3: queen vs rook. */
  const QUEEN_VS_ROOK = 'Q7/5p1p/6p1/8/2p5/3r1PP1/7P/1K1k4 b - - 2 40';
  /** Kasparov - Topalov 1999, before 25...Kb6: most pieces still on. */
  const MIDDLEGAME = 'b2r3r/k3Rp1p/p2q1np1/Np1P4/3p1Q2/P4PPB/1PP4P/1K6 b - - 1 25';

  it('counts knights, bishops, rooks and queens of both sides', () => {
    expect(nonPawnMaterial(START_FEN)).toBe(62);
    expect(nonPawnMaterial(ROOK_MINOR_EACH)).toBe(16);
    expect(nonPawnMaterial(ROOK_VS_ROOK_BISHOP)).toBe(13);
    expect(nonPawnMaterial(ROOK_ENDING)).toBe(10);
    expect(nonPawnMaterial(QUEEN_VS_ROOK)).toBe(14);
    expect(nonPawnMaterial(MIDDLEGAME)).toBe(45);
  });

  it('classifies real positions', () => {
    const at = (fenBefore: string, classification: Classification = 'good') =>
      move(60, { color: 'b', fenBefore, classification });
    expect(phaseOf(at(MIDDLEGAME), 25)).toBe('middlegame');
    expect(phaseOf(at(ROOK_MINOR_EACH), 25)).toBe('middlegame');
    expect(phaseOf(at(QUEEN_VS_ROOK), 40)).toBe('middlegame');
    expect(phaseOf(at(ROOK_VS_ROOK_BISHOP), 29)).toBe('endgame');
    expect(phaseOf(at(ROOK_ENDING), 35)).toBe('endgame');
    expect(ENDGAME_MATERIAL).toBe(13);
  });

  it('puts the first 12 moves of each side and every book move in the opening', () => {
    const quiet = move(1, { color: 'w', fenBefore: START_FEN });
    expect(phaseOf(quiet, 1)).toBe('opening');
    expect(phaseOf(quiet, 12)).toBe('opening');
    expect(phaseOf(quiet, 13)).toBe('middlegame');
    const book = move(31, { color: 'w', classification: 'book', fenBefore: START_FEN });
    expect(phaseOf(book, 16)).toBe('opening');
    // The move-count rule comes first, even in a (very early) endgame.
    expect(phaseOf(move(20, { color: 'b', fenBefore: ROOK_ENDING }), 10)).toBe('opening');
  });

  it('averages move accuracy per phase for the player and the opponents', () => {
    const list: LibraryMove[] = [];
    // 13 moves each in the opening (move 13 is a book move), then two endgame moves each.
    for (let i = 0; i < 26; i++) {
      const color: Color = i % 2 === 0 ? 'w' : 'b';
      list.push(
        move(i + 1, {
          color,
          classification: i >= 24 ? 'book' : 'best',
          winBefore: 50,
          winAfter: color === 'w' ? 50 : 45,
        }),
      );
    }
    list.push(move(27, { color: 'w', fenBefore: ROOK_ENDING, winBefore: 60, winAfter: 40 }));
    list.push(move(28, { color: 'b', fenBefore: ROOK_ENDING, winBefore: 60, winAfter: 60 }));
    list.push(move(29, { color: 'w', fenBefore: MIDDLEGAME, winBefore: 50, winAfter: 40 }));
    const result = phaseAccuracy([
      { entry: entry(played('w', 'win'), { moves: list }), color: 'w' },
    ]);
    expect(result.opening.you).toEqual({ accuracy: 100, moves: 13 });
    expect(result.opening.opponents.moves).toBe(13);
    expect(result.opening.opponents.accuracy).toBeCloseTo(moveAccuracy(50, 45));
    expect(result.endgame.you).toEqual({ accuracy: moveAccuracy(60, 40), moves: 1 });
    expect(result.endgame.opponents).toEqual({ accuracy: 100, moves: 1 });
    expect(result.middlegame.you).toEqual({ accuracy: moveAccuracy(50, 40), moves: 1 });
    expect(result.middlegame.opponents).toEqual({ accuracy: null, moves: 0 });
  });
});

describe('time trouble', () => {
  it('reads the starting clock from the time control', () => {
    expect(baseTimeSeconds('180+2')).toBe(180);
    expect(baseTimeSeconds('600')).toBe(600);
    expect(baseTimeSeconds('1/86400')).toBeNull();
    expect(baseTimeSeconds('-')).toBeNull();
    expect(baseTimeSeconds(undefined)).toBeNull();
  });

  it('compares errors under 10% of the starting clock with the rest', () => {
    // 3+0 blitz: time trouble is below 18 seconds.
    const blitz = entry(played('w', 'loss', { timeControl: '180' }), {
      moves: [
        move(1, { color: 'w', clock: 170 }),
        move(2, { color: 'b', clock: 5, classification: 'blunder' }), // opponent: ignored
        move(3, { color: 'w', clock: 60, classification: 'mistake' }),
        move(4, { color: 'b', clock: 4 }),
        move(5, { color: 'w', clock: 18 }), // exactly 10%: not yet in trouble
        move(7, { color: 'w', clock: 12, classification: 'blunder' }),
        move(9, { color: 'w', clock: 9, classification: 'missedWin' }),
        move(11, { color: 'w', clock: 3, classification: 'inaccuracy' }),
      ],
    });
    // Daily games and games without clocks are left out.
    const daily = entry(played('w', 'win', { timeControl: '1/86400' }), {
      moves: [move(1, { color: 'w', clock: 1, classification: 'blunder' })],
    });
    const noClock = entry(played('b', 'win', { timeControl: '60' }));
    const calm = entry(played('b', 'win', { timeControl: '300+3' }), {
      moves: [move(2, { color: 'b', clock: 290 }), move(4, { color: 'b', clock: 280 })],
    });
    const stats = timeTrouble([
      { entry: blitz, color: 'w' },
      { entry: daily, color: 'w' },
      { entry: noClock, color: 'b' },
      { entry: calm, color: 'b' },
    ]);
    expect(stats).toMatchObject({
      games: 2,
      gamesInTrouble: 1,
      moves: 8,
      troubleMoves: 3,
      troubleErrors: 2,
      calmErrors: 1,
    });
    expect(stats.troubleRate).toBeCloseTo((2 / 3) * 100);
    expect(stats.calmRate).toBeCloseTo((1 / 5) * 100);
  });

  it('has no rates without clocks', () => {
    const stats = timeTrouble([{ entry: entry(played('w', 'win')), color: 'w' }]);
    expect(stats.games).toBe(0);
    expect(stats.troubleRate).toBeNull();
    expect(stats.calmRate).toBeNull();
  });
});

describe('costly openings and moves', () => {
  it('averages accuracy and score per family, lowest accuracy first', () => {
    const entries: PlayerEntry[] = [
      {
        entry: entry(played('w', 'win'), { white: 90, opening: 'Italian Game: Giuoco Piano' }),
        color: 'w',
      },
      { entry: entry(played('w', 'loss'), { white: 70, opening: 'Italian Game' }), color: 'w' },
      {
        entry: entry(played('b', 'draw', { openingName: 'Sicilian Defense Najdorf Variation' }), {
          black: 60,
        }),
        color: 'b',
      },
      {
        entry: entry(played('b', 'win'), { black: 95, opening: 'Sicilian Defense: Najdorf' }),
        color: 'b',
      },
    ];
    const rows = openingCosts(entries, new Set(['Sicilian Defense']));
    expect(rows.map((r) => [r.family, r.games, r.accuracy, r.score])).toEqual([
      ['Sicilian Defense', 2, 77.5, 75],
      ['Italian Game', 2, 80, 50],
    ]);
  });

  it('lists the player’s costliest mistakes, biggest first', () => {
    const first = entry(played('w', 'loss', { endTime: 1 }), {
      moves: [
        move(1, { color: 'w', classification: 'blunder', winBefore: 60, winAfter: 20 }),
        move(2, { color: 'b', classification: 'blunder', winBefore: 80, winAfter: 10 }),
        // A best move with search noise is not a mistake.
        move(3, { color: 'w', classification: 'best', winBefore: 70, winAfter: 20 }),
        move(5, { color: 'w', classification: 'inaccuracy', winBefore: 50, winAfter: 43 }),
      ],
    });
    const second = entry(played('b', 'loss', { endTime: 2 }), {
      moves: [
        move(2, { color: 'b', classification: 'missedWin', winBefore: 85, winAfter: 45 }),
        move(4, { color: 'b', classification: 'mistake', winBefore: 50, winAfter: 35 }),
      ],
    });
    const list = biggestMistakes(
      [
        { entry: first, color: 'w' },
        { entry: second, color: 'b' },
      ],
      3,
    );
    // Equal losses: the newer game first.
    expect(list.map((m) => [m.entry.gameId, m.move.ply, m.move.winLoss])).toEqual([
      [second.gameId, 2, 40],
      [first.gameId, 1, 40],
      [second.gameId, 4, 15],
    ]);
  });
});
