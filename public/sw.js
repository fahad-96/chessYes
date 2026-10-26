/*
 * Kibitz service worker: offline start, offline analysis and update prompts.
 *
 * Hand-written (no Workbox) so every caching rule can be read in this one file. Only
 * production builds register it (src/app/registerServiceWorker.ts).
 *
 * Build-time injection. Vite copies this file from public/ unchanged, then the
 * `kibitz:service-worker` plugin in vite.config.ts fills in the two placeholders below
 * in dist/sw.js:
 *   - BUILD_ID: a hash of the build output. A deploy that changes anything produces a
 *     byte-different sw.js (which is how browsers notice an update) and new cache names,
 *     while rebuilding identical code keeps the id, so users see no pointless update prompt.
 *   - PRECACHE: the files downloaded at install, grouped by how they are cached. The optional
 *     natural voice (its model worker in assets/, the ONNX runtime in voice/) is left out: it
 *     is fetched, and cached at runtime, only once a user turns that voice on.
 *
 * Caching rules. Only GET requests inside this app's scope are handled. Cross-origin
 * requests (the Chess.com and Lichess APIs) always go straight to the network: the app
 * keeps its own IndexedDB caches for game data.
 *   - Navigations: network first, falling back to the precached index.html (offline start).
 *   - assets/*: cache first. Vite puts a content hash in these names, so a cached copy is
 *     never stale.
 *   - engine/* (Stockfish js + wasm, ~1.9 MB): cache first with background revalidation.
 *     The names do not change between deploys, so they live in a cache that is not tied
 *     to the build id and are not downloaded again after every deploy.
 *   - Other precached files (manifest, icons): served from the precache.
 *   - Anything else: network first, with a small capped runtime cache as the fallback.
 *
 * Updates. A new worker installs in the background and then waits. The page shows
 * "A new version of Kibitz is available"; its Reload button posts SKIP_WAITING, this worker
 * takes over, deletes the previous version's caches and the page reloads once.
 */

const BUILD_ID = '__KIBITZ_BUILD_ID__';
const PRECACHE = /* __KIBITZ_PRECACHE__ */ { shell: [], assets: [], engine: [] };

/** Cache names include the scope, so two copies of Kibitz on one origin never collide. */
const SCOPE = self.registration.scope;
const CACHE_PREFIX = `kibitz@${new URL(SCOPE).pathname}:`;
const PRECACHE_CACHE = `${CACHE_PREFIX}precache-${BUILD_ID}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${BUILD_ID}`;
/** Bump the version only if the format of the stored engine responses changes. */
const ENGINE_CACHE = `${CACHE_PREFIX}engine-v1`;

/** Vite's build.assetsDir: hashed, immutable files. */
const ASSETS_PREFIX = 'assets/';
const ENGINE_PREFIX = 'engine/';
/** The runtime cache only backs up stray same-origin files, so it stays small. */
const RUNTIME_MAX_ENTRIES = 60;
/** On a connection that is up but barely working, start from the cached app after this. */
const NAVIGATION_TIMEOUT_MS = 4000;

const toUrl = (path) => new URL(path, SCOPE).href;
const INDEX_URL = toUrl('./');
const SHELL_URLS = new Set(PRECACHE.shell.map(toUrl));
const ENGINE_URLS = new Set(PRECACHE.engine.map(toUrl));

self.addEventListener('install', (event) => {
  // No skipWaiting() here: an update waits until the user chooses to reload, so a page
  // never runs code from two different builds.
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PRECACHE_CACHE, RUNTIME_CACHE, ENGINE_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name))
          .map((name) => caches.delete(name)),
      );
      await pruneEngineCache();
      // Lets the navigation request start while this worker boots (network-first pages).
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      // Control the page that installed us, so the first visit already works offline.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  // Out of scope or cross-origin (api.chess.com, lichess.org, ...): let the browser handle it.
  if (!request.url.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }
  const url = new URL(request.url);
  url.hash = '';
  const path = url.href.slice(SCOPE.length);
  if (path.startsWith(ENGINE_PREFIX)) {
    event.respondWith(handleEngineFile(event));
  } else if (path.startsWith(ASSETS_PREFIX) || SHELL_URLS.has(url.href)) {
    event.respondWith(cacheFirst(event));
  } else {
    event.respondWith(networkFirst(event));
  }
});

// ---------------------------------------------------------------------------------------
// Install

async function precache() {
  const cache = await caches.open(PRECACHE_CACHE);
  await Promise.all([
    // Hashed files: a copy kept by the previous version is byte-identical, so reuse it
    // instead of downloading it again (most chunks survive a small deploy unchanged).
    ...PRECACHE.assets.map(async (path) => {
      const url = toUrl(path);
      const existing = await lookUp(url);
      await cache.put(url, existing ?? (await fetchOk(url, 'default')));
    }),
    // Unhashed files: always revalidate with the server.
    ...PRECACHE.shell.map(async (path) => {
      const url = toUrl(path);
      await cache.put(url, await fetchOk(url, 'no-cache'));
    }),
  ]);

  // Best effort: a flaky download of the engine must not stop the app shell from
  // installing. The engine is cached on first use anyway (see handleEngineFile).
  const engine = await caches.open(ENGINE_CACHE);
  await Promise.all(
    [...ENGINE_URLS].map(async (url) => {
      if (await lookUp(url, ENGINE_CACHE)) return;
      try {
        await engine.put(url, await fetchOk(url, 'no-cache'));
      } catch (error) {
        console.warn('[sw] could not precache', url, error);
      }
    }),
  );
}

