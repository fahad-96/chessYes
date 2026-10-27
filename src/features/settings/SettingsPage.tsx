import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Download, Square, Trash2, Volume2 } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import type { AccuracyModel } from '@/core/accuracyModel';
import { clearAnalysisCache } from '@/engine/cache';
import { PRESETS, recommendPreset, type PresetId } from '@/engine/presets';
import { clearPuzzleProgress, loadProgress } from '@/features/puzzles/progress';
import { clearLibrary, getLibraryEntries } from '@/library/library';
import { cn } from '@/lib/cn';
import {
  THEME_BOARD,
  useSettings,
  type BoardTheme,
  type SettingsState,
  type ThemeSetting,
} from '@/state/settings';
import {
  KOKORO_DOWNLOAD_MB,
  KOKORO_VOICES,
  hasWebGpuAdapter,
  isKokoroDownloaded,
  type KokoroVoiceId,
} from '@/voice/kokoroVoice';
import { listSystemVoices, rankEnglishVoices, systemVoiceLabel } from '@/voice/systemVoice';
import {
  MAX_RATE,
  MIN_RATE,
  isVoiceSupported,
  prepareNaturalVoice,
  removeNaturalVoice,
  speak,
  stopSpeaking,
  useVoiceSettings,
  useVoiceStatus,
} from '@/voice/voice';
import { formatBytes } from './formatBytes';

const THEME_OPTIONS: { value: ThemeSetting; label: string; description: string }[] = [
  { value: 'classic', label: 'Classic', description: 'Charcoal and green, bold type' },
  { value: 'system', label: 'System', description: 'Dark or light, like your device' },
  { value: 'dark', label: 'Dark', description: 'Deep blue-grey with amber' },
  { value: 'light', label: 'Light', description: 'Bright, for daylight' },
];

const BOARD_OPTIONS: { value: BoardTheme; label: string }[] = [
  { value: 'green', label: 'Green' },
  { value: 'slate', label: 'Slate' },
  { value: 'walnut', label: 'Walnut' },
  { value: 'ocean', label: 'Ocean' },
];

const PRESET_IDS: PresetId[] = ['fast', 'standard', 'deep'];

const ACCURACY_OPTIONS: { value: AccuracyModel; label: string; description: string }[] = [
  {
    value: 'calibrated',
    label: 'Calibrated (default)',
    description: 'Tuned to match the accuracy figures big chess sites publish.',
  },
  { value: 'lichess', label: 'Lichess formula', description: 'The open formula used by Lichess.' },
];

/** The preset "Auto" resolves to on this device, or null if it cannot be determined. */
function autoPreset(): PresetId | null {
  try {
    return recommendPreset();
  } catch {
    return null;
  }
}

