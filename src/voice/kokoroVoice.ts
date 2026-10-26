import type { KokoroDevice, KokoroDtype, KokoroRequest, KokoroResponse } from './kokoro.worker';

/**
 * Main-thread side of the optional natural voice: owns the model worker, turns text into
 * audio sentence by sentence (generating the next sentence while the current one plays),
 * and plays it with the Web Audio API. Only offered where WebGPU is available: on the CPU
 * the model is far slower than real time (see kokoro.worker.ts).
 */

/** A curated set of the best-rated Kokoro English voices. */
export const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Heart (US, female)' },
  { id: 'af_bella', label: 'Bella (US, female)' },
  { id: 'am_michael', label: 'Michael (US, male)' },
  { id: 'am_fenrir', label: 'Fenrir (US, male)' },
  { id: 'bf_emma', label: 'Emma (UK, female)' },
  { id: 'bm_george', label: 'George (UK, male)' },
] as const;

export type KokoroVoiceId = (typeof KOKORO_VOICES)[number]['id'];

/** The setup that is fast enough: full-precision weights on the GPU. */
const BACKEND: { device: KokoroDevice; dtype: KokoroDtype } = { device: 'webgpu', dtype: 'fp32' };

/** One-time download of the fp32 model, shown before the user opts in. */
export const KOKORO_DOWNLOAD_MB = 326;

/**
 * A warm device should say a short sentence in about 2 s; above this the voice lags behind
 * the board, so the system voice is used instead.
 */
export const KOKORO_MAX_BENCHMARK_MS = 4000;

/** Cache API bucket used by Transformers.js for model files. */
const MODEL_CACHE = 'transformers-cache';

export interface KokoroLoadProgress {
  loaded: number;
  total: number;
}

export interface KokoroReady {
  /** Milliseconds to generate a short sentence once warm. */
  benchmarkMs: number;
}

let worker: Worker | null = null;
let ready: Promise<KokoroReady> | null = null;
let nextId = 1;
const pendingAudio = new Map<
  number,
  {
    resolve: (audio: { samples: Float32Array; sampleRate: number }) => void;
    reject: (e: Error) => void;
  }
>();
const progressListeners = new Set<(progress: KokoroLoadProgress) => void>();
let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
/** Incremented by stop(); a speak() call from an older generation gives up. */
let generation = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<KokoroResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        progressListeners.forEach((listener) => listener(message));
      } else if (message.type === 'audio') {
        pendingAudio.get(message.id)?.resolve(message);
        pendingAudio.delete(message.id);
      } else if (message.type === 'error' && message.id !== undefined) {
        pendingAudio.get(message.id)?.reject(new Error(message.message));
        pendingAudio.delete(message.id);
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'The voice model stopped working.');
      pendingAudio.forEach(({ reject }) => reject(error));
      pendingAudio.clear();
      worker?.terminate();
      worker = null;
      ready = null;
    };
  }
  return worker;
}

/** True when this browser has WebGPU, module workers and Web Audio. */
export function isKokoroSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'gpu' in navigator &&
    typeof Worker !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  );
}

/** True when WebGPU actually hands out a GPU (navigator.gpu can exist without one). */
export async function hasWebGpuAdapter(): Promise<boolean> {
  if (!isKokoroSupported()) return false;
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(await gpu?.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * Downloads (first time), initialises and warms up the model. Safe to call repeatedly;
 * resolves with how fast the device turned out to be.
 */
export function loadKokoro(
  onProgress?: (progress: KokoroLoadProgress) => void,
  backend = BACKEND,
): Promise<KokoroReady> {
  if (onProgress) progressListeners.add(onProgress);
  if (!ready) {
    const w = getWorker();
    ready = new Promise<KokoroReady>((resolve, reject) => {
      const onMessage = (event: MessageEvent<KokoroResponse>) => {
        if (event.data.type === 'ready') {
          w.removeEventListener('message', onMessage);
          resolve({ benchmarkMs: event.data.benchmarkMs });
        } else if (event.data.type === 'error' && event.data.id === undefined) {
          w.removeEventListener('message', onMessage);
          reject(new Error(event.data.message));
        }
      };
      w.addEventListener('message', onMessage);
      const runtimeUrl = new URL(`${import.meta.env.BASE_URL}voice/`, location.href).href;
      w.postMessage({ type: 'load', runtimeUrl, ...backend } satisfies KokoroRequest);
    });
    ready.catch(() => {
      ready = null;
    });
  }
  const done = ready;
  if (onProgress)
    void done.finally(() => progressListeners.delete(onProgress)).catch(() => undefined);
  return done;
}

function generate(text: string, voice: KokoroVoiceId, speed: number) {
  const id = nextId++;
  return new Promise<{ samples: Float32Array; sampleRate: number }>((resolve, reject) => {
    pendingAudio.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'generate', id, text, voice, speed } satisfies KokoroRequest);
  });
}

/** Splits text into sentences so speech starts quickly and long text never times out. */
export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function play(samples: Float32Array, sampleRate: number, myGeneration: number): Promise<void> {
  audioContext ??= new AudioContext();
  const context = audioContext;
  if (context.state === 'suspended') void context.resume();
  return new Promise((resolve) => {
    if (myGeneration !== generation) return resolve();
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (currentSource === source) currentSource = null;
      resolve();
    };
    currentSource = source;
    source.start();
  });
}

/**
 * Speaks text with the natural voice. Resolves when playback ends or stop() is
 * called. Loads the model first if needed.
 */
export async function speakKokoro(text: string, voice: KokoroVoiceId, speed = 1): Promise<void> {
  stopKokoro();
  const myGeneration = generation;
  await loadKokoro();
  const sentences = splitSentences(text);
  // Generate sentence i+1 while sentence i plays.
  let upcoming = sentences.length ? generate(sentences[0]!, voice, speed) : null;
  for (let i = 0; i < sentences.length && upcoming; i++) {
    const audio = await upcoming;
    if (myGeneration !== generation) return;
    upcoming = i + 1 < sentences.length ? generate(sentences[i + 1]!, voice, speed) : null;
    await play(audio.samples, audio.sampleRate, myGeneration);
    if (myGeneration !== generation) return;
  }
}

/** Stops playback immediately (sentences already queued in the worker are discarded). */
export function stopKokoro(): void {
  generation++;
  try {
    currentSource?.stop();
  } catch {
    // already stopped
  }
  currentSource = null;
}

/** Whether the model files are already in the browser cache (no download needed). */
export async function isKokoroDownloaded(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(MODEL_CACHE);
    const keys = await cache.keys();
    return keys.some(
      (request) => request.url.includes('Kokoro-82M') && request.url.includes('/onnx/model.onnx'),
    );
  } catch {
    return false;
  }
}

/** Deletes the downloaded model and shuts the worker down. */
export async function removeKokoroModel(): Promise<void> {
  stopKokoro();
  worker?.terminate();
  worker = null;
  ready = null;
  try {
    if (typeof caches !== 'undefined') await caches.delete(MODEL_CACHE);
  } catch {
    // nothing cached
  }
}
