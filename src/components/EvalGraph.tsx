import { memo, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Classification } from '@/core/types';
import { cn } from '@/lib/cn';
import { CLASSIFICATION_META } from './classificationMeta';
import {
  analysedWidth,
  buildAreaPath,
  buildLinePath,
  plyForKey,
  plyToX,
  winToY,
  xToPly,
} from './evalGraphGeometry';

export interface EvalGraphMarker {
  ply: number;
  classification: Classification;
}

export interface EvalGraphProps {
  /** White's win % per position (index = ply, 0 = start). May cover only part of the game. */
  whiteWinPercents: readonly number[];
  /** Number of moves in the game; the x axis always spans the whole game. */
  totalPlies: number;
  currentPly: number;
  onSeek: (ply: number) => void;
  /** Moves worth a dot on the line (e.g. brilliant moves and blunders). */
  markers?: readonly EvalGraphMarker[];
  /** Tooltip / screen-reader text for a ply, e.g. "14. Nf5 · +1.2". */
  describePly?: (ply: number) => string;
  /** Chart height in px. */
  height?: number;
  className?: string;
}

/** Which classifications get a dot on the graph. */
export const GRAPH_MARKER_CLASSIFICATIONS: readonly Classification[] = [
  'brilliant',
  'great',
  'mistake',
  'blunder',
  'missedWin',
];

const FALLBACK_WIDTH = 320;

/**
 * Area chart of White's winning chances across the game. Click, drag or tap to
 * jump to a move; focus it and use the arrow keys like a slider.
 */
export const EvalGraph = memo(function EvalGraph({
  whiteWinPercents,
  totalPlies,
  currentPly,
  onSeek,
  markers = [],
  describePly,
  height = 96,
  className,
}: EvalGraphProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [hoverPly, setHoverPly] = useState<number | null>(null);
  const dragRef = useRef<{ pointerId: number; touch: boolean } | null>(null);
  const hatchId = `${useId()}-hatch`;

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || FALLBACK_WIDTH);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const size = { width, height };
  const areaPath = buildAreaPath(whiteWinPercents, totalPlies, size);
  const linePath = buildLinePath(whiteWinPercents, totalPlies, size);
  const coveredWidth = analysedWidth(whiteWinPercents.length, totalPlies, width);
  const currentX = plyToX(currentPly, totalPlies, width);
  const currentWin = whiteWinPercents[currentPly];

  const plyAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return xToPly(event.clientX - rect.left, totalPlies, rect.width || width);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const touch = event.pointerType !== 'mouse';
    dragRef.current = { pointerId: event.pointerId, touch };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // On touch, wait: the finger may be starting a vertical scroll (pointercancel).
    if (!touch) onSeek(plyAt(event));
    setHoverPly(plyAt(event));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const ply = plyAt(event);
    setHoverPly(ply);
    if (dragRef.current?.pointerId === event.pointerId && ply !== currentPly) onSeek(ply);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.touch) {
      if (!cancelled) onSeek(plyAt(event));
      setHoverPly(null);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = plyForKey(event.key, currentPly, totalPlies);
    if (next === null) return;
    // Marks the key as handled so the page-level shortcuts do not step twice.
    event.preventDefault();
    if (next !== currentPly) onSeek(next);
  };

  const tooltipPly = hoverPly;
  const tooltipText = tooltipPly !== null && describePly ? describePly(tooltipPly) : null;
  const tooltipX = tooltipPly !== null ? plyToX(tooltipPly, totalPlies, width) : 0;

  return (
    <div
      ref={wrapperRef}
      role="slider"
      tabIndex={0}
      aria-label="Evaluation graph"
      aria-valuemin={0}
      aria-valuemax={totalPlies}
      aria-valuenow={currentPly}
      aria-valuetext={describePly?.(currentPly)}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => endDrag(event, false)}
      onPointerCancel={(event) => endDrag(event, true)}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setHoverPly(null);
      }}
      className={cn(
        'relative cursor-pointer touch-pan-y rounded-sm select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      style={{ height }}
    >
      <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
        <defs>
          <pattern
            id={hatchId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--line)' }} strokeWidth="2" />
          </pattern>
        </defs>

        {/* Not analysed yet: hatched. */}
        <rect
          x={coveredWidth}
          y={0}
          width={Math.max(0, width - coveredWidth)}
          height={height}
          fill={`url(#${hatchId})`}
          opacity={0.6}
        />
        <rect
          x={0}
          y={0}
          width={coveredWidth}
          height={height}
          style={{ fill: 'var(--eval-black)' }}
        />
        {areaPath && <path d={areaPath} style={{ fill: 'var(--eval-white)' }} />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            style={{ stroke: 'var(--muted)' }}
            strokeOpacity={0.5}
            strokeWidth={1}
          />
        )}

        {/* 50% line: equal position. */}
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          style={{ stroke: 'var(--muted)' }}
          strokeOpacity={0.55}
          strokeDasharray="3 3"
          strokeWidth={1}
        />

        {tooltipPly !== null && tooltipPly !== currentPly && (
          <line
            x1={tooltipX}
            x2={tooltipX}
            y1={0}
            y2={height}
            style={{ stroke: 'var(--muted)' }}
            strokeWidth={1}
          />
        )}

        <line
          x1={currentX}
          x2={currentX}
          y1={0}
          y2={height}
          style={{ stroke: 'var(--accent)' }}
          strokeWidth={2}
        />

        {markers.map(({ ply, classification }) => {
          const value = whiteWinPercents[ply];
          if (value === undefined) return null;
          return (
            <circle
              key={ply}
              cx={plyToX(ply, totalPlies, width)}
              cy={winToY(value, height)}
              r={4}
              style={{
                fill: CLASSIFICATION_META[classification].colorVar,
                stroke: 'var(--surface)',
              }}
              strokeWidth={1.5}
            />
          );
        })}

        {currentWin !== undefined && (
          <circle
            cx={currentX}
            cy={winToY(currentWin, height)}
            r={4.5}
            style={{ fill: 'var(--accent)', stroke: 'var(--surface)' }}
            strokeWidth={2}
          />
        )}
      </svg>

      {tooltipText && (
        <div
          className={cn(
            'pointer-events-none absolute top-0 z-10 rounded-md border border-line',
            'bg-surface-3 px-2 py-1 text-xs whitespace-nowrap text-text shadow-lg',
          )}
          style={{
            left: Math.min(Math.max(tooltipX, 48), Math.max(48, width - 48)),
            transform: 'translate(-50%, calc(-100% - 6px))',
          }}
        >
          {tooltipText}
        </div>
      )}
    </div>
  );
});
