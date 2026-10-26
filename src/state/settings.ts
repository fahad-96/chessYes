import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { recommendPreset, type PresetId } from '@/engine/presets';

export type Platform = 'chesscom' | 'lichess';
export type ThemeSetting = 'system' | 'dark' | 'light';
export type BoardTheme = 'slate' | 'walnut' | 'ocean';

export interface RecentSearch {
  platform: Platform;
  username: string;
}

export interface SettingsState {
  /** 'auto' picks a preset for this device (see recommendPreset). */
  preset: 'auto' | PresetId;
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
      theme: 'system',
      boardTheme: 'slate',
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
    { name: 'kibitz-settings', version: 1, storage: createJSONStorage(() => safeStorage) },
  ),
);

/** The preset actually used for analysis. */
export function resolvePreset(preset: SettingsState['preset']): PresetId {
  return preset === 'auto' ? recommendPreset() : preset;
}
