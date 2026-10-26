import { createStore, get, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PositionAnalysis } from '@/core/types';
import {
  analysisCacheKey,
  clearAnalysisCache,
  loadAnalyses,
  loadCachedAnalyses,
  saveAnalyses,
} from './cache';

const settings = { depth: 16, multiPv: 2, maxTimeMs: 4000 };

const start: PositionAnalysis = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  depth: 16,
  lines: [
    { pv: ['e2e4', 'e7e5'], score: { type: 'cp', value: 31 }, depth: 16 },
    { pv: ['d2d4'], score: { type: 'cp', value: 25 }, depth: 16 },
  ],
  nodes: 240000,
  timeMs: 310,
};

const mated: PositionAnalysis = {
  fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
  depth: 0,
  lines: [],
  terminal: 'checkmate',
};

/** Same database and store the cache uses, to plant hand-made entries. */
const rawStore = createStore('kibitz-analysis', 'analyses');

beforeEach(async () => {
  await clearAnalysisCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analysisCacheKey', () => {
  it('combines the game, engine and every setting that changes the result', () => {
    expect(analysisCacheKey('chesscom/hikaru/2024/05/123', 'Stockfish 19 lite', settings)).toBe(
      'chesscom/hikaru/2024/05/123|Stockfish 19 lite|d16|pv2|t4000',
    );
  });

  it('differs when a setting differs', () => {
    const base = analysisCacheKey('lichess/abc', 'SF', settings);
    expect(analysisCacheKey('lichess/abc', 'SF', { ...settings, depth: 12 })).not.toBe(base);
    expect(analysisCacheKey('lichess/abc', 'SF', { ...settings, multiPv: 1 })).not.toBe(base);
    expect(analysisCacheKey('lichess/abc', 'SF', { ...settings, maxTimeMs: 1500 })).not.toBe(base);
  });
});

describe('analysis cache', () => {
  it('round-trips partial analyses, keeping gaps as null', async () => {
    const key = analysisCacheKey('pgn/abc', 'SF', settings);
    await saveAnalyses(key, [start, null, mated]);
    expect(await loadAnalyses(key)).toEqual([start, null, mated]);
  });

  it('keeps the analysis a verified one replaced, and rejects anything nested deeper', async () => {
    const verified: PositionAnalysis = { ...start, depth: 20, unverified: start };
    await saveAnalyses('verified', [verified, null, mated]);
    expect(await loadAnalyses('verified')).toEqual([verified, null, mated]);
    const nested = { ...verified, unverified: verified };
    await saveAnalyses('nested', [nested]);
    expect(await loadAnalyses('nested')).toBeNull();
  });

  it('turns holes in sparse arrays into null', async () => {
    const key = 'sparse';
    const sparse: (PositionAnalysis | null)[] = [];
    sparse[2] = start;
    await saveAnalyses(key, sparse);
    expect(await loadAnalyses(key)).toEqual([null, null, start]);
  });

  it('returns null for a missing key', async () => {
    expect(await loadAnalyses('nope')).toBeNull();
  });

  it('stores a versioned envelope with a timestamp', async () => {
    const before = Date.now();
    await saveAnalyses('envelope', [start]);
    const raw = await get('envelope', rawStore);
    expect(raw).toMatchObject({ v: 2, analyses: [start] });
    expect(raw.savedAt).toBeGreaterThanOrEqual(before);
  });

  it('records whether the analyses were verified', async () => {
    await saveAnalyses('plain', [start]);
    await saveAnalyses('verified', [start, mated], { refined: true });
    expect(await loadCachedAnalyses('plain')).toEqual({ analyses: [start], refined: false });
    expect(await loadCachedAnalyses('verified')).toEqual({
      analyses: [start, mated],
      refined: true,
    });
    expect(await get('plain', rawStore)).not.toHaveProperty('refined');
    // Saving again without the flag (new analyses) clears it.
    await saveAnalyses('verified', [start]);
    expect((await loadCachedAnalyses('verified'))?.refined).toBe(false);
    expect(await loadCachedAnalyses('missing')).toBeNull();
  });

  it('reads entries saved before verification existed as not verified', async () => {
    await set('old', { v: 2, savedAt: 1, analyses: [start] }, rawStore);
    expect(await loadCachedAnalyses('old')).toEqual({ analyses: [start], refined: false });
  });

  it('rejects stored data with the wrong shape', async () => {
    const cases: [string, unknown][] = [
      ['not-an-object', 'hello'],
      ['old-version', { v: 1, savedAt: 1, analyses: [start] }],
      ['no-array', { v: 2, savedAt: 1, analyses: 'x' }],
      ['bad-entry', { v: 2, savedAt: 1, analyses: [{ fen: 1, depth: 2, lines: [] }] }],
      [
        'bad-score',
        {
          v: 2,
          savedAt: 1,
          analyses: [
            { ...start, lines: [{ pv: ['e2e4'], score: { type: 'x', value: 1 }, depth: 1 }] },
          ],
        },
      ],
      ['bad-terminal', { v: 2, savedAt: 1, analyses: [{ ...mated, terminal: 'resigned' }] }],
      ['bad-refined', { v: 2, savedAt: 1, analyses: [start], refined: 'yes' }],
    ];
    for (const [key, value] of cases) {
      await set(key, value, rawStore);
      expect(await loadAnalyses(key), key).toBeNull();
    }
  });

  it('clears everything', async () => {
    await saveAnalyses('a', [start]);
    await saveAnalyses('b', [mated]);
    await clearAnalysisCache();
    expect(await loadAnalyses('a')).toBeNull();
    expect(await loadAnalyses('b')).toBeNull();
  });

  it('resolves quietly when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.resetModules();
    // A fresh module instance, so no store was opened before the stub.
    const cache = await import('./cache');
    await expect(cache.saveAnalyses('k', [start])).resolves.toBeUndefined();
    await expect(cache.loadAnalyses('k')).resolves.toBeNull();
    await expect(cache.loadCachedAnalyses('k')).resolves.toBeNull();
    await expect(cache.clearAnalysisCache()).resolves.toBeUndefined();
  });
});
