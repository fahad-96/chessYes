// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createServiceWorkerUpdates,
  RELOAD_FALLBACK_MS,
  UPDATE_CHECK_INTERVAL_MS,
} from './registerServiceWorker';

/** Just enough of ServiceWorker, ServiceWorkerRegistration and ServiceWorkerContainer. */
class FakeWorker extends EventTarget {
  messages: unknown[] = [];
  constructor(public state: ServiceWorkerState) {
    super();
  }
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  setState(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  update = vi.fn(() => Promise.resolve());
  /** Simulates the browser finding a new sw.js. */
  findUpdate(): FakeWorker {
    this.installing = new FakeWorker('installing');
    this.dispatchEvent(new Event('updatefound'));
    return this.installing;
  }
}

class FakeContainer extends EventTarget {
  registration = new FakeRegistration();
  register = vi.fn(async () => this.registration);
  changeController() {
    this.dispatchEvent(new Event('controllerchange'));
  }
}

function setup(prepare?: (registration: FakeRegistration) => void) {
  const container = new FakeContainer();
  prepare?.(container.registration);
  const reload = vi.fn();
  const updates = createServiceWorkerUpdates({ scriptUrl: '/sw.js', scope: '/', reload });
  const listener = vi.fn();
  updates.subscribe(listener);
  const ready = updates.register(container as unknown as ServiceWorkerContainer);
  return { container, registration: container.registration, updates, reload, listener, ready };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createServiceWorkerUpdates', () => {
  it('registers the worker with its scope', async () => {
    const { container, ready } = setup();
    await ready;
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('does not prompt on the very first install', async () => {
    const { registration, updates, ready } = setup();
    await ready;
    const worker = registration.findUpdate();
    worker.setState('installed');
    worker.setState('activated');
    expect(updates.getStatus()).toBe('idle');
  });

  it('prompts when a new version finishes installing next to the active one', async () => {
    const { registration, updates, listener, ready } = setup((r) => {
      r.active = new FakeWorker('activated');
    });
    await ready;
    const worker = registration.findUpdate();
    expect(updates.getStatus()).toBe('idle');
    worker.setState('installed');
    registration.waiting = worker;
    expect(updates.getStatus()).toBe('available');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('prompts at startup when a version is already waiting', async () => {
    const { updates, ready } = setup((r) => {
      r.active = new FakeWorker('activated');
      r.waiting = new FakeWorker('installed');
    });
    await ready;
    expect(updates.getStatus()).toBe('available');
  });

  it('activates the waiting worker and reloads once it takes control', async () => {
    const waiting = new FakeWorker('installed');
    const { container, updates, reload, ready } = setup((r) => {
      r.active = new FakeWorker('activated');
      r.waiting = waiting;
    });
    await ready;
    updates.applyUpdate();
    expect(updates.getStatus()).toBe('reloading');
    expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(reload).not.toHaveBeenCalled();

    container.changeController();
    container.changeController();
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway if the new worker never takes control', async () => {
    const { updates, reload, ready } = setup((r) => {
      r.active = new FakeWorker('activated');
      r.waiting = new FakeWorker('installed');
    });
    await ready;
    updates.applyUpdate();
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when another tab activated the update', async () => {
    const { container, registration, updates, reload, ready } = setup((r) => {
      r.active = new FakeWorker('activated');
      r.waiting = new FakeWorker('installed');
    });
    await ready;
    // Another tab pressed Reload: the waiting worker is now the active one.
    registration.active = registration.waiting;
    registration.waiting = null;
    container.changeController();
    expect(reload).not.toHaveBeenCalled();
    expect(updates.getStatus()).toBe('available');

    // This tab's button now just reloads.
    updates.applyUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores applyUpdate when nothing is waiting', async () => {
    const { updates, reload, ready } = setup();
    await ready;
    updates.applyUpdate();
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    expect(reload).not.toHaveBeenCalled();
    expect(updates.getStatus()).toBe('idle');
  });

  it('checks for new versions periodically and when the tab comes back', async () => {
    const { registration, ready } = setup();
    await ready;
    expect(registration.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);

    // Coming back right after a check does not check again...
    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalledTimes(1);
    // ...but coming back later does (timers are throttled in background tabs).
    vi.setSystemTime(Date.now() + UPDATE_CHECK_INTERVAL_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('survives a failed update check while offline', async () => {
    const { registration, ready } = setup();
    await ready;
    registration.update.mockImplementation(() => Promise.reject(new TypeError('offline')));
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes listeners', async () => {
    const { registration, updates, ready } = setup((r) => {
      r.active = new FakeWorker('activated');
    });
    const listener = vi.fn();
    const unsubscribe = updates.subscribe(listener);
    unsubscribe();
    await ready;
    registration.findUpdate().setState('installed');
    expect(updates.getStatus()).toBe('available');
    expect(listener).not.toHaveBeenCalled();
  });
});
