import { CLASSIFICATION_META } from '@/components/classificationMeta';
import type { Classification } from '@/core/types';
import { cn } from '@/lib/cn';

/**
 * Decorative illustration for the home page: a stylised eval graph with a few
 * classification markers. Pure SVG drawn with theme tokens (no images), and
 * hidden from assistive technology because it carries no information.
 */

// White's win % over an imaginary game: a calm opening, a sharp middlegame, a won ending.
const SERIES = [
  50, 52, 51, 54, 53, 55, 52, 56, 58, 55, 57, 60, 47, 44, 49, 62, 66, 63, 69, 67, 72, 58, 61, 77,
  81, 84, 88, 91, 95, 98,
];

const WIDTH = 300;
const HEIGHT = 110;

function point(index: number): [number, number] {
  const x = (index / (SERIES.length - 1)) * WIDTH;
  const y = HEIGHT - ((SERIES[index] ?? 50) / 100) * HEIGHT;
  return [Number(x.toFixed(1)), Number(y.toFixed(1))];
}

const LINE = SERIES.map((_, i) => point(i).join(',')).join(' ');
const AREA = `0,${HEIGHT} ${LINE} ${WIDTH},${HEIGHT}`;

const MARKERS: { index: number; kind: Classification }[] = [
  { index: 12, kind: 'mistake' },
  { index: 15, kind: 'great' },
  { index: 21, kind: 'blunder' },
  { index: 23, kind: 'brilliant' },
];

const LEGEND: Classification[] = ['brilliant', 'great', 'mistake', 'blunder'];

export function HeroPreview() {
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl border border-line bg-surface p-4 shadow-xl shadow-black/10 sm:p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AccuracyTile side="white" value="91.8" />
          <AccuracyTile side="black" value="74.2" />
        </div>
        <span className="text-xs font-medium tracking-wide text-muted uppercase">Accuracy</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full rounded-lg">
        <rect width={WIDTH} height={HEIGHT} fill="var(--eval-black)" />
        <polygon points={AREA} fill="var(--eval-white)" />
        <line
          x1="0"
          x2={WIDTH}
          y1={HEIGHT / 2}
          y2={HEIGHT / 2}
          stroke="var(--muted)"
          strokeOpacity="0.5"
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
        {MARKERS.map(({ index, kind }) => {
          const [x, y] = point(index);
          return (
            <circle
              key={index}
              cx={x}
              cy={y}
              r="4.5"
              fill={CLASSIFICATION_META[kind].colorVar}
              stroke="var(--surface)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
        {LEGEND.map((kind) => (
          <li key={kind} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: CLASSIFICATION_META[kind].colorVar }}
            />
            {CLASSIFICATION_META[kind].label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AccuracyTile({ side, value }: { side: 'white' | 'black'; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
      <span
        className={cn(
          'h-3 w-3 rounded-full ring-1',
          side === 'white' ? 'ring-black/25' : 'ring-white/30',
        )}
        style={{ background: side === 'white' ? 'var(--eval-white)' : 'var(--eval-black)' }}
      />
      <span className="tabular text-lg font-bold text-text">{value}</span>
    </div>
  );
}
