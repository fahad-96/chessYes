/**
 * The pure half of the coach voice: which clips of the voice pack a line needs, when each one
 * starts, how much to prefetch, and a small LRU cache. No browser APIs, so it is unit-tested;
 * packPlayer.ts does the fetching, decoding and playing.
 */
import { CLIP_MARGIN_MS, type CoachScript, type CoachSegment } from './coachScript';

/** One clip of the pack: its file (hashed, never changes) and its exact length in ms. */
export interface PackClip {
  file: string;
  ms: number;
}

/** public/voice-pack/manifest.json, as rendered by the chess-yes-voice repository. */
export interface PackManifest {
  version: number;
  voice?: string;
  license?: string;
  attribution?: string;
  clips: Record<string, PackClip>;
}

/** True for a manifest the player can use (a 404 page or a broken file is not). */
export function isPackManifest(value: unknown): value is PackManifest {
  if (!value || typeof value !== 'object') return false;
  const { version, clips } = value as Partial<PackManifest>;
  if (typeof version !== 'number' || !clips || typeof clips !== 'object') return false;
  const first = Object.values(clips)[0] as Partial<PackClip> | undefined;
  return !first || (typeof first.file === 'string' && typeof first.ms === 'number');
}

export interface ScheduledClip {
  key: string;
  file: string;
  /** When the clip starts, from the start of the line. */
  offsetMs: number;
  ms: number;
}

export type LinePlan =
  | { kind: 'pack'; clips: ScheduledClip[]; durationMs: number }
  | {
      kind: 'device';
      /** no-pack: no manifest; missing: some clip is not in it; empty: no clips at all. */
      reason: 'no-pack' | 'missing' | 'empty';
      missing: string[];
    };

/**
 * Start of each segment's clip, in ms from the start of the line. Every clip keeps
 * CLIP_MARGIN_MS of near-silence at both ends, so the next clip starts at this clip's start +
 * its length - both margins + the pause the script asks for. A segment without a pause (the
 * last one, or one before an unknown clip) lets its margins play out in full. Lengths come
 * from the manifest, not from the decoded audio: some decoders add padding to MP3s.
 */
export function clipOffsets(
  segments: readonly CoachSegment[],
  lengths: readonly number[],
): number[] {
  const offsets: number[] = [];
  let at = 0;
  segments.forEach((segment, i) => {
    offsets.push(at);
    const pause = segment.pauseMsAfter ?? 2 * CLIP_MARGIN_MS;
    at += Math.max(0, (lengths[i] ?? 0) - 2 * CLIP_MARGIN_MS + pause);
  });
  return offsets;
}

/**
 * How to say a line: from the pack when every one of its clips is there, otherwise with the
 * device voice for the whole line (one line is never spoken in two voices).
 */
export function planLine(script: CoachScript, manifest: PackManifest | null): LinePlan {
  if (script.segments.length === 0) return { kind: 'device', reason: 'empty', missing: [] };
  if (!manifest) return { kind: 'device', reason: 'no-pack', missing: [] };
  const missing = [
    ...new Set(script.segments.map((s) => s.key).filter((key) => !manifest.clips[key])),
  ];
  if (missing.length) return { kind: 'device', reason: 'missing', missing };
  const clips = script.segments.map((s) => manifest.clips[s.key]!);
  const offsets = clipOffsets(
    script.segments,
    clips.map((clip) => clip.ms),
  );
  const scheduled = script.segments.map((segment, i) => ({
    key: segment.key,
    file: clips[i]!.file,
    offsetMs: offsets[i]!,
    ms: clips[i]!.ms,
  }));
  const last = scheduled.at(-1)!;
  return { kind: 'pack', clips: scheduled, durationMs: last.offsetMs + last.ms };
}

/** What the browser says about the connection (navigator.connection, Chromium only). */
export interface ConnectionHints {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * How many upcoming lines to prefetch: none with Data Saver or on a 2G-class connection
 * (each line is then fetched when it is spoken), one on 3G, otherwise all that were asked.
 */
export function prefetchDepth(connection: ConnectionHints | undefined, wanted: number): number {
  if (connection?.saveData) return 0;
  const type = connection?.effectiveType;
  if (type === 'slow-2g' || type === '2g') return 0;
  if (type === '3g') return Math.min(wanted, 1);
  return wanted;
}

/**
 * The clip files to prefetch for upcoming lines, in order and without repeats. Lines that
 * would fall back to the device voice are skipped: their clips would never be played.
 */
export function prefetchFiles(scripts: readonly CoachScript[], manifest: PackManifest): string[] {
  const files = new Set<string>();
  for (const script of scripts) {
    const plan = planLine(script, manifest);
    if (plan.kind === 'pack') for (const clip of plan.clips) files.add(clip.file);
  }
  return [...files];
}

/**
 * A least-recently-used cache bounded by a total cost (bytes), so decoded audio stays within a
 * phone's memory. The newest entry is always kept, even when it alone is over the budget.
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; cost: number }>();
  private total = 0;

  constructor(
    private readonly maxCost: number,
    private readonly costOf: (value: V) => number,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get cost(): number {
    return this.total;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.delete(key);
    const cost = Math.max(0, this.costOf(value));
    this.entries.set(key, { value, cost });
    this.total += cost;
    for (const [oldest, entry] of this.entries) {
      if (this.total <= this.maxCost || oldest === key) break;
      this.entries.delete(oldest);
      this.total -= entry.cost;
    }
  }

  delete(key: K): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.total -= entry.cost;
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }
}