/** /settings: analysis depth and accuracy scale, appearance, review display, voice and storage. */
export default function SettingsPage() {
  useDocumentTitle('Settings · Kibitz');
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1.5 text-muted">Saved in this browser. Changes apply right away.</p>
      </header>
      <AnalysisSection />
      <AppearanceSection />
      <ReviewSection />
      <VoiceSection />
      <StorageSection />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = `settings-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <Card className="p-4 sm:p-5">
      <section aria-labelledby={id}>
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        <div className="mt-4">{children}</div>
      </section>
    </Card>
  );
}

/** A selectable card backed by a native radio input (keyboard and screen-reader support for free). */
function RadioCard({
  name,
  checked,
  onSelect,
  title,
  description,
  aside,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 transition-colors',
        'hover:bg-surface-2 has-checked:border-accent/70 has-checked:bg-accent/10',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {description && <span className="mt-0.5 block text-sm text-muted">{description}</span>}
      </span>
      {aside}
    </label>
  );
}

function AnalysisSection() {
  const preset = useSettings((s) => s.preset);
  const accuracyModel = useSettings((s) => s.accuracyModel);
  const set = useSettings((s) => s.set);
  const [auto] = useState(autoPreset);
  return (
    <Section title="Analysis">
      <div className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Depth</legend>
          <p className="text-sm text-muted">
            How deeply Stockfish searches each position. Deeper is more accurate but slower; every
            position also has a time cap so slow devices never stall.
          </p>
          <div className="grid gap-2">
            <RadioCard
              name="preset"
              checked={preset === 'auto'}
              onSelect={() => set({ preset: 'auto' })}
              title="Auto"
              description={
                auto
                  ? `Picks a depth for this device. Here it uses ${PRESETS[auto].label}: ${PRESETS[auto].description}`
                  : 'Picks a depth for this device.'
              }
            />
            {PRESET_IDS.map((id) => (
              <RadioCard
                key={id}
                name="preset"
                checked={preset === id}
                onSelect={() => set({ preset: id })}
                title={PRESETS[id].label}
                description={PRESETS[id].description}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Accuracy scale</legend>
          <p className="text-sm text-muted">
            How move and game accuracy are scored. Move labels are the same on both.
          </p>
          <div className="grid gap-2 min-[420px]:grid-cols-2">
            {ACCURACY_OPTIONS.map((option) => (
              <RadioCard
                key={option.value}
                name="accuracy-scale"
                checked={accuracyModel === option.value}
                onSelect={() => set({ accuracyModel: option.value })}
                title={option.label}
                description={option.description}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </Section>
  );
}

function AppearanceSection() {
  const theme = useSettings((s) => s.theme);
  const boardTheme = useSettings((s) => s.boardTheme);
  const set = useSettings((s) => s.set);
  return (
    <Section title="Appearance">
      <div className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Theme</legend>
          <div className="grid gap-2 min-[420px]:grid-cols-2">
            {THEME_OPTIONS.map((option) => (
              <RadioCard
                key={option.value}
                name="theme"
                checked={theme === option.value}
                onSelect={() => {
                  // A theme can come with its own board (classic: green); it can be changed after.
                  const board = THEME_BOARD[option.value];
                  set(board ? { theme: option.value, boardTheme: board } : { theme: option.value });
                }}
                title={option.label}
                description={option.description}
                aside={<ThemePreview theme={option.value} />}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Board</legend>
          <div className="grid gap-2 min-[420px]:grid-cols-2 md:grid-cols-4">
            {BOARD_OPTIONS.map((option) => (
              <RadioCard
                key={option.value}
                name="board"
                checked={boardTheme === option.value}
                onSelect={() => set({ boardTheme: option.value })}
                title={option.label}
                aside={<BoardPreview theme={option.value} />}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </Section>
  );
}

/**
 * A tiny page in a theme's own colours: header bar, a panel with a line of text and a
 * green (or amber) button. index.css matches data-theme on any element, so the tokens
 * inside resolve to that theme whatever the page uses. System shows dark and light halves.
 */
function ThemePreview({ theme }: { theme: ThemeSetting }) {
  return (
    <span
      aria-hidden="true"
      className="relative block h-11 w-16 shrink-0 overflow-hidden rounded-md ring-1 ring-line"
    >
      {theme === 'system' ? (
        <>
          <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
            <ThemeMock theme="dark" />
          </span>
          <span className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
            <ThemeMock theme="light" className="right-0 left-auto" />
          </span>
        </>
      ) : (
        <ThemeMock theme={theme} />
      )}
    </span>
  );
}

function ThemeMock({ theme, className }: { theme: ThemeSetting; className?: string }) {
  return (
    <span
      data-theme={theme}
      className={cn('absolute inset-y-0 left-0 block w-16', className)}
      style={{ background: 'var(--bg)' }}
    >
      <span className="absolute inset-x-0 top-0 h-2" style={{ background: 'var(--chrome)' }} />
      <span
        className="absolute inset-x-1.5 top-3 bottom-1.5 rounded-sm"
        style={{ background: 'var(--surface)' }}
      >
        <span
          className="absolute top-1.5 left-1.5 h-1 w-7 rounded-full"
          style={{ background: 'var(--text)' }}
        />
        <span
          className="absolute inset-x-1.5 bottom-1.5 h-2 rounded-[2px]"
          style={{ background: 'var(--accent)', boxShadow: 'inset 0 -1px 0 var(--accent-edge)' }}
        />
      </span>
    </span>
  );
}

/** 2x2 squares painted with the same CSS variables the real board uses. */
function BoardPreview({ theme }: { theme: BoardTheme }) {
  const light = { background: 'var(--board-light)' };
  const dark = { background: 'var(--board-dark)' };
  return (
    <span
      data-board={theme}
      aria-hidden="true"
      className="grid h-10 w-10 shrink-0 grid-cols-2 overflow-hidden rounded-md ring-1 ring-line"
    >
      <span style={light} />
      <span style={dark} />
      <span style={dark} />
      <span style={light} />
    </span>
  );
}

function ReviewSection() {
  const showBestMoveArrow = useSettings((s) => s.showBestMoveArrow);
  const showEvalBar = useSettings((s) => s.showEvalBar);
  const showBoardBadges = useSettings((s) => s.showBoardBadges);
  const set = useSettings((s) => s.set);
  const toggles: {
    key: keyof Pick<SettingsState, 'showBestMoveArrow' | 'showEvalBar' | 'showBoardBadges'>;
    value: boolean;
    label: string;
    description: string;
  }[] = [
    {
      key: 'showBestMoveArrow',
      value: showBestMoveArrow,
      label: 'Best-move arrow',
      description: 'Draw an arrow for the engine’s best move on the board.',
    },
    {
      key: 'showEvalBar',
      value: showEvalBar,
      label: 'Evaluation bar',
      description: 'Show who is better next to the board.',
    },
    {
      key: 'showBoardBadges',
      value: showBoardBadges,
      label: 'Board badges',
      description: 'Mark the current move’s classification on its square.',
    },
  ];
  return (
    <Section title="Review">
      <div className="divide-y divide-line">
        {toggles.map((t) => (
          <Toggle
            key={t.key}
            checked={t.value}
            onChange={(checked) => set({ [t.key]: checked })}
            label={t.label}
            description={t.description}
            className="py-3 first:pt-0 last:pb-0"
          />
        ))}
      </div>
    </Section>
  );
}

const TEST_SENTENCE =
  'Rook g8 is a blunder. Your opponent replies bishop takes g8 and wins your rook for free.';

/** English system voices, best first; null while loading, empty when the system has none. */
function useEnglishVoices(): SpeechSynthesisVoice[] | null {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void listSystemVoices().then((all) => {
        if (!cancelled) setVoices(rankEnglishVoices(all));
      });
    load();
    // Some browsers add voices later (online voices, newly installed ones).
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    synth?.addEventListener?.('voiceschanged', load);
    return () => {
      cancelled = true;
      synth?.removeEventListener?.('voiceschanged', load);
    };
  }, []);
  return voices;
}

/** Whether the natural voice can be offered here (WebGPU with a real adapter). */
function useNaturalVoiceAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void hasWebGpuAdapter().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

function VoiceSection() {
  const supported = isVoiceSupported();
  const narrate = useVoiceSettings((s) => s.narrate);
  const engine = useVoiceSettings((s) => s.engine);
  const systemVoice = useVoiceSettings((s) => s.systemVoice);
  const kokoroVoice = useVoiceSettings((s) => s.kokoroVoice);
  const rate = useVoiceSettings((s) => s.rate);
  const set = useVoiceSettings((s) => s.set);
  const speaking = useVoiceStatus((s) => s.speaking);
  const voices = useEnglishVoices();
  const naturalAvailable = useNaturalVoiceAvailable();
  const voiceId = useId();
  const rateId = useId();

  // Stop the test sentence when leaving the page.
  useEffect(() => () => stopSpeaking(), []);

  if (!supported) {
    return (
      <Section title="Voice">
        <p className="text-sm text-muted">
          This browser cannot speak, so the voice coach is not available here. Everything else works
          the same without it.
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="Voice"
      description="Reads moves and their stories aloud. Voices marked online are spoken by your browser maker’s service; the others never leave your device."
    >
      <div className="space-y-5">
        <Toggle
          checked={narrate}
          onChange={(checked) => {
            set({ narrate: checked });
            if (!checked) stopSpeaking();
          }}
          label="Read moves aloud"
          description="While you step through a review, hear each move’s verdict and why. The speaker button on the review switches this too."
        />

        {naturalAvailable && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Voice engine</legend>
            <div className="grid gap-2">
              <RadioCard
                name="voice-engine"
                checked={engine === 'system'}
                onSelect={() => set({ engine: 'system' })}
                title="System voice"
                description="Built into your device: instant, nothing to download."
              />
              <RadioCard
                name="voice-engine"
                checked={engine === 'kokoro'}
                onSelect={() => set({ engine: 'kokoro' })}
                title="Natural voice"
                description={`Downloads ${KOKORO_DOWNLOAD_MB} MB once, best on computers with a modern GPU.`}
              />
            </div>
            {engine === 'kokoro' && (
              <NaturalVoicePanel voice={kokoroVoice} onVoice={(id) => set({ kokoroVoice: id })} />
            )}
          </fieldset>
        )}

        {(engine === 'system' || !naturalAvailable) && (
          <div className="space-y-2">
            <label htmlFor={voiceId} className="block text-sm font-medium">
              System voice
            </label>
            {voices === null ? (
              <p className="flex min-h-10 items-center gap-2 text-sm text-muted">
                <Spinner label="Loading voices" /> Looking for voices…
              </p>
            ) : voices.length === 0 ? (
              <p className="text-sm text-muted">
                No English voices are installed, so your browser’s default voice is used. You can
                add voices in your system’s speech settings.
              </p>
            ) : (
              <select
                id={voiceId}
                value={voices.some((v) => v.voiceURI === systemVoice) ? (systemVoice ?? '') : ''}
                onChange={(event) => set({ systemVoice: event.target.value || null })}
                className="h-10 w-full min-w-0 rounded-lg border border-line bg-surface px-2 text-sm text-text hover:bg-surface-2 sm:max-w-md sm:px-3"
              >
                <option value="">
                  Automatic: {voices[0] ? systemVoiceLabel(voices[0]) : 'best available'}
                </option>
                {voices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {systemVoiceLabel(voice)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3 sm:max-w-md">
            <label htmlFor={rateId} className="text-sm font-medium">
              Speed
            </label>
            <span className="tabular text-sm text-muted">{formatRate(rate)}</span>
          </div>
          <input
            id={rateId}
            type="range"
            min={MIN_RATE}
            max={MAX_RATE}
            step={0.05}
            value={rate}
            aria-valuetext={formatRate(rate)}
            onChange={(event) => set({ rate: Number(event.target.value) })}
            className="h-10 w-full accent-[var(--accent)] sm:max-w-md"
          />
        </div>

        <Button
          variant="secondary"
          onClick={() => (speaking ? stopSpeaking() : void speak(TEST_SENTENCE))}
        >
          {speaking ? (
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          ) : (
            <Volume2 className="h-4 w-4" aria-hidden="true" />
          )}
          {speaking ? 'Stop' : 'Test voice'}
        </Button>
      </div>
    </Section>
  );
}

/** "1×", "0.85×", "1.2×". */
function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

/** Download progress, voice choice and removal for the natural voice. */
function NaturalVoicePanel({
  voice,
  onVoice,
}: {
  voice: KokoroVoiceId;
  onVoice: (id: KokoroVoiceId) => void;
}) {
  const loading = useVoiceStatus((s) => s.loading);
  const progress = useVoiceStatus((s) => s.progress);
  const ready = useVoiceStatus((s) => s.naturalReady);
  const error = useVoiceStatus((s) => s.error);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const selectId = useId();

  useEffect(() => {
    let cancelled = false;
    void isKokoroDownloaded().then((value) => {
      if (!cancelled) setDownloaded(value);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, loading]);

  const downloading = !!progress && progress.total > 0 && progress.loaded < progress.total;
  const percent = downloading ? (progress.loaded / progress.total) * 100 : 100;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
      {loading ? (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm">
            {downloading
              ? `Downloading the voice… ${formatBytes(progress.loaded)} of ${formatBytes(progress.total)}`
              : 'Preparing the voice…'}
          </p>
          <div
            role="progressbar"
            aria-label="Natural voice download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            className="h-1.5 overflow-hidden rounded-full bg-surface-3"
          >
            <div
              className={cn(
                'h-full rounded-full bg-accent transition-[width] duration-300',
                !downloading && 'animate-pulse',
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : ready ? (
        <p className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-success" aria-hidden="true" /> The natural voice is ready.
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            {downloaded
              ? 'Downloaded. It starts the first time it speaks; until then the system voice is used.'
              : 'Not downloaded yet. Until it is, the system voice is used.'}
          </p>
          <Button variant="primary" className="shrink-0" onClick={() => void prepareNaturalVoice()}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {downloaded ? 'Start voice' : `Download ${KOKORO_DOWNLOAD_MB} MB`}
          </Button>
        </div>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor={selectId} className="text-sm font-medium">
            Voice
          </label>
          <select
            id={selectId}
            value={voice}
            onChange={(event) => onVoice(event.target.value as KokoroVoiceId)}
            className="h-10 min-w-0 rounded-lg border border-line bg-surface px-2 text-sm text-text hover:bg-surface-2"
          >
            {KOKORO_VOICES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {(downloaded || ready) && !loading && (
          <Button
            variant="ghost"
            className="shrink-0"
            onClick={() => void removeNaturalVoice().then(() => setDownloaded(false))}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Remove downloaded voice
          </Button>
        )}
      </div>
    </div>
  );
}

type ClearState = 'idle' | 'confirm' | 'clearing' | 'done' | 'error';

/**
 * One thing stored in this browser, with a button that clears it after a confirmation
 * (the confirm buttons replace the button, and focus returns to it afterwards).
 */
function ClearRow({
  title,
  status,
  confirmText,
  doneText,
  errorText,
  buttonLabel,
  disabled = false,
  onClear,
}: {
  title: string;
  /** What is stored now, e.g. "12 games". */
  status: ReactNode;
  confirmText: string;
  doneText: string;
  errorText: string;
  buttonLabel: string;
  disabled?: boolean;
  onClear: () => Promise<void>;
}) {
  const [state, setState] = useState<ClearState>('idle');
  // A plain <button> because Button does not forward refs.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = () => requestAnimationFrame(() => buttonRef.current?.focus());

  async function clear() {
    setState('clearing');
    try {
      await onClear();
      setState('done');
    } catch {
      setState('error');
    }
    restoreFocus();
  }

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="tabular mt-0.5 text-sm text-muted" aria-live="polite">
          {state === 'done'
            ? doneText
            : state === 'error'
              ? errorText
              : state === 'confirm'
                ? confirmText
                : status}
        </p>
      </div>
      {state === 'confirm' ? (
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            autoFocus
            onClick={() => {
              setState('idle');
              restoreFocus();
            }}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void clear()}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Yes, clear
          </Button>
        </div>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          className={buttonClass('secondary', 'md', 'shrink-0')}
          disabled={disabled || state === 'clearing'}
          onClick={() => setState('confirm')}
        >
          {state === 'clearing' ? (
            <Spinner label="Clearing" />
          ) : state === 'done' ? (
            <Check className="h-4 w-4 text-success" aria-hidden="true" />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          )}
          {buttonLabel}
        </button>
      )}
    </div>
  );
}

/** Counts what is stored, again whenever `version` changes; null while counting. */
function useStoredCount(count: () => Promise<number>, version: number): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    count()
      .then((result) => {
        if (!cancelled) setValue(result);
      })
      .catch(() => {
        if (!cancelled) setValue(0);
      });
    return () => {
      cancelled = true;
    };
  }, [count, version]);
  return value;
}

const countLibrary = async () => (await getLibraryEntries()).length;
const countPuzzles = async () => (await loadProgress()).size;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function StorageSection() {
  const recentCount = useSettings((s) => s.recent.length);
  const clearRecent = useSettings((s) => s.clearRecent);
  const [recentCleared, setRecentCleared] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  // Bumped after every clear, so the counts and the usage are read again.
  const [version, setVersion] = useState(0);
  const games = useStoredCount(countLibrary, version);
  const puzzles = useStoredCount(countPuzzles, version);

  useEffect(() => {
    let cancelled = false;
    navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        // Some browsers report 0 when they will not say; that is not worth showing.
        if (!cancelled && typeof estimate.usage === 'number' && estimate.usage > 0) {
          setUsage(estimate.usage);
        }
      })
      .catch(() => {
        /* not supported or blocked: just hide the number */
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const thenRecount = (clear: () => Promise<void>) => async () => {
    await clear();
    setVersion((current) => current + 1);
  };

  return (
    <Section
      title="Storage"
      description="Analyses, reviewed games and puzzle progress are kept in this browser, so reopening a game is instant. Nothing is uploaded anywhere."
    >
      {usage !== null && (
        <p className="tabular mb-4 text-sm text-muted">
          Kibitz is using about {formatBytes(usage)} on this device.
        </p>
      )}
      <div className="divide-y divide-line">
        <ClearRow
          title="Analysis cache"
          status="Saved engine analyses of the games you opened."
          confirmText="Remove every saved analysis? This cannot be undone."
          doneText="Cleared. Games will be analysed again when you open them."
          errorText="Could not clear the cache. Try again, or clear site data in your browser."
          buttonLabel="Clear analysis cache"
          onClear={thenRecount(clearAnalysisCache)}
        />
        <ClearRow
          title="Reviewed games"
          status={
            games === null
              ? 'Counting…'
              : games === 0
                ? 'No reviewed games yet. Insights and puzzles are built from them.'
                : `${plural(games, 'game', 'games')}. Insights and puzzles are built from them.`
          }
          confirmText="Remove every reviewed game? Insights and puzzles start over."
          doneText="Cleared. Games you review from now on are added again."
          errorText="Could not clear the library. Try again, or clear site data in your browser."
          buttonLabel="Clear reviewed games library"
          disabled={games === 0}
          onClear={thenRecount(clearLibrary)}
        />
        <ClearRow
          title="Puzzle progress"
          status={
            puzzles === null
              ? 'Counting…'
              : puzzles === 0
                ? 'No puzzles tried yet.'
                : `${plural(puzzles, 'puzzle', 'puzzles')} tried, each with its next review date.`
          }
          confirmText="Forget every attempt and your streak? The puzzles stay and start over."
          doneText="Reset. Every puzzle is new again."
          errorText="Could not reset the progress. Try again, or clear site data in your browser."
          buttonLabel="Reset puzzle progress"
          disabled={puzzles === 0}
          onClear={thenRecount(clearPuzzleProgress)}
        />
        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Recent searches</p>
            <p className="tabular mt-0.5 text-sm text-muted" aria-live="polite">
              {recentCleared && recentCount === 0
                ? 'Cleared.'
                : recentCount === 0
                  ? 'No recent searches.'
                  : `${plural(recentCount, 'username', 'usernames')} on the home page.`}
            </p>
          </div>
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={recentCount === 0}
            onClick={() => {
              clearRecent();
              setRecentCleared(true);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Clear recent searches
          </Button>
        </div>
      </div>
    </Section>
  );
}
