import { useEffect, useRef } from 'react';
import { Square, Volume2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CoachScript } from '@/voice/coachScript';
import { textToSpeech } from '@/voice/speakable';
import {
  isVoiceSupported,
  speak,
  stopSpeaking,
  useVoiceSettings,
  useVoiceStatus,
} from '@/voice/voice';

/**
 * Text for the speech engine: chess notation spelled out ("Nf6+" → "Knight f6, check")
 * and move numbers dropped ("12... Nf6" would be read as "twelve dot dot dot").
 */
export function speechFor(text: string): string {
  return textToSpeech(text.replace(/\b\d+\.(?:\.\.)?\s+/g, ''));
}

export interface ListenButtonProps {
  text: string;
  /**
   * The coach line to say instead of `text` (the coach voice says it; the device voice reads
   * its text). Without one, `text` is read by the device voice.
   */
  script?: CoachScript | null;
  /** Speak as soon as the button appears, when the "read aloud" setting is on. */
  autoPlay?: boolean;
  className?: string;
}

/**
 * Reads `script` (or `text`) aloud with the voice coach, or stops it.
 * Renders nothing in browsers without speech. Speech this button started stops when it
 * goes away (e.g. on the next puzzle).
 */
export function ListenButton({ text, script, autoPlay = false, className }: ListenButtonProps) {
  const speaking = useVoiceStatus((s) => s.speaking);
  const started = useRef(false);
  const supported = isVoiceSupported();

  const speech = () =>
    script && (script.segments.length || script.text) ? script : speechFor(text);
  const play = () => {
    started.current = true;
    void speak(speech()).catch(() => undefined);
  };

  useEffect(() => {
    // The setting is read once, when the text appears: turning it on later is no cue.
    if (supported && autoPlay && text && useVoiceSettings.getState().narrate) {
      started.current = true;
      void speak(speechFor(text)).catch(() => undefined);
    }
  }, [supported, autoPlay, text]);

  useEffect(
    () => () => {
      if (started.current) stopSpeaking();
    },
    [],
  );

  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={speaking ? stopSpeaking : play}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface-3 hover:text-text',
        className,
      )}
    >
      {speaking ? (
        <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
      ) : (
        <Volume2 aria-hidden="true" className="h-4 w-4" />
      )}
      {speaking ? 'Stop' : 'Listen'}
    </button>
  );
}
