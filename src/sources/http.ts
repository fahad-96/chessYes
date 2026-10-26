/**
 * HTTP helpers shared by the data sources.
 *
 * Chess.com's Published-Data API rejects parallel requests with HTTP 429, so
 * every request to a host goes through a per-host serial queue: one request in
 * flight at a time, in call order.
 */

export class NotFoundError extends Error {
  override name = 'NotFoundError';
}
export class RateLimitError extends Error {
  override name = 'RateLimitError';
}
export class NetworkError extends Error {
  override name = 'NetworkError';
}
/** Any other non-2xx response. */
export class HttpError extends Error {
  override name = 'HttpError';
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface FetchOptions {
  signal?: AbortSignal;
  /** Passed to fetch(); see the caching notes in chesscom.ts. */
  cache?: RequestCache;
  headers?: Record<string, string>;
  /** Max retries after HTTP 429 (exponential backoff 1s, 2s, 4s... capped at 30s). Default 4. */
  maxRetries?: number;
  /** First 429 backoff delay in ms, doubled on every retry (capped at 30 s or this). Default 1000. */
  retryBaseMs?: number;
}

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_BASE_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
/** Pause before the single retry after a network failure (gives flaky mobile links a moment). */
const NETWORK_RETRY_DELAY_MS = 500;

/** Tail of each key's chain. Links always resolve, so one failure never blocks later tasks. */
const queues = new Map<string, Promise<void>>();

/** True for the error fetch() and our own helpers throw when a request is aborted. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function abortError(signal: AbortSignal): unknown {
  // Mirror fetch(): reject with the signal's reason (an AbortError DOMException by default).
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Runs `task` after every earlier task queued for the same `key` has settled.
 * A failing task does not block the queue. Aborting a queued task removes it
 * without running it.
 */
export function enqueue<T>(key: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError(signal));

  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const finished = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => finished);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal!));
    signal?.addEventListener('abort', onAbort, { once: true });

    void previous.then(() => {
      signal?.removeEventListener('abort', onAbort);
      // Aborted while waiting: the promise is already rejected, skip the task.
      if (signal?.aborted) {
        release();
        return;
      }
      let running: Promise<T>;
      try {
        running = task();
      } catch (error) {
        running = Promise.reject(error);
      }
      running.then(resolve, reject).finally(release);
    });
  });
}

/** setTimeout as a promise that rejects as soon as `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Frees the connection of a response whose body we are not going to read. */
function discardBody(response: Response): void {
  response.body?.cancel().catch(() => {});
}

/** One GET with the retry policy; runs inside the host queue. */
async function fetchWithRetry(url: string, options: FetchOptions): Promise<Response> {
  const { signal, cache, headers } = options;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  let rateLimitRetries = 0;
  let networkRetried = false;

  for (;;) {
    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', signal, cache, headers });
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      if (networkRetried) {
        throw new NetworkError(`Could not reach ${new URL(url).host}. Check your connection.`, {
          cause: error,
        });
      }
      networkRetried = true;
      await sleep(NETWORK_RETRY_DELAY_MS, signal);
      continue;
    }

    if (response.ok) return response;
    discardBody(response);

    if (response.status === 404 || response.status === 410) {
      throw new NotFoundError(`Not found: ${url}`);
    }
    if (response.status === 429) {
      if (rateLimitRetries >= maxRetries) {
        throw new RateLimitError(
          `${new URL(url).host} is rate limiting requests. Try again in a minute.`,
        );
      }
      // The cap never shortens the first wait (Lichess asks for a full minute).
      const cap = Math.max(MAX_BACKOFF_MS, retryBaseMs);
      const delay = Math.min(retryBaseMs * 2 ** rateLimitRetries, cap);
      rateLimitRetries += 1;
      await sleep(delay, signal);
      continue;
    }
    throw new HttpError(response.status, `HTTP ${response.status} for ${url}`);
  }
}

/**
 * Fetches through the host queue and reads the body before releasing it, so a large
 * download never overlaps the next request to the same host.
 */
function queuedRead<T>(
  url: string,
  options: FetchOptions,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const key = new URL(url).host;
  return enqueue(key, async () => read(await fetchWithRetry(url, options)), options.signal);
}

/**
 * GET a URL through the host's serial queue and return the Response for 2xx.
 * 404 → NotFoundError, 410 → NotFoundError, 429 → retry with backoff then RateLimitError,
 * network failure → NetworkError (retried once). AbortError propagates unchanged.
 */
export function queuedFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  return queuedRead(url, options, async (response) => response);
}

/** queuedFetch + JSON parsing. */
export function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  return queuedRead(url, options, (response) => response.json() as Promise<T>);
}

/** queuedFetch + reading the body as text (used for ndjson streams). */
export function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  return queuedRead(url, options, (response) => response.text());
}

/** Tests only: drops queued state between tests. */
export function resetQueuesForTests(): void {
  queues.clear();
}
