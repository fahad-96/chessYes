import { ExternalLink } from 'lucide-react';
import { CLASSIFICATION_META } from '@/components/classificationMeta';
import { CLASSIFICATIONS } from '@/core/types';
import { Card } from '@/components/ui/Card';
import { CLASSIFICATION_DOC_URL } from '@/features/about/links';

/** Every move label with its colour, symbol and meaning, best to worst. */
export function ClassificationLegend() {
  return (
    <section aria-labelledby="legend-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="legend-heading" className="text-xl font-semibold tracking-tight">
            What the labels mean
          </h2>
          <p className="mt-1 text-sm text-muted">
            Each move is labelled by how much it changed the mover’s chance of winning.
          </p>
        </div>
        <a
          href={CLASSIFICATION_DOC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-accent underline-offset-4 hover:underline"
        >
          Exact rules
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
      <Card className="p-2 sm:p-3">
        <ul className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          {CLASSIFICATIONS.map((id) => {
            const meta = CLASSIFICATION_META[id];
            return (
              <li key={id} className="flex gap-3 rounded-lg p-2.5">
                <span
                  aria-hidden="true"
                  className="mt-1 h-3 w-3 shrink-0 rounded-full"
                  style={{ background: meta.colorVar }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {meta.label}
                    {meta.symbol && (
                      <span className="ml-1.5 font-mono text-xs text-muted" aria-hidden="true">
                        {meta.symbol}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm leading-snug text-muted">{meta.description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
