/**
 * Calibration run for the move labels: reviews real games with the real engine and
 * prints how often each label is given, so the numbers in thresholds.ts can be judged
 * on real play rather than on hand-made positions. It asserts only that the pipeline
 * works; the output is meant to be read.
 *
 * Skipped unless CALIBRATE is set. It takes minutes per game (single-threaded WASM):
 *
 *   CALIBRATE=1 npx vitest run src/core/calibration.test.ts --silent=false
 *
 * (--silent=false makes sure the tables are printed even by reporters that hide the
 * console output of passing tests.)
 *
 * Environment variables:
 *   CALIBRATE_DEPTH   search depth (default 14); MultiPV is always 2
 *   CALIBRATE_FILTER  only review fixtures whose file name contains this text
 *   CALIBRATE_CACHE   directory to save engine analyses in and reuse them from, so
 *                     changed thresholds can be re-checked in seconds without the engine
 *
 * Fixtures live in src/core/__fixtures__/games. The file name starts with a group
 * (beginner, club, master, famous, ...) that the summary is broken down by; add your own
 * games the same way. For every Brilliant, Great and Miss (and every engine top move
 * that the search after it refutes) the position, the move, the engine lines and the
 * numbers behind the label are printed so each one can be checked by hand, with flags such
 * as in-check or winning-capture. A "what if" table then shows how the counts per
 * player-game would change with other thresholds or extra conditions.
 */
import { Chess } from 'chess.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeGame } from '@/engine/analyzeGame';
import { StockfishEngine } from '@/engine/stockfish';
import { createNodeEngineWorker } from '@/test/nodeStockfish';
import openingsJson from './openings/data/openings.json';
import { createOpeningBook, type OpeningBook, type OpeningBookData } from './openings';
import { materialBalance, staticExchange } from './material';
import { parsePgn } from './pgn';
import { buildGameReview } from './review';
import { THRESHOLDS } from './thresholds';
import {
  CLASSIFICATIONS,
  type Classification,
  type GameReview,
  type MoveReview,
  type ParsedGame,
  type ParsedMove,
  type PositionAnalysis,
  type Square,
  type SuggestedLine,
} from './types';
import { formatScore, scoreToWinPercent, winPercentFor } from './winPercent';

// The app's tsconfig only loads browser types; this file runs in Node under Vitest.
declare const process: { env: Record<string, string | undefined> };

const DEPTH = Number(process.env.CALIBRATE_DEPTH) || 14;
const FILTER = process.env.CALIBRATE_FILTER ?? '';
const CACHE_DIR = process.env.CALIBRATE_CACHE;
/** The time cap is only a safety net: every position should reach the full depth. */
const SETTINGS = { depth: DEPTH, multiPv: 2, maxTimeMs: 300_000 };
const GAME_TIMEOUT_MS = 2 * 60 * 60_000;

interface Fixture {
  name: string;
  /** First word of the file name: beginner, club, master, famous, ... */
  group: string;
  pgn: string;
}

const FIXTURES: Fixture[] = Object.entries(
  import.meta.glob<string>('./__fixtures__/games/*.pgn', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)
  .map(([path, pgn]) => {
    const name = path.replace(/^.*\//, '').replace(/\.pgn$/, '');
    return { name, group: name.split('-')[0] ?? name, pgn };
  })
  .filter((fixture) => fixture.name.includes(FILTER))
  .sort((a, b) => a.name.localeCompare(b.name));

interface GameResult {
  fixture: Fixture;
  game: ParsedGame;
  review: GameReview;
  seconds: number;
}

// ---------------------------------------------------------------------------
// Optional analysis cache (Node fs, loaded only when CALIBRATE_CACHE is set)
// ---------------------------------------------------------------------------

interface NodeFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
}

async function nodeFs(): Promise<NodeFs> {
  // A variable specifier keeps the type checker from looking for Node's type declarations.
  const specifier = 'node:fs/promises';
  return (await import(/* @vite-ignore */ specifier)) as NodeFs;
}

const cachePath = (name: string) => `${CACHE_DIR}/${name}.d${DEPTH}.mpv2.json`;

async function readCache(name: string): Promise<PositionAnalysis[]> {
  if (!CACHE_DIR) return [];
  try {
    const fs = await nodeFs();
    return JSON.parse(await fs.readFile(cachePath(name), 'utf8')) as PositionAnalysis[];
  } catch {
    return []; // no cache yet
  }
}

async function writeCache(name: string, analyses: PositionAnalysis[]): Promise<void> {
  if (!CACHE_DIR) return;
  const fs = await nodeFs();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath(name), JSON.stringify(analyses));
}

