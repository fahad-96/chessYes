import type { AnalysisSettings } from '@/core/types';

export type PresetId = 'fast' | 'standard' | 'deep';

export interface Preset extends AnalysisSettings {
  id: PresetId;
  label: string;
  description: string;
}

/**
 * Analysis presets. Depth gives consistent results; maxTimeMs caps each position
 * so a slow phone finishes in reasonable time (the reached depth is recorded).
 * MultiPV 2 is needed to detect "Great" moves.
 */
export const PRESETS: Record<PresetId, Preset> = {
  fast: {
    id: 'fast',
    label: 'Fast',
    description: 'Depth 12. Good for phones and quick looks.',
    depth: 12,
    multiPv: 2,
    maxTimeMs: 1500,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    description: 'Depth 16. The best balance for most devices.',
    depth: 16,
    multiPv: 2,
    maxTimeMs: 4000,
  },
  deep: {
    id: 'deep',
    label: 'Deep',
    description: 'Depth 20. Most accurate, slowest.',
    depth: 20,
    multiPv: 2,
    maxTimeMs: 12000,
  },
};

/**
 * Picks a preset for this device: 'fast' on phones/tablets or low-end hardware
 * (hardwareConcurrency <= 4 or deviceMemory <= 4), otherwise 'standard'.
 * Safe to call outside a browser (returns 'standard').
 */
export function recommendPreset(): PresetId {
  if (typeof navigator === 'undefined' || !navigator) return 'standard';
  // Not in every browser's typings yet (Chromium-only APIs).
  const nav = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
    deviceMemory?: number;
  };

  // Android tablets report userAgentData.mobile = false, so the user agent is checked too.
  const mobile =
    nav.userAgentData?.mobile === true || /Mobi|Android|iPhone|iPad/.test(nav.userAgent ?? '');
  if (mobile) return 'fast';

  const cores = nav.hardwareConcurrency;
  const memoryGb = nav.deviceMemory;
  if ((cores !== undefined && cores <= 4) || (memoryGb !== undefined && memoryGb <= 4)) {
    return 'fast';
  }
  return 'standard';
}
