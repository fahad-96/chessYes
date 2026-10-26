import type { TimeClass } from '@/core/types';

/** "180+2" → "3+2", "600" → "10 min", "1/86400" → "1 day", "45" → "45 sec". */
export function formatTimeControl(timeControl: string | undefined): string {
  if (!timeControl || timeControl === '-') return '';
  const daily = /^1\/(\d+)$/.exec(timeControl);
  if (daily) {
    const days = Math.round(Number(daily[1]) / 86400);
    return days === 1 ? '1 day' : `${days} days`;
  }
  const [baseRaw, incRaw] = timeControl.split('+');
  const base = Number(baseRaw);
  if (!Number.isFinite(base)) return timeControl;
  const inc = incRaw === undefined ? undefined : Number(incRaw);
  const baseLabel = base % 60 === 0 ? `${base / 60}` : base < 60 ? `${base}s` : `${(base / 60).toFixed(1)}`;
  if (inc === undefined || !Number.isFinite(inc)) {
    return base < 60 ? `${base} sec` : `${baseLabel} min`;
  }
  return `${baseLabel}+${inc}`;
}

const TIME_CLASS_LABELS: Record<TimeClass, string> = {
  ultrabullet: 'UltraBullet',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  daily: 'Daily',
  unknown: 'Game',
};

export function formatTimeClass(timeClass: TimeClass): string {
  return TIME_CLASS_LABELS[timeClass];
}

/** Clock in seconds → "2:59", "1:02:03", "9.8" (tenths under 10 seconds). */
export function formatClock(seconds: number): string {
  if (seconds < 10) return seconds.toFixed(1);
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Relative date for recent games ("3 hours ago", "yesterday"), otherwise "12 Oct 2026". */
export function formatGameDate(epochMs: number | undefined, now = Date.now()): string {
  if (!epochMs) return '';
  const diff = now - epochMs;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff >= 0 && diff < hour) return `${Math.max(1, Math.round(diff / minute))} min ago`;
  if (diff >= 0 && diff < day) {
    const hours = Math.round(diff / hour);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (diff >= 0 && diff < 2 * day) return 'yesterday';
  if (diff >= 0 && diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  return new Date(epochMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Formats an accuracy value: 87.43 → "87.4". */
export function formatAccuracy(accuracy: number): string {
  return accuracy.toFixed(1);
}
