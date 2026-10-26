/**
 * Service worker registration and the "new version available" flow.
 *
 * Production builds register public/sw.js (offline start and offline analysis; see the
 * notes at the top of that file). After a deploy the new worker installs in the background
 * and waits, so an open page never mixes code from two builds. UpdateToast then offers a
 * reload: the waiting worker is told to take over (SKIP_WAITING) and the page reloads once,
 * when the new worker controls it.
 */

/** idle: nothing to do. available: a new version is waiting. reloading: the user accepted it. */
export type UpdateStatus = 'idle' | 'available' | 'reloading';

/** A tiny store for the update status, readable with useSyncExternalStore. */
export interface ServiceWorkerUpdates {
  getStatus(): UpdateStatus;
  subscribe(listener: () => void): () => void;
  /** Registers the worker and starts watching for updates. */
  register(container: ServiceWorkerContainer): Promise<void>;
  /** Activates the waiting version and reloads the page once it is in control. */
  applyUpdate(): void;
}

export interface ServiceWorkerUpdatesOptions {
  scriptUrl: string;
  scope: string;
  reload: () => void;
}

/**
 * How often an open tab asks the server for a new version. Browsers only check on
 * navigation, which a hash-routed app never does, so long-lived tabs would miss deploys.
 */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Reload anyway if the new worker has not taken control by then (it failed to activate). */
export const RELOAD_FALLBACK_MS = 4000;

/** Creates the update store. The app uses `appUpdates`; tests create their own. */
export function createServiceWorkerUpdates({
  scriptUrl,
  scope,
  reload,
}: ServiceWorkerUpdatesOptions): ServiceWorkerUpdates {
  let status: UpdateStatus = 'idle';
  let registration: ServiceWorkerRegistration | undefined;
  let reloadRequested = false;
  let reloaded = false;
  let lastCheck = 0;
  const listeners = new Set<() => void>();

  const setStatus = (next: UpdateStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener();
  };

  const reloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  };

  // A worker that finishes installing while another one is active is an update. The very
  // first install has no active worker, so it never prompts.
  const watchInstalling = (worker: ServiceWorker | null) => {
    if (!worker) return;
    const check = () => {
      if (worker.state === 'installed' && registration?.active) setStatus('available');
    };
    worker.addEventListener('statechange', check);
    check();
  };

  const checkForUpdate = () => {
    lastCheck = Date.now();
    // Rejects when offline; the next check will try again.
    registration?.update().catch(() => undefined);
  };

  return {
    getStatus: () => status,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async register(container) {
      // Only the tab where the user pressed Reload reloads. Other open tabs keep their
      // prompt, whose button then simply reloads (the new version is already in control).
      container.addEventListener('controllerchange', () => {
        if (reloadRequested) reloadOnce();
      });

      registration = await container.register(scriptUrl, { scope });
      lastCheck = Date.now();
      if (registration.waiting && registration.active) setStatus('available');
      watchInstalling(registration.installing);
      registration.addEventListener('updatefound', () => watchInstalling(registration!.installing));

      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        const stale = Date.now() - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
        if (document.visibilityState === 'visible' && stale) checkForUpdate();
      });
    },

    applyUpdate() {
      if (status !== 'available') return;
      setStatus('reloading');
      reloadRequested = true;
      const waiting = registration?.waiting;
      if (!waiting) {
        reloadOnce();
        return;
      }
      waiting.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(reloadOnce, RELOAD_FALLBACK_MS);
    },
  };
}

const BASE_URL = import.meta.env.BASE_URL;

/** The app's update store, shared by registerServiceWorker and UpdateToast. */
export const appUpdates = createServiceWorkerUpdates({
  scriptUrl: `${BASE_URL}sw.js`,
  scope: BASE_URL,
  reload: () => window.location.reload(),
});

/**
 * Registers the service worker in production builds, once the page has loaded (so the
 * precache downloads do not compete with the first render). Does nothing where service
 * workers are unavailable (old browsers, insecure origins, some private modes).
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;

  if (!import.meta.env.PROD) {
    // A worker left behind by `vite preview` on the same origin would serve stale files
    // to the dev server, so remove it.
    container
      .getRegistration(BASE_URL)
      .then((leftover) => leftover?.unregister())
      .catch(() => undefined);
    return;
  }

  const start = () => {
    appUpdates.register(container).catch((error: unknown) => {
      console.warn('Offline support is unavailable: the service worker did not register.', error);
    });
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
