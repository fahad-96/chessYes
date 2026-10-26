import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/cn';
import { linePath, nearestIndex, niceScale, scaleLinear } from './chartGeometry';

export interface PointDescription {
  /** The value, shown first and strongest. */
  value: string;
  /** Secondary lines: date, opponent, ... */
  details: string[];
}

export interface LineChartProps {
  /** X position of every point (epoch ms, game number, ...), ascending. */
  xs: readonly number[];
  /** The emphasised series, one value per x, drawn as a line. */
  values: readonly number[];
  /** Optional context values, one per x, drawn as small grey dots behind the line. */
  context?: readonly number[];
  /** Keeps the automatic y range inside these bounds (e.g. accuracy 0-100). */
  yBounds?: readonly [number, number];
  /** Plot height in px, x-axis labels included. */
  height?: number;
  /** Accessible name of the chart. */
  label: string;
  formatY: (value: number) => string;
  /** Whole-number ticks only, for values formatted without decimals. */
  integerTicks?: boolean;
  /** Labels under the two ends of the x axis. */
  xLabels: readonly [string, string];
  /** Shorter labels for when `xLabels` do not fit side by side. */
  xLabelsShort?: readonly [string, string];
  describe: (index: number) => PointDescription;
  /** Called on click, Enter, or a second tap on the same point. */
  onActivate?: (index: number) => void;
  /** Direct label at the end of the line, e.g. the current rating. */
  endLabel?: string;
  /**
   * Marks every point of the line, so a few games read as separate games rather than as a
   * trend. Left out automatically when the points are too close together.
   */
  markers?: boolean;
  className?: string;
}

const FALLBACK_WIDTH = 320;
const MARGIN = { top: 10, bottom: 22, left: 40 };
const TOOLTIP_WIDTH = 176;
/** Markers need this much room per point (px) to stay apart. */
const MIN_MARKER_GAP = 14;

/**
 * Single-series line chart with a crosshair: hover, tap or use the arrow keys to read a point;
 * click or press Enter to open it. Colours come from the .kb-viz tokens (insights.css).
 */
