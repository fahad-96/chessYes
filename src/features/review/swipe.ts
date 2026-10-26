import { useMemo, useRef } from 'react';
import type { PointerEvent } from 'react';

export interface PointerSample {
  x: number;
  y: number;
  /** Milliseconds (event.timeStamp). */
  time: number;
}

export interface SwipeOptions {
  /** Minimum horizontal travel in px. */
  minDistance?: number;
  /** Slower gestures are treated as drags or scrolls, not swipes. */
  maxDuration?: number;
  /** Horizontal travel must exceed vertical travel by this factor. */
  ratio?: number;
}

export type SwipeDirection = 'left' | 'right';

/** Classifies a finished gesture as a horizontal swipe, or null (tap, scroll, slow drag). */
export function detectSwipe(
  start: PointerSample,
  end: PointerSample,
  { minDistance = 40, maxDuration = 700, ratio = 1.5 }: SwipeOptions = {},
): SwipeDirection | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const duration = end.time - start.time;
  if (duration < 0 || duration > maxDuration) return null;
  if (Math.abs(dx) < minDistance) return null;
  if (Math.abs(dx) < Math.abs(dy) * ratio) return null;
  return dx < 0 ? 'left' : 'right';
}

/**
 * Pointer handlers that report horizontal swipes from touch or pen input.
 * Pair them with `touch-action: pan-y` so vertical scrolling keeps working: the
 * browser then cancels the pointer (pointercancel) when the user scrolls.
 */
export function useSwipe(onSwipe: (direction: SwipeDirection) => void, options?: SwipeOptions) {
  const startRef = useRef<(PointerSample & { id: number }) | null>(null);
  const minDistance = options?.minDistance;
  const maxDuration = options?.maxDuration;
  const ratio = options?.ratio;

  return useMemo(
    () => ({
      onPointerDown(event: PointerEvent) {
        if (event.pointerType === 'mouse' || !event.isPrimary) return;
        startRef.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          time: event.timeStamp,
        };
      },
      onPointerUp(event: PointerEvent) {
        const start = startRef.current;
        startRef.current = null;
        if (!start || start.id !== event.pointerId) return;
        const direction = detectSwipe(
          start,
          { x: event.clientX, y: event.clientY, time: event.timeStamp },
          { minDistance, maxDuration, ratio },
        );
        if (direction) onSwipe(direction);
      },
      onPointerCancel() {
        startRef.current = null;
      },
    }),
    [onSwipe, minDistance, maxDuration, ratio],
  );
}
