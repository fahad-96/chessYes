import { ArrowRight, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { FAQ } from './faq';

/**
 * Frequently asked questions. Native <details>, so every answer is in the page's HTML
 * (readable by search engines and screen readers) and opens without JavaScript.
 */
export function HomeFaq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-24">
      <h2
        id="faq-heading"
        className="text-center font-display text-[clamp(2.4rem,5vw,3.5rem)] leading-tight tracking-[-0.01em]"
      >
        Questions, <em className="kb-display-accent">answered.</em>
      </h2>
      <p className="mt-3 text-center text-muted">
        About reviewing your chess games with Chess Yes.
      </p>
      <Card className="mt-8 divide-y divide-glass-border">
        {FAQ.map((item) => (
          <details key={item.question} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold transition-colors hover:text-brand [&::-webkit-details-marker]:hidden">
              <h3 className="text-[15px]">{item.question}</h3>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="px-5 pb-4 text-sm leading-relaxed text-muted">
              <p>{item.answer}</p>
              {item.link && (
                <Link
                  to={item.link.to}
                  className="mt-2 inline-flex items-center gap-1 font-medium text-brand underline-offset-4 hover:underline"
                >
                  {item.link.label}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          </details>
        ))}
      </Card>
    </section>
  );
}
