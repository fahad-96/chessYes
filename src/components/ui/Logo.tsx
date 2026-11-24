import { useId } from 'react';
import { cn } from '@/lib/cn';

/** The board squares darkened in the mark: a 4 × 4 corner of a chessboard. */
const DARK_SQUARES =
  'M16 0h16v16H16zM48 0h16v16H48zM0 16h16v16H0zM32 16h16v16H32zM16 32h16v16H16zM48 32h16v16H48zM0 48h16v16H0zM32 48h16v16H32z';

/**
 * The Chess Yes mark: a corner of a chessboard with a check mark on it. "Check" is both the
 * chess word and a yes. The tile is glass-like (a soft top sheen and a light rim) to match
 * the glass header. Brand colours are fixed, so the mark looks the same in every theme.
 * Same drawing as public/favicon.svg; the app icons in public/icons are rendered from it.
 */
export function LogoMark({ className, size = 28 }: { className?: string; size?: number }) {
  // Ids must be unique per instance: the mark can appear more than once on a page.
  const id = useId().replace(/:/g, '');
  const ref = (name: string) => `${id}-${name}`;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient
          id={ref('bg')}
          x1="10"
          y1="0"
          x2="54"
          y2="64"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#8fd14f" />
          <stop offset="1" stopColor="#357317" />
        </linearGradient>
        <linearGradient
          id={ref('sheen')}
          x1="0"
          y1="0"
          x2="0"
          y2="64"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fff" stopOpacity=".26" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id={ref('rim')}
          x1="0"
          y1="0"
          x2="64"
          y2="64"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fff" stopOpacity=".6" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".08" />
          <stop offset="1" stopColor="#fff" stopOpacity=".22" />
        </linearGradient>
        <filter id={ref('shadow')} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="2.2" stdDeviation="1.8" floodColor="#0d3004" floodOpacity=".5" />
        </filter>
        <clipPath id={ref('clip')}>
          <rect width="64" height="64" rx="16" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${ref('clip')})`}>
        <rect width="64" height="64" fill={`url(#${ref('bg')})`} />
        <path fill="#0b2a05" fillOpacity=".15" d={DARK_SQUARES} />
        <rect width="64" height="64" fill={`url(#${ref('sheen')})`} />
      </g>
      <rect
        x=".75"
        y=".75"
        width="62.5"
        height="62.5"
        rx="15.25"
        fill="none"
        stroke={`url(#${ref('rim')})`}
        strokeWidth="1.5"
      />
      <path
        d="M17 33.5 27 43.5 47 22.5"
        fill="none"
        stroke="#fff"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${ref('shadow')})`}
      />
    </svg>
  );
}

/** Mark plus the "Chess Yes" wordmark, with "Yes" in the brand green. */
export function Logo({ className, size = 30 }: { className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span className="text-lg leading-none font-extrabold tracking-tight text-text">
        Chess <span className="text-brand">Yes</span>
      </span>
    </span>
  );
}
