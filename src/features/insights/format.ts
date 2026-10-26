/** Formatting helpers for the insights page. */

/** 62.49 → "62%"; null → "—". */
export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Signed whole number with a real minus sign: 12 → "+12", -7 → "−7", 0 → "±0". */
export function formatSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '±0';
  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;
}

/** Remaining time for a progress line: "less than a minute left", "about 4 min left". */
export function formatEta(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'less than a minute left';
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `about ${hours} h left` : `about ${hours} h ${rest} min left`;
}

/** "12 Oct 2026" style date. */
export function formatDay(epochMs: number | undefined): string {
  if (epochMs === undefined) return '';
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Axis label for a date, as precise as the span needs: the time of day within a couple of
 * days (strong players can fit a hundred games into one), the day within a year, else the month.
 */
export function formatAxisDate(epochMs: number, spanMs: number): string {
  const day = 86_400_000;
  const options: Intl.DateTimeFormatOptions =
    spanMs < 2 * day
      ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
      : spanMs < 300 * day
        ? { day: 'numeric', month: 'short' }
        : { month: 'short', year: 'numeric' };
  return new Date(epochMs).toLocaleString(undefined, options);
}

/** "1 game", "3 games". */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}