// ---------------------------------------------------------------------------
// Per-move facts used by the tables and the "what if" counts
// ---------------------------------------------------------------------------

type Side = 'white' | 'black';

interface MoveFacts {
  move: MoveReview;
  fenBefore: string;
  /** Mover's win % for the engine's second choice, when there was one. */
  winSecond?: number;
  isEngineBest: boolean;
  isRecapture: boolean;
  /** The move answers a check. */
  inCheck: boolean;
  /** The move captures and wins material outright (static exchange >= great.obviousCaptureGain). */
  winningCapture: boolean;
  /**
   * A detected sacrifice that is a capture or a check, where the engine's line has the
   * opponent take the piece and the mover win the material straight back on the next move.
   */
  regainedAtOnce: boolean;
  /**
   * A quiet move (no capture, not answering a check) that takes a piece out of an attack
   * that would have won at least 2 pawns, such as retreating a knight attacked by a pawn.
   */
  rescuesPiece: boolean;
  /** The engine's best move started a forced mate for the mover. */
  hadMate: boolean;
  /** Win % the opponent's previous move gave away, when it was graded an error. */
  opponentGift?: number;
}

/** Material in pawn units from `color`'s point of view. */
const materialFor = (fen: string, color: 'w' | 'b') =>
  color === 'w' ? materialBalance(fen) : -materialBalance(fen);

function regainedAtOnce(move: MoveReview, parsed: ParsedMove): boolean {
  if (!move.sacrifice || (!parsed.captured && !parsed.isCheck)) return false;
  const after = move.evalAfter;
  if (after?.type === 'mate' && (move.color === 'w') === after.value > 0) return false;
  const [reply, answer] = move.playedLine?.pvUci ?? [];
  if (!reply || !answer) return false;
  const chess = new Chess(parsed.fenAfter);
  try {
    if (!chess.move(reply).captured) return false; // the sacrifice is not taken
    chess.move(answer);
  } catch {
    return false;
  }
  const net = materialFor(chess.fen(), move.color) - materialFor(parsed.fenBefore, move.color);
  return net > -THRESHOLDS.brilliant.minSacrifice;
}

/** What the opponent could win on `square` if the mover passed (a null move). */
function threatenedBefore(fenBefore: string, square: string): number {
  const fields = fenBefore.split(' ');
  fields[1] = fields[1] === 'w' ? 'b' : 'w';
  fields[3] = '-';
  return staticExchange(fields.join(' '), square as Square);
}

function moveFacts(result: GameResult): MoveFacts[] {
  return result.review.moves.map((move, i) => {
    const parsed = result.game.moves[i]!;
    const previous = result.game.moves[i - 1];
    const previousReview = result.review.moves[i - 1];
    const inCheck = !!previous?.isCheck;
    const best = move.best?.score;
    const facts: MoveFacts = {
      move,
      fenBefore: parsed.fenBefore,
      isEngineBest: move.best?.uci === move.uci,
      isRecapture: !!previous?.captured && !!parsed.captured && previous.to === parsed.to,
      inCheck,
      winningCapture:
        !!parsed.captured &&
        staticExchange(parsed.fenBefore, parsed.to) >= THRESHOLDS.great.obviousCaptureGain,
      regainedAtOnce: regainedAtOnce(move, parsed),
      rescuesPiece:
        !inCheck &&
        !parsed.captured &&
        parsed.piece !== 'k' &&
        threatenedBefore(parsed.fenBefore, parsed.from) >= 2,
      hadMate: best?.type === 'mate' && (move.color === 'w') === best.value > 0,
    };
    if (previousReview && BASE_ERRORS.has(previousReview.classification)) {
      facts.opponentGift = previousReview.winLoss;
    }
    if (move.secondBest) {
      facts.winSecond = winPercentFor(scoreToWinPercent(move.secondBest.score), move.color);
    }
    return facts;
  });
}

