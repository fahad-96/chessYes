import knightUrl from '@/assets/brand/knight.png';
import { cn } from '@/lib/cn';

/**
 * The Chess Yes mark: a green knight, cropped to its head, on a rounded tile with a light
 * glass rim. The image is 192px, sharp up to 64px on high-density screens.
 */
export function LogoMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <img
      src={knightUrl}
      alt=""
      width={size}
      height={size}
      decoding="async"
      draggable={false}
      className={cn(
        'shrink-0 rounded-[28%] object-cover shadow-[0_2px_10px_-2px_rgb(0_0_0/0.55)] ring-1 ring-white/20',
        className,
      )}
    />
  );
}

/** Mark plus the "Chess Yes" wordmark, set in the display serif with "Yes" in the brand green. */
export function Logo({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span className="font-display text-[1.65rem] leading-none tracking-tight text-text">
        Chess <em className="text-brand">Yes</em>
      </span>
    </span>
  );
}
