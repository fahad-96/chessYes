/**
 * Opt-in tool: analyses a dataset of real games that carry published accuracies from
 * another site, so Kibitz's accuracy model can be calibrated against them.
 *
 *   ACCURACY_DATASET  JSON file: [{ url, pgn, white: { rating }, black: { rating }, accuracies }]
 *   ACCURACY_OUT      directory for one analysis file per game (existing files are skipped)
 *   ACCURACY_DEPTH    search depth (default 16, the Standard preset)
 *   SHARD             "k/n": analyse every n-th game starting at k (run n processes in parallel)
 *
 * ACCURACY_DATASET=... ACCURACY_OUT=... SHARD=1/4 npx vitest run src/core/accuracyCalibration.test.ts
 */
import { describe, expect, it } from 'vitest';
import { analyzeGame } from '@/engine/analyzeGame';
import { StockfishEngine } from '@/engine/stockfish';
import { createNodeEngineWorker } from '@/test/nodeStockfish';
import { parsePgn } from './pgn';

declare const process: { env: Record<string, string | undefined> };

interface NodeFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  access(path: string): Promise<void>;
}

async function nodeFs(): Promise<NodeFs> {
  const specifier = 'node:fs/promises';
  return (await import(/* @vite-ignore */ specifier)) as NodeFs;
}

interface DatasetGame {
  url: string;
  pgn: string;
}

const DATASET = process.env.ACCURACY_DATASET;
const OUT = process.env.ACCURACY_OUT;
const DEPTH = Number(process.env.ACCURACY_DEPTH) || 16;
const [SHARD_K, SHARD_N] = (process.env.SHARD ?? '1/1').split('/').map(Number) as [number, number];

describe.skipIf(!DATASET || !OUT)('accuracy calibration analysis', () => {
  it(
    `analyses shard ${SHARD_K}/${SHARD_N} at depth ${DEPTH}`,
    async () => {
      const fs = await nodeFs();
      const dataset = JSON.parse(await fs.readFile(DATASET!, 'utf8')) as DatasetGame[];
      await fs.mkdir(OUT!, { recursive: true });
      const worker = await createNodeEngineWorker();
      const engine = new StockfishEngine({ createWorker: () => worker });
      await engine.init();
      let analysed = 0;
      for (const [index, entry] of dataset.entries()) {
        if (index % SHARD_N !== SHARD_K - 1) continue;
        const id = entry.url.split('/').pop()!;
        const file = `${OUT}/${id}.d${DEPTH}.json`;
        try {
          await fs.access(file);
          continue; // already analysed
        } catch {
          // not yet
        }
        let game;
        try {
          game = parsePgn(entry.pgn);
        } catch {
          continue; // unreadable PGN
        }
        const analyses = await analyzeGame(game, {
          engine,
          settings: { depth: DEPTH, multiPv: 2, maxTimeMs: 120_000 },
        });
        await fs.writeFile(file, JSON.stringify({ url: entry.url, depth: DEPTH, analyses }));
        analysed++;
        console.log(`[shard ${SHARD_K}/${SHARD_N}] ${analysed} games, last ${id}`);
      }
      expect(analysed).toBeGreaterThanOrEqual(0);
    },
    12 * 60 * 60_000,
  );
});
