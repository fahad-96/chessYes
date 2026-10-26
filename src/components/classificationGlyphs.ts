import type { Classification } from '@/core/types';

/**
 * Vector glyphs for the classification badges, drawn on a 20 x 20 grid with the
 * badge circle centred at (10, 10). Glyphs are paths rather than text so they look
 * the same on every platform and stay crisp at 14-20 px.
 *
 * The same data renders both the React icon and the SVG string used for the
 * board badge, so the two can never drift apart.
 */
export type GlyphPart =
  /** White stroke with round caps and joins, no fill. */
  | { kind: 'stroke'; d: string; width: number }
  /** White fill; `round` adds a thin white stroke to soften sharp corners. */
  | { kind: 'fill'; d: string; round?: number }
  | { kind: 'dot'; cx: number; cy: number; r: number }
  /** Stroke in the badge colour, used to cut gaps into white shapes. */
  | { kind: 'cutout'; d: string; width: number };

export const GLYPH_VIEWBOX = 20;

const n = (value: number) => Number(value.toFixed(2));

/** "!" centred on `cx`, scaled around the badge centre by `s`. */
function exclamation(cx: number, s = 1): GlyphPart[] {
  return [
    { kind: 'stroke', d: `M${n(cx)} ${n(10 - 5 * s)}V${n(10 + 1.2 * s)}`, width: n(2.3 * s) },
    { kind: 'dot', cx: n(cx), cy: n(10 + 4.8 * s), r: n(1.3 * s) },
  ];
}

/** "?" centred on `cx`: an arc over the top that curls into a short stem, plus a dot. */
function question(cx: number, s = 1): GlyphPart[] {
  const r = 2.4 * s;
  const y0 = 10 - 2.6 * s;
  // The arc ends 50 degrees below the horizontal on the right-hand side.
  const endX = cx + Math.cos((50 * Math.PI) / 180) * r;
  const endY = y0 + Math.sin((50 * Math.PI) / 180) * r;
  const d =
    `M${n(cx - r)} ${n(y0)}` +
    `A${n(r)} ${n(r)} 0 1 1 ${n(endX)} ${n(endY)}` +
    `Q${n(cx)} ${n(y0 + 1.05 * r)} ${n(cx)} ${n(y0 + 1.6 * r)}`;
  return [
    { kind: 'stroke', d, width: n(2.2 * s) },
    { kind: 'dot', cx: n(cx), cy: n(10 + 4.8 * s), r: n(1.25 * s) },
  ];
}

/** Five-pointed star path. */
function star(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (-90 + i * 36) * (Math.PI / 180);
    points.push(`${n(cx + Math.cos(angle) * radius)} ${n(cy + Math.sin(angle) * radius)}`);
  }
  return `M${points.join('L')}Z`;
}

export const CLASSIFICATION_GLYPHS: Record<Classification, GlyphPart[]> = {
  brilliant: [...exclamation(7.6, 0.9), ...exclamation(12.4, 0.9)],
  great: exclamation(10),
  best: [{ kind: 'fill', d: star(10, 10.4, 5.9, 2.5), round: 0.9 }],
  excellent: [
    // Thumbs up: cuff on the left, hand with raised thumb on the right.
    {
      kind: 'fill',
      d: 'M5.4 9.2h.8a.8.8 0 0 1 .8.8v4.4a.8.8 0 0 1-.8.8h-.8a.8.8 0 0 1-.8-.8V10a.8.8 0 0 1 .8-.8Z',
    },
    {
      kind: 'fill',
      d:
        'M8 9.4L10.3 5.2C10.65 4.6 11.75 4.75 11.8 5.6L11.55 8.3H14.4C15.25 8.3 15.85 9.1 ' +
        '15.6 9.9L14.45 14.3C14.3 14.85 13.8 15.2 13.25 15.2H8Z',
      round: 0.6,
    },
  ],
  good: [{ kind: 'stroke', d: 'M5.8 10.4L8.7 13.2L14.3 7.2', width: 2.3 }],
  book: [
    {
      kind: 'fill',
      d:
        'M10 6.6C8.7 5.6 6.9 5.3 4.9 5.7V14.1C6.9 13.7 8.7 14 10 15C11.3 14 13.1 13.7 ' +
        '15.1 14.1V5.7C13.1 5.3 11.3 5.6 10 6.6Z',
      round: 0.5,
    },
    { kind: 'cutout', d: 'M10 7V14.4', width: 1 },
  ],
  forced: [
    { kind: 'stroke', d: 'M5.4 10H14.4', width: 2.2 },
    { kind: 'stroke', d: 'M11.2 6.6L14.6 10L11.2 13.4', width: 2.2 },
  ],
  inaccuracy: [...question(8.4, 0.8), ...exclamation(13.4, 0.8)],
  mistake: question(10),
  blunder: [...question(6.8, 0.8), ...question(13.2, 0.8)],
  missedWin: [
    // A target with a slash through it: the win that was there and was missed.
    { kind: 'stroke', d: 'M14.3 10A4.3 4.3 0 1 1 5.7 10A4.3 4.3 0 1 1 14.3 10Z', width: 1.7 },
    { kind: 'dot', cx: 10, cy: 10, r: 1.4 },
    { kind: 'cutout', d: 'M5.3 14.7L14.7 5.3', width: 3.6 },
    { kind: 'stroke', d: 'M5.3 14.7L14.7 5.3', width: 1.6 },
  ],
};

/** Serialises glyph parts to SVG markup. `badgeColor` fills the cut-outs. */
export function glyphToSvg(parts: readonly GlyphPart[], badgeColor: string): string {
  return parts
    .map((part) => {
      switch (part.kind) {
        case 'stroke':
          return (
            `<path d="${part.d}" fill="none" stroke="#fff" stroke-width="${part.width}" ` +
            'stroke-linecap="round" stroke-linejoin="round"/>'
          );
        case 'cutout':
          return (
            `<path d="${part.d}" fill="none" style="stroke:${badgeColor}" ` +
            `stroke-width="${part.width}" stroke-linecap="round"/>`
          );
        case 'fill':
          return part.round
            ? `<path d="${part.d}" fill="#fff" stroke="#fff" stroke-width="${part.round}" ` +
                'stroke-linejoin="round"/>'
            : `<path d="${part.d}" fill="#fff"/>`;
        case 'dot':
          return `<circle cx="${part.cx}" cy="${part.cy}" r="${part.r}" fill="#fff"/>`;
      }
    })
    .join('');
}
