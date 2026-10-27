import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD, DEFAULT_THEME, SETTINGS_VERSION, migrateSettings } from './settings';

const calibrated = { accuracyModel: 'calibrated' } as const;

describe('migrateSettings', () => {
  it('moves users still on the old defaults to classic + green', () => {
    expect(
      migrateSettings({ theme: 'system', boardTheme: 'slate', showEvalBar: false }, 1),
    ).toEqual({ theme: 'classic', boardTheme: 'green', showEvalBar: false, ...calibrated });
    expect(DEFAULT_THEME).toBe('classic');
    expect(DEFAULT_BOARD).toBe('green');
  });

  it('treats missing values from version 1 as its defaults', () => {
    expect(migrateSettings({}, 1)).toEqual({
      theme: 'classic',
      boardTheme: 'green',
      ...calibrated,
    });
    expect(migrateSettings(null, 0)).toEqual({
      theme: 'classic',
      boardTheme: 'green',
      ...calibrated,
    });
    // A board someone picked keeps the theme they had (version 1's default, system).
    expect(migrateSettings({ boardTheme: 'walnut' }, 1)).toEqual({
      theme: 'system',
      boardTheme: 'walnut',
      ...calibrated,
    });
  });

  it('keeps a theme or board someone chose', () => {
    expect(migrateSettings({ theme: 'dark', boardTheme: 'slate' }, 1)).toEqual({
      theme: 'dark',
      boardTheme: 'slate',
      ...calibrated,
    });
    expect(migrateSettings({ theme: 'system', boardTheme: 'ocean' }, 1)).toEqual({
      theme: 'system',
      boardTheme: 'ocean',
      ...calibrated,
    });
    expect(migrateSettings({ theme: 'light', boardTheme: 'walnut' }, 1)).toEqual({
      theme: 'light',
      boardTheme: 'walnut',
      ...calibrated,
    });
  });

  it('adds the calibrated accuracy scale to version 2 settings and keeps the rest', () => {
    const v2 = {
      preset: 'deep' as const,
      theme: 'system' as const,
      boardTheme: 'slate' as const,
      showBestMoveArrow: false,
      showEvalBar: true,
      showBoardBadges: false,
      recent: [{ platform: 'lichess' as const, username: 'alice' }],
    };
    expect(migrateSettings(v2, 2)).toEqual({ ...v2, ...calibrated });
  });

  it('leaves current settings alone', () => {
    const current = {
      theme: 'system' as const,
      boardTheme: 'slate' as const,
      accuracyModel: 'lichess' as const,
    };
    expect(SETTINGS_VERSION).toBe(3);
    expect(migrateSettings(current, SETTINGS_VERSION)).toBe(current);
  });
});
