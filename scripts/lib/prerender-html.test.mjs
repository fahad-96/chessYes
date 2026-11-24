import { describe, expect, it } from 'vitest';
import { buildPage, escapeHtml, fileForPath, robotsTxt, sitemapXml } from './prerender-html.mjs';

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta
      name="description"
      content="Old description"
    />
    <meta name="robots" content="index, follow" />
    <title>Old title</title>
    <link rel="canonical" href="https://example.com/" />
    <meta property="og:title" content="Old" />
    <meta
      property="og:description"
      content="Old"
    />
    <meta property="og:url" content="https://example.com/" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const PAGE = {
  title: 'Play & win · "Chess Yes"',
  description: 'Play <Stockfish>',
  canonical: 'https://chessyes.in/play',
  robots: 'index, follow',
  ogTitle: 'Play',
  ogUrl: 'https://chessyes.in/play',
  body: '<h1>Play Stockfish</h1>',
};

describe('buildPage', () => {
  it('writes the page head and body into the template', () => {
    const html = buildPage(TEMPLATE, PAGE);
    expect(html).toContain('<title>Play &amp; win · &quot;Chess Yes&quot;</title>');
    expect(html).toContain('<meta name="description" content="Play &lt;Stockfish&gt;" />');
    expect(html).toContain('<link rel="canonical" href="https://chessyes.in/play" />');
    expect(html).toContain('<meta property="og:url" content="https://chessyes.in/play" />');
    expect(html).toContain('<meta property="og:description" content="Play &lt;Stockfish&gt;" />');
    expect(html).toContain('<div id="root"><h1>Play Stockfish</h1></div>');
    expect(html).not.toContain('Old');
  });

  it('drops the canonical link when the page has none', () => {
    const html = buildPage(TEMPLATE, { ...PAGE, canonical: null, robots: 'noindex, follow' });
    expect(html).not.toContain('rel="canonical"');
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
  });

  it('adds structured data that cannot close its script element', () => {
    const html = buildPage(TEMPLATE, { ...PAGE, jsonLd: [{ name: '</script><b>' }] });
    expect(html).toContain(
      '<script type="application/ld+json">[{"name":"\\u003c/script>\\u003cb>"}]</script>',
    );
  });

  it('fails when the template lost a tag', () => {
    expect(() => buildPage(TEMPLATE.replace(/<title>.*<\/title>/, ''), PAGE)).toThrow(/<title>/);
    expect(() =>
      buildPage(TEMPLATE.replace('<div id="root"></div>', '<div id="root">x</div>'), PAGE),
    ).toThrow(/root/);
  });
});

describe('site files', () => {
  it('names a file per route', () => {
    expect(fileForPath('/')).toBe('index.html');
    expect(fileForPath('/play')).toBe('play.html');
  });

  it('writes a sitemap and robots.txt', () => {
    const xml = sitemapXml(['https://chessyes.in/', 'https://chessyes.in/play'], '2026-11-24');
    expect(xml).toContain('<loc>https://chessyes.in/play</loc>');
    expect(xml).toContain('<lastmod>2026-11-24</lastmod>');
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(robotsTxt('https://chessyes.in')).toContain('Sitemap: https://chessyes.in/sitemap.xml');
  });

  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