const BASE_ERRORS: ReadonlySet<Classification> = new Set([
  'inaccuracy',
  'mistake',
  'blunder',
  'missedWin',
]);

interface GreatRule {
  minGapToSecond: number;
  maxSecondBestWin: number;
  /** Not for answering a check. */
  noCheckEvasions?: boolean;
  /** Not for captures that simply win material. */
  noWinningCaptures?: boolean;
  /** Not for moving an attacked piece to safety. */
  noPieceRescues?: boolean;
  /** The search after the move must confirm it: at most this much win % lost. */
  maxLoss?: number;
}
interface BrilliantRule {
  minSacrifice: number;
  minWinAfter: number;
  maxSecondBestWin: number;
  /** When answering a check, only the moved piece itself can be the sacrifice. */
  inCheckMovedPieceOnly?: boolean;
  /** Not when the material comes straight back (see MoveFacts.regainedAtOnce). */
  noRegainedAtOnce?: boolean;
}
interface MissRule {
  minMaterialWon: number;
  minGift: number;
  minShareGivenBack: number;
  minWinAfter: number;
}

const ungraded = (m: MoveReview) => m.classification === 'book' || m.classification === 'forced';

/** Would the move be Brilliant under `rule` (same logic as classify.ts)? */
function wouldBeBrilliant(f: MoveFacts, rule: BrilliantRule): boolean {
  const m = f.move;
  if (ungraded(m) || !m.sacrifice || BASE_ERRORS.has(m.classification)) return false;
  if (m.winLoss > THRESHOLDS.brilliant.maxLoss || m.sacrifice.material < rule.minSacrifice) {
    return false;
  }
  if (m.winAfter < rule.minWinAfter) return false;
  if (rule.inCheckMovedPieceOnly && f.inCheck && m.sacrifice.square !== m.uci.slice(2, 4)) {
    return false;
  }
  if (rule.noRegainedAtOnce && f.regainedAtOnce) return false;
  return !(f.winSecond !== undefined && f.winSecond >= rule.maxSecondBestWin);
}

/** Would the move be Great under `rule`, given today's Brilliant rule takes precedence? */
function wouldBeGreat(f: MoveFacts, rule: GreatRule): boolean {
  const m = f.move;
  if (ungraded(m) || m.classification === 'brilliant' || !f.isEngineBest) return false;
  // Checkmate is never Great (classify.ts), whatever the thresholds.
  if (f.winSecond === undefined || f.isRecapture || m.san.endsWith('#')) return false;
  if (rule.noCheckEvasions && f.inCheck) return false;
  if (rule.noWinningCaptures && f.winningCapture) return false;
  if (rule.noPieceRescues && f.rescuesPiece) return false;
  if (rule.maxLoss !== undefined && m.winLoss > rule.maxLoss) return false;
  return m.winBefore - f.winSecond >= rule.minGapToSecond && f.winSecond < rule.maxSecondBestWin;
}

