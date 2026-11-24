/**
 * Strength levels of the Play opponent. Stockfish has no reliable built-in way to play
 * like a weaker human in a WebAssembly build that searches by depth and time, so each
 * level limits the search and then picks among the engine's top candidate moves
 * (see chooseEngineMove in engineMove.ts):
 *
 * - a shallow search (`depth`, `maxTimeMs`) misses deeper tactics;
 * - `multiPv` candidate moves are considered, and a move is picked at random with a
 *   weight of e^(−loss / temperature), where loss is how many win % points it gives up
 *   against the best candidate;
 * - moves that give up more than `maxLoss` are never picked;
 * - `mateVision`: a forced mate in this many moves or fewer is always played;
 * - `randomMoveChance`: now and then a beginner plays any legal move.
 *
 * Every number here is a tuning knob, not a rating: the levels are ordered from weakest
 * to strongest, and level 8 is Stockfish at full strength for the time it is given.
 */
export interface EngineLevel {
  /** 1 (weakest) to 8 (full strength). */
  id: number;
  name: string;
  /** One sentence on how this level plays. */
  blurb: string;
  depth: number;
  maxTimeMs: number;
  multiPv: number;
  /** Win % points; 0 always plays the best candidate. */
  temperature: number;
  /** Win % points a picked move may give up against the best candidate. */
  maxLoss: number;
  /** Always plays a forced mate in this many moves or fewer (0: no such rule). */
  mateVision: number;
  /** Chance (0-1) of playing a uniformly random legal move instead. */
  randomMoveChance: number;
  /** The move never appears sooner than this, so fast replies do not feel abrupt. */
  minThinkMs: number;
}

export const ENGINE_LEVELS: readonly EngineLevel[] = [
  {
    id: 1,
    name: 'Beginner',
    blurb: 'Knows how the pieces move and often leaves them hanging.',
    depth: 1,
    maxTimeMs: 200,
    multiPv: 12,
    temperature: 30,
    maxLoss: 100,
    mateVision: 0,
    randomMoveChance: 0.2,
    minThinkMs: 700,
  },
  {
    id: 2,
    name: 'Novice',
    blurb: 'Takes free pieces but misses most threats.',
    depth: 2,
    maxTimeMs: 250,
    multiPv: 10,
    temperature: 18,
    maxLoss: 60,
    mateVision: 1,
    randomMoveChance: 0.08,
    minThinkMs: 700,
  },
  {
    id: 3,
    name: 'Casual',
    blurb: 'Plays sensible moves and blunders now and then.',
    depth: 4,
    maxTimeMs: 300,
    multiPv: 8,
    temperature: 10,
    maxLoss: 35,
    mateVision: 1,
    randomMoveChance: 0.03,
    minThinkMs: 600,
  },
  {
    id: 4,
    name: 'Club player',
    blurb: 'Solid in quiet positions, can be tricked by tactics.',
    depth: 6,
    maxTimeMs: 400,
    multiPv: 6,
    temperature: 6,
    maxLoss: 20,
    mateVision: 2,
    randomMoveChance: 0,
    minThinkMs: 600,
  },
  {
    id: 5,
    name: 'Strong club player',
    blurb: 'Rarely hangs a piece and punishes loose play.',
    depth: 8,
    maxTimeMs: 600,
    multiPv: 5,
    temperature: 3.5,
    maxLoss: 12,
    mateVision: 3,
    randomMoveChance: 0,
    minThinkMs: 500,
  },
  {
    id: 6,
    name: 'Expert',
    blurb: 'Sees short combinations and converts an advantage.',
    depth: 10,
    maxTimeMs: 800,
    multiPv: 4,
    temperature: 2,
    maxLoss: 6,
    mateVision: 4,
    randomMoveChance: 0,
    minThinkMs: 400,
  },
  {
    id: 7,
    name: 'Master',
    blurb: 'Precise, with only small inaccuracies.',
    depth: 13,
    maxTimeMs: 1200,
    multiPv: 3,
    temperature: 1,
    maxLoss: 3,
    mateVision: 6,
    randomMoveChance: 0,
    minThinkMs: 300,
  },
  {
    id: 8,
    name: 'Stockfish',
    blurb: 'Full strength: always plays the best move it finds.',
    depth: 18,
    maxTimeMs: 2000,
    multiPv: 1,
    temperature: 0,
    maxLoss: 0,
    mateVision: 99,
    randomMoveChance: 0,
    minThinkMs: 200,
  },
];

export const DEFAULT_LEVEL_ID = 3;
export const MIN_LEVEL_ID = 1;
export const MAX_LEVEL_ID = ENGINE_LEVELS.length;

/** The level with this id; out-of-range or invalid ids get the nearest valid level. */
export function engineLevel(id: number): EngineLevel {
  const index = Number.isFinite(id)
    ? Math.min(MAX_LEVEL_ID, Math.max(MIN_LEVEL_ID, Math.round(id))) - 1
    : DEFAULT_LEVEL_ID - 1;
  return ENGINE_LEVELS[index]!;
}

/** True for a whole number that names a level. */
export function isLevelId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_LEVEL_ID &&
    value <= MAX_LEVEL_ID
  );
}

/** The engine's player name in the game record and the PGN, e.g. "Stockfish level 3". */
export function engineName(levelId: number): string {
  return `Stockfish level ${engineLevel(levelId).id}`;
}
