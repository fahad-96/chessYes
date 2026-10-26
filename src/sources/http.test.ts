import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueue,
  fetchJson,
  HttpError,
  isAbortError,
  NetworkError,
  NotFoundError,
  queuedFetch,
  RateLimitError,
  resetQueuesForTests,
} from './http';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run (real timers only). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetQueuesForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('enqueue', () => {
  it('runs tasks with the same key one at a time, in call order', async () => {
    const log: string[] = [];
    const first = deferred<string>();
    const a = enqueue('k', () => {
      log.push('a');
      return first.promise;
    });
    const b = enqueue('k', async () => {
      log.push('b');
      return 'b';
    });
    await flush();
    expect(log).toEqual(['a']);

    first.resolve('a');
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
    expect(log).toEqual(['a', 'b']);
  });

  it('runs tasks with different keys concurrently', async () => {
    const log: string[] = [];
    const blocker = deferred<void>();
    void enqueue('one', () => {
      log.push('one');
      return blocker.promise;
    });
    const other = enqueue('two', async () => {
      log.push('two');
      return 2;
    });
    await expect(other).resolves.toBe(2);
    expect(log).toEqual(['one', 'two']);
    blocker.resolve();
  });

  it('keeps the queue moving after a task fails', async () => {
    const failing = enqueue('k', async () => {
      throw new Error('boom');
    });
    const next = enqueue('k', async () => 'next');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('next');
  });

  it('treats a synchronous throw like a rejection', async () => {
    const failing = enqueue('k', () => {
      throw new Error('sync');
    });
    await expect(failing).rejects.toThrow('sync');
    await expect(enqueue('k', async () => 1)).resolves.toBe(1);
  });

  it('removes a task aborted while queued without running it', async () => {
    const blocker = deferred<string>();
    const first = enqueue('k', () => blocker.promise);
    const controller = new AbortController();
    const skipped = vi.fn(async () => 'never');
    const aborted = enqueue('k', skipped, controller.signal);
    const third = enqueue('k', async () => 'third');

    controller.abort();
    // Rejects right away, without waiting for the task ahead of it.
    await expect(aborted).rejects.toSatisfy(isAbortError);

    blocker.resolve('first');
    await expect(first).resolves.toBe('first');
    await expect(third).resolves.toBe('third');
    expect(skipped).not.toHaveBeenCalled();
  });

  it('rejects at once when the signal is already aborted', async () => {
    const task = vi.fn(async () => 1);
    await expect(enqueue('k', task, AbortSignal.abort())).rejects.toSatisfy(isAbortError);
    expect(task).not.toHaveBeenCalled();
  });
});

describe('queuedFetch', () => {
  it('sends one request per host at a time; other hosts are not blocked', async () => {
    const first = deferred<Response>();
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/1') ? first.promise : Promise.resolve(jsonResponse({ url })),
    );

    const a = fetchJson('https://api.chess.com/pub/1');
    const b = fetchJson('https://api.chess.com/pub/2');
    const c = fetchJson('https://lichess.org/api/3');
    await expect(c).resolves.toEqual({ url: 'https://lichess.org/api/3' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.chess.com/pub/1',
      'https://lichess.org/api/3',
    ]);

    first.resolve(jsonResponse({ url: 'first' }));
    await expect(a).resolves.toEqual({ url: 'first' });
    await expect(b).resolves.toEqual({ url: 'https://api.chess.com/pub/2' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('passes the signal, cache mode and headers to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const controller = new AbortController();
    await queuedFetch('https://lichess.org/x', {
      signal: controller.signal,
      cache: 'no-cache',
      headers: { Accept: 'application/x-ndjson' },
    });
    expect(fetchMock).toHaveBeenCalledWith('https://lichess.org/x', {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-cache',
      headers: { Accept: 'application/x-ndjson' },
    });
  });

  it.each([404, 410])('maps HTTP %i to NotFoundError', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'not found' }, status));
    await expect(queuedFetch('https://api.chess.com/pub/player/nobody')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('maps other errors to HttpError with the status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    const error = await queuedFetch('https://api.chess.com/pub/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
  });

  it('retries after 429 with exponential backoff', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = fetchJson('https://api.chess.com/pub/x');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(result).resolves.toEqual({ ok: true });
  });

  it('gives up with RateLimitError after maxRetries', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response(null, { status: 429 }));

    const result = queuedFetch('https://api.chess.com/pub/x', { maxRetries: 2 });
    const assertion = expect(result).rejects.toBeInstanceOf(RateLimitError);
    await vi.advanceTimersByTimeAsync(1000 + 2000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('caps the backoff at 30 seconds and honours retryBaseMs', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response(null, { status: 429 }));

    const result = queuedFetch('https://lichess.org/x', { retryBaseMs: 20_000, maxRetries: 2 });
    const assertion = expect(result).rejects.toBeInstanceOf(RateLimitError);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_999); // 40 s doubled, capped to 30 s
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await assertion;
  });

  it('holds the host queue while backing off', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockImplementation(async (url: string) => jsonResponse({ url }));

    const first = fetchJson('https://api.chess.com/pub/1');
    const second = fetchJson('https://api.chess.com/pub/2');
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    await expect(first).resolves.toEqual({ url: 'https://api.chess.com/pub/1' });
    await expect(second).resolves.toEqual({ url: 'https://api.chess.com/pub/2' });
  });

  it('stops backing off when aborted', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response(null, { status: 429 }));
    const controller = new AbortController();

    const result = queuedFetch('https://api.chess.com/pub/x', { signal: controller.signal });
    const assertion = expect(result).rejects.toSatisfy(isAbortError);
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure once', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    const result = fetchJson('https://api.chess.com/pub/x');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a NetworkError when the retry fails too', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = queuedFetch('https://api.chess.com/pub/x');
    const assertion = expect(result).rejects.toBeInstanceOf(NetworkError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propagates an AbortError from fetch without retrying', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValue(abort);
    await expect(queuedFetch('https://api.chess.com/pub/x')).rejects.toBe(abort);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
