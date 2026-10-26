/**
 * Small helpers shared by the data sources: validating untrusted JSON and
 * estimating time classes.
 */
import type { GameResult, TimeClass } from '@/core/types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value if it is a non-empty string. */
export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The value if it is a finite number. */
export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const RESULTS: readonly string[] = ['1-0', '0-1', '1/2-1/2', '*'];

export function isGameResult(value: unknown): value is GameResult {
  return typeof value === 'string' && RESULTS.includes(value);
}

/**
 * Lichess's speed estimate: base seconds + 40 × increment
 * (< 30 s ultrabullet, < 3 min bullet, < 8 min blitz, < 25 min rapid, else classical).
 */
export function estimateTimeClass(baseSeconds: number, incrementSeconds = 0): TimeClass {
  const total = baseSeconds + 40 * incrementSeconds;
  if (total < 30) return 'ultrabullet';
  if (total < 180) return 'bullet';
  if (total < 480) return 'blitz';
  if (total < 1500) return 'rapid';
  return 'classical';
}

/**
 * Time class from a PGN TimeControl tag: "180+2", "600", "1/86400" (daily, one move
 * per N seconds), "40/7200:3600" (the first period decides) or "*180" (sandclock).
 */
export function timeClassFromTimeControl(timeControl: string | undefined): TimeClass {
  if (!timeControl) return 'unknown';
  if (/^1\/\d+$/.test(timeControl)) return 'daily';
  const firstPeriod = timeControl.split(':')[0] ?? '';
  const match = /^\*?(?:\d+\/)?(\d+(?:\.\d+)?)(?:\+(\d+(?:\.\d+)?))?$/.exec(firstPeriod);
  if (!match) return 'unknown';
  return estimateTimeClass(Number(match[1]), Number(match[2] ?? 0));
}
