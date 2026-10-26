import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from '@/lib/safeStorage';
import type { KokoroLoadProgress, KokoroVoiceId } from './kokoroVoice';
import { isSystemVoiceSupported, speakSystem, stopSystem } from './systemVoice';

/**
 * The voice coach. Two free engines, both running on the user's device:
 * - 'system': the browser's built-in speech (instant, no download) — the default;
 * - 'kokoro': the open Kokoro-82M neural voice, opt-in, on WebGPU only (a one-time
 *   download, then cached). Until it is ready in this session the system voice speaks.
 * Only one thing is spoken at a time: speak() interrupts whatever is playing.
 */

export type VoiceEngineId = 'system' | 'kokoro';

export interface VoiceSettings {
  /** Read each move aloud while stepping through a review. */
  narrate: boolean;
  engine: VoiceEngineId;
  /** voiceURI of the chosen system voice; null = best available English voice. */
  systemVoice: string | null;
  kokoroVoice: KokoroVoiceId;
  /** Speaking speed, 0.7-1.4. */
  rate: number;
  set: (patch: Partial<Omit<VoiceSettings, 'set'>>) => void;
}

export const MIN_RATE = 0.7;
export const MAX_RATE = 1.4;

export const useVoiceSettings = create<VoiceSettings>()(
  persist(
    (set) => ({
      narrate: false,
      engine: 'system',
      systemVoice: null,
      kokoroVoice: 'af_heart',
      rate: 1,
      set: (patch) => set(patch),
    }),
    {
      name: 'kibitz-voice',
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      // Version 1 used a slower model setup; its download cannot be reused.
      migrate: (persisted) => ({ ...(persisted as VoiceSettings), engine: 'system' }),
    },
  ),
);

export interface VoiceStatus {
  speaking: boolean;
  /** The natural voice is downloading or warming up. */
  loading: boolean;
  progress: KokoroLoadProgress | null;
  /** The natural voice is loaded in this session and speaks right away. */
  naturalReady: boolean;
  /** Last problem, shown in the UI (e.g. the model could not be downloaded). */
  error: string | null;
}

export const useVoiceStatus = create<VoiceStatus>()(() => ({
  speaking: false,
  loading: false,
  progress: null,
  naturalReady: false,
  error: null,
}));

let token = 0;

/** True when the browser can speak (the natural voice is an extra on top of this). */
export function isVoiceSupported(): boolean {
  return isSystemVoiceSupported();
}

let preparing: Promise<boolean> | null = null;

/**
 * Downloads (first time), starts and warms up the natural voice, with progress in
 * useVoiceStatus. On a device too slow for it the system voice stays in charge.
 */
export function prepareNaturalVoice(): Promise<boolean> {
  preparing ??= (async () => {
    const kokoro = await import('./kokoroVoice');
    if (!(await kokoro.hasWebGpuAdapter())) {
      useVoiceStatus.setState({ error: 'This browser cannot run the natural voice.' });
      return false;
    }
    useVoiceStatus.setState({ loading: true, error: null, progress: null });
    try {
      const { benchmarkMs } = await kokoro.loadKokoro((progress) =>
        useVoiceStatus.setState({ progress }),
      );
      if (benchmarkMs > kokoro.KOKORO_MAX_BENCHMARK_MS) {
        useVoiceSettings.getState().set({ engine: 'system' });
        useVoiceStatus.setState({
          loading: false,
          progress: null,
          error: `The natural voice is too slow on this device (${(benchmarkMs / 1000).toFixed(1)} s for a short sentence), so the system voice is used. You can remove the download below.`,
        });
        return false;
      }
      useVoiceStatus.setState({ loading: false, progress: null, naturalReady: true });
      return true;
    } catch (error) {
      useVoiceStatus.setState({
        loading: false,
        progress: null,
        error: `The natural voice could not be loaded (${error instanceof Error ? error.message : 'network error'}). The system voice is used instead.`,
      });
      return false;
    }
  })().finally(() => {
    preparing = null;
  });
  return preparing;
}

/** Deletes the natural voice download and goes back to the system voice. */
export async function removeNaturalVoice(): Promise<void> {
  const kokoro = await import('./kokoroVoice');
  await kokoro.removeKokoroModel();
  useVoiceSettings.getState().set({ engine: 'system' });
  useVoiceStatus.setState({ naturalReady: false, error: null, progress: null });
}

/** Starts the natural voice in the background when it was downloaded in an earlier visit. */
async function warmNaturalVoice(): Promise<void> {
  const status = useVoiceStatus.getState();
  if (status.loading || status.naturalReady || status.error) return;
  const kokoro = await import('./kokoroVoice');
  if (await kokoro.isKokoroDownloaded()) void prepareNaturalVoice();
}

/** Speaks text with the chosen engine; resolves when done or interrupted. */
export async function speak(text: string): Promise<void> {
  const { engine, systemVoice, kokoroVoice, rate } = useVoiceSettings.getState();
  stopSpeaking();
  const myToken = ++token;
  if (!text.trim()) return;
  useVoiceStatus.setState({ speaking: true });
  try {
    if (engine === 'kokoro') {
      if (useVoiceStatus.getState().naturalReady) {
        const kokoro = await import('./kokoroVoice');
        if (myToken !== token) return;
        try {
          await kokoro.speakKokoro(text, kokoroVoice, rate);
          return;
        } catch (error) {
          console.error('Natural voice failed', error);
          useVoiceStatus.setState({ naturalReady: false });
        }
      } else {
        // Not loaded yet in this session: speak now with the system voice meanwhile.
        void warmNaturalVoice();
      }
    }
    if (myToken !== token) return;
    await speakSystem(text, { voiceURI: systemVoice, rate });
  } finally {
    if (myToken === token) useVoiceStatus.setState({ speaking: false });
  }
}

/** Stops any speech immediately. */
export function stopSpeaking(): void {
  token++;
  stopSystem();
  // Only touch the natural voice when it was loaded.
  if (useVoiceStatus.getState().naturalReady) {
    void import('./kokoroVoice').then((kokoro) => kokoro.stopKokoro());
  }
  useVoiceStatus.setState({ speaking: false });
}
