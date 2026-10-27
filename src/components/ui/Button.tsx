import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  // Raised: a darker bottom edge (kb-raised in index.css) that presses in when clicked.
  // Its face is --button (4.5:1 with the label); see primaryFace for the xl size.
  primary: 'kb-raised text-accent-fg',
  secondary: 'bg-surface-2 text-text hover:bg-surface-3 border border-line',
  ghost: 'text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30',
};

// --edge: height of the raised edge of primary buttons, in proportion to the button.
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm rounded-md gap-1.5 [--edge:2px]',
  md: 'h-10 px-4 text-sm rounded-lg gap-2 [--edge:3px]',
  lg: 'h-12 px-6 text-base rounded-xl gap-2 [--edge:4px]',
  // The big call to action, e.g. "Start review". Its bold 20px label is large text.
  xl: 'h-14 px-6 text-xl rounded-xl gap-2.5 [--edge:5px]',
  icon: 'h-10 w-10 rounded-lg [--edge:3px]',
};

/**
 * Background of a primary button. The xl call to action has a large bold label, for
 * which 3:1 is enough, so it can use the brighter accent (in the classic theme the
 * bright green; other primary buttons there use a deeper green).
 */
function primaryFace(size: Size): string {
  return size === 'xl'
    ? 'kb-raised-hero bg-accent hover:bg-accent-strong'
    : 'bg-button hover:bg-button-strong';
}

/**
 * Button classes, exported so links (react-router `<Link>`, `<a>`) can look like
 * buttons without nesting a <button> inside an <a>.
 */
export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', className?: string) {
  return cn(
    'inline-flex items-center justify-center whitespace-nowrap transition-colors select-none',
    'disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    variant === 'primary' && primaryFace(size),
    sizes[size],
    size === 'xl' ? 'font-bold' : variant === 'primary' && 'font-semibold',
    className,
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
