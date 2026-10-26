/**
 * The browser's built-in speech (Web Speech API): free, instant, offline on most
 * systems. Quality depends on the device; we pick the most natural English voice.
 */

export function isSystemVoiceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

/** Voices load asynchronously in some browsers (Chrome); wait briefly for them. */
export function listSystemVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!isSystemVoiceSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener('voiceschanged', done);
      clearTimeout(timer);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    synth.addEventListener('voiceschanged', done);
  });
}

/** True for English voices ("en", "en-US", "en_GB"). */
export function isEnglishVoice(voice: Pick<SpeechSynthesisVoice, 'lang'>): boolean {
  return /^en(-|_|$)/i.test(voice.lang);
}

/** Higher is better: natural/neural voices first, then well-known good ones. */
function voiceScore(voice: SpeechSynthesisVoice): number {
  let score = 0;
  if (isEnglishVoice(voice)) score += 10;
  if (/^en[-_](US|GB)/i.test(voice.lang)) score += 2;
  if (/natural|neural|online/i.test(voice.name)) score += 6;
  if (/google/i.test(voice.name)) score += 3;
  if (/samantha|aria|jenny|guy|serena|daniel|karen|moira|ava|allison/i.test(voice.name)) score += 2;
  if (/compact|espeak/i.test(voice.name)) score -= 4;
  return score;
}

/**
 * Short name for a voice picker: "Aria (Natural), US, online" instead of
 * "Microsoft Aria Online (Natural) - English (United States)". Voices that are not local
 * are marked online: the browser sends their text to its maker's speech service.
 */
export function systemVoiceLabel(
  voice: Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService'>,
): string {
  const name =
    voice.name
      .replace(/^Microsoft\s+/, '')
      .replace(/\s+-\s+English\b.*$/, '')
      .replace(/\s*\bOnline\b/, '')
      .trim() || voice.name;
  const region = voice.lang.split(/[-_]/)[1]?.toUpperCase();
  const shownRegion = region === 'GB' ? 'UK' : region;
  const parts = [name];
  if (shownRegion && !name.includes(shownRegion)) parts.push(shownRegion);
  if (!voice.localService) parts.push('online');
  return parts.join(', ');
}

/** English voices, best first. */
export function rankEnglishVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices
    .filter(isEnglishVoice)
    .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
}

/** Chrome stops utterances after ~15 s, so long text is spoken sentence by sentence. */
export function speechChunks(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/** Rough speaking time at `rate` (about 2.7 words a second at normal speed). */
export function estimateSpeechMs(text: string, rate = 1): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round((words / 2.7 / Math.max(0.5, rate)) * 1000);
}

let generation = 0;

/**
 * Speaks one chunk; resolves when it ends, fails or is cancelled. Some engines never fire
 * `end` (no audio device, voices still loading), so a watchdog resolves after a generous
 * estimate instead of leaving the caller waiting forever.
 */
function speakChunk(
  synth: SpeechSynthesis,
  text: string,
  voice: SpeechSynthesisVoice | null,
  rate: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve();
    };
    const watchdog = setTimeout(finish, estimateSpeechMs(text, rate) * 2 + 3000);
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'en-US';
    }
    utterance.rate = rate;
    utterance.onend = finish;
    utterance.onerror = finish;
    try {
      synth.speak(utterance);
    } catch {
      finish();
    }
  });
}

/** Speaks text; resolves when finished or stopped. Does nothing without speech support. */
export async function speakSystem(
  text: string,
  options: { voiceURI?: string | null; rate?: number } = {},
): Promise<void> {
  if (!isSystemVoiceSupported()) return;
  stopSystem();
  const myGeneration = generation;
  const synth = window.speechSynthesis;
  const voices = await listSystemVoices();
  if (myGeneration !== generation) return;
  const voice =
    voices.find((v) => v.voiceURI === options.voiceURI) ?? rankEnglishVoices(voices)[0] ?? null;
  // A paused engine (Safari after a tab switch) would queue the text silently.
  if (synth.paused) synth.resume();

  for (const part of speechChunks(text)) {
    if (myGeneration !== generation) return;
    await speakChunk(synth, part, voice, options.rate ?? 1);
  }
}

export function stopSystem(): void {
  generation++;
  if (isSystemVoiceSupported()) window.speechSynthesis.cancel();
}
