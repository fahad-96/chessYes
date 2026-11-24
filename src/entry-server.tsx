/**
 * Build-time rendering of the public pages (see scripts/prerender.mjs). Built by
 * `vite build --ssr src/entry-server.tsx`, it renders a route to static HTML with the same
 * routes and components as the browser app, waiting for lazily loaded pages. The browser
 * then replaces that HTML with the live app (createRoot in main.tsx), so the HTML only has
 * to be what a visitor (or a search engine) sees before the app starts.
 */
import { prerender } from 'react-dom/static';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router-dom';
import { basenameFor, routes } from './app/routes';

export { PAGES, SITE_NAME, SITE_URL, headTagsForPath, pageTitle, structuredData } from './app/seo';

/** The HTML inside <div id="root"> for `path` (relative to the site's base URL). */
export async function renderPage(path: string, baseUrl = '/'): Promise<string> {
  const basename = basenameFor(baseUrl);
  const handler = createStaticHandler(routes, { basename });
  const url = new URL((basename === '/' ? '' : basename) + path, 'http://localhost');
  const context = await handler.query(new Request(url));
  if (context instanceof Response) {
    throw new Error(`Rendering ${path} answered with a redirect or response (${context.status})`);
  }
  const router = createStaticRouter(handler.dataRoutes, context);
  const render = async () => {
    const { prelude } = await prerender(
      <StaticRouterProvider router={router} context={context} hydrate={false} />,
      // React moves Suspense content larger than this (12.8 kB by default) out of place, to
      // stream it later. A static page is not streamed: keep everything in place.
      { progressiveChunkSize: Number.POSITIVE_INFINITY },
    );
    return new Response(prelude).text();
  };
  // The first pass loads the page's lazily imported module. In it the page arrives after the
  // shell, so React writes it as hidden content plus a script that reveals it, which search
  // engines may not run. In the second pass the module is loaded, nothing suspends, and the
  // page is plain HTML in place.
  await render();
  const html = await render();
  if (/<script|hidden id="S:/.test(html)) {
    throw new Error(`Rendering ${path} still suspended: the HTML needs a script to show`);
  }
  return html;
}
