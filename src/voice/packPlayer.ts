/**
 * Plays the coach voice: lines of pre-rendered clips (public/voice-pack, installed at build
 * time by scripts/fetch-voice.mjs) stitched together with the Web Audio API.
 *
 * - The manifest is fetched once per page (a missing pack is not an error: the device voice
 *   speaks instead).
 * - One shared AudioContext. Browsers only let audio start after a user gesture, and iOS
 *   Safari only inside the gesture's own handler, so unlockAudio() runs synchronously in
 *   taps and key presses (armAudioUnlock) while narration is wanted. It also recovers a
 *   context that iOS "interrupted" (a call, another app) or that was suspended in the
 *   background, and asks iOS to play speech even when the silent switch is on.
 * - Decoded clips live in a small LRU cache sized for phones; the encoded bytes (about 7 kB
 *   a clip) in another. The service worker keeps the files across visits.
 * - A line plays only when every clip is available; otherwise playPackLine() answers
 *   'unavailable' and the caller says the whole line with the device voice.
 */
import type { CoachScript } from './coachScript';
import {
  LruCache,
  isPackManifest,
  planLine,
  prefetchDepth,
  prefetchFiles,
  type ConnectionHints,
  type LinePlan,
  type PackManifest,
} from './packPlan';

const PACK_URL = `${import.meta.env.BASE_URL}voice-pack/`;
/** Scheduling a line slightly ahead keeps its first clip from being clipped. */
const START_LEAD_S = 0.03;
/** A started context that does not run within this time is blocked (no gesture yet). */
const RESUME_TIMEOUT_MS = 700;
/** An idle context is suspended to save battery; the next line resumes it. */
const IDLE_SUSPEND_MS = 30_000;
/** Prefetch politely: a couple of requests at a time. */
const PREFETCH_CONCURRENCY = 2;

export type PackState = 'unknown' | 'checking' | 'ready' | 'missing';
export type PlayResult = 'played' | 'stopped' | 'unavailable';

// ---------------------------------------------------------------------------------------
// The manifest

let manifest: PackManifest | null = null;
let manifestPromise: Promise<PackManifest | null> | null = null;
let packState: PackState = 'unknown';

/** The pack's manifest, or null when this site has no voice pack (or it cannot be read). */
export function loadPackManifest(): Promise<PackManifest | null> {
  manifestPromise ??= (async () => {
    packState = 'checking';
    try {
      const response = await fetch(`${PACK_URL}manifest.json`);
      // A 404 (no pack in this build), or a dev server answering with its index page.
      const json: unknown = response.ok ? await response.json().catch(() => null) : null;
      manifest = isPackManifest(json) ? json : null;
      packState = manifest ? 'ready' : 'missing';
      return manifest;
    } catch {
      // Offline before the manifest was ever cached: try again on the next line.
      packState = 'unknown';
      manifestPromise = null;
      return null;
    }
  })();
  return manifestPromise;
}

export function getPackState(): PackState {
  return packState;
}

// ---------------------------------------------------------------------------------------
// The audio context

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

function audioContextClass(): AudioContextConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  if (typeof AudioContext !== 'undefined') return AudioContext;
  return (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}

export function hasWebAudio(): boolean {
  return !!audioContextClass();
}

let ctx: AudioContext | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function context(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctor = audioContextClass();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * iOS 16.4+: play as "playback" audio, so the coach is heard with the silent switch on (Web
 * Audio is otherwise "ambient" there and muted by the switch, unlike the device voice).
 */
function preferPlaybackSession(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession && nav.audioSession.type !== 'playback') {
      nav.audioSession.type = 'playback';
    }
  } catch {
    // not supported
  }
}

/**
 * Creates or wakes the audio context. Call it synchronously inside a user gesture (a tap, a
 * key press): that is when browsers, and iOS Safari above all, allow audio to start. Also
 * starts a one-sample silent buffer, which older iOS versions need to unlock audio.
 */
export function unlockAudio(): void {
  // No pack on this site: the device voice speaks, so leave Web Audio (and, on iOS, the
  // audio session, which would pause the user's music) alone.
  if (packState === 'missing') return;
  // Before the context starts, so iOS opens the audio session with this category.
  preferPlaybackSession();
  const audio = context();
  if (!audio || audio.state === 'running') return;
  void resumeContext(audio);
  try {
    const source = audio.createBufferSource();
    source.buffer = audio.createBuffer(1, 1, audio.sampleRate);
    source.connect(audio.destination);
    source.start(0);
  } catch {
    // nothing to unlock
  }
  // A tap that wakes the audio without a line to say must not leave it running for good.
  scheduleIdleSuspend();
}