/** Fetches a file for a cache, rejecting on HTTP errors so a broken install is retried. */
async function fetchOk(url, cacheMode) {
  const response = await fetch(new Request(url, { cache: cacheMode, credentials: 'same-origin' }));
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  // A redirected response cannot answer a navigation, so store a plain copy.
  return response.redirected ? copyResponse(response) : response;
}

async function copyResponse(response) {
  const { status, statusText, headers } = response;
  return new Response(await response.blob(), { status, statusText, headers });
}

/** Drops engine files that are no longer shipped (for example after a Stockfish upgrade). */
async function pruneEngineCache() {
  if (ENGINE_URLS.size === 0) return;
  const cache = await caches.open(ENGINE_CACHE);
  const requests = await cache.keys();
  await Promise.all(
    requests.filter((req) => !ENGINE_URLS.has(req.url)).map((req) => cache.delete(req)),
  );
}

// ---------------------------------------------------------------------------------------
// Strategies

async function handleNavigation(event) {
  const network = (async () => (await event.preloadResponse) || fetch(event.request))();
  try {
    return await withTimeout(network, NAVIGATION_TIMEOUT_MS);
  } catch {
    // Offline or too slow. Hash routing means every screen is index.html plus a #fragment;
    // other files opened directly (the engine licence, say) are served if this version has them.
    const fallback =
      (await matchOwnCaches(event.request)) ?? (await lookUp(INDEX_URL, PRECACHE_CACHE));
    if (fallback) {
      network.catch(() => undefined);
      return fallback;
    }
    // Nothing cached yet: keep waiting for the network (or fail like a normal page load).
    return network;
  }
}

async function cacheFirst(event) {
  const { request } = event;
  const cached = (await lookUp(request, PRECACHE_CACHE)) ?? (await lookUp(request, RUNTIME_CACHE));
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) event.waitUntil(putInRuntimeCache(request, response.clone()));
  return response;
}

async function networkFirst(event) {
  const { request } = event;
  try {
    const response = await fetch(request);
    if (isCacheable(response)) event.waitUntil(putInRuntimeCache(request, response.clone()));
    return response;
  } catch (error) {
    const cached = await lookUp(request, RUNTIME_CACHE);
    if (cached) return cached;
    throw error;
  }
}

/** Engine files already revalidated by this worker instance (it lives for minutes at most). */
const revalidated = new Set();

async function handleEngineFile(event) {
  const url = new URL(event.request.url);
  url.hash = '';
  const key = url.href;
  const cache = await caches.open(ENGINE_CACHE);
  const cached = await lookUp(key, ENGINE_CACHE);
  if (!cached) {
    const response = await fetch(event.request);
    if (isCacheable(response)) event.waitUntil(cache.put(key, response.clone()));
    return response;
  }
  if (!revalidated.has(key)) {
    revalidated.add(key);
    event.waitUntil(revalidateEngineFile(cache, key, cached).catch(() => undefined));
  }
  return cached;
}

/**
 * Asks the server whether an engine file changed. The request is conditional (the HTTP
 * cache sends If-None-Match), so an unchanged 1.8 MB wasm costs a 304, and the stored copy
 * is only rewritten when its validators differ.
 */
async function revalidateEngineFile(cache, key, cached) {
  const fresh = await fetch(new Request(key, { cache: 'no-cache', credentials: 'same-origin' }));
  if (!isCacheable(fresh) || sameValidators(cached, fresh)) return;
  await cache.put(key, fresh);
}

function sameValidators(a, b) {
  const names = ['etag', 'last-modified', 'content-length'];
  const known = names.filter((name) => a.headers.has(name) || b.headers.has(name));
  return known.length > 0 && known.every((name) => a.headers.get(name) === b.headers.get(name));
}

// ---------------------------------------------------------------------------------------
// Helpers

function isCacheable(response) {
  return response.ok && response.type === 'basic';
}

/**
 * Finds a cached response, in one cache or (without a name) in any. Vary is ignored: some
 * servers (vite preview, for one) send "Vary: Origin", and module scripts are requested
 * with an Origin header that the precache requests did not have, so a strict match would
 * miss files that are cached. Every cached response is one of this app's own files.
 */
function lookUp(request, cacheName) {
  return caches.match(request, { cacheName, ignoreVary: true });
}

/**
 * Looks a request up in this version's caches only. Searching every cache could also find
 * the files of a newer version that is installed and waiting.
 */
async function matchOwnCaches(request) {
  for (const cacheName of [PRECACHE_CACHE, ENGINE_CACHE, RUNTIME_CACHE]) {
    const hit = await lookUp(request, cacheName);
    if (hit) return hit;
  }
  return undefined;
}

async function putInRuntimeCache(request, response) {
  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response);
  // Keys come back oldest first, so trimming the front keeps the most recent entries.
  const keys = await cache.keys();
  const excess = keys.length - RUNTIME_MAX_ENTRIES;
  if (excess > 0) await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
