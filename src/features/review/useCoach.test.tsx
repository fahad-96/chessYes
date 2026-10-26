// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePgn } from '@/core/pgn';
import {
  CLASSIFICATIONS,
  type Classification,
  type GameReview,
  type MoveReview,
} from '@/core/types';
import { useCoach, type CoachOptions } from './useCoach';
import type { Variation } from './variation';

/** Speech that finishes when the test says so. */
const voice = vi.hoisted(() => ({
  narrate: false,
  spoken: [] as string[],
  finish: [] as (() => void)[],
  stops: 0,
}));

vi.mock('@/voice/voice', () => ({
  isVoiceSupported: () => true,
  speak: (text: string) => {
    voice.spoken.push(text);
    return new Promise<void>((resolve) => voice.finish.push(resolve));
  },
  stopSpeaking: () => {
    voice.stops++;
  },
  useVoiceSettings: <T,>(
    select: (state: { narrate: boolean; set: (patch: { narrate?: boolean }) => void }) => T,
  ) =>
    select({
      narrate: voice.narrate,
      set: (patch) => {
        if (patch.narrate !== undefined) voice.narrate = patch.narrate;
      },
    }),
}));

const game = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
const emptyCounts = () =>
  Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;

function moveReview(ply: number): MoveReview {
  const move = game.moves[ply - 1]!;
  return {
    ply,
    color: move.color,
    san: move.san,
    uci: move.uci,
    classification: 'best',
    winBefore: 50,
    winAfter: 50,
    winLoss: 0,
    accuracy: 100,
    evalAfter: { type: 'cp', value: 20 },
    whiteWinAfter: 50,
    explanation: '',
  };
}

const review: GameReview = {
  version: 1,
  engine: { name: 'Stockfish', depth: 18, multiPv: 2 },
  moves: game.moves.map((m) => moveReview(m.ply)),
  white: { accuracy: 90, counts: emptyCounts() },
  black: { accuracy: 90, counts: emptyCounts() },
  whiteWinPercents: [],
  keyMoments: [2, 5],
};

function setup(initial: Partial<CoachOptions> = {}) {
  const showMoment = vi.fn((_ply: number) => 0);
  const props: CoachOptions = {
    game,
    review,
    ply: 0,
    variation: null,
    busy: false,
    showMoment,
    ...initial,
  };
  const hook = renderHook((p: CoachOptions) => useCoach(p), { initialProps: props });
  return { ...hook, props, showMoment };
}

/** Lets pending promise callbacks run. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(voice, { narrate: false, spoken: [], finish: [], stops: 0 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useCoach', () => {
  it('reads each move while narration is on, and nothing while it is off', () => {
    const { rerender, props } = setup();
    rerender({ ...props, ply: 1 });
    expect(voice.spoken).toEqual([]);
    voice.narrate = true;
    rerender({ ...props, ply: 2 });
    expect(voice.spoken).toEqual(['E5 is the best move.']);
    rerender({ ...props, ply: 3 });
    expect(voice.spoken.at(-1)).toBe('Knight f3 is the best move.');
  });

  it('says something right away when narration is switched on', () => {
    const { result } = setup({ ply: 3 });
    act(() => result.current.setNarrate(true));
    expect(voice.narrate).toBe(true);
    expect(voice.spoken).toEqual(['Knight f3 is the best move.']);
  });

  it('reads a story when it opens and stops when it closes', () => {
    voice.narrate = true;
    const { rerender, props } = setup({ ply: 4 });
    const story: Variation = {
      kind: 'story',
      startPly: 4,
      startFen: game.moves[3]!.fenAfter,
      moves: [],
      index: 0,
      story: {
        story: {
          kind: 'refutation',
          fen: game.moves[3]!.fenAfter,
          movesUci: ['f1b5'],
          movesSan: ['Bb5'],
          motifs: [],
          materialSwing: 0,
          text: 'Your opponent replies Bb5.',
        },
        player: 'b',
        mover: 'b',
        afterMove: true,
        anchorLabel: '2... Nc6',
        san: 'Nc6',
        classification: 'mistake',
      },
    };
    rerender({ ...props, ply: 4, variation: story });
    expect(voice.spoken).toEqual(['Your opponent replies Bishop b5.']);
    const stops = voice.stops;
    rerender({ ...props, ply: 4, variation: null });
    expect(voice.stops).toBeGreaterThan(stops);
  });

  it('walks through the key moments as each narration ends', async () => {
    const { result, rerender, props, showMoment } = setup();
    act(() => result.current.startTour());
    expect(showMoment).toHaveBeenCalledWith(2);
    rerender({ ...props, ply: 2 });
    expect(result.current.tour).toMatchObject({ index: 0, total: 2, ply: 2, label: '1... e5' });
    expect(voice.spoken).toEqual(['E5 is the best move.']);
    // The narration ends; after the pause the next moment is shown.
    act(() => voice.finish.shift()?.());
    await flush();
    act(() => vi.advanceTimersByTime(5000));
    expect(showMoment).toHaveBeenLastCalledWith(5);
    rerender({ ...props, ply: 5 });
    expect(result.current.tour).toMatchObject({ index: 1, ply: 5 });
    expect(voice.spoken.at(-1)).toBe('Bishop b5 is the best move.');
    act(() => voice.finish.shift()?.());
    await flush();
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.tour).toBeNull();
  });

  it('stops the tour when the user moves elsewhere', () => {
    const { result, rerender, props } = setup();
    act(() => result.current.startTour());
    rerender({ ...props, ply: 2 });
    expect(result.current.tour).not.toBeNull();
    rerender({ ...props, ply: 3 });
    expect(result.current.tour).toBeNull();
  });
});
