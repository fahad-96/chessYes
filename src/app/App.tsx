import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { basenameFor, routes } from './routes';

/**
 * Real paths (/play, /review/lichess/abc), not #/ fragments: search engines index each page
 * under its own URL. The host serves the prerendered page for public routes and index.html
 * for the rest (netlify.toml). The router is created on first render, after main.tsx has
 * turned an old #/ link into a path.
 */
let router: ReturnType<typeof createBrowserRouter> | null = null;

export function App() {
  router ??= createBrowserRouter(routes, { basename: basenameFor(import.meta.env.BASE_URL) });
  return <RouterProvider router={router} />;
}
