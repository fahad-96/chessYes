import { useCallback, useEffect, useState } from 'react';
import { getLibraryEntries, type LibraryEntry } from '@/library/library';
import {
  loadActivity,
  loadProgress,
  recordAttempt,
  schedule,
  type PuzzleOutcome,
  type PuzzleProgress,
} from './progress';

export interface PuzzleData {
  /** null while loading. */
  entries: LibraryEntry[] | null;
  progress: ReadonlyMap<string, PuzzleProgress>;
  activity: readonly string[];
  /** Stores an attempt; the progress on screen updates at once. */
  record: (id: string, outcome: PuzzleOutcome) => void;
}

/** Loads the library and the puzzle history, and records attempts. */
export function usePuzzleData(): PuzzleData {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [progress, setProgress] = useState<ReadonlyMap<string, PuzzleProgress>>(new Map());
  const [activity, setActivity] = useState<readonly string[]>([]);

  useEffect(() => {
    let cancelled = false;
    // All three never throw: storage problems fall back to memory.
    void Promise.all([getLibraryEntries(), loadProgress(), loadActivity()]).then(
      ([loadedEntries, loadedProgress, loadedActivity]) => {
        if (cancelled) return;
        setProgress(loadedProgress);
        setActivity(loadedActivity);
        setEntries(loadedEntries);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const record = useCallback((id: string, outcome: PuzzleOutcome) => {
    const now = Date.now();
    // Update the screen right away (same computation as recordAttempt), so the next
    // puzzle is picked from fresh data even before storage has answered.
    setProgress((current) => new Map(current).set(id, schedule(current.get(id), id, outcome, now)));
    void recordAttempt(id, outcome, now).then(async (saved) => {
      setProgress((current) => new Map(current).set(id, saved));
      setActivity(await loadActivity());
    });
  }, []);

  return { entries, progress, activity, record };
}
