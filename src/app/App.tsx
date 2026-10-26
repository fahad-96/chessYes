import { lazy, Suspense } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import { Layout } from './Layout';

// Hash routing keeps the app fully static: no server rewrites needed on GitHub Pages.
const HomePage = lazy(() => import('@/features/home/HomePage'));
const GamesPage = lazy(() => import('@/features/games/GamesPage'));
const ReviewPage = lazy(() => import('@/features/review/ReviewPage'));
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

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: page(<HomePage />) },
      /** Game list: /player/chesscom/hikaru or /player/lichess/DrNykterstein */
      { path: '/player/:platform/:username', element: page(<GamesPage />) },
      /** Review: /review/<GameRecord.id>, e.g. /review/lichess/HqjDTU4A */
      { path: '/review/*', element: page(<ReviewPage />) },
      { path: '/import', element: page(<ImportPage />) },
      { path: '/settings', element: page(<SettingsPage />) },
      { path: '/about', element: page(<AboutPage />) },
      { path: '*', element: page(<NotFoundPage />) },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
