/**
 * Sharing a review: links that open at a move (?ply=N), file names for exported PGN,
 * and small clipboard / download helpers.
 */
import type { GameRecord } from '@/core/types';

/**
 * The review link for `href` at `ply`: sets `?ply=N` (or removes it at the start). Links
 * from before the app used real paths keep the route after "#", so there the query belongs
 * to the part after "#".
 */
export function reviewLink(href: string, ply: number): string {
  const hashIndex = href.indexOf('#');
  const withPly = (pathAndQuery: string) => {
    const queryIndex = pathAndQuery.indexOf('?');
    const path = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
    const params = new URLSearchParams(queryIndex === -1 ? '' : pathAndQuery.slice(queryIndex));
    if (ply > 0) params.set('ply', String(Math.floor(ply)));
    else params.delete('ply');
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };
  if (hashIndex === -1) return withPly(href);
  return `${href.slice(0, hashIndex)}#${withPly(href.slice(hashIndex + 1))}`;
}

/** The ply a review link asks for (`?ply=N`), clamped to the game; 0 when absent or invalid. */
export function initialPly(search: string, totalPlies: number): number {
  const value = new URLSearchParams(search).get('ply');
  if (value === null || !/^\d+$/.test(value.trim())) return 0;
  return Math.min(totalPlies, Math.max(0, Number(value)));
}

function fileSafe(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** "Morphy-vs-Duke-Karl-2024-05-01.pgn"; the date is left out when unknown. */
export function pgnFileName(record: Pick<GameRecord, 'white' | 'black' | 'endTime'>): string {
  const white = fileSafe(record.white.name) || 'White';
  const black = fileSafe(record.black.name) || 'Black';
  const date =
    record.endTime !== undefined && Number.isFinite(record.endTime)
      ? `-${new Date(record.endTime).toISOString().slice(0, 10)}`
      : '';
  return `${white}-vs-${black}${date}.pgn`;
}

/** Copies text to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or not a secure context: try the older API below.
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

/** Saves text as a file through a temporary download link. */
export function downloadText(fileName: string, text: string, type = 'application/x-chess-pgn') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
