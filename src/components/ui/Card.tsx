import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  // kb-card (index.css): translucent glass over the ambient background. Utilities in
  // className still win, so a card can keep a solid or tinted background of its own.
  return <div className={cn('kb-card rounded-2xl border', className)} {...props} />;
}
