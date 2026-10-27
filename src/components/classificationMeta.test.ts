// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CLASSIFICATIONS } from '@/core/types';
import { CLASSIFICATION_META, verdictText } from './classificationMeta';
import { CLASSIFICATION_GLYPHS, glyphToSvg } from './classificationGlyphs';
import { classificationBadgeSvg } from './ClassificationIcon';

describe('CLASSIFICATION_META', () => {
  it('describes every classification with its colour token', () => {
    for (const classification of CLASSIFICATIONS) {
      const meta = CLASSIFICATION_META[classification];
      expect(meta.label).toBeTruthy();
      expect(meta.description).toMatch(/\.$/);
      expect(meta.colorVar).toBe(`var(--c-${classification})`);
    }
  });

  it('uses the right article for the noun phrase', () => {
    for (const classification of CLASSIFICATIONS) {
      const { article, phrase } = CLASSIFICATION_META[classification];
      expect(article).toBe(/^[aeiou]/i.test(phrase) ? 'an' : 'a');
    }
  });
});

describe('verdictText', () => {
  it('reads as a sentence', () => {
    expect(verdictText('Nf5', 'blunder')).toBe('Nf5 is a blunder');
    expect(verdictText('e4', 'book')).toBe('e4 is a book move');
    expect(verdictText('h3', 'inaccuracy')).toBe('h3 is an inaccuracy');
    expect(verdictText('Bc4', 'excellent')).toBe('Bc4 is an excellent move');
    expect(verdictText('Qxd5', 'best')).toBe('Qxd5 is the best move');
    expect(verdictText('Rxe6', 'missedWin')).toBe('Rxe6 is a miss');
  });
});

describe('badge glyphs', () => {
  it('has a glyph for every classification', () => {
    for (const classification of CLASSIFICATIONS) {
      expect(CLASSIFICATION_GLYPHS[classification].length).toBeGreaterThan(0);
    }
  });

  it('draws glyphs on the 20 x 20 badge grid', () => {
    // Coordinates, relative offsets, radii and arc flags all stay within the grid.
    for (const classification of CLASSIFICATIONS) {
      const markup = glyphToSvg(CLASSIFICATION_GLYPHS[classification], 'red');
      const numbers = [...markup.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
      for (const value of numbers) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(20);
      }
    }
  });

  it('produces well-formed SVG for the board badge', () => {
    for (const classification of CLASSIFICATIONS) {
      const markup = classificationBadgeSvg(classification);
      expect(markup).toContain(`var(--c-${classification})`);
      const doc = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${markup}</svg>`,
        'image/svg+xml',
      );
      expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
      expect(doc.querySelectorAll('circle').length).toBeGreaterThanOrEqual(2);
    }
  });
});
