import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from '@/lib/safeStorage';
import type { CoachScript } from './coachScript';
import {
  armAudioUnlock,
  disarmAudioUnlock,
  getPackState,
  hasWebAudio,
  loadPackManifest,
  playPackLine,
  prefetchLines,
  stopPack,
  unlockAudio,
  type PackState,
} from './packPlayer';
import { isSystemVoiceSupported, speakSystem, stopSystem } from './systemVoice';

/**
 * The voice coach. Two free voices:
 * - 'coach' (the default): the Bella voice pack, lines of pre-rendered clips served by this
 *   site (packPlayer.ts). Natural, instant and offline once heard, with no speech model on
 *   the device. A line it cannot say in full (a clip missing, no pack in this build, audio
 *   blocked) is said by the device voice instead, the whole line, never half and half;
 * - 'system': the device's built-in speech (Web Speech API), which can read any text.
 * speak() takes a coach line (CoachScript) or plain text; plain text is outside the pack's
 * vocabulary, so the device voice reads it. Only one thing is spoken at a time.
 */

export type VoiceEngineId = 'coach' | 'system';

/** A coach line, or plain text (always read by the device voice). */
export type Speech = CoachScript | string;

export interface PersistedVoiceSettings {
  /** Read each move aloud while stepping through a review. */
  narrate: boolean;
  engine: VoiceEngineId;
  /** voiceURI of the chosen device voice; null = best available English voice. */
  systemVoice: string | null;
  /** Speaking speed of the device voice, 0.7-1.4 (the coach voice has one speed). */
  rate: number;
}

export interface VoiceSettings extends PersistedVoiceSettings {
  set: (patch: Partial<PersistedVoiceSettings>) => void;
}

export const MIN_RATE = 0.7;
export const MAX_RATE = 1.4;
export const VOICE_SETTINGS_VERSION = 3;

export const DEFAULT_VOICE_SETTINGS: PersistedVoiceSettings = {
  narrate: false,
  engine: 'coach',
  systemVoice: null,
  rate: 1,
};

/**
 * Settings saved by any version, made valid for this one. Before version 3 the choice was
 * between the device voice (then the default) and an on-device Kokoro model, both replaced by
 * the coach voice pack, so every earlier choice becomes 'coach'.
 */
export function migrateVoiceSettings(persisted: unknown, version: number): PersistedVoiceSettings {
  const saved = (persisted && typeof persisted === 'object' ? persisted : {}) as Record<
    string,
    unknown
  >;
  const rate = typeof saved.rate === 'number' && Number.isFinite(saved.rate) ? saved.rate : 1;
  return {
    narrate: typeof saved.narrate === 'boolean' ? saved.narrate : DEFAULT_VOICE_SETTINGS.narrate,
    engine: version >= VOICE_SETTINGS_VERSION && saved.engine === 'system' ? 'system' : 'coach',
    systemVoice: typeof saved.systemVoice === 'string' ? saved.systemVoice : null,
    rate: Math.min(MAX_RATE, Math.max(MIN_RATE, rate)),
  };
}

/** The Kokoro model that earlier versions could download (326 MB) is no longer used. */
function removeOldVoiceModel(): void {
  try {
    if (typeof caches !== 'undefined') void caches.delete('transformers-cache').catch(() => false);
  } catch {
    // no Cache Storage here
  }
}

export const useVoiceSettings = create<VoiceSettings>()(
  persist(
    (set) => ({
      ...DEFAULT_VOICE_SETTINGS,
      set: (patch) => set(patch),
    }),
    {
      name: 'kibitz-voice',
      version: VOICE_SETTINGS_VERSION,
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ narrate, engine, systemVoice, rate }) => ({
        narrate,
        engine,
        systemVoice,
        rate,
      }),
      migrate: (persisted, version) => {
        if (version < VOICE_SETTINGS_VERSION) removeOldVoiceModel();
        return migrateVoiceSettings(persisted, version) as unknown as VoiceSettings;
      },
      merge: (persisted, current) => ({
        ...current,
        ...migrateVoiceSettings(persisted, VOICE_SETTINGS_VERSION),
      }),
    },
  ),
);

