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

export interface FetchOptions {
  signal?: AbortSignal;
  /** Passed to fetch(); see the caching notes in chesscom.ts. */
  cache?: RequestCache;
  headers?: Record<string, string>;
  /** Max retries after HTTP 429 (exponential backoff 1s, 2s, 4s... capped at 30s). Default 4. */
  maxRetries?: number;
}

/**
 * Runs `task` after every earlier task queued for the same `key` has settled.
 * A failing task does not block the queue. Aborting a queued task removes it
 * without running it.
 */
export function enqueue<T>(_key: string, _task: () => Promise<T>, _signal?: AbortSignal): Promise<T> {
  throw new Error('not implemented');
}

/**
 * GET a URL through the host's serial queue and return the Response for 2xx.
 * 404 → NotFoundError, 410 → NotFoundError, 429 → retry with backoff then RateLimitError,
 * network failure → NetworkError (retried once). AbortError propagates unchanged.
 */
export function queuedFetch(_url: string, _options?: FetchOptions): Promise<Response> {
  throw new Error('not implemented');
}

/** queuedFetch + JSON parsing. */
export function fetchJson<T>(_url: string, _options?: FetchOptions): Promise<T> {
  throw new Error('not implemented');
}

/** Tests only: drops queued state between tests. */
export function resetQueuesForTests(): void {
  throw new Error('not implemented');
}
