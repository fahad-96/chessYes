import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Color } from '@/core/types';
import { safeStorage } from '@/lib/safeStorage';
import { getInteractiveEngine } from '@/practice/interactiveEngine';
import { chooseEngineMove } from './engineMove';
import {
  START_FEN,
  canTakeBack,
  isEngineTurn,
  newGame,
  opposite,
  playMove,
  positionOf,
  resign as resignGame,
  sanitizeGame,
  takeBack as takeBackMove,
  type PlayGame,
  type PlayPosition,
} from './game';
import { DEFAULT_LEVEL_ID, engineLevel, isLevelId } from './levels';

export type ColorChoice = Color | 'random';

export interface PlaySetup {
  color: ColorChoice;
  level: number;
}

interface PlayState {
  /** The game on the board (in progress or finished), or null on the setup screen. */
  game: PlayGame | null;
  /** The last choices on the setup screen. */
  setup: PlaySetup;
  setGame: (game: PlayGame | null) => void;
  setSetup: (setup: PlaySetup) => void;
}

const DEFAULT_SETUP: PlaySetup = { color: 'w', level: DEFAULT_LEVEL_ID };

function sanitizeSetup(value: unknown): PlaySetup {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETUP;
  const raw = value as Record<string, unknown>;
  const color =
    raw.color === 'w' || raw.color === 'b' || raw.color === 'random'
      ? raw.color
      : DEFAULT_SETUP.color;
  const level = isLevelId(raw.level) ? raw.level : DEFAULT_SETUP.level;
  return { color, level };
}

/**
 * The current game and the setup choices, kept in localStorage ("kibitz-play") so a
 * reload or a visit to another page resumes the game. Stored values are checked on the
 * way in: a game whose moves are not legal is dropped.
 */
export const usePlayStore = create<PlayState>()(
  persist(
    (set) => ({
      game: null,
      setup: DEFAULT_SETUP,
      setGame: (game) => set({ game }),
      setSetup: (setup) => set({ setup }),
    }),
    {
      name: 'kibitz-play',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ game: state.game, setup: state.setup }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<Record<'game' | 'setup', unknown>>;
        return {
          ...current,
          game: sanitizeGame(stored.game),
          setup: sanitizeSetup(stored.setup),
        };
      },
    },
  ),
);

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export type EngineStatus =
  { status: 'idle' } | { status: 'thinking' } | { status: 'error'; message: string };

export interface PlayControls {
  game: PlayGame | null;
  setup: PlaySetup;
  position: PlayPosition | null;
  engine: EngineStatus;
  canTakeBack: boolean;
  /** Starts a new game; `random` picks the player's colour for 'random'. */
  start: (setup: PlaySetup, random?: () => number) => void;
  /** Plays the player's move (UCI). False when it is not their turn or the move is illegal. */
  move: (uci: string) => boolean;
  resign: () => void;
  takeBack: () => void;
  /** Asks the engine again after it failed. */
  retryEngine: () => void;
  /** Back to the setup screen. */
  leave: () => void;
}

/**
 * Runs a game against the engine: the player's moves come from the board, and whenever it
 * is the engine's turn it searches with the level's limits (levels.ts) and plays the move
 * chooseEngineMove picks. A search is cancelled when the game changes under it (a take-back,
 * resigning, a new game) or the page closes; the next visit asks again.
 */
export function usePlayGame(): PlayControls {
  const game = usePlayStore((state) => state.game);
  const setup = usePlayStore((state) => state.setup);
  const setGame = usePlayStore((state) => state.setGame);
  const setSetup = usePlayStore((state) => state.setSetup);
  const position = useMemo(() => (game ? positionOf(game) : null), [game]);

  /** Engine failures, per position: a failure is shown only for the position it happened in. */
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** The game the engine's hash tables were last cleared for. */
  const engineGameRef = useRef<string | null>(null);

  const engineTurn = game !== null && isEngineTurn(game);
  const positionKey = game ? `${game.id}:${game.moves.length}` : '';

  useEffect(() => {
    if (!game || !isEngineTurn(game)) return;
    const controller = new AbortController();
    const { signal } = controller;
    const startedAt = Date.now();
    const key = `${game.id}:${game.moves.length}`;

    void (async () => {
      const level = engineLevel(game.level);
      const current = positionOf(game);
      const engine = await getInteractiveEngine();
      if (signal.aborted) return;
      if (engineGameRef.current !== game.id) {
        await engine.newGame();
        engineGameRef.current = game.id;
      }
      const analysis = await engine.analyze({
        fen: current.fen,
        initialFen: START_FEN,
        moves: game.moves,
        depth: level.depth,
        maxTimeMs: level.maxTimeMs,
        multiPv: Math.max(1, Math.min(level.multiPv, current.legalMoves.length)),
        signal,
      });
      const uci = chooseEngineMove(analysis, current.legalMoves, opposite(game.player), level);
      await delay(level.minThinkMs - (Date.now() - startedAt), signal);
      if (signal.aborted) return;
      // Only play into the position that was searched.
      const latest = usePlayStore.getState().game;
      if (!latest || latest.id !== game.id || latest.moves.length !== game.moves.length) return;
      const next = playMove(latest, uci, Date.now());
      if (next) setGame(next);
    })().catch((error: unknown) => {
      if (signal.aborted || isAbort(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      setFailure({ key, message });
    });

    return () => controller.abort();
  }, [game, attempt, setGame]);

  const engine: EngineStatus = !engineTurn
    ? { status: 'idle' }
    : failure && failure.key === positionKey
      ? { status: 'error', message: failure.message }
      : { status: 'thinking' };

  const start = useCallback(
    (choice: PlaySetup, random: () => number = Math.random) => {
      const player: Color = choice.color === 'random' ? (random() < 0.5 ? 'w' : 'b') : choice.color;
      setSetup(choice);
      setFailure(null);
      setGame(newGame(player, choice.level, Date.now()));
    },
    [setGame, setSetup],
  );

  const move = useCallback(
    (uci: string) => {
      const current = usePlayStore.getState().game;
      if (!current || current.outcome || isEngineTurn(current)) return false;
      const next = playMove(current, uci, Date.now());
      if (!next) return false;
      setGame(next);
      return true;
    },
    [setGame],
  );

  const resign = useCallback(() => {
    const current = usePlayStore.getState().game;
    const next = current && resignGame(current, Date.now());
    if (next) setGame(next);
  }, [setGame]);

  const takeBack = useCallback(() => {
    const current = usePlayStore.getState().game;
    const next = current && takeBackMove(current);
    if (next) setGame(next);
  }, [setGame]);

  const retryEngine = useCallback(() => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  const leave = useCallback(() => {
    setFailure(null);
    setGame(null);
  }, [setGame]);

  return {
    game,
    setup,
    position,
    engine,
    canTakeBack: game !== null && canTakeBack(game),
    start,
    move,
    resign,
    takeBack,
    retryEngine,
    leave,
  };
}
