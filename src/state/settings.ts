import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { DEFAULT_ACCURACY_MODEL, type AccuracyModel } from '@/core/accuracyModel';
import { recommendPreset, type PresetId } from '@/engine/presets';

export type Platform = 'chesscom' | 'lichess';
export type ThemeSetting = 'classic' | 'system' | 'dark' | 'light';
export type BoardTheme = 'green' | 'slate' | 'walnut' | 'ocean';

/** Defaults for new users. index.html's no-flash script applies the same ones. */
export const DEFAULT_THEME: ThemeSetting = 'classic';
export const DEFAULT_BOARD: BoardTheme = 'green';
/** Board that goes with each theme; picking a theme in Settings switches to it. */
export const THEME_BOARD: Partial<Record<ThemeSetting, BoardTheme>> = { classic: 'green' };

/**
 * Version of the persisted settings. 2: classic theme and green board became the defaults.
 * 3: the accuracy scale became a setting (calibrated by default).
 */
export const SETTINGS_VERSION = 3;

export interface RecentSearch {
  platform: Platform;
  username: string;
}

export interface SettingsState {
  /** 'auto' picks a preset for this device (see recommendPreset). */
  preset: 'auto' | PresetId;
  /** The scale accuracies are shown on (core/accuracyModel.ts); labels do not depend on it. */
  accuracyModel: AccuracyModel;
  theme: ThemeSetting;
  boardTheme: BoardTheme;
  showBestMoveArrow: boolean;
  showEvalBar: boolean;
  /** Draw the classification badge on the destination square of the current move. */
  showBoardBadges: boolean;
  recent: RecentSearch[];
  set: (
    patch: Partial<Omit<SettingsState, 'set' | 'addRecent' | 'removeRecent' | 'clearRecent'>>,
  ) => void;
  addRecent: (search: RecentSearch) => void;
  /** Forgets one recent search (usernames match case-insensitively). */
  removeRecent: (search: RecentSearch) => void;
  clearRecent: () => void;
}

/**
 * Upgrades settings saved by an older version, keeping every other field.
 * - Version 2 changed the defaults: anyone still on the old ones (system theme, slate board)
 *   moves to classic + green, while a theme or board someone picked themselves is kept.
 * - Version 3 added the accuracy scale; everyone starts on the default (calibrated).
 */
export function migrateSettings(persisted: unknown, version: number): Partial<SettingsState> {
  let state: Partial<SettingsState> =
    persisted && typeof persisted === 'object' ? (persisted as Partial<SettingsState>) : {};
  if (version >= SETTINGS_VERSION) return state;
  if (version < 2) {
    // Version 1 did not store a value it never had: missing means its default.
    const theme = state.theme ?? 'system';
    const boardTheme = state.boardTheme ?? 'slate';
    state =
      theme === 'system' && boardTheme === 'slate'
        ? { ...state, theme: DEFAULT_THEME, boardTheme: DEFAULT_BOARD }
        : { ...state, theme, boardTheme };
  }
  if (version < 3) state = { ...state, accuracyModel: DEFAULT_ACCURACY_MODEL };
  return state;
}

const sameSearch = (a: RecentSearch, b: RecentSearch) =>
  a.platform === b.platform && a.username.toLowerCase() === b.username.toLowerCase();

const MAX_RECENT = 6;

/** localStorage can throw (private mode, blocked storage); settings then live in memory only. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* ignore */
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      preset: 'auto',
      accuracyModel: DEFAULT_ACCURACY_MODEL,
      theme: DEFAULT_THEME,
      boardTheme: DEFAULT_BOARD,
      showBestMoveArrow: true,
      showEvalBar: true,
      showBoardBadges: true,
      recent: [],
      set: (patch) => set(patch),
      addRecent: (search) =>
        set((state) => ({
          recent: [search, ...state.recent.filter((r) => !sameSearch(r, search))].slice(
            0,
            MAX_RECENT,
          ),
        })),
      removeRecent: (search) =>
        set((state) => ({ recent: state.recent.filter((r) => !sameSearch(r, search)) })),
      clearRecent: () => set({ recent: [] }),
    }),
    {
      name: 'kibitz-settings',
      version: SETTINGS_VERSION,
      migrate: (persisted, version) => migrateSettings(persisted, version) as SettingsState,
      storage: createJSONStorage(() => safeStorage),
    },
  ),
);

/** The preset actually used for analysis. */
export function resolvePreset(preset: SettingsState['preset']): PresetId {
  return preset === 'auto' ? recommendPreset() : preset;
}
