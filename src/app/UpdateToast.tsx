import { useState, useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { appUpdates, type ServiceWorkerUpdates } from './registerServiceWorker';

/**
 * "A new version of Kibitz is available" prompt, shown when a new service worker is waiting.
 * Rendered next to <App /> in main.tsx, outside the router, so it appears on every screen.
 * Reload hands control to the new version and reloads once; Later hides the prompt (the new
 * version then starts the next time every Kibitz tab has been closed).
 */
export function UpdateToast({ updates = appUpdates }: { updates?: ServiceWorkerUpdates }) {
  const status = useSyncExternalStore(updates.subscribe, updates.getStatus, updates.getStatus);
  const [dismissed, setDismissed] = useState(false);
  const visible = status !== 'idle' && !dismissed;
  const reloading = status === 'reloading';

  return (
    // The live region stays mounted so screen readers announce the prompt when it appears.
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {visible && (
        <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2 rounded-2xl border border-line bg-surface-2 p-3 shadow-lg shadow-black/20 sm:flex-row sm:items-center sm:gap-3 sm:pl-4 motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:starting:translate-y-2 motion-safe:starting:opacity-0">
          <p className="flex min-w-0 items-center gap-2.5 text-sm text-text sm:flex-1">
            <RefreshCw aria-hidden="true" className="size-4 shrink-0 text-accent" />
            <span>A new version of Kibitz is available</span>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDismissed(true)} disabled={reloading}>
              Later
            </Button>
            <Button variant="primary" onClick={() => updates.applyUpdate()} disabled={reloading}>
              {reloading ? 'Reloading…' : 'Reload'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
