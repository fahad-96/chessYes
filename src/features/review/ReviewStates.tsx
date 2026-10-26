import { Link } from 'react-router-dom';
import { House, RotateCcw, SearchX, TriangleAlert, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import type { ReviewLoadError } from './reviewHelpers';

/** Placeholder while the game is fetched: the page shape, so nothing jumps on load. */
export function ReviewSkeleton() {
  return (
    <div className="w-full" aria-busy="true">
      <div className="mb-4 h-6 w-64 max-w-full animate-pulse rounded-md bg-surface-2" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="mx-auto w-full lg:max-w-[calc(100dvh-19.5rem)]">
          <div className="flex aspect-square w-full items-center justify-center rounded-md bg-surface-2">
            <span className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-4 w-4" label="Loading game" />
              Loading game…
            </span>
          </div>
        </div>
        <div className="hidden flex-col gap-4 lg:flex">
          <div className="h-56 animate-pulse rounded-2xl bg-surface-2" />
          <div className="h-32 animate-pulse rounded-2xl bg-surface-2" />
        </div>
      </div>
    </div>
  );
}

export function ReviewErrorView({
  error,
  onRetry,
}: {
  error: ReviewLoadError;
  onRetry: () => void;
}) {
  const Icon =
    error.kind === 'not-found' ? SearchX : error.kind === 'network' ? WifiOff : TriangleAlert;
  return (
    <div className="mx-auto w-full max-w-lg py-8">
      <Card className="flex flex-col items-center gap-4 p-6 text-center" role="alert">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
          <Icon aria-hidden="true" className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{error.title}</h1>
          <p className="mt-1 text-sm text-muted">{error.message}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {error.retryable && (
            <Button variant="primary" onClick={onRetry}>
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              Try again
            </Button>
          )}
          <Link
            to="/"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 text-sm hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <House aria-hidden="true" className="h-4 w-4" />
            Back to home
          </Link>
        </div>
      </Card>
    </div>
  );
}