/** resume() that never throws or rejects (very old WebKit contexts may lack it). */
function resumeContext(audio: AudioContext): Promise<void> {
  try {
    return audio.resume().catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;
let armed = false;

function onGesture(event: Event): void {
  // A finger's pointerdown does not count as a gesture yet (its pointerup and touchend do):
  // starting audio there would only be refused.
  if (event.type === 'pointerdown' && (event as PointerEvent).pointerType !== 'mouse') return;
  if (!ctx || ctx.state !== 'running') unlockAudio();
}

/**
 * While narration is on, every tap and key press makes sure the audio context runs before the
 * app reacts to it (the move it narrates). Cheap: the listeners only act when it is not running.
 */
export function armAudioUnlock(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  for (const type of GESTURES) {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  }
}

export function disarmAudioUnlock(): void {
  if (!armed) return;
  armed = false;
  for (const type of GESTURES) window.removeEventListener(type, onGesture, { capture: true });
}

/** Resumes the context if needed; false when the browser keeps it from running. */
async function ensureRunning(audio: AudioContext): Promise<boolean> {
  if (audio.state === 'running') return true;
  // 'interrupted' (iOS) and 'suspended' both resume this way when the browser allows it.
  await Promise.race([
    resumeContext(audio),
    new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS)),
  ]);
  // The await above may have changed it.
  return (audio.state as AudioContextState) === 'running';
}

function scheduleIdleSuspend(): void {
  clearTimeout(idleTimer);
  if (!ctx) return;
  idleTimer = setTimeout(() => {
    if (!playing && ctx?.state === 'running') void ctx.suspend().catch(() => undefined);
  }, IDLE_SUSPEND_MS);
}

// ---------------------------------------------------------------------------------------
// Clips

/** Decoded audio budget: about a minute of speech on phones with little memory. */
function decodedBudgetBytes(): number {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory <= 2) return 6 * 1024 * 1024;
  if (memory !== undefined && memory >= 8) return 32 * 1024 * 1024;
  return 12 * 1024 * 1024;
}

let decoded: LruCache<string, AudioBuffer> | null = null;
const encoded = new LruCache<string, ArrayBuffer>(3 * 1024 * 1024, (bytes) => bytes.byteLength);
const fetching = new Map<string, Promise<ArrayBuffer>>();
const decoding = new Map<string, Promise<AudioBuffer>>();

function decodedCache(): LruCache<string, AudioBuffer> {
  decoded ??= new LruCache(decodedBudgetBytes(), (b) => b.length * b.numberOfChannels * 4);
  return decoded;
}

function fetchClip(file: string, priority: RequestPriority): Promise<ArrayBuffer> {
  const cached = encoded.get(file);
  if (cached) return Promise.resolve(cached);
  let pending = fetching.get(file);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(`${PACK_URL}${file}`, { priority });
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      encoded.set(file, bytes);
      return bytes;
    })().finally(() => fetching.delete(file));
    fetching.set(file, pending);
  }
  return pending;
}

/** decodeAudioData with callbacks: older Safari has no promise form. */
function decode(audio: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // decodeAudioData detaches what it is given; keep the cached bytes intact.
    const result = audio.decodeAudioData(bytes.slice(0), resolve, reject) as unknown;
    if (result instanceof Promise) result.catch(() => undefined);
  });
}

function decodeClip(audio: AudioContext, file: string): Promise<AudioBuffer> {
  const cache = decodedCache();
  const hit = cache.get(file);
  if (hit) return Promise.resolve(hit);
  let pending = decoding.get(file);
  if (!pending) {
    pending = (async () => {
      const buffer = await decode(audio, await fetchClip(file, 'high'));
      cache.set(file, buffer);
      return buffer;
    })().finally(() => decoding.delete(file));
    decoding.set(file, pending);
  }
  return pending;
}

// ---------------------------------------------------------------------------------------
// Playing

interface Playing {
  sources: AudioBufferSourceNode[];
  output: GainNode;
  timer: ReturnType<typeof setTimeout>;
  finish: (result: PlayResult) => void;
}

let playing: Playing | null = null;
let generation = 0;

const stats = { played: 0, fallbacks: 0, stopped: 0, prefetched: 0 };
let lastLine: {
  keys: string[];
  plan: LinePlan['kind'];
  reason?: string;
  missing?: string[];
  offsetsMs?: number[];
  durationMs?: number;
  startedAt?: number;
  result?: PlayResult | 'blocked' | 'load-failed';
} | null = null;

/**
 * Says a coach line from the pack. Resolves 'played' when it has finished, 'stopped' when
 * stopPack() or another line cut it short, and 'unavailable' when it cannot be played from
 * the pack (no pack, a clip missing or failing to load, audio blocked): the caller then says
 * the whole line with the device voice.
 */
