import type { Classification } from '@/core/types';
import { cn } from '@/lib/cn';
import { CLASSIFICATION_META } from './classificationMeta';
import {
  CLASSIFICATION_GLYPHS,
  GLYPH_VIEWBOX,
  glyphToSvg,
  type GlyphPart,
} from './classificationGlyphs';

export interface ClassificationIconProps {
  classification: Classification;
  /** Rendered size in px (the icon is designed for 14-20 px). Default 16. */
  size?: number;
  className?: string;
  /** Accessible name; defaults to the classification label. */
  title?: string;
  /** Hide from assistive technology when the label is already written next to the icon. */
  decorative?: boolean;
}

function GlyphPartElement({ part, color }: { part: GlyphPart; color: string }) {
  switch (part.kind) {
    case 'stroke':
      return (
        <path
          d={part.d}
          fill="none"
          stroke="#fff"
          strokeWidth={part.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'cutout':
      return (
        <path
          d={part.d}
          fill="none"
          style={{ stroke: color }}
          strokeWidth={part.width}
          strokeLinecap="round"
        />
      );
    case 'fill':
      return part.round ? (
        <path
          d={part.d}
          fill="#fff"
          stroke="#fff"
          strokeWidth={part.round}
          strokeLinejoin="round"
        />
      ) : (
        <path d={part.d} fill="#fff" />
      );
    case 'dot':
      return <circle cx={part.cx} cy={part.cy} r={part.r} fill="#fff" />;
  }
}

/** Round, coloured badge with a white glyph for a move classification. */
export function ClassificationIcon({
  classification,
  size = 16,
  className,
  title,
  decorative = false,
}: ClassificationIconProps) {
  const meta = CLASSIFICATION_META[classification];
  const label = title ?? meta.label;
  return (
    <svg
      viewBox={`0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`}
      width={size}
      height={size}
      className={cn('inline-block shrink-0', className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
    >
      {!decorative && <title>{label}</title>}
      <circle cx="10" cy="10" r="10" style={{ fill: meta.colorVar }} />
      {CLASSIFICATION_GLYPHS[classification].map((part, i) => (
        <GlyphPartElement key={i} part={part} color={meta.colorVar} />
      ))}
    </svg>
  );
}

/**
 * The badge as SVG markup for chessground's `DrawShape.customSvg`. Chessground
 * places that markup in a 100 x 100 viewBox covering the square, so the badge sits
 * in the square's top-right corner, with a soft shadow to separate it from the piece.
 */
export function classificationBadgeSvg(classification: Classification): string {
  const color = CLASSIFICATION_META[classification].colorVar;
  const glyph = glyphToSvg(CLASSIFICATION_GLYPHS[classification], color);
  return (
    '<g transform="translate(66 2) scale(1.6)">' +
    '<circle cx="10" cy="10.7" r="10.3" fill="#000" fill-opacity="0.3"/>' +
    `<circle cx="10" cy="10" r="10" style="fill:${color}"/>` +
    glyph +
    '</g>'
  );
}
