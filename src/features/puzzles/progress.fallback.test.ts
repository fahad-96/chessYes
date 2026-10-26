import { describe, expect, it, vi } from 'vitest';

// Every storage call fails, as in a browser with blocked site data.
vi.mock('idb-keyval', () => {
  const fail = () => Promise.reject(new Error('storage blocked'));
  return { createStore: () => () => fail(), get: fail, set: fail, entries: fail, clear: fail };
});

const { loadActivity, loadProgress, recordAttempt } = await import('./progress');

describe('progress without storage', () => {
  it('keeps the session’s progress in memory and never throws', async () => {
    const saved = await recordAttempt('lichess/x#3', 'failed');
    expect(saved.lapses).toBe(1);
    expect((await loadProgress()).get('lichess/x#3')).toEqual(saved);
    expect(await loadActivity()).toHaveLength(1);
    const again = await recordAttempt('lichess/x#3', 'solved');
    expect(again).toMatchObject({ attempts: 2, interval: 1 });
  });
});
