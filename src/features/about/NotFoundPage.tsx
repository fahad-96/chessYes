import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClass } from '@/components/ui/Button';
import { LogoMark } from '@/components/ui/Logo';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';

/** Fallback for unknown routes. */
export default function NotFoundPage() {
  useDocumentTitle('Page not found · Chess Yes');
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <LogoMark size={56} />
      <p className="tabular mt-6 text-sm font-semibold tracking-wide text-accent">404</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">This page is off the board</h1>
      <p className="mt-2 text-muted">The link may be broken, or the page has moved.</p>
      <Link to="/" className={buttonClass('primary', 'md', 'mt-6')}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Chess Yes
      </Link>
    </div>
  );
}
