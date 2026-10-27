import { describe, expect, it } from 'vitest';
import { CLIP_MARGIN_MS, type CoachScript } from './coachScript';
import {
  LruCache,
  clipOffsets,
  isPackManifest,
  planLine,
  prefetchDepth,
  prefetchFiles,
  type PackManifest,
} from './packPlan';

const manifest: PackManifest = {
  version: 1,
  voice: 'af_bella',
  clips: {
    'move:Rg8': { file: 'move-rg8-0664ee.mp3', ms: 1060 },
    'phrase:verdict_blunder_1': { file: 'phrase-verdict_blunder_1-b7bd04.mp3', ms: 845 },
    'move:Bxg8': { file: 'move-bxg8-f706fd.mp3', ms: 1195 },
    'phrase:was_better': { file: 'phrase-was_better-fc18d4.mp3', ms: 690 },
  },
};

const blunder: CoachScript = {
  segments: [
    { key: 'move:Rg8', pauseMsAfter: 380 },
    { key: 'phrase:verdict_blunder_1', pauseMsAfter: 340 },
    { key: 'move:Bxg8', pauseMsAfter: 60 },
    { key: 'phrase:was_better' },
  ],
  text: "Rook to g8. That's a blunder. Bishop takes g8 was better.",
};

describe('clipOffsets', () => {
  it('starts each clip at the previous start + its length - both margins + the pause', () => {
    const margins = 2 * CLIP_MARGIN_MS;
    expect(clipOffsets(blunder.segments, [1060, 845, 1195, 690])).toEqual([
      0,
      1060 - margins + 380,
      1060 - margins + 380 + (845 - margins + 340),
      1060 - margins + 380 + (845 - margins + 340) + (1195 - margins + 60),
    ]);
  });

  it('lets a clip without a pause play out in full, and never goes backwards', () => {
    expect(clipOffsets([{ key: 'a' }, { key: 'b' }], [500, 400])).toEqual([0, 500]);
    expect(clipOffsets([{ key: 'a', pauseMsAfter: 0 }, { key: 'b' }], [50, 400])).toEqual([0, 0]);
  });
});

describe('planLine', () => {
  it('schedules a line whose clips are all in the pack, with the manifest lengths', () => {
    const plan = planLine(blunder, manifest);
    expect(plan.kind).toBe('pack');
    if (plan.kind !== 'pack') return;
    expect(plan.clips.map((c) => c.file)).toEqual([
      'move-rg8-0664ee.mp3',
      'phrase-verdict_blunder_1-b7bd04.mp3',
      'move-bxg8-f706fd.mp3',
      'phrase-was_better-fc18d4.mp3',
    ]);
    expect(plan.clips[1]!.offsetMs).toBe(1060 - 2 * CLIP_MARGIN_MS + 380);
    expect(plan.durationMs).toBe(plan.clips[3]!.offsetMs + 690);
  });

  it('gives the whole line to the device voice when any clip is missing', () => {
    const line: CoachScript = {
      segments: [...blunder.segments.slice(0, 2), { key: 'phrase:winning_free_r' }],
      text: 'Rook to g8. That’s a blunder.',
    };
    expect(planLine(line, manifest)).toEqual({
      kind: 'device',
      reason: 'missing',
      missing: ['phrase:winning_free_r'],
    });
  });

  it('uses the device voice without a pack, and for a line without clips', () => {
    expect(planLine(blunder, null)).toMatchObject({ kind: 'device', reason: 'no-pack' });
    expect(planLine({ segments: [], text: 'Hello.' }, manifest)).toMatchObject({
      kind: 'device',
      reason: 'empty',
    });
  });
});

describe('isPackManifest', () => {
  it('accepts a manifest and rejects other answers (a 404 page, broken JSON)', () => {
    expect(isPackManifest(manifest)).toBe(true);
    expect(isPackManifest({ version: 1, clips: {} })).toBe(true);
    expect(isPackManifest(null)).toBe(false);
    expect(isPackManifest('<!doctype html>')).toBe(false);
    expect(isPackManifest({ version: 1, clips: { a: { file: 3 } } })).toBe(false);
  });
});

describe('prefetching', () => {
  it('prefetches less with Data Saver and on slow connections', () => {
    expect(prefetchDepth(undefined, 3)).toBe(3);
    expect(prefetchDepth({ effectiveType: '4g' }, 3)).toBe(3);
    expect(prefetchDepth({ effectiveType: '3g' }, 3)).toBe(1);
    expect(prefetchDepth({ effectiveType: '2g' }, 3)).toBe(0);
    expect(prefetchDepth({ effectiveType: 'slow-2g' }, 3)).toBe(0);
    expect(prefetchDepth({ saveData: true, effectiveType: '4g' }, 3)).toBe(0);
  });

  it('lists the clips of lines the pack can say, once each', () => {
    const missing: CoachScript = { segments: [{ key: 'move:Qh7#' }], text: 'Queen to h7.' };
    const again: CoachScript = { segments: [{ key: 'move:Rg8' }], text: 'Rook to g8.' };
    expect(prefetchFiles([missing, blunder, again], manifest)).toEqual([
      'move-rg8-0664ee.mp3',
      'phrase-verdict_blunder_1-b7bd04.mp3',
      'move-bxg8-f706fd.mp3',
      'phrase-was_better-fc18d4.mp3',
    ]);
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entries beyond its budget', () => {
    const cache = new LruCache<string, number>(10, (value) => value);
    cache.set('a', 4);
    cache.set('b', 4);
    expect(cache.get('a')).toBe(4); // a is now the most recent
    cache.set('c', 4);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.cost).toBe(8);
    expect(cache.size).toBe(2);
  });

  it('keeps the newest entry even when it alone is over the budget', () => {
    const cache = new LruCache<string, number>(10, (value) => value);
    cache.set('a', 3);
    cache.set('big', 30);
    expect([cache.has('a'), cache.has('big'), cache.cost]).toEqual([false, true, 30]);
    cache.set('big', 2);
    expect(cache.cost).toBe(2);
    cache.delete('big');
    expect([cache.size, cache.cost]).toEqual([0, 0]);
  });
});
