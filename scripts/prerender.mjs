/**
 * Writes the public pages as static HTML after `vite build` (run by `npm run build`).
 *
 * The browser app alone ships one empty index.html, so search engines would have to run the
 * app to see anything. Instead every public page (seo.ts PAGES) gets its own file with its
 * own title, description, canonical URL and the rendered page in <div id="root">:
 *   dist/index.html, dist/play.html, dist/puzzles.html, ...
 * plus dist/app.html, an empty, noindex shell for personal pages (reviews, game lists,
 * insights), dist/404.html, dist/sitemap.xml and dist/robots.txt. netlify.toml routes
 * requests to them. The server bundle (.ssr, from src/entry-server.tsx) is removed afterwards.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildPage, fileForPath, robotsTxt, sitemapXml } from './lib/prerender-html.mjs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const ssrDir = new URL('.ssr/', root);
const baseUrl = process.env.BASE_PATH ?? '/';

const server = await import(new URL('entry-server.js', ssrDir).href);
const { PAGES, SITE_NAME, SITE_URL, headTagsForPath, pageTitle, renderPage, structuredDataFor } =
  server;
const template = readFileSync(new URL('index.html', dist), 'utf8');

function write(file, html) {
  writeFileSync(new URL(file, dist), html);
}

for (const page of PAGES) {
  const tags = headTagsForPath(page.path);
  const body = await renderPage(page.path, baseUrl);
  write(
    fileForPath(page.path),
    buildPage(template, {
      ...tags,
      title: pageTitle(page.path),
      body,
      jsonLd: structuredDataFor(page.path),
    }),
  );
  console.log(`[prerender] ${page.path} -> ${fileForPath(page.path)} (${body.length} chars)`);
}

// Personal pages start from an empty shell that search engines are told not to index.
const home = headTagsForPath('/');
write(
  'app.html',
  buildPage(template, {
    ...home,
    title: SITE_NAME,
    canonical: null,
    robots: 'noindex, follow',
    body: '',
  }),
);

// Unknown paths: the "off the board" page, also noindex.
write(
  '404.html',
  buildPage(template, {
    ...home,
    title: `Page not found · ${SITE_NAME}`,
    canonical: null,
    robots: 'noindex, follow',
    body: await renderPage('/404', baseUrl),
  }),
);

const indexable = PAGES.filter((page) => page.indexable).map(
  (page) => SITE_URL + (page.path === '/' ? '/' : page.path),
);
write('sitemap.xml', sitemapXml(indexable, new Date().toISOString().slice(0, 10)));
write('robots.txt', robotsTxt(SITE_URL));
console.log(`[prerender] app.html, 404.html, sitemap.xml (${indexable.length} pages), robots.txt`);

rmSync(ssrDir, { recursive: true, force: true });
