import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import { Layout } from './Layout';

const HomePage = lazy(() => import('@/features/home/HomePage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const TrainPage = lazy(() => import('@/features/train/TrainPage'));
const GamesPage = lazy(() => import('@/features/games/GamesPage'));
const ReviewPage = lazy(() => import('@/features/review/ReviewPage'));
const InsightsPage = lazy(() => import('@/features/insights/InsightsPage'));
const PuzzlesPage = lazy(() => import('@/features/puzzles/PuzzlesPage'));
const PlayPage = lazy(() => import('@/features/play/PlayPage'));
const ImportPage = lazy(() => import('@/features/import/ImportPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const AboutPage = lazy(() => import('@/features/about/AboutPage'));
const NotFoundPage = lazy(() => import('@/features/about/NotFoundPage'));

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-muted">
      <Spinner />
    </div>
  );
}

const page = (element: React.ReactNode) => (
  <Suspense fallback={<PageFallback />}>{element}</Suspense>
);

/**
 * Every route of the app. Shared by the browser router (App.tsx) and the build-time
 * renderer (entry-server.tsx), which writes the public pages out as static HTML.
 */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      /** The landing page: the photo, the headline and "Get started". */
      { path: '/', element: page(<HomePage />) },
      /** The app's home: the connected account's games (or "Connect your account"). */
      { path: '/home', element: page(<DashboardPage />) },
      /** "Analyze my recent games": analyses them, then offers puzzles from their mistakes. */
      { path: '/train', element: page(<TrainPage />) },
      /** Game list: /player/chesscom/hikaru or /player/lichess/DrNykterstein */
      { path: '/player/:platform/:username', element: page(<GamesPage />) },
      /** Review: /review/<GameRecord.id>, e.g. /review/lichess/HqjDTU4A */
      { path: '/review/*', element: page(<ReviewPage />) },
      /** Insights across many games: /insights/chesscom/hikaru */
      { path: '/insights/:platform/:username', element: page(<InsightsPage />) },
      /** Puzzles built from your own mistakes. */
      { path: '/puzzles', element: page(<PuzzlesPage />) },
      /** A game against Stockfish at a chosen strength, then its review. */
      { path: '/play', element: page(<PlayPage />) },
      { path: '/import', element: page(<ImportPage />) },
      { path: '/settings', element: page(<SettingsPage />) },
      { path: '/about', element: page(<AboutPage />) },
      { path: '*', element: page(<NotFoundPage />) },
    ],
  },
];

/** The router's basename for a Vite base URL: "/" → "/", "/chessYes/" → "/chessYes". */
export function basenameFor(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed || '/';
}

/**
 * Links from before the app used real paths (/#/review/lichess/abc?ply=4, installed apps
 * opening ./#/import) keep working: the path that was in the fragment becomes the URL's path.
 * Returns the new URL, or null when the fragment is not an old route.
 */
export function pathFromLegacyHash(baseUrl: string, hash: string): string | null {
  if (!hash.startsWith('#/')) return null;
  const base = basenameFor(baseUrl);
  return (base === '/' ? '' : base) + hash.slice(1);
}
