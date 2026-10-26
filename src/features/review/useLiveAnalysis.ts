import { useEffect, useState } from 'react';
import type { PositionAnalysis } from '@/core/types';
import { analysePosition } from '@/practice/interactiveEngine';
import { errorMessage, isAbortError } from './reviewHelpers';

/** Search settings for exploring: three lines, deep enough to trust, capped for phones. */
export const LIVE_ANALYSIS = { depth: 20, maxTimeMs: 15_000, multiPv: 3 } as const;
/** Stepping quickly through a line should not start (and abort) a search per position. */
const START_DELAY_MS = 120;
/** Finished searches by FEN, so stepping back and forth through a line is instant. */
const finished = new Map<string, PositionAnalysis>();
const MAX_FINISHED = 64;

function remember(analysis: PositionAnalysis) {
  finished.delete(analysis.fen);
  finished.set(analysis.fen, analysis);
  if (finished.size > MAX_FINISHED) finished.delete(finished.keys().next().value!);
}

export interface LiveAnalysisState {
  /** The latest result for `fen` (partial while the search runs), or null. */
  analysis: PositionAnalysis | null;
  /** The search for `fen` is still deepening. */
  running: boolean;
  error: string | null;
}

interface Result extends LiveAnalysisState {
  fen: string | null;
}

const IDLE: LiveAnalysisState = { analysis: null, running: false, error: null };

/**
 * Analyses one position with the interactive engine and streams deepening results. A new
 * `fen` aborts the previous search; null stops searching.
 */
export function useLiveAnalysis(fen: string | null): LiveAnalysisState {
  const [result, setResult] = useState<Result>({ fen: null, ...IDLE });

  useEffect(() => {
    if (!fen) return;
    const known = finished.get(fen);
    if (known) {
      setResult({ fen, analysis: known, running: false, error: null });
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(() => {
      setResult((current) =>
        current.fen === fen ? current : { fen, analysis: null, running: true, error: null },
      );
      analysePosition(fen, {
        ...LIVE_ANALYSIS,
        signal,
        onUpdate: (partial) => {
          if (!signal.aborted) setResult({ fen, analysis: partial, running: true, error: null });
        },
      }).then(
        (analysis) => {
          if (signal.aborted) return;
          remember(analysis);
          setResult({ fen, analysis, running: false, error: null });
        },
        (error: unknown) => {
          if (signal.aborted || isAbortError(error)) return;
          console.error('Live analysis failed', error);
          setResult((current) => ({
            fen,
            analysis: current.fen === fen ? current.analysis : null,
            running: false,
            error: errorMessage(error),
          }));
        },
      );
    }, START_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fen]);

  if (!fen || result.fen !== fen) return fen ? { ...IDLE, running: true } : IDLE;
  return result;
}
