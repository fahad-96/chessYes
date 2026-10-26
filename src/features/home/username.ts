import type { Platform } from '@/state/settings';

export const PLATFORM_LABELS: Record<Platform, string> = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
};

/** Username rules of each site (allowed characters and length). */
const USERNAME_RULES: Record<Platform, { min: number; max: number }> = {
  chesscom: { min: 3, max: 25 },
  lichess: { min: 2, max: 30 },
};

const USERNAME_CHARS = /^[A-Za-z0-9_-]+$/;

export function isPlatform(value: string | undefined): value is Platform {
  return value === 'chesscom' || value === 'lichess';
}

/**
 * Checks a username against the site's rules.
 * @returns a readable error message, or null when the username is valid.
 */
export function validateUsername(platform: Platform, username: string): string | null {
  const name = username.trim();
  const site = PLATFORM_LABELS[platform];
  const { min, max } = USERNAME_RULES[platform];
  if (!name) return `Enter a ${site} username.`;
  if (!USERNAME_CHARS.test(name)) {
    return `${site} usernames only contain letters, numbers, "_" and "-".`;
  }
  if (name.length < min || name.length > max) {
    return `${site} usernames are ${min} to ${max} characters long.`;
  }
  return null;
}

/**
 * Accepts what people actually paste: a bare username, "@name", or a profile URL
 * (chess.com/member/<name>, lichess.org/@/<name>). A URL also tells us the platform.
 */
export function parseUsernameInput(raw: string): { username: string; platform?: Platform } {
  const input = raw.trim();
  const url = /^(?:https?:\/\/)?(?:www\.|m\.)?(chess\.com|lichess\.org)\/(.+)$/i.exec(input);
  if (url) {
    const host = url[1]!.toLowerCase();
    const segments = url[2]!.split(/[/?#]/).filter(Boolean);
    if (host === 'chess.com') {
      // chess.com/member/<name>, chess.com/stats/live/rapid/<name> etc.: the name comes last.
      const memberIndex = segments.findIndex((s) => /^(member|players?)$/i.test(s));
      const name = memberIndex >= 0 ? segments[memberIndex + 1] : segments[segments.length - 1];
      if (name) return { username: decodeSafe(name), platform: 'chesscom' };
    } else {
      // lichess.org/@/<name>
      const atIndex = segments.indexOf('@');
      const name = atIndex >= 0 ? segments[atIndex + 1] : undefined;
      if (name) return { username: decodeSafe(name), platform: 'lichess' };
    }
  }
  return { username: input.replace(/^@/, '') };
}

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Route of a player's game list. */
export function playerPath(platform: Platform, username: string): string {
  return `/player/${platform}/${encodeURIComponent(username.trim())}`;
}