export interface VoiceStatus {
  speaking: boolean;
  /** The coach voice pack: being checked, ready, or missing (the device voice speaks). */
  pack: PackState;
  /** Which voice said the last line. */
  lastVoice: 'coach' | 'device' | null;
}

export const useVoiceStatus = create<VoiceStatus>()(() => ({
  speaking: false,
  pack: 'unknown',
  lastVoice: null,
}));

let token = 0;

/** True when the browser can speak with at least one of the voices. */
export function isVoiceSupported(): boolean {
  return isSystemVoiceSupported() || hasWebAudio();
}

/** Looks for the voice pack (once per page) and reports it in useVoiceStatus. */
export async function checkCoachVoice(): Promise<boolean> {
  if (!hasWebAudio()) {
    useVoiceStatus.setState({ pack: 'missing' });
    return false;
  }
  if (useVoiceStatus.getState().pack === 'unknown') useVoiceStatus.setState({ pack: 'checking' });
  const found = await loadPackManifest();
  useVoiceStatus.setState({ pack: getPackState() });
  return !!found;
}

/**
 * Narration is on: from now on every tap or key press keeps the coach voice's audio unlocked
 * before the app reacts to it, which phones require. Safe to call outside a gesture.
 */
export function armVoice(): void {
  if (useVoiceSettings.getState().engine !== 'coach' || !hasWebAudio()) return;
  armAudioUnlock();
  void checkCoachVoice();
}

/** Like armVoice, from inside a tap or key press: also unlocks the audio right away. */
export function prepareVoice(): void {
  if (useVoiceSettings.getState().engine !== 'coach' || !hasWebAudio()) return;
  unlockAudio();
  armVoice();
}

/** Narration is off: taps no longer touch the audio. */
export function releaseVoice(): void {
  disarmAudioUnlock();
}

/** Fetches the clips of lines that will probably be said next (the coach voice only). */
export function prefetchSpeech(scripts: readonly CoachScript[]): void {
  if (useVoiceSettings.getState().engine !== 'coach' || !hasWebAudio()) return;
  prefetchLines(scripts);
}

/**
 * Says a coach line or plain text; resolves when done or interrupted. Call it synchronously
 * from a tap when there is one: that is when phones allow audio to start.
 */
export async function speak(speech: Speech): Promise<void> {
  const { engine, systemVoice, rate } = useVoiceSettings.getState();
  stopSpeaking();
  const myToken = ++token;
  const script = typeof speech === 'string' ? null : speech;
  const text = (typeof speech === 'string' ? speech : speech.text).trim();
  const useCoach = !!script && script.segments.length > 0 && engine === 'coach' && hasWebAudio();
  if (!text && !useCoach) return;
  // Before any await: inside a tap, this is what lets the audio start on phones.
  if (useCoach) unlockAudio();
  useVoiceStatus.setState({ speaking: true });
  try {
    if (useCoach) {
      const result = await playPackLine(script);
      if (myToken !== token || result === 'stopped') return;
      useVoiceStatus.setState({ pack: getPackState() });
      if (result === 'played') {
        useVoiceStatus.setState({ lastVoice: 'coach' });
        return;
      }
    }
    if (!text || !isSystemVoiceSupported()) return;
    useVoiceStatus.setState({ lastVoice: 'device' });
    await speakSystem(text, { voiceURI: systemVoice, rate });
  } finally {
    if (myToken === token) useVoiceStatus.setState({ speaking: false });
  }
}

/** Stops any speech immediately. */
export function stopSpeaking(): void {
  token++;
  stopSystem();
  stopPack();
  useVoiceStatus.setState({ speaking: false });
}
