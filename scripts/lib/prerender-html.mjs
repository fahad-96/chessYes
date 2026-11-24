/**
 * Pure helpers for scripts/prerender.mjs: turn the built index.html into one page's HTML,
 * and write the sitemap and robots.txt. Every replacement must find its tag, so a change to
 * index.html that would silently drop a tag fails the build instead.
 */

/** Escapes text for an HTML attribute value or text node. */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function replaceOnce(html, pattern, replacement, name) {
  if (!pattern.test(html)) throw new Error(`[prerender] index.html has no ${name}`);
  return html.replace(pattern, () => replacement);
}

/**
 * One page's HTML from the index.html template.
 * @param {string} template the built dist/index.html
 * @param {{ title: string, description: string, canonical: string | null, robots: string,
 *   ogTitle: string, ogUrl: string, body: string, jsonLd?: object[] }} page
 */
export function buildPage(template, page) {
  let html = template;
  html = replaceOnce(
    html,
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(page.title)}</title>`,
    '<title>',
  );
  html = replaceOnce(
    html,
    /<meta\s+name="description"[\s\S]*?\/>/,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    'meta description',
  );
  html = replaceOnce(
    html,
    /<meta\s+name="robots"[\s\S]*?\/>/,
    `<meta name="robots" content="${escapeHtml(page.robots)}" />`,
    'meta robots',
  );
  html = replaceOnce(
    html,
    /<link\s+rel="canonical"[\s\S]*?\/>\s*/,
    page.canonical ? `<link rel="canonical" href="${escapeHtml(page.canonical)}" />\n    ` : '',
    'canonical link',
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:title"[\s\S]*?\/>/,
    `<meta property="og:title" content="${escapeHtml(page.ogTitle)}" />`,
    'og:title',
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:description"[\s\S]*?\/>/,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    'og:description',
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:url"[\s\S]*?\/>/,
    `<meta property="og:url" content="${escapeHtml(page.ogUrl)}" />`,
    'og:url',
  );
  if (page.jsonLd?.length) {
    // "<" is escaped so the data can never close the script element.
    const json = JSON.stringify(page.jsonLd).replace(/</g, '\\u003c');
    html = replaceOnce(
      html,
      /<\/head>/,
      `  <script type="application/ld+json">${json}</script>\n  </head>`,
      '</head>',
    );
  }
  html = replaceOnce(
    html,
    /<div id="root"><\/div>/,
    `<div id="root">${page.body}</div>`,
    'empty <div id="root">',
  );
  return html;
}

/** The output file for a route: "/" → "index.html", "/play" → "play.html". */
export function fileForPath(path) {
  return path === '/' ? 'index.html' : `${path.replace(/^\//, '')}.html`;
}

/** sitemap.xml for absolute page URLs. */
export function sitemapXml(urls, lastmod) {
  const entries = urls
    .map(
      (url) =>
        `  <url>\n    <loc>${escapeHtml(url)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/** robots.txt: everything may be crawled (personal pages say noindex themselves). */
export function robotsTxt(siteUrl) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
}
