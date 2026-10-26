import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Monitor, Moon, Sun, Trash2 } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import { clearAnalysisCache } from '@/engine/cache';
import { PRESETS, recommendPreset, type PresetId } from '@/engine/presets';
import { cn } from '@/lib/cn';
import {
  useSettings,
  type BoardTheme,
  type SettingsState,
  type ThemeSetting,
} from '@/state/settings';
import { formatBytes } from './formatBytes';

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" aria-hidden="true" /> },
  { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" aria-hidden="true" /> },
] as const satisfies readonly { value: ThemeSetting; label: string; icon: ReactNode }[];

const BOARD_OPTIONS: { value: BoardTheme; label: string }[] = [
  { value: 'slate', label: 'Slate' },
  { value: 'walnut', label: 'Walnut' },
  { value: 'ocean', label: 'Ocean' },
];

const PRESET_IDS: PresetId[] = ['fast', 'standard', 'deep'];

/** The preset "Auto" resolves to on this device, or null if it cannot be determined. */
function autoPreset(): PresetId | null {
  try {
    return recommendPreset();
  } catch {
    return null;
  }
}

/** /settings: analysis depth, appearance, review display and local storage. */
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
  const set = useSettings((s) => s.set);
  const [auto] = useState(autoPreset);
  return (
    <Section
      title="Analysis depth"
      description="How deeply Stockfish searches each position. Deeper is more accurate but slower; every position also has a time cap so slow devices never stall."
    >
      <fieldset className="grid gap-2">
        <legend className="sr-only">Analysis depth</legend>
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
      </fieldset>
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
        <div className="space-y-2">
          <p className="text-sm font-medium">Theme</p>
          <SegmentedControl
            label="Theme"
            value={theme}
            onChange={(value) => set({ theme: value })}
            options={THEME_OPTIONS}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Board</legend>
          <div className="grid gap-2 sm:grid-cols-3">
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

type ClearState = 'idle' | 'confirm' | 'clearing' | 'done' | 'error';

function StorageSection() {
  const recentCount = useSettings((s) => s.recent.length);
  const clearRecent = useSettings((s) => s.clearRecent);
  const [cacheState, setCacheState] = useState<ClearState>('idle');
  const [recentCleared, setRecentCleared] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  // The confirm buttons replace the clear button; hand focus back to it afterwards.
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = () => requestAnimationFrame(() => clearButtonRef.current?.focus());

  useEffect(() => {
    if (cacheState === 'confirm' || cacheState === 'clearing') return;
    let cancelled = false;
    navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (!cancelled && typeof estimate.usage === 'number') setUsage(estimate.usage);
      })
      .catch(() => {
        /* not supported or blocked: just hide the number */
      });
    return () => {
      cancelled = true;
    };
  }, [cacheState]);

  async function clearCache() {
    setCacheState('clearing');
    try {
      await clearAnalysisCache();
      setCacheState('done');
    } catch {
      setCacheState('error');
    }
    restoreFocus();
  }

  return (
    <Section
      title="Storage"
      description="Analyses are saved in this browser so reopening a game is instant. Nothing is uploaded anywhere."
    >
      {usage !== null && (
        <p className="tabular mb-4 text-sm text-muted">
          Kibitz is using about {formatBytes(usage)} on this device.
        </p>
      )}
      <div className="divide-y divide-line">
        <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Analysis cache</p>
            <p className="mt-0.5 text-sm text-muted" aria-live="polite">
              {cacheState === 'done'
                ? 'Cleared. Games will be analysed again when you open them.'
                : cacheState === 'error'
                  ? 'Could not clear the cache. Try again, or clear site data in your browser.'
                  : cacheState === 'confirm'
                    ? 'Remove every saved analysis? This cannot be undone.'
                    : 'Saved engine analyses of the games you reviewed.'}
            </p>
          </div>
          {cacheState === 'confirm' ? (
            <div className="flex shrink-0 gap-2">
              <Button
                variant="ghost"
                autoFocus
                onClick={() => {
                  setCacheState('idle');
                  restoreFocus();
                }}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void clearCache()}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Yes, clear
              </Button>
            </div>
          ) : (
            // A plain <button> because Button does not forward refs.
            <button
              ref={clearButtonRef}
              type="button"
              className={buttonClass('secondary', 'md', 'shrink-0')}
              disabled={cacheState === 'clearing'}
              onClick={() => setCacheState('confirm')}
            >
              {cacheState === 'clearing' ? (
                <Spinner label="Clearing" />
              ) : cacheState === 'done' ? (
                <Check className="h-4 w-4 text-success" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              Clear analysis cache
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Recent searches</p>
            <p className="tabular mt-0.5 text-sm text-muted" aria-live="polite">
              {recentCleared && recentCount === 0
                ? 'Cleared.'
                : recentCount === 0
                  ? 'No recent searches.'
                  : `${recentCount} ${recentCount === 1 ? 'username' : 'usernames'} on the home page.`}
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
