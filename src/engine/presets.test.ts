import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESETS, recommendPreset } from './presets';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/130.0.0.0 Safari/537.36';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function stubNavigator(overrides: Record<string, unknown>) {
  vi.stubGlobal('navigator', {
    userAgent: DESKTOP_UA,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recommendPreset', () => {
  it('picks standard on a capable desktop', () => {
    stubNavigator({});
    expect(recommendPreset()).toBe('standard');
  });

  it('picks fast when the browser reports a mobile device', () => {
    stubNavigator({ userAgentData: { mobile: true } });
    expect(recommendPreset()).toBe('fast');
  });

  it('picks fast for phone and tablet user agents', () => {
    stubNavigator({ userAgent: ANDROID_UA });
    expect(recommendPreset()).toBe('fast');
    stubNavigator({ userAgent: IPHONE_UA, deviceMemory: undefined });
    expect(recommendPreset()).toBe('fast');
    // Android tablets report mobile: false in userAgentData but still say Android.
    stubNavigator({ userAgent: ANDROID_UA, userAgentData: { mobile: false } });
    expect(recommendPreset()).toBe('fast');
  });

  it('picks fast on low-end hardware', () => {
    stubNavigator({ hardwareConcurrency: 4 });
    expect(recommendPreset()).toBe('fast');
    stubNavigator({ deviceMemory: 4 });
    expect(recommendPreset()).toBe('fast');
  });

  it('does not penalise browsers that hide device memory (Firefox, Safari)', () => {
    stubNavigator({ deviceMemory: undefined, hardwareConcurrency: 12 });
    expect(recommendPreset()).toBe('standard');
  });

  it('returns standard outside a browser', () => {
    vi.stubGlobal('navigator', undefined);
    expect(recommendPreset()).toBe('standard');
  });
});

describe('PRESETS', () => {
  it('uses MultiPV 2 everywhere so "Great" moves can be detected', () => {
    for (const preset of Object.values(PRESETS)) expect(preset.multiPv).toBe(2);
  });
});