export async function playPackLine(script: CoachScript): Promise<PlayResult> {
  stopPack();
  const mine = ++generation;
  // Loading a line can take a while on a slow network: keep the audio awake meanwhile.
  clearTimeout(idleTimer);
  const unavailable = (): PlayResult => {
    stats.fallbacks++;
    scheduleIdleSuspend();
    return 'unavailable';
  };
  const found = await loadPackManifest();
  if (mine !== generation) return 'stopped';
  const plan = planLine(script, found);
  lastLine = { keys: script.segments.map((s) => s.key), plan: plan.kind };
  if (plan.kind === 'device') {
    Object.assign(lastLine, { reason: plan.reason, missing: plan.missing, result: 'unavailable' });
    return unavailable();
  }
  const audio = context();
  if (!audio || !(await ensureRunning(audio))) {
    if (mine !== generation) return 'stopped';
    lastLine.result = 'blocked';
    return unavailable();
  }
  if (mine !== generation) return 'stopped';
  let buffers: AudioBuffer[];
  try {
    buffers = await Promise.all(plan.clips.map((clip) => decodeClip(audio, clip.file)));
  } catch (error) {
    if (mine !== generation) return 'stopped';
    console.warn('Coach voice: a clip could not be loaded', error);
    lastLine.result = 'load-failed';
    return unavailable();
  }
  if (mine !== generation) return 'stopped';

  const output = audio.createGain();
  output.connect(audio.destination);
  const start = audio.currentTime + START_LEAD_S;
  const sources = plan.clips.map((clip, i) => {
    const source = audio.createBufferSource();
    source.buffer = buffers[i]!;
    source.connect(output);
    source.start(start + clip.offsetMs / 1000);
    return source;
  });
  Object.assign(lastLine, {
    offsetsMs: plan.clips.map((clip) => clip.offsetMs),
    durationMs: plan.durationMs,
    startedAt: start,
  });

  return new Promise<PlayResult>((resolve) => {
    const finish = (result: PlayResult) => {
      if (playing?.finish !== finish) return;
      clearTimeout(current.timer);
      for (const source of current.sources) {
        source.onended = null;
        if (result === 'stopped') {
          try {
            source.stop();
          } catch {
            // not started yet or already ended
          }
        }
        source.disconnect();
      }
      current.output.disconnect();
      playing = null;
      if (lastLine) lastLine.result = result;
      stats[result === 'played' ? 'played' : 'stopped']++;
      scheduleIdleSuspend();
      resolve(result);
    };
    // The line ends with its last clip; the timer covers a context that stopped running
    // (backgrounded on iOS) and would never fire `ended`.
    const current: Playing = {
      sources,
      output,
      finish,
      timer: setTimeout(() => finish('played'), plan.durationMs + 1500),
    };
    sources.at(-1)!.onended = () => finish('played');
    playing = current;
  });
}

/** Stops the line being played, at once. */
export function stopPack(): void {
  generation++;
  playing?.finish('stopped');
  // Also when a line was still loading: the audio goes back to sleep if nothing follows.
  scheduleIdleSuspend();
}

// ---------------------------------------------------------------------------------------
// Prefetching

let prefetchQueue: string[] = [];
let prefetchRunning = 0;

function connectionHints(): ConnectionHints | undefined {
  return (navigator as Navigator & { connection?: ConnectionHints }).connection;
}

/**
 * Fetches the clips of upcoming lines (the next moves) in the background, at low priority,
 * so they play at once. Fewer lines with Data Saver or on a slow connection. A new call
 * replaces the lines still waiting from the previous one.
 */
export function prefetchLines(scripts: readonly CoachScript[]): void {
  const depth = prefetchDepth(connectionHints(), scripts.length);
  if (depth === 0) {
    prefetchQueue = [];
    return;
  }
  void loadPackManifest().then((found) => {
    if (!found) return;
    prefetchQueue = prefetchFiles(scripts.slice(0, depth), found).filter(
      (file) => !encoded.has(file) && !decodedCache().has(file) && !fetching.has(file),
    );
    pumpPrefetch();
  });
}

function pumpPrefetch(): void {
  while (prefetchRunning < PREFETCH_CONCURRENCY && prefetchQueue.length) {
    const file = prefetchQueue.shift()!;
    prefetchRunning++;
    fetchClip(file, 'low')
      .then(() => stats.prefetched++)
      .catch(() => undefined)
      .finally(() => {
        prefetchRunning--;
        pumpPrefetch();
      });
  }
}

// ---------------------------------------------------------------------------------------
// Debugging

/** A snapshot for debugging (also on window.__chessYesVoice in the browser console). */
export function packDebugState() {
  return {
    pack: packState,
    clipsInPack: manifest ? Object.keys(manifest.clips).length : 0,
    context: ctx?.state ?? 'none',
    sampleRate: ctx?.sampleRate ?? null,
    currentTime: ctx?.currentTime ?? null,
    armed,
    playing: !!playing,
    decodedClips: decoded?.size ?? 0,
    decodedBytes: decoded?.cost ?? 0,
    encodedClips: encoded.size,
    queuedPrefetch: prefetchQueue.length,
    ...stats,
    lastLine,
  };
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__chessYesVoice', {
    value: { state: packDebugState },
    configurable: true,
  });
}
