/// <reference lib="webworker" />
/**
 * Runs the Kokoro-82M text-to-speech model (Apache-2.0) off the main thread with
 * Transformers.js on WebGPU. The ONNX runtime is served from our own site (public/voice/,
 * copied by scripts/copy-engine.mjs); the model weights come from the Hugging Face Hub on
 * first use and are then cached by the browser.
 *
 * Measured on an Intel UHD (gen-12) laptop GPU after warm-up: fp32 takes about 2 s for a
 * short sentence (faster than real time), fp16 4-8 s and q8 / WebAssembly 20 s or more,
 * so fp32 on WebGPU is the only setup offered.
 */
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export type KokoroDevice = 'webgpu' | 'wasm';
export type KokoroDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

export type KokoroRequest =
  | { type: 'load'; runtimeUrl: string; device: KokoroDevice; dtype: KokoroDtype }
  | { type: 'generate'; id: number; text: string; voice: string; speed: number };

export type KokoroResponse =
  | { type: 'progress'; loaded: number; total: number }
  /** benchmarkMs: time to generate a short phrase once warm, to spot devices too slow for it. */
  | { type: 'ready'; benchmarkMs: number }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number }
  | { type: 'error'; id?: number; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let model: Promise<KokoroTTS> | null = null;

function post(message: KokoroResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

function load(runtimeUrl: string, device: KokoroDevice, dtype: KokoroDtype): Promise<KokoroTTS> {
  if (!model) {
    env.allowLocalModels = false;
    const wasm = env.backends.onnx.wasm;
    if (wasm) wasm.wasmPaths = runtimeUrl;
    // Per-file byte counts, summed so the UI can show one overall progress bar.
    const files = new Map<string, { loaded: number; total: number }>();
    model = KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype,
      device,
      progress_callback: (info) => {
        if (info.status !== 'progress' || !('file' in info)) return;
        files.set(info.file, { loaded: info.loaded, total: info.total });
        let loaded = 0;
        let total = 0;
        for (const file of files.values()) {
          loaded += file.loaded;
          total += file.total;
        }
        post({ type: 'progress', loaded, total });
      },
    });
    model.catch(() => {
      model = null; // let a later request retry (e.g. after a network error)
    });
  }
  return model;
}

scope.onmessage = async (event: MessageEvent<KokoroRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      const tts = await load(request.runtimeUrl, request.device, request.dtype);
      // The first generation compiles the GPU shaders (several seconds); the second shows
      // how fast this device really is.
      await tts.generate('Ready.', { voice: 'af_heart' });
      const start = performance.now();
      await tts.generate('Knight f3 is the best move.', { voice: 'af_heart' });
      post({ type: 'ready', benchmarkMs: Math.round(performance.now() - start) });
      return;
    }
    if (!model) throw new Error('The voice model is not loaded.');
    const tts = await model;
    const audio = await tts.generate(request.text, {
      voice: request.voice as never,
      speed: request.speed,
    });
    const samples = audio.audio;
    post({ type: 'audio', id: request.id, samples, sampleRate: audio.sampling_rate }, [
      samples.buffer,
    ]);
  } catch (error) {
    post({
      type: 'error',
      id: request.type === 'generate' ? request.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
