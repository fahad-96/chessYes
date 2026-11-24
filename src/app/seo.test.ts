import { describe, expect, it } from 'vitest';
import { FAQ } from '@/features/home/faq';
import { PAGES, SITE_URL, headTagsForPath, pageForPath, pageTitle, structuredDataFor } from './seo';

describe('page metadata', () => {
  it('fits search result limits and is unique per page', () => {
    for (const page of PAGES) {
      expect(page.title.length, page.title).toBeLessThanOrEqual(60);
      expect(page.description.length, page.description).toBeLessThanOrEqual(160);
      expect(page.description.length, page.description).toBeGreaterThan(50);
      expect(page.title).toContain('Chess Yes');
    }
    expect(new Set(PAGES.map((page) => page.title)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((page) => page.description)).size).toBe(PAGES.length);
  });

  it('finds pages with or without a trailing slash', () => {
    expect(pageForPath('/play')?.path).toBe('/play');
    expect(pageForPath('/play/')?.path).toBe('/play');
    expect(pageForPath('/')?.path).toBe('/');
    expect(pageForPath('/review/lichess/abc')).toBeNull();
    expect(pageTitle('/about')).toMatch(/^About Chess Yes/);
    expect(pageTitle('/nowhere')).toBe('Chess Yes');
  });
});

describe('headTagsForPath', () => {
  it('indexes public pages under their own canonical URL', () => {
    expect(headTagsForPath('/')).toMatchObject({
      canonical: `${SITE_URL}/`,
      ogUrl: `${SITE_URL}/`,
      robots: 'index, follow, max-image-preview:large',
    });
    expect(headTagsForPath('/play').canonical).toBe(`${SITE_URL}/play`);
  });

  it('keeps settings, personal pages and unknown paths out of the index', () => {
    expect(headTagsForPath('/settings').robots).toBe('noindex, follow');
    expect(headTagsForPath('/home').robots).toBe('noindex, follow');
    for (const path of [
      '/review/lichess/abc',
      '/player/chesscom/hikaru',
      '/insights/x/y',
      '/404',
    ]) {
      const tags = headTagsForPath(path);
      expect(tags.robots).toBe('noindex, follow');
      expect(tags.canonical).toBeNull();
    }
  });
});

describe('structuredDataFor', () => {
  it('names the site and describes the free app on the landing page', () => {
    const [site, app] = structuredDataFor('/') as Record<string, unknown>[];
    expect(site).toMatchObject({ '@type': 'WebSite', name: 'Chess Yes', url: `${SITE_URL}/` });
    expect(site?.alternateName).toContain('ChessYes');
    expect(app).toMatchObject({
      '@type': 'WebApplication',
      isAccessibleForFree: true,
      offers: { price: '0' },
    });
  });

  it('marks up the questions on the About page, where they are shown', () => {
    const [faq] = structuredDataFor('/about') as Record<string, unknown>[];
    expect(faq).toMatchObject({ '@type': 'FAQPage' });
    expect((faq?.mainEntity as unknown[]).length).toBe(FAQ.length);
    expect(structuredDataFor('/play')).toEqual([]);
  });

  it('serialises to JSON', () => {
    expect(() => JSON.parse(JSON.stringify(structuredDataFor('/')))).not.toThrow();
  });
});
