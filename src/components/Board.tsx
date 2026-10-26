import { memo, useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawBrushes, DrawShape } from 'chessground/draw';
import type { Classification, Square } from '@/core/types';
import { sideToMove } from '@/core/notation';
import { cn } from '@/lib/cn';
import { classificationBadgeSvg } from './ClassificationIcon';
import './Board.css';

export type BoardOrientation = 'white' | 'black';

export interface BoardArrow {
  from: Square;
  to: Square;
  /** best = engine's suggestion, threat = opponent's strongest reply, played = the move made. */
  kind: 'best' | 'threat' | 'played';
}

export interface BoardBadge {
  square: Square;
  classification: Classification;
}

export interface BoardProps {
  fen: string;
  orientation: BoardOrientation;
  lastMove?: [Square, Square];
  /** Highlights the king of the side to move. */
  check?: boolean;
  arrows?: readonly BoardArrow[];
  badge?: BoardBadge | null;
  coordinates?: boolean;
  className?: string;
}

/**
 * Arrow colours. Chessground writes these into SVG attributes, where CSS variables
 * do not resolve, so they are literal colours chosen to read on every board theme.
 * The four default brushes are required by the type and kept for completeness.
 */
const BRUSHES: DrawBrushes = {
  green: { key: 'g', color: '#15781b', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
  best: { key: 'kbBest', color: '#22a35a', opacity: 0.95, lineWidth: 12 },
  threat: { key: 'kbThreat', color: '#d93f45', opacity: 0.85, lineWidth: 9 },
  played: { key: 'kbPlayed', color: '#4a7fd9', opacity: 0.8, lineWidth: 9 },
};

function buildShapes(arrows: readonly BoardArrow[], badge: BoardBadge | null | undefined) {
  const shapes: DrawShape[] = arrows
    .filter((arrow) => arrow.from !== arrow.to)
    .map((arrow) => ({ orig: arrow.from, dest: arrow.to, brush: arrow.kind }));
  if (badge) {
    shapes.push({
      orig: badge.square,
      customSvg: { html: classificationBadgeSvg(badge.classification) },
    });
  }
  return shapes;
}

const NO_ARROWS: readonly BoardArrow[] = [];

/**
 * View-only chess board (chessground). The board is created once and updated in
 * place, so moving through a game animates pieces instead of re-rendering.
 *
 * Resizing needs no extra code: chessground observes its wrapper element itself.
 * (Calling api.redrawAll() from another ResizeObserver would leak an observer per
 * call, because every redraw registers a new one.)
 */
export const Board = memo(function Board({
  fen,
  orientation,
  lastMove,
  check = false,
  arrows = NO_ARROWS,
  badge,
  coordinates = true,
  className,
}: BoardProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const positionedRef = useRef(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const api = Chessground(element, {
      viewOnly: true,
      coordinates,
      disableContextMenu: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: false, visible: true, brushes: BRUSHES },
    });
    apiRef.current = api;
    positionedRef.current = false;
    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, [coordinates]);

  const lastFrom = lastMove?.[0];
  const lastTo = lastMove?.[1];

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const turnColor = sideToMove(fen) === 'w' ? 'white' : 'black';
    const config: Config = {
      fen,
      orientation,
      turnColor,
      check: check ? turnColor : false,
      lastMove: lastFrom && lastTo ? [lastFrom, lastTo] : undefined,
    };
    if (!positionedRef.current) {
      // Show the first position immediately instead of animating from the start position.
      positionedRef.current = true;
      api.set({ animation: { enabled: false } });
      api.set(config);
      api.set({ animation: { enabled: true, duration: 180 } });
    } else {
      api.set(config);
    }
  }, [fen, orientation, check, lastFrom, lastTo, coordinates]);

  useEffect(() => {
    apiRef.current?.setAutoShapes(buildShapes(arrows, badge));
  }, [arrows, badge, coordinates]);

  return (
    <div className={cn('kb-board', className)}>
      <div ref={elementRef} />
    </div>
  );
});
