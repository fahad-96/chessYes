import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameRecord } from '@/core/types';
import { entryColor } from '@/features/insights/stats';
import { getLibraryEntry, type LibraryEntry } from '@/library/library';
import type { Platform } from '@/state/settings';

/**
 * Accuracies of the searched player in games that are already reviewed (in the library),
 * for the badges on the game list. Only the rows on screen are looked up, one IndexedDB
 * read each, so a long list costs nothing until it is shown.
 */

/** Accuracies found earlier, so coming back from a review shows the badges at once. */
const known = new Map<string, number>();

const knownKey = (platform: Platform, username: string, gameId: string) =>
  `${platform}:${username.trim().toLowerCase()}:${gameId}`;

/** The player's game accuracy in a library entry, or null when they made no move in it. */
export function libraryAccuracy(
  entry: LibraryEntry,
  platform: Platform,
  username: string,
): number | null {
  const color = entryColor(entry, platform, username);
  if (!color || !entry.moves.some((move) => move.color === color)) return null;
  return (color === 'w' ? entry.white : entry.black).accuracy;
}

/** Game id → the player's accuracy, for the given (visible) games that are in the library. */
export function useLibraryAccuracies(
  games: readonly GameRecord[],
  platform: Platform,
  username: string,
): ReadonlyMap<string, number> {
  const ids = useMemo(() => games.map((game) => game.id), [games]);
  const idsKey = ids.join('\n');
  const [found, setFound] = useState<Map<string, number>>(() => {
    const initial = new Map<string, number>();
    for (const id of ids) {
      const accuracy = known.get(knownKey(platform, username, id));
      if (accuracy !== undefined) initial.set(id, accuracy);
    }
    return initial;
  });
  /**
   * Ids looked up since this list mounted. Each mount looks again (a game just reviewed may
   * have joined the library); an id is recorded when its answer arrives, not when asked.
   */
  const checked = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    const lookup = (idsKey ? idsKey.split('\n') : []).filter((id) => !checked.current.has(id));
    if (lookup.length === 0) return;
    void Promise.all(
      lookup.map(async (id) => {
        const entry = await getLibraryEntry(id).catch(() => null);
        return [id, entry ? libraryAccuracy(entry, platform, username) : null] as const;
      }),
    ).then((results) => {
      if (!active) return;
      for (const [id] of results) checked.current.add(id);
      setFound((previous) => {
        const next = new Map(previous);
        let changed = false;
        for (const [id, accuracy] of results) {
          const key = knownKey(platform, username, id);
          if (accuracy === null) {
            known.delete(key);
            changed = next.delete(id) || changed;
          } else {
            known.set(key, accuracy);
            if (next.get(id) !== accuracy) {
              next.set(id, accuracy);
              changed = true;
            }
          }
        }
        return changed ? next : previous;
      });
    });
    return () => {
      active = false;
    };
  }, [idsKey, platform, username]);

  return found;
}
