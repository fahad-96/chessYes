import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

// text-base (16px) on purpose: iOS Safari zooms the page into smaller inputs.
const fieldClass = cn(
  'w-full rounded-lg border border-line bg-surface-2 px-3 text-base text-text',
  'placeholder:text-muted transition-colors',
  'hover:border-muted/60 focus-visible:border-accent',
  'aria-[invalid=true]:border-danger disabled:opacity-50',
);

const inputSizes = { md: 'h-10', lg: 'h-11', xl: 'h-12' } as const;

export interface InputProps extends ComponentProps<'input'> {
  /** Height: md 40px, lg 44px (default, a comfortable touch target), xl 48px (matches a large Button). */
  inputSize?: keyof typeof inputSizes;
}

/** Single-line text input styled with the design tokens. */
export function Input({ className, inputSize = 'lg', ...props }: InputProps) {
  return <input className={cn(fieldClass, inputSizes[inputSize], className)} {...props} />;
}

/** Multi-line text input styled like {@link Input}. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldClass, 'py-2.5 leading-relaxed', className)} {...props} />;
}
