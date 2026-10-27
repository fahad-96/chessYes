import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadOpeningBook } from '@/core/openings';
import type { GameRecord } from '@/core/types';
import type { AccuracyModel } from '@/core/accuracyModel';
import { getLibraryEntries, getOutdatedEntries } from '@/library/library';
import type { Platform } from '@/state/settings';
import { cachedOpeningName, computeOpeningNames, type NameProgress } from './openingNames';
import { entryColor, openingFamily, playerEntries, resolveFamily, type PlayerEntry } from './stats';

export interface OpeningNamesState {
  /** Family of a game, or null while the names are being worked out. */
  familyOf: ((record: GameRecord) => string) | null;
  progress: NameProgress | null;
  /** The opening book did not load; families fall back to the sites' names. */
  bookFailed: boolean;
}

/**
 * Opening families for a set of games, named with the opening book (see openingNames.ts).
 * Names are cached per game, so revisiting the page or changing filters is instant.
 */
export function useOpeningNames(records: readonly GameRecord[]): OpeningNamesState {
  const cached = useMemo(() => {
    const names = new Map<string, string | null>();
    for (const record of records) {
      const name = cachedOpeningName(record.id);
      if (name === undefined) return null;
      names.set(record.id, name);
    }
    return names;
  }, [records]);
  const [computed, setComputed] = useState<{
    records: readonly GameRecord[];
    names: Map<string, string | null>;
  } | null>(null);
  const [progress, setProgress] = useState<NameProgress | null>(null);
  const [bookFailed, setBookFailed] = useState(false);

  useEffect(() => {
    if (cached) return;
    const controller = new AbortController();
    const { signal } = controller;
    loadOpeningBook()
      .then((book) =>
        computeOpeningNames(records, book, {
          signal,
          onProgress: (next) => {
            if (!signal.aborted) setProgress(next);
          },
        }),
      )
      .then(
        (names) => {
          if (!signal.aborted) setComputed({ records, names });
        },
        (error: unknown) => {
          if (signal.aborted) return;
          console.warn('Opening book unavailable; using the sites’ opening names.', error);
          setBookFailed(true);
          setComputed({ records, names: new Map() });
        },
      );
    return () => controller.abort();
  }, [records, cached]);

  const names = cached ?? (computed?.records === records ? computed.names : null);
  const familyOf = useMemo(() => {
    if (!names) return null;
    const known = new Set<string>();
    for (const name of names.values()) if (name) known.add(openingFamily(name));
    return (record: GameRecord) => {
      const name = names.get(record.id);
      return name ? openingFamily(name) : resolveFamily(record.openingName ?? '', known);
    };
  }, [names]);

  return { familyOf, progress: names ? null : progress, bookFailed };
}

export interface PlayerLibraryState {
  /** The player's reviewed games on the current accuracy scale, oldest first; null while loading. */
  entries: PlayerEntry[] | null;
  /**
   * The player's reviewed games that are left out because their accuracies are on another
   * scale: saved with the other Settings choice, or by an older version of Kibitz.
   */
  leftOut: number;
  failed: boolean;
  reload: () => void;
}

/**
 * The player's reviewed games from the library: those saved with this player as the
 * perspective, plus reviews of their games opened without one (matched by name). Only games
 * whose accuracies are on `accuracyModel` count, so averages never mix two scales.
 * Reloads whenever `version` changes (the batch job bumps it as games are saved).
 */
export function usePlayerLibrary(
  platform: Platform,
  username: string,
  accuracyModel: AccuracyModel,
  version: unknown,
): PlayerLibraryState {
  const [state, setState] = useState<{
    all: PlayerEntry[] | null;
    outdated: number;
    failed: boolean;
  }>({ all: null, outdated: 0, failed: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([getLibraryEntries(), getOutdatedEntries()]).then(
      ([all, outdated]) => {
        if (!active) return;
        setState({
          all: playerEntries(all, platform, username),
          outdated: outdated.filter((entry) => entryColor(entry, platform, username)).length,
          failed: false,
        });
      },
      () => {
        if (active) setState((current) => ({ ...current, failed: true }));
      },
    );
    return () => {
      active = false;
    };
  }, [platform, username, version, attempt]);

  const entries = useMemo(
    () => state.all?.filter((item) => item.entry.accuracyModel === accuracyModel) ?? null,
    [state.all, accuracyModel],
  );
  const leftOut = (state.all?.length ?? 0) - (entries?.length ?? 0) + state.outdated;
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { entries, leftOut, failed: state.failed, reload };
}
