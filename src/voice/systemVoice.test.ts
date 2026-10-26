import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  estimateSpeechMs,
  rankEnglishVoices,
  speakSystem,
  speechChunks,
  stopSystem,
  systemVoiceLabel,
} from './systemVoice';

function voice(name: string, lang: string, localService = true): SpeechSynthesisVoice {
  return { name, lang, localService, voiceURI: name, default: false };
}

describe('rankEnglishVoices', () => {
  it('keeps English voices, natural ones first', () => {
    const ranked = rankEnglishVoices([
      voice('Microsoft David - English (United States)', 'en-US'),
      voice('Microsoft Katja Online (Natural) - German (Germany)', 'de-DE', false),
      voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
      voice('eSpeak English', 'en'),
    ]);
    expect(ranked.map((v) => v.name)).toEqual([
      'Microsoft Aria Online (Natural) - English (United States)',
      'Microsoft David - English (United States)',
      'eSpeak English',
    ]);
  });
});

describe('systemVoiceLabel', () => {
  it('shortens names and marks online voices', () => {
    expect(
      systemVoiceLabel(
        voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
      ),
    ).toBe('Aria (Natural), US, online');
    expect(systemVoiceLabel(voice('Microsoft David - English (United States)', 'en-US'))).toBe(
      'David, US',
    );
    expect(systemVoiceLabel(voice('Google UK English Female', 'en-GB', false))).toBe(
      'Google UK English Female, online',
    );
    expect(systemVoiceLabel(voice('Samantha', 'en_US'))).toBe('Samantha, US');
  });
});

describe('speech helpers', () => {
  it('splits text into sentences', () => {
    expect(speechChunks('Rook g8 is a blunder. Best was Rook takes g7! Next')).toEqual([
      'Rook g8 is a blunder.',
      'Best was Rook takes g7!',
      'Next',
    ]);
  });

  it('estimates speaking time from the words and the rate', () => {
    expect(estimateSpeechMs('one two three four five six seven eight nine', 1)).toBe(3333);
    expect(estimateSpeechMs('one two three four five six seven eight nine', 1.5)).toBe(2222);
  });
});

/** A fake Web Speech API: records utterances; `autoEnd` makes each one end at once. */
function fakeSpeech({ autoEnd }: { autoEnd: boolean }) {
  const spoken: string[] = [];
  const synth = {
    paused: false,
    speak: vi.fn((utterance: { text: string; onend?: () => void }) => {
      spoken.push(utterance.text);
      if (autoEnd) setTimeout(() => utterance.onend?.(), 10);
    }),
    cancel: vi.fn(),
    resume: vi.fn(),
    getVoices: () => [voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US')],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  class Utterance {
    text: string;
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    rate = 1;
    onend?: () => void;
    onerror?: () => void;
    constructor(text: string) {
      this.text = text;
    }
  }
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  return { spoken, synth };
}

describe('speakSystem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('speaks sentence by sentence with the best English voice', async () => {
    const { spoken } = fakeSpeech({ autoEnd: true });
    const done = speakSystem('Rook g8 is a blunder. Best was Rook takes g7.', { rate: 1.2 });
    await vi.runAllTimersAsync();
    await done;
    expect(spoken).toEqual(['Rook g8 is a blunder.', 'Best was Rook takes g7.']);
  });

  it('does not wait forever when the engine never says it finished', async () => {
    const { spoken } = fakeSpeech({ autoEnd: false });
    let finished = false;
    void speakSystem('Rook g8 is a blunder. Best was Rook takes g7.').then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spoken).toHaveLength(2);
    expect(finished).toBe(true);
  });

  it('stops between sentences when interrupted', async () => {
    const { spoken, synth } = fakeSpeech({ autoEnd: false });
    void speakSystem('First sentence. Second sentence.');
    await vi.advanceTimersByTimeAsync(0);
    stopSystem();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spoken).toEqual(['First sentence.']);
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('does nothing without speech support', async () => {
    vi.stubGlobal('window', {});
    await expect(speakSystem('Hello.')).resolves.toBeUndefined();
  });
});
