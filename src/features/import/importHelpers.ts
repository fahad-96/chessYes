/** Helpers for the PGN import page (pure functions, no React). */

/** Largest file we read into memory; big PGN databases belong in a desktop tool. */
export const MAX_PGN_FILE_BYTES = 10 * 1024 * 1024;

/** How many games of a multi-game PGN we list to pick from. */
export const MAX_LISTED_GAMES = 200;

/** Morphy's "Opera Game" (Paris, 1858), public domain. Used by "Try an example". */
export const OPERA_GAME_PGN = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0
`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats a PGN date tag, keeping only the parts that are known:
 * "2024.03.15" → "15 Mar 2024", "2024.03.??" → "Mar 2024", "1858.??.??" → "1858".
 */
export function formatPgnDate(date: string | undefined): string {
  if (!date) return '';
  const match = /^(\d{4}|\?{4})[.\-/](\d{2}|\?{2})[.\-/](\d{2}|\?{2})$/.exec(date.trim());
  if (!match) return '';
  const [, y, m, d] = match;
  if (!y || y.startsWith('?')) return '';
  const monthIndex = m && !m.startsWith('?') ? Number(m) - 1 : -1;
  const month = MONTHS[monthIndex];
  if (!month) return y;
  if (!d || d.startsWith('?')) return `${month} ${y}`;
  return `${Number(d)} ${month} ${y}`;
}

const RESULT_LABELS: Record<string, string> = {
  '1-0': '1-0',
  '0-1': '0-1',
  '1/2-1/2': '½-½',
};

export interface PgnSummary {
  white: string;
  black: string;
  /** "1-0", "0-1", "½-½" or "" when unknown. */
  result: string;
  date: string;
  event: string;
}

/** What we show for one game of a multi-game PGN, from its header tags. */
export function summarizePgnHeaders(headers: Record<string, string>): PgnSummary {
  const clean = (value: string | undefined) => (value && value !== '?' ? value.trim() : '');
  return {
    white: clean(headers.White) || 'White',
    black: clean(headers.Black) || 'Black',
    result: RESULT_LABELS[headers.Result ?? ''] ?? '',
    date: formatPgnDate(headers.Date ?? headers.UTCDate),
    event: clean(headers.Event),
  };
}
