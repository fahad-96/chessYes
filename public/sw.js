/*
 * Chess Yes service worker: offline start, offline analysis and update prompts.
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
 *   - PRECACHE: the files downloaded at install, grouped by how they are cached. The coach
 *     voice pack (voice-pack/, ~20 MB of clips) is never precached: each clip is cached the
 *     first time it is played.
 *
 * Caching rules. Only GET requests inside this app's scope are handled. Cross-origin
 * requests (the Chess.com and Lichess APIs) always go straight to the network: the app
 * keeps its own IndexedDB caches for game data.
 *   - Navigations: network first, falling back to the precached app shell (app.html), whose
 *     router shows any page (offline start).
 *   - assets/*: cache first. Vite puts a content hash in these names, so a cached copy is
 *     never stale.
 *   - engine/* (Stockfish js + wasm, ~1.9 MB): cache first with background revalidation.
 *     The names do not change between deploys, so they live in a cache that is not tied
 *     to the build id and are not downloaded again after every deploy.
 *   - voice-pack/*.mp3 (the coach voice's clips, ~7 kB each): cache first, in a cache of their
 *     own that survives deploys and keeps the most recent VOICE_MAX_ENTRIES clips. The file
 *     names contain a hash, so a cached clip is never stale.
 *   - voice-pack/manifest.json: network first (it names the clips of the current pack), with
 *     the cached copy after MANIFEST_TIMEOUT_MS or offline.
 *   - Other precached files (manifest, icons): served from the precache.
 *   - Anything else: network first, with a small capped runtime cache as the fallback.
 *
 * Updates. A new worker installs in the background and then waits. The page shows
 * "A new version of Chess Yes is available"; its Reload button posts SKIP_WAITING, this worker
 * takes over, deletes the previous version's caches and the page reloads once.
 */

const BUILD_ID = '__KIBITZ_BUILD_ID__';
const PRECACHE = /* __KIBITZ_PRECACHE__ */ { shell: [], assets: [], engine: [] };

/** Cache names include the scope, so two copies of Chess Yes on one origin never collide. */
const SCOPE = self.registration.scope;
const CACHE_PREFIX = `kibitz@${new URL(SCOPE).pathname}:`;
const PRECACHE_CACHE = `${CACHE_PREFIX}precache-${BUILD_ID}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${BUILD_ID}`;
/** Bump the version only if the format of the stored engine responses changes. */
const ENGINE_CACHE = `${CACHE_PREFIX}engine-v1`;
/** The coach voice's clips and manifest; not tied to a build either. */
const VOICE_CACHE = `${CACHE_PREFIX}voice-v1`;

/** Vite's build.assetsDir: hashed, immutable files. */
const ASSETS_PREFIX = 'assets/';
const ENGINE_PREFIX = 'engine/';
const VOICE_PREFIX = 'voice-pack/';
const VOICE_MANIFEST = 'voice-pack/manifest.json';
/** About 5 MB of clips: a few reviews' worth of lines, small enough for any phone. */
const VOICE_MAX_ENTRIES = 700;
/** A slow network should not hold up the first line: use the cached manifest after this. */
const MANIFEST_TIMEOUT_MS = 3000;
/** The runtime cache only backs up stray same-origin files, so it stays small. */
const RUNTIME_MAX_ENTRIES = 60;
/** On a connection that is up but barely working, start from the cached app after this. */
const NAVIGATION_TIMEOUT_MS = 4000;

const toUrl = (path) => new URL(path, SCOPE).href;
const INDEX_URL = toUrl('./');
/** The empty app shell (scripts/prerender.mjs): any route can start from it. */
const APP_URL = toUrl('./app.html');
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
      const keep = new Set([PRECACHE_CACHE, RUNTIME_CACHE, ENGINE_CACHE, VOICE_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name))
          .map((name) => caches.delete(name)),
      );
      await pruneEngineCache();
      await trimCache(VOICE_CACHE, VOICE_MAX_ENTRIES);
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
  } else if (path === VOICE_MANIFEST) {
    event.respondWith(handleVoiceManifest(event, url.href));
  } else if (path.startsWith(VOICE_PREFIX) && path.endsWith('.mp3')) {
    event.respondWith(handleVoiceClip(event, url.href));
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
    // Offline or too slow. Every page is the app shell plus a route the router reads from the
    // URL; other files opened directly (the engine licence, say) are served if this version
    // has them. Builds without app.html (vite dev) fall back to index.html.
    const fallback =
      (await matchOwnCaches(event.request)) ??
      (await lookUp(APP_URL, PRECACHE_CACHE)) ??
      (await lookUp(INDEX_URL, PRECACHE_CACHE));
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

/** Clips are immutable (hashed names): the cached copy always wins. */
async function handleVoiceClip(event, key) {
  const cached = await lookUp(key, VOICE_CACHE);
  if (cached) return cached;
  const response = await fetch(event.request);
  // Only audio: a server that answers a missing file with its index page must not poison it.
  const audio = (response.headers.get('content-type') ?? '').startsWith('audio/');
  if (isCacheable(response) && audio) event.waitUntil(putVoiceClip(key, response.clone()));
  return response;
}

let voicePuts = 0;

async function putVoiceClip(key, response) {
  const cache = await caches.open(VOICE_CACHE);
  await cache.put(key, response);
  // Trimming lists the whole cache, so do it every few clips rather than every one.
  if (++voicePuts % 25 === 0) await trimCache(VOICE_CACHE, VOICE_MAX_ENTRIES);
}

/** The manifest names the current pack's files: ask the network first, briefly. */
async function handleVoiceManifest(event, key) {
  const network = fetch(event.request).then(async (response) => {
    if (isCacheable(response)) {
      // A full or blocked cache must not turn a good response into an error.
      await caches
        .open(VOICE_CACHE)
        .then((cache) => cache.put(key, response.clone()))
        .catch(noop);
    }
    return response;
  });
  event.waitUntil(network.then(noop, noop));
  try {
    return await withTimeout(network, MANIFEST_TIMEOUT_MS);
  } catch {
    const cached = await lookUp(key, VOICE_CACHE);
    // Nothing cached yet: keep waiting for the network (or fail like a normal request).
    return cached ?? network;
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
  await trimCache(RUNTIME_CACHE, RUNTIME_MAX_ENTRIES);
}

/**
 * Keeps the newest `max` entries of a cache: keys come back oldest first, so trimming the
 * front keeps the most recent ones. The voice manifest is never trimmed.
 */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = (await cache.keys()).filter((request) => !request.url.endsWith(VOICE_MANIFEST));
  const excess = keys.length - max;
  if (excess > 0) await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

function noop() {}

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