/** Would the error be a Miss under `rule` (same logic as classify.ts)? */
function wouldBeMiss(f: MoveFacts, rule: MissRule): boolean {
  const m = f.move;
  if (!BASE_ERRORS.has(m.classification) || m.winAfter < rule.minWinAfter) return false;
  // The 'missed' and 'refutation' stories are what review.ts measures the material with.
  const materialMissed = (m.bestIdea?.materialSwing ?? 0) - Math.max(0, m.why?.materialSwing ?? 0);
  const couldWinMaterial = materialMissed >= rule.minMaterialWon;
  const gift = f.opponentGift ?? 0;
  const gaveBackGift = gift >= rule.minGift && m.winLoss >= gift * rule.minShareGivenBack;
  return f.hadMate || couldWinMaterial || gaveBackGift;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const SHORT: Record<Classification, string> = {
  brilliant: 'Bril',
  great: 'Grt',
  best: 'Best',
  excellent: 'Exc',
  good: 'Good',
  book: 'Book',
  forced: 'Frc',
  inaccuracy: 'Inac',
  mistake: 'Mist',
  blunder: 'Blun',
  missedWin: 'Miss',
};

const pad = (value: string | number, width: number) => String(value).padStart(width);
const pct = (value: number | undefined) => (value === undefined ? '  -  ' : value.toFixed(1));
const moveLabel = (m: MoveReview) =>
  `${Math.ceil(m.ply / 2)}${m.color === 'w' ? '.' : '...'}${m.san}`;
const lineLabel = (line: SuggestedLine | undefined) =>
  line ? `${line.san} ${formatScore(line.score)}` : '-';

function playerName(game: ParsedGame, side: Side): string {
  const prefix = side === 'white' ? 'White' : 'Black';
  const name = game.headers[prefix] ?? '?';
  const elo = game.headers[`${prefix}Elo`];
  return elo ? `${name} (${elo})` : name;
}

function countsHeader(): string {
  return CLASSIFICATIONS.map((c) => pad(SHORT[c], 5)).join('');
}

function formatGame(result: GameResult, facts: MoveFacts[]): string {
  const { fixture, game, review } = result;
  const out: string[] = [];
  out.push(
    `\n=== ${fixture.name} | ${playerName(game, 'white')} vs ${playerName(game, 'black')} | ` +
      `${game.headers.Result ?? '*'} | ${game.moves.length} plies | depth ${DEPTH} | ` +
      `${result.seconds.toFixed(0)} s`,
  );
  out.push(`        acc ${countsHeader()}`);
  for (const side of ['white', 'black'] as const) {
    const player = review[side];
    const counts = CLASSIFICATIONS.map((c) => pad(player.counts[c], 5)).join('');
    out.push(`${side.padEnd(6)} ${pad(player.accuracy.toFixed(1), 5)}${counts}`);
  }
  for (const f of facts) {
    const m = f.move;
    // The engine's top move whose own search after it finds a loss (horizon effect).
    const refutedTopMove = f.isEngineBest && !ungraded(m) && m.winLoss > 5;
    if (
      m.classification !== 'brilliant' &&
      m.classification !== 'great' &&
      m.classification !== 'missedWin' &&
      !refutedTopMove
    ) {
      continue;
    }
    const gap = f.winSecond === undefined ? '' : ` gap ${(m.winBefore - f.winSecond).toFixed(1)}`;
    const sacrifice = m.sacrifice
      ? ` | sac ${m.sacrifice.piece}@${m.sacrifice.square} ${m.sacrifice.material}`
      : '';
    const flags = [
      f.inCheck && 'in-check',
      f.winningCapture && 'winning-capture',
      f.regainedAtOnce && 'regained-at-once',
      f.rescuesPiece && 'rescues-piece',
      refutedTopMove && 'top-move-refuted-after',
    ].filter(Boolean);
    out.push(
      `  ${m.classification.toUpperCase().padEnd(9)} ${moveLabel(m).padEnd(14)} ` +
        `before ${pct(m.winBefore)} after ${pct(m.winAfter)} second ${pct(f.winSecond)}${gap} | ` +
        `best ${lineLabel(m.best)} | 2nd ${lineLabel(m.secondBest)} | ` +
        `played -> ${m.evalAfter ? formatScore(m.evalAfter) : 'end'}${sacrifice}` +
        (flags.length > 0 ? ` | ${flags.join(' ')}` : ''),
    );
    out.push(`            fen ${f.fenBefore}`);
    out.push(`            line ${m.best?.pvSan.slice(0, 8).join(' ') ?? '-'}`);
  }
  return out.join('\n');
}

interface GroupStats {
  group: string;
  games: number;
  moves: number;
  accuracies: number[];
  counts: Record<Classification, number>;
}

function groupStats(group: string, results: GameResult[]): GroupStats {
  const counts = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<
    Classification,
    number
  >;
  const accuracies: number[] = [];
  let moves = 0;
  for (const { review } of results) {
    moves += review.moves.length;
    for (const side of ['white', 'black'] as const) {
      accuracies.push(review[side].accuracy);
      for (const c of CLASSIFICATIONS) counts[c] += review[side].counts[c];
    }
  }
  return { group, games: results.length, moves, accuracies, counts };
}

function formatSummary(results: GameResult[]): string {
  const groups = [...new Set(results.map((r) => r.fixture.group))];
  const stats = [
    ...groups.map((g) =>
      groupStats(
        g,
        results.filter((r) => r.fixture.group === g),
      ),
    ),
    groupStats('ALL', results),
  ];
  const out: string[] = [`\n=== Summary (depth ${DEPTH}, MultiPV 2, ${results.length} games)`];

  out.push('Per player-game:');
  out.push(
    `${'group'.padEnd(9)} games moves  acc avg  acc range   ` +
      ['Bril', 'Grt', 'Miss', 'Blun', 'Mist', 'Inac'].map((h) => pad(h, 6)).join(''),
  );
  for (const s of stats) {
    const playerGames = s.games * 2;
    const avg = s.accuracies.reduce((a, b) => a + b, 0) / s.accuracies.length;
    const range = `${Math.min(...s.accuracies).toFixed(0)}-${Math.max(...s.accuracies).toFixed(0)}`;
    const per = (['brilliant', 'great', 'missedWin', 'blunder', 'mistake', 'inaccuracy'] as const)
      .map((c) => pad((s.counts[c] / playerGames).toFixed(2), 6))
      .join('');
    out.push(
      `${s.group.padEnd(9)} ${pad(s.games, 5)} ${pad(s.moves, 5)} ${pad(avg.toFixed(1), 8)} ` +
        `${pad(range, 10)}   ${per}`,
    );
  }

  out.push('Labels per 100 moves:');
  out.push(`${'group'.padEnd(9)}${countsHeader()}`);
  for (const s of stats) {
    const per100 = CLASSIFICATIONS.map((c) => pad(((100 * s.counts[c]) / s.moves).toFixed(1), 5));
    out.push(`${s.group.padEnd(9)}${per100.join('')}`);
  }
  return out.join('\n');
}

/** Per player-game counts of a label under alternative thresholds, per group. */
function formatWhatIf(results: GameResult[], allFacts: MoveFacts[][]): string {
  const groups = [...new Set(results.map((r) => r.fixture.group)), 'ALL'];
  const perPlayerGame = (predicate: (f: MoveFacts) => boolean) =>
    groups
      .map((group) => {
        const indexes = results
          .map((r, i) => (group === 'ALL' || r.fixture.group === group ? i : -1))
          .filter((i) => i >= 0);
        const count = indexes.reduce((n, i) => n + allFacts[i]!.filter(predicate).length, 0);
        return pad((count / (2 * indexes.length)).toFixed(2), 9);
      })
      .join('');

  const width = 72;
  const out = [`\n=== What if (per player-game; current values first)`];
  out.push(`${'rule'.padEnd(width)}${groups.map((g) => pad(g, 9)).join('')}`);

  // Today's rule (classify.ts): no check evasions and no winning captures, with maxLoss.
  const great: GreatRule = {
    ...THRESHOLDS.great,
    noCheckEvasions: true,
    noWinningCaptures: true,
  };
  const greatRules: GreatRule[] = [
    great,
    { ...great, minGapToSecond: 10 },
    { ...great, minGapToSecond: 20 },
    { ...great, maxSecondBestWin: 60 },
    { ...great, maxSecondBestWin: 50 },
    { ...great, noPieceRescues: true },
    { ...great, noCheckEvasions: false },
    { ...great, noWinningCaptures: false },
    { ...great, maxLoss: undefined },
    { ...great, minGapToSecond: 10, noCheckEvasions: false, noWinningCaptures: false },
  ];
  for (const rule of greatRules) {
    const label =
      `Great gap>=${rule.minGapToSecond} 2nd<${rule.maxSecondBestWin}` +
      (rule.noCheckEvasions ? ' no-check-evasion' : '') +
      (rule.noWinningCaptures ? ' no-winning-capture' : '') +
      (rule.noPieceRescues ? ' no-rescue' : '') +
      (rule.maxLoss !== undefined ? ` loss<=${rule.maxLoss}` : '');
    out.push(`${label.padEnd(width)}${perPlayerGame((f) => wouldBeGreat(f, rule))}`);
  }

  // Horizon effects: the engine's top move is always Best, even when the search after it
  // finds that it loses a lot. These rows show how often that happens at this depth.
  const refuted = (f: MoveFacts, loss: number) =>
    f.isEngineBest && !ungraded(f.move) && f.move.winLoss > loss;
  for (const loss of [5, 10]) {
    out.push(
      `${`Engine top move, search after it loses > ${loss}`.padEnd(width)}` +
        perPlayerGame((f) => refuted(f, loss)),
    );
  }
  out.push(
    `${'...of which labelled Great or Brilliant (loss > 5)'.padEnd(width)}` +
      perPlayerGame(
        (f) =>
          refuted(f, 5) &&
          (f.move.classification === 'great' || f.move.classification === 'brilliant'),
      ),
  );

  const brilliant = THRESHOLDS.brilliant;
  const strictBrilliant = { inCheckMovedPieceOnly: true, noRegainedAtOnce: true };
  const brilliantRules: BrilliantRule[] = [
    { ...brilliant },
    { ...brilliant, minSacrifice: 3 },
    { ...brilliant, maxSecondBestWin: 90 },
    { ...brilliant, minWinAfter: 60 },
    // Sacrifices whose material comes straight back are already dropped (review.ts), so
    // the last two rows only differ from the first while that rule is switched off.
    { ...brilliant, inCheckMovedPieceOnly: true },
    { ...brilliant, ...strictBrilliant },
  ];
  for (const rule of brilliantRules) {
    const label =
      `Brilliant sac>=${rule.minSacrifice} after>=${rule.minWinAfter} 2nd<${rule.maxSecondBestWin}` +
      (rule.inCheckMovedPieceOnly ? ' in-check-moved-only' : '') +
      (rule.noRegainedAtOnce ? ' not-regained' : '');
    out.push(`${label.padEnd(width)}${perPlayerGame((f) => wouldBeBrilliant(f, rule))}`);
  }

  const miss = THRESHOLDS.miss;
  const missRules: MissRule[] = [
    { ...miss },
    { ...miss, minMaterialWon: 1 },
    { ...miss, minMaterialWon: 3 },
    { ...miss, minGift: 5 },
    { ...miss, minGift: 15 },
    { ...miss, minGift: Infinity },
    { ...miss, minWinAfter: 30 },
    { ...miss, minWinAfter: 50 },
  ];
  for (const rule of missRules) {
    const label =
      `Miss material>=${rule.minMaterialWon} gift>=${rule.minGift} ` +
      `share>=${rule.minShareGivenBack} after>=${rule.minWinAfter}`;
    out.push(`${label.padEnd(width)}${perPlayerGame((f) => wouldBeMiss(f, rule))}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.CALIBRATE)(
  'classification calibration (real games, real engine)',
  () => {
    const results: GameResult[] = [];
    const allFacts: MoveFacts[][] = [];
    let engine: StockfishEngine;
    let book: OpeningBook;

    beforeAll(async () => {
      book = createOpeningBook(openingsJson as unknown as OpeningBookData);
      const worker = await createNodeEngineWorker();
      engine = new StockfishEngine({ createWorker: () => worker });
      await engine.init();
    }, 120_000);

    afterAll(() => {
      engine?.terminate();
      if (results.length === 0) return;
      console.log(formatSummary(results));
      console.log(formatWhatIf(results, allFacts));
    });

    it('has fixtures', () => {
      expect(FIXTURES.length).toBeGreaterThan(0);
    });

    for (const fixture of FIXTURES) {
      it(
        fixture.name,
        async () => {
          const game = parsePgn(fixture.pgn);
          const startedAt = Date.now();
          const analyses = await analyzeGame(game, {
            engine,
            settings: SETTINGS,
            existing: await readCache(fixture.name),
          });
          await writeCache(fixture.name, analyses);
          const review = buildGameReview(game, analyses, {
            book,
            engine: { name: engine.name, depth: DEPTH, multiPv: SETTINGS.multiPv },
          });
          expect(review.moves).toHaveLength(game.moves.length);

          const result = { fixture, game, review, seconds: (Date.now() - startedAt) / 1000 };
          const facts = moveFacts(result);
          results.push(result);
          allFacts.push(facts);
          console.log(formatGame(result, facts));
        },
        GAME_TIMEOUT_MS,
      );
    }
  },
);
