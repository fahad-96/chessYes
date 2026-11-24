import { FAQ } from '@/features/home/faq';

/**
 * Search and sharing metadata, in one place. The build (scripts/prerender.mjs) writes it
 * into the static HTML of every public page, and useSeoHead keeps it right while the app
 * changes pages without reloading. Pages set their own <title> with pageTitle(path).
 */

/** The canonical origin. Every other address (chessyes.netlify.app, www) is a duplicate. */
export const SITE_URL = 'https://chessyes.in';
export const SITE_NAME = 'Chess Yes';

export interface PageSeo {
  /** Route path, e.g. "/play". */
  path: string;
  /** The tab and search-result title, about 60 characters at most. */
  title: string;
  /** The search-result snippet, about 155 characters at most. */
  description: string;
  /** Prerendered at build time and listed in the sitemap. */
  indexable: boolean;
}

export const PAGES: readonly PageSeo[] = [
  {
    path: '/',
    title: 'Chess Yes: Free Chess Game Review with Stockfish',
    description:
      'Review your Chess.com and Lichess games for free: every move classified from Brilliant to Blunder, accuracy, an eval graph and plain-English explanations.',
    indexable: true,
  },
  {
    path: '/play',
    title: 'Play Chess Against Stockfish Online, Free · Chess Yes',
    description:
      'Play chess against Stockfish at eight levels, from beginner to full strength, right in your browser. No account, no ads. Review every game move by move.',
    indexable: true,
  },
  {
    path: '/puzzles',
    title: 'Chess Puzzles From Your Own Mistakes · Chess Yes',
    description:
      'Turn the mistakes and blunders from your reviewed games into puzzles, with hints, the idea behind every solution and spaced repetition. Free.',
    indexable: true,
  },
  {
    path: '/import',
    title: 'Analyze a Chess PGN Free with Stockfish · Chess Yes',
    description:
      'Paste or upload any PGN and get a full Stockfish game review: move classifications, accuracy for both players, an eval graph and explanations.',
    indexable: true,
  },
  {
    path: '/about',
    title: 'About Chess Yes: Free, Open-Source Chess Analysis',
    description:
      'How Chess Yes reviews chess games: Stockfish 19 runs in your browser, moves are judged by win % lost, and explanations are rule-based. Free and private.',
    indexable: true,
  },
  {
    path: '/settings',
    title: 'Settings · Chess Yes',
    description: 'Theme, board, analysis depth and voice settings for Chess Yes.',
    indexable: false,
  },
];

/** Routes whose content is one person's games: never indexed, and kept out of robots crawling. */
export const PRIVATE_PREFIXES = ['/review/', '/player/', '/insights/'] as const;

const HOME = PAGES[0]!;

/** The page entry for a path (a trailing slash is ignored), or null for other routes. */
export function pageForPath(pathname: string): PageSeo | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return PAGES.find((page) => page.path === path) ?? null;
}

/** The <title> of a public page. */
export function pageTitle(path: string): string {
  return pageForPath(path)?.title ?? SITE_NAME;
}

export interface HeadTags {
  description: string;
  /** Absolute canonical URL, or null when the page should not name one. */
  canonical: string | null;
  robots: string;
  ogTitle: string;
  ogUrl: string;
}

/**
 * The head tags for any path. Public pages are indexed under their own URL; personal pages
 * (reviews, game lists, insights), Settings and unknown paths are noindex, follow.
 */
export function headTagsForPath(pathname: string): HeadTags {
  const page = pageForPath(pathname);
  if (page) {
    const url = SITE_URL + (page.path === '/' ? '/' : page.path);
    return {
      description: page.description,
      canonical: url,
      robots: page.indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow',
      ogTitle: page.title,
      ogUrl: url,
    };
  }
  return {
    description: HOME.description,
    canonical: null,
    robots: 'noindex, follow',
    ogTitle: HOME.title,
    ogUrl: SITE_URL + pathname,
  };
}

/**
 * Structured data for the home page: the site's name (what search results show for it),
 * the app itself, and the questions and answers on the page.
 */
export function structuredData(): object[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      alternateName: ['ChessYes', 'chessyes', 'chessyes.in'],
      url: `${SITE_URL}/`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      description: HOME.description,
      applicationCategory: 'GameApplication',
      applicationSubCategory: 'Chess analysis',
      operatingSystem: 'Any (runs in a web browser)',
      browserRequirements: 'Requires JavaScript and WebAssembly',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      image: `${SITE_URL}/og-image.png`,
      featureList: [
        'Free chess game review for Chess.com and Lichess games',
        'Move classifications from Brilliant to Blunder',
        'Accuracy for both players and an evaluation graph',
        'Plain-English explanations of every key move',
        'Play against Stockfish at eight strengths',
        'Puzzles from your own mistakes',
        'Stockfish 19 runs in your browser, offline-ready',
      ],
      author: { '@type': 'Person', name: 'Fahad Yousuf', url: 'https://fahad-yousuf.netlify.app/' },
    },
  ];
}
