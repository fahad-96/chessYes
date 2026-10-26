import { Volume2, VolumeX } from 'lucide-react';
import { useVoiceStatus } from '@/voice/voice';
import { cn } from '@/lib/cn';

export interface VoiceToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string;
}

/** Speaker button in the review header: read each move aloud, on or off. */
export function VoiceToggle({ on, onChange, className }: VoiceToggleProps) {
  const speaking = useVoiceStatus((s) => s.speaking);
  const label = on ? 'Stop reading moves aloud' : 'Read moves aloud';
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label="Read moves aloud"
      title={label}
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm transition-colors lg:h-9 lg:w-9',
        'focus-visible:outline-2 focus-visible:outline-accent',
        on
          ? 'border-accent/60 bg-accent/15 text-text hover:bg-accent/25'
          : 'border-line bg-surface-2 text-muted hover:bg-surface-3 hover:text-text',
        className,
      )}
    >
      {on ? (
        <Volume2 aria-hidden="true" className={cn('h-4 w-4', speaking && 'animate-pulse')} />
      ) : (
        <VolumeX aria-hidden="true" className="h-4 w-4" />
      )}
    </button>
  );
}
