import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
// Display serif for headlines and the wordmark (bundled, so it works offline).
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import './index.css';
import { App } from './app/App';
import { registerServiceWorker } from './app/registerServiceWorker';
import { pathFromLegacyHash } from './app/routes';
import { UpdateToast } from './app/UpdateToast';

// An old #/ link (shared reviews, installed apps) becomes the real path before the router starts.
const legacy = pathFromLegacyHash(import.meta.env.BASE_URL, window.location.hash);
if (legacy) window.history.replaceState(window.history.state, '', legacy);

// The prerendered HTML of public pages (scripts/prerender.mjs) is replaced by the live app.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateToast />
  </StrictMode>,
);

// Offline support and update prompts (production builds only).
registerServiceWorker();
