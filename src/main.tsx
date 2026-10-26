import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './index.css';
import { App } from './app/App';
import { registerServiceWorker } from './app/registerServiceWorker';
import { UpdateToast } from './app/UpdateToast';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateToast />
  </StrictMode>,
);

// Offline support and update prompts (production builds only).
registerServiceWorker();
