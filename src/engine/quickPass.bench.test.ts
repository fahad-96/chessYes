/**
 * Benchmark for the quick first pass (QUICK_PASS in presets.ts): runs the real engine in
 * Node over a 40-move game and prints how long the pass takes and how close its labels are
 * to a full-depth review. Use it when tuning QUICK_PASS. It asserts only that it ran.
 *
 * Skipped unless BENCH_QUICK is set (a full-depth reference pass takes a few minutes):
 *
 *   BENCH_QUICK=1 npx vitest run src/engine/quickPass.bench.test.ts --silent=false
 *
 * Environment variables:
 *   BENCH_DEPTHS     comma-separated quick depths to try (default "6,8,10")
 *   BENCH_REFERENCE  depth of the reference pass the labels are compared with (default 16;
 *                    0 skips it)
 *   BENCH_GAME       fixture in src/core/__fixtures__/games whose file name contains this
 *                    text (default: a 40-move master game)
 *
 * Node on a desktop is several times faster than WebAssembly on a mid-range phone, so read
 * the times as relative: what matters is how they scale with depth and the time cap.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import openingsJson from '@/core/openings/data/openings.json';
import { createOpeningBook, type OpeningBook, type OpeningBookData } from '@/core/openings';
import { parsePgn } from '@/core/pgn';
import { buildGameReview } from '@/core/review';
import type { AnalysisSettings, Classification, GameReview, PositionAnalysis } from '@/core/types';
import { createNodeEngineWorker } from '@/test/nodeStockfish';
import { analyzeGame } from './analyzeGame';
import { QUICK_PASS } from './presets';
import { StockfishEngine } from './stockfish';

// The app's tsconfig only loads browser types; this file runs in Node under Vitest.
declare const process: { env: Record<string, string | undefined> };

const ENABLED = !!process.env.BENCH_QUICK;
const DEPTHS = (process.env.BENCH_DEPTHS ?? '6,8,10').split(',').map(Number).filter(Boolean);
const REFERENCE_DEPTH = Number(process.env.BENCH_REFERENCE ?? 16);
const GAME = process.env.BENCH_GAME ?? 'tenhertog-vanforeest';
const TIMEOUT_MS = 30 * 60_000;

const FIXTURES = import.meta.glob<string>('../core/__fixtures__/games/*.pgn', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const pgn = Object.entries(FIXTURES).find(([path]) => path.includes(GAME))?.[1];
const game = parsePgn(pgn ?? '');
let book: OpeningBook;
let engine: StockfishEngine;

async function timedPass(settings: AnalysisSettings) {
  const startedAt = performance.now();
  const analyses = await analyzeGame(game, { engine, settings });
  const elapsedMs = performance.now() - startedAt;
  const searched = analyses.filter((analysis) => !analysis.terminal);
  const capped = searched.filter((analysis) => analysis.depth < settings.depth).length;
  // Search time as the engine reports it, without the Node harness's per-message overhead.
  const engineMs = searched.reduce((sum, analysis) => sum + (analysis.timeMs ?? 0), 0);
  return { analyses, elapsedMs, engineMs, searched: searched.length, capped };
}

function review(analyses: PositionAnalysis[], settings: AnalysisSettings): GameReview {
  return buildGameReview(game, analyses, {
    book,
    engine: { name: 'bench', depth: settings.depth, multiPv: settings.multiPv },
  });
}

const SEVERITY: Partial<Record<Classification, number>> = {
  inaccuracy: 1,
  mistake: 2,
  blunder: 3,
  missedWin: 2,
};

describe.runIf(ENABLED)('quick pass benchmark (real engine, Node)', () => {
  beforeAll(async () => {
    book = createOpeningBook(openingsJson as unknown as OpeningBookData);
    const worker = await createNodeEngineWorker();
    engine = new StockfishEngine({ createWorker: () => worker });
    await engine.init();
  }, TIMEOUT_MS);

  afterAll(() => engine?.terminate());

  it(
    'times the quick pass and compares its labels with a deeper review',
    async () => {
      const reference =
        REFERENCE_DEPTH > 0
          ? await timedPass({ depth: REFERENCE_DEPTH, multiPv: 2, maxTimeMs: 60_000 })
          : null;
      const referenceReview = reference
        ? review(reference.analyses, { depth: REFERENCE_DEPTH, multiPv: 2, maxTimeMs: 0 })
        : null;

      const rows: string[] = [
        `Game: ${GAME}, ${game.moves.length} plies, ${game.moves.length + 1} positions`,
        reference
          ? `Reference depth ${REFERENCE_DEPTH}: ${(reference.elapsedMs / 1000).toFixed(1)} s`
          : 'No reference pass',
        'depth  cap ms  total s  engine s  ms/pos  capped  same label  error-grade diffs',
      ];
      const candidates = [
        ...DEPTHS.map((depth) => ({ ...QUICK_PASS, depth })),
        // The shipped settings, in case they are not among the depths above.
        ...(DEPTHS.includes(QUICK_PASS.depth) ? [] : [QUICK_PASS]),
      ];
      for (const settings of candidates) {
        const pass = await timedPass(settings);
        let same = '-';
        let gradeDiffs = '-';
        if (referenceReview) {
          const quick = review(pass.analyses, settings);
          const pairs = quick.moves.map((move, i) => [move, referenceReview.moves[i]!] as const);
          same = `${pairs.filter(([a, b]) => a.classification === b.classification).length}`;
          // Moves where one review calls it an error and the other a different grade of error
          // (or none): the differences a reader would actually notice.
          gradeDiffs = `${
            pairs.filter(
              ([a, b]) => (SEVERITY[a.classification] ?? 0) !== (SEVERITY[b.classification] ?? 0),
            ).length
          }`;
        }
        rows.push(
          [
            String(settings.depth).padStart(5),
            String(settings.maxTimeMs).padStart(7),
            (pass.elapsedMs / 1000).toFixed(1).padStart(8),
            (pass.engineMs / 1000).toFixed(1).padStart(9),
            (pass.elapsedMs / pass.searched).toFixed(0).padStart(7),
            String(pass.capped).padStart(7),
            `${same}/${game.moves.length}`.padStart(11),
            gradeDiffs.padStart(18),
          ].join(' '),
        );
      }
      console.log(rows.join('\n'));
      expect(rows.length).toBeGreaterThan(3);
    },
    TIMEOUT_MS,
  );
});
