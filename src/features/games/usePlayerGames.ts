import { useCallback, useEffect, useRef, useState } from 'react';
import type { Platform } from '@/state/settings';
import { formatMonth } from './gameList';
import {
  classifyLoadError,
  clearCachedList,
  getCachedList,
  isAbortError,
  loadFirstPage,
  loadNextPage,
  setCachedList,
  type GameListData,
  type LoadErrorKind,
} from './playerGames';

export interface PlayerGamesState {
  data: GameListData | null;
  /** 'loading' is the first load only; later pages use `loadingMore`. */
  status: 'loading' | 'ready' | 'error' | 'not-found';
  loadingMore: boolean;
  /** What is being fetched right now, e.g. "Loading October 2026". */
  progressLabel: string | null;
  error: { kind: LoadErrorKind; detail?: string } | null;
}

/**
 * Loads a player's games and keeps them in the module cache. Mount it with
 * `key={platform + username}` so a different player gets a fresh instance.
 */
export function usePlayerGames(platform: Platform, username: string) {
  const [state, setState] = useState<PlayerGamesState>(() => {
    const cached = getCachedList(platform, username);
    return {
      data: cached ?? null,
      status: cached ? 'ready' : 'loading',
      loadingMore: false,
      progressLabel: null,
      error: null,
    };
  });
  const controllerRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(
    async (from: GameListData | null) => {
      if (busyRef.current) return;
      busyRef.current = true;
      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;
      setState((s) => ({
        ...s,
        status: from ? s.status : 'loading',
        loadingMore: from !== null,
        progressLabel: null,
        error: null,
      }));
      const onProgress = (month: { year: number; month: number } | null) => {
        if (signal.aborted) return;
        setState((s) => ({
          ...s,
          progressLabel: month ? `Loading ${formatMonth(month.year, month.month)}` : null,
        }));
      };
      try {
        const data = from
          ? await loadNextPage(from, signal, onProgress)
          : await loadFirstPage(platform, username, signal, onProgress);
        if (signal.aborted) return;
        setCachedList(platform, username, data);
        setState({ data, status: 'ready', loadingMore: false, progressLabel: null, error: null });
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        const kind = classifyLoadError(error);
        const detail = error instanceof Error ? error.message : undefined;
        setState((s) => ({
          ...s,
          status: !from && kind === 'not-found' ? 'not-found' : from ? s.status : 'error',
          loadingMore: false,
          progressLabel: null,
          error: { kind, detail },
        }));
      } finally {
        if (controllerRef.current === controller) {
          busyRef.current = false;
          controllerRef.current = null;
        }
      }
    },
    [platform, username],
  );

  useEffect(() => {
    if (!getCachedList(platform, username)) void run(null);
    return () => {
      // Leaving the page cancels queued requests; anything already loaded stays cached.
      controllerRef.current?.abort();
      controllerRef.current = null;
      busyRef.current = false;
    };
  }, [platform, username, run]);

  const loadMore = useCallback(() => {
    if (state.data?.hasMore) void run(state.data);
  }, [run, state.data]);

  /** Retries whatever failed: the first load, or the next page. */
  const retry = useCallback(() => void run(state.data), [run, state.data]);

  /** Drops the cached list and loads the newest games again. */
  const refresh = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    busyRef.current = false;
    clearCachedList(platform, username);
    setState({
      data: null,
      status: 'loading',
      loadingMore: false,
      progressLabel: null,
      error: null,
    });
    void run(null);
  }, [platform, username, run]);

  return { ...state, loadMore, retry, refresh };
}