export function LineChart({
  xs,
  values,
  context,
  yBounds,
  height = 168,
  label,
  formatY,
  integerTicks = false,
  xLabels,
  xLabelsShort,
  describe,
  onActivate,
  endLabel,
  markers = false,
  className,
}: LineChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [active, setActive] = useState<number | null>(null);
  const lastTouchRef = useRef<number | null>(null);
  const pointerTypeRef = useRef<string>('mouse');

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

  const count = Math.min(xs.length, values.length);
  const all = [...values.slice(0, count), ...(context?.slice(0, count) ?? [])];
  let low = Math.min(...all);
  let high = Math.max(...all);
  if (yBounds) {
    low = Math.max(yBounds[0], low);
    high = Math.min(yBounds[1], high);
  }
  const scale = niceScale(low, high, height < 150 ? 3 : 4, integerTicks);
  if (yBounds) {
    scale.ticks = scale.ticks.filter((t) => t >= yBounds[0] && t <= yBounds[1]);
    scale.min = Math.max(scale.min, yBounds[0]);
    scale.max = Math.min(scale.max, yBounds[1]);
  }
  const right = endLabel ? Math.max(36, endLabel.length * 7 + 14) : 12;
  const plotWidth = Math.max(40, width - MARGIN.left - right);
  const plotBottom = height - MARGIN.bottom;
  const first = xs[0] ?? 0;
  const last = xs[count - 1] ?? first;
  const xScale =
    count > 1
      ? scaleLinear([first, last], [MARGIN.left, MARGIN.left + plotWidth])
      : () => MARGIN.left + plotWidth / 2;
  const yScale = scaleLinear([scale.min, scale.max], [plotBottom, MARGIN.top]);
  const pixelXs = xs.slice(0, count).map(xScale);
  const points = pixelXs.map((x, i) => [x, yScale(values[i]!)] as const);
  const path = linePath(points);
  // About 6.5 px per character at 11 px: use the short labels, or one label, when needed.
  const fits = (labels: readonly [string, string]) =>
    (labels[0].length + labels[1].length) * 6.5 + 16 <= plotWidth;
  const axisLabels = fits(xLabels) || !xLabelsShort ? xLabels : xLabelsShort;
  const singleAxisLabel = axisLabels[0] === axisLabels[1] || !fits(axisLabels);
  const endPoint = points[count - 1];
  const showMarkers = markers && count > 1 && plotWidth / (count - 1) >= MIN_MARKER_GAP;

  const indexAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return nearestIndex(pixelXs, event.clientX - rect.left);
  };

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const current = active ?? count - 1;
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + 1;
    else if (event.key === 'PageDown') next = current - 10;
    else if (event.key === 'PageUp') next = current + 10;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else if (event.key === 'Enter' && onActivate) {
      event.preventDefault();
      onActivate(current);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(count - 1, next)));
  };

  const shown = active !== null && active < count ? active : null;
  const description = shown !== null ? describe(shown) : null;
  const activePoint = shown !== null ? points[shown] : undefined;
  const tooltipLeft = activePoint
    ? Math.min(Math.max(activePoint[0] - TOOLTIP_WIDTH / 2, 0), Math.max(0, width - TOOLTIP_WIDTH))
    : 0;

  return (
    <div
      ref={wrapperRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={Math.max(1, count)}
      aria-valuenow={(shown ?? count - 1) + 1}
      aria-valuetext={
        count > 0
          ? (() => {
              const d = describe(shown ?? count - 1);
              return [d.value, ...d.details].join(', ');
            })()
          : 'No data'
      }
      onKeyDown={handleKey}
      onFocus={() => setActive((current) => current ?? count - 1)}
      onBlur={() => setActive(null)}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') setActive(indexAt(event));
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setActive(null);
      }}
      onPointerDown={(event) => {
        pointerTypeRef.current = event.pointerType;
        if (event.pointerType === 'mouse') return;
        // Touch: the first tap reads a point, a second tap on the same point opens it.
        const index = indexAt(event);
        if (lastTouchRef.current === index && onActivate) onActivate(index);
        lastTouchRef.current = index;
        setActive(index);
      }}
      onClick={(event) => {
        if (onActivate && pointerTypeRef.current === 'mouse') {
          const rect = event.currentTarget.getBoundingClientRect();
          onActivate(nearestIndex(pixelXs, event.clientX - rect.left));
        }
      }}
      className={cn(
        'kb-viz relative touch-pan-y rounded-md select-none',
        onActivate && 'cursor-pointer',
        'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent',
        className,
      )}
      style={{ height }}
    >
      <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={yScale(tick)}
              y2={yScale(tick)}
              style={{ stroke: 'var(--viz-grid)' }}
              strokeWidth={1}
            />
            <text
              x={MARGIN.left - 8}
              y={yScale(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="tabular fill-muted text-[11px]"
            >
              {formatY(tick)}
            </text>
          </g>
        ))}

        {context?.slice(0, count).map((value, i) => (
          <circle
            key={i}
            cx={pixelXs[i]}
            cy={yScale(value)}
            r={3.5}
            style={{ fill: 'var(--viz-context)', stroke: 'var(--surface)' }}
            strokeWidth={1.5}
          />
        ))}

        {count > 1 && (
          <path
            d={path}
            fill="none"
            style={{ stroke: 'var(--viz-series)' }}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {showMarkers &&
          points
            .slice(0, -1)
            .map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={3.5}
                style={{ fill: 'var(--viz-series)', stroke: 'var(--surface)' }}
                strokeWidth={1.5}
              />
            ))}

        {endPoint && (
          <>
            <circle
              cx={endPoint[0]}
              cy={endPoint[1]}
              r={4}
              style={{ fill: 'var(--viz-series)', stroke: 'var(--surface)' }}
              strokeWidth={2}
            />
            {endLabel && (
              <text
                x={endPoint[0] + 9}
                y={endPoint[1]}
                dominantBaseline="middle"
                className="tabular fill-text text-xs font-semibold"
              >
                {endLabel}
              </text>
            )}
          </>
        )}

        {activePoint && (
          <>
            <line
              x1={activePoint[0]}
              x2={activePoint[0]}
              y1={MARGIN.top}
              y2={plotBottom}
              style={{ stroke: 'var(--muted)' }}
              strokeWidth={1}
            />
            <circle
              cx={activePoint[0]}
              cy={activePoint[1]}
              r={5}
              style={{ fill: 'var(--viz-series)', stroke: 'var(--surface)' }}
              strokeWidth={2}
            />
          </>
        )}

        <text x={MARGIN.left} y={height - 6} className="fill-muted text-[11px]" textAnchor="start">
          {axisLabels[0]}
        </text>
        {!singleAxisLabel && (
          <text
            x={MARGIN.left + plotWidth}
            y={height - 6}
            className="fill-muted text-[11px]"
            textAnchor="end"
          >
            {axisLabels[1]}
          </text>
        )}
      </svg>

      {description && activePoint && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-xs shadow-lg"
          style={{
            left: tooltipLeft,
            width: TOOLTIP_WIDTH,
            // Above the point when there is room, otherwise below it.
            top: activePoint[1] > 70 ? Math.max(0, activePoint[1] - 70) : activePoint[1] + 12,
          }}
        >
          <p className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <span
              aria-hidden="true"
              className="h-0.5 w-3 rounded-full"
              style={{ background: 'var(--viz-series)' }}
            />
            {description.value}
          </p>
          {description.details.map((line) => (
            <p key={line} className="mt-0.5 truncate text-muted">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
