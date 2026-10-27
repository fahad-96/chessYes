import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachScript } from './coachScript';

const mocks = vi.hoisted(() => ({
  pack: 'unavailable' as 'played' | 'stopped' | 'unavailable',
  played: [] as CoachScript[],
  said: [] as string[],
}));

vi.mock('./packPlayer', () => ({
  armAudioUnlock: vi.fn(),
  disarmAudioUnlock: vi.fn(),
  getPackState: () => 'ready',
  hasWebAudio: () => true,
  loadPackManifest: () => Promise.resolve(null),
  playPackLine: (script: CoachScript) => {
    mocks.played.push(script);
    return Promise.resolve(mocks.pack);
  },
  prefetchLines: vi.fn(),
  stopPack: vi.fn(),
  unlockAudio: vi.fn(),
}));

vi.mock('./systemVoice', () => ({
  isSystemVoiceSupported: () => true,
  speakSystem: (text: string) => {
    mocks.said.push(text);
    return Promise.resolve();
  },
  stopSystem: vi.fn(),
}));

const { migrateVoiceSettings, speak, useVoiceSettings, useVoiceStatus } = await import('./voice');

const line: CoachScript = {
  segments: [{ key: 'move:Rg8', pauseMsAfter: 380 }, { key: 'phrase:verdict_blunder_1' }],
  text: "Rook to g8. That's a blunder.",
};

beforeEach(() => {
  Object.assign(mocks, { pack: 'unavailable', played: [], said: [] });
  useVoiceSettings.getState().set({ engine: 'coach' });
});

describe('migrateVoiceSettings', () => {
  it('moves every earlier voice choice to the coach voice', () => {
    expect(
      migrateVoiceSettings(
        { narrate: true, engine: 'kokoro', kokoroVoice: 'af_heart', systemVoice: 'x', rate: 1.2 },
        2,
      ),
    ).toEqual({ narrate: true, engine: 'coach', systemVoice: 'x', rate: 1.2 });
    // The device voice was the default before version 3, not a choice.
    expect(migrateVoiceSettings({ engine: 'system', rate: 1 }, 2).engine).toBe('coach');
    expect(migrateVoiceSettings({ narrate: true, engine: 'system' }, 1).engine).toBe('coach');
  });

  it('keeps a device voice chosen since, and repairs anything invalid', () => {
    expect(migrateVoiceSettings({ engine: 'system' }, 3).engine).toBe('system');
    expect(migrateVoiceSettings({ engine: 'kokoro' }, 3).engine).toBe('coach');
    expect(migrateVoiceSettings({ rate: 9, narrate: 'yes', systemVoice: 4 }, 3)).toEqual({
      narrate: false,
      engine: 'coach',
      systemVoice: null,
      rate: 1.4,
    });
    expect(migrateVoiceSettings(undefined, 0)).toEqual({
      narrate: false,
      engine: 'coach',
      systemVoice: null,
      rate: 1,
    });
  });
});

describe('speak', () => {
  it('plays a coach line from the pack when it can', async () => {
    mocks.pack = 'played';
    await speak(line);
    expect(mocks.played).toEqual([line]);
    expect(mocks.said).toEqual([]);
    expect(useVoiceStatus.getState()).toMatchObject({ speaking: false, lastVoice: 'coach' });
  });

  it('says the whole line with the device voice when the pack cannot', async () => {
    await speak(line);
    expect(mocks.played).toEqual([line]);
    expect(mocks.said).toEqual(["Rook to g8. That's a blunder."]);
    expect(useVoiceStatus.getState().lastVoice).toBe('device');
  });

  it('says nothing more once the line was stopped', async () => {
    mocks.pack = 'stopped';
    await speak(line);
    expect(mocks.said).toEqual([]);
  });

  it('reads plain text, and every line with the device voice engine, with the device voice', async () => {
    await speak('Your opponent replies Bishop b5.');
    useVoiceSettings.getState().set({ engine: 'system' });
    await speak(line);
    expect(mocks.played).toEqual([]);
    expect(mocks.said).toEqual([
      'Your opponent replies Bishop b5.',
      "Rook to g8. That's a blunder.",
    ]);
  });
});

describe('saved settings', () => {
  it('turns the Kokoro voice saved by version 2 into the coach voice, keeping the rest', async () => {
    const saved = {
      state: {
        narrate: true,
        engine: 'kokoro',
        kokoroVoice: 'af_heart',
        systemVoice: 'x',
        rate: 1.2,
      },
      version: 2,
    };
    const storage = new Map([['kibitz-voice', JSON.stringify(saved)]]);
    const deleted: string[] = [];
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('caches', {
      delete: (name: string) => {
        deleted.push(name);
        return Promise.resolve(true);
      },
    });
    try {
      await useVoiceSettings.persist.rehydrate();
      const { narrate, engine, systemVoice, rate } = useVoiceSettings.getState();
      expect({ narrate, engine, systemVoice, rate }).toEqual({
        narrate: true,
        engine: 'coach',
        systemVoice: 'x',
        rate: 1.2,
      });
      // The old model's 326 MB cache is removed, and the migrated settings are saved.
      expect(deleted).toEqual(['transformers-cache']);
      expect(JSON.parse(storage.get('kibitz-voice')!)).toEqual({
        state: { narrate: true, engine: 'coach', systemVoice: 'x', rate: 1.2 },
        version: 3,
      });
    } finally {
      vi.unstubAllGlobals();
      useVoiceSettings.getState().set({ narrate: false });
    }
  });
});
