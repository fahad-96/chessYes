import { useCallback, useEffect, useState } from 'react';
import { storyStepDelay } from './story';
import { seekVariation, type Variation } from './variation';

/** Pause between moves when an engine line plays itself. */
export const AUTOPLAY_STEP_MS = 800;

/** Engine lines and stories play themselves; the user's own variations do not. */
function playsItself(variation: Variation): boolean {
  return variation.kind === 'line' || variation.kind === 'story';
}

/** Pause before the next move: stories linger on the step where their motif appears. */
export function autoplayDelay(variation: Variation): number {
  return variation.kind === 'story' ? storyStepDelay(variation) : AUTOPLAY_STEP_MS;
}

export interface VariationControls {
  variation: Variation | null;
  /** An engine line or a story is playing itself. */
  playing: boolean;
  /** Shows a variation (engine lines and stories start playing at once). */
  open: (variation: Variation) => void;
  /** Replaces the variation after a move on the board (stops auto-play). */
  update: (variation: Variation) => void;
  close: () => void;
  seek: (index: number) => void;
  step: (delta: number) => void;
  togglePlay: () => void;
}

/** The variation shown on the board, if any, and auto-play for engine lines. */
export function useVariation(): VariationControls {
  const [variation, setVariation] = useState<Variation | null>(null);
  const [playing, setPlaying] = useState(false);

  const open = useCallback((next: Variation) => {
    setVariation(next);
    setPlaying(playsItself(next) && next.index < next.moves.length);
  }, []);
  const update = useCallback((next: Variation) => {
    setVariation(next);
    setPlaying(false);
  }, []);
  const close = useCallback(() => {
    setVariation(null);
    setPlaying(false);
  }, []);
  const seek = useCallback((index: number) => {
    setPlaying(false);
    setVariation((current) => (current ? seekVariation(current, index) : current));
  }, []);
  const step = useCallback((delta: number) => {
    setPlaying(false);
    setVariation((current) => (current ? seekVariation(current, current.index + delta) : current));
  }, []);
  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Playing from the end starts the line again.
    setVariation((current) =>
      current && current.index >= current.moves.length ? seekVariation(current, 0) : current,
    );
    setPlaying(true);
  }, [playing]);

  useEffect(() => {
    if (!playing || !variation) return;
    if (variation.index >= variation.moves.length) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setVariation((current) => (current ? seekVariation(current, current.index + 1) : null)),
      autoplayDelay(variation),
    );
    return () => clearTimeout(timer);
  }, [playing, variation]);

  return { variation, playing, open, update, close, seek, step, togglePlay };
}
