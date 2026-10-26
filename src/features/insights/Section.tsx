import { useId, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export interface SectionProps {
  title: string;
  /** One line under the title: what the numbers are based on. */
  description?: ReactNode;
  /** Controls on the right of the title (wrap under it on phones). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled card; the page is a column of these. */
export function Section({ title, description, actions, children, className }: SectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5', className)}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A quiet message inside a section: nothing to show yet. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
      {children}
    </p>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-line px-4 py-6 text-center"
    >
      <TriangleAlert className="h-5 w-5 text-danger" aria-hidden="true" />
      <p className="text-sm">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
