// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceWorkerUpdates, UpdateStatus } from './registerServiceWorker';
import { UpdateToast } from './UpdateToast';

/** An update store whose status the test controls. */
function fakeUpdates(initial: UpdateStatus) {
  let status = initial;
  const listeners = new Set<() => void>();
  const updates: ServiceWorkerUpdates & { set(next: UpdateStatus): void } = {
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    register: vi.fn(async () => undefined),
    applyUpdate: vi.fn(() => updates.set('reloading')),
    set(next) {
      status = next;
      for (const listener of listeners) listener();
    },
  };
  return updates;
}

afterEach(() => {
  cleanup();
});

describe('UpdateToast', () => {
  it('stays hidden until a new version is available', () => {
    const updates = fakeUpdates('idle');
    render(<UpdateToast updates={updates} />);
    expect(screen.queryByText(/new version/)).toBeNull();

    act(() => updates.set('available'));
    expect(screen.getByText('A new version of Chess Yes is available')).toBeTruthy();
  });

  it('announces the prompt through a live region that is always mounted', () => {
    const updates = fakeUpdates('idle');
    const { container } = render(<UpdateToast updates={updates} />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toBeTruthy();
    act(() => updates.set('available'));
    expect(region?.textContent).toContain('A new version of Chess Yes is available');
  });

  it('applies the update on Reload and disables the buttons while reloading', () => {
    const updates = fakeUpdates('available');
    render(<UpdateToast updates={updates} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(updates.applyUpdate).toHaveBeenCalledTimes(1);
    const reloading = screen.getByRole('button', { name: 'Reloading…' }) as HTMLButtonElement;
    expect(reloading.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Later' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('hides when dismissed with Later', () => {
    const updates = fakeUpdates('available');
    render(<UpdateToast updates={updates} />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText(/new version/)).toBeNull();
    expect(updates.applyUpdate).not.toHaveBeenCalled();
  });
});
