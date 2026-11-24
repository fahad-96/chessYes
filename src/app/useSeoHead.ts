import { useEffect } from 'react';
import { headTagsForPath } from './seo';

function upsertMeta(attribute: 'name' | 'property', key: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attribute, key);
    document.head.appendChild(meta);
  }
  meta.content = content;
}

/**
 * Keeps the description, robots, canonical and link-preview tags in <head> right for the
 * current route while the app changes pages without reloading. (The first load already
 * has them: scripts/prerender.mjs writes them into each page's HTML.) Titles are set by
 * the pages themselves (pageTitle in seo.ts).
 */
export function useSeoHead(pathname: string) {
  useEffect(() => {
    const tags = headTagsForPath(pathname);
    upsertMeta('name', 'description', tags.description);
    upsertMeta('name', 'robots', tags.robots);
    upsertMeta('property', 'og:title', tags.ogTitle);
    upsertMeta('property', 'og:description', tags.description);
    upsertMeta('property', 'og:url', tags.ogUrl);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (tags.canonical) {
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.appendChild(canonical);
      }
      canonical.href = tags.canonical;
    } else {
      canonical?.remove();
    }
  }, [pathname]);
}
