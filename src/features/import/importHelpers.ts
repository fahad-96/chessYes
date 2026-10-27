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

/** Shown when the text holds no game at all. */
export const NO_GAMES_MESSAGE =
  'No games found. A PGN has moves like “1. e4 e5 2. Nf3”, usually after tags like [White "…"].';

/** What a pasted link points to, when the whole text is a link to a single game. */
export type GameLink = { site: 'lichess'; gameId: string } | { site: 'chesscom' };

// lichess.org/<8-char id>, optionally with the 4-char player suffix, /white or /black, #ply.
const LICHESS_GAME_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?lichess\.org\/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(?:white|black))?\/?(?:[?#]\S*)?$/i;
// Lichess pages whose path also has 8 letters.
const LICHESS_PAGES = new Set([
  'analysis',
  'features',
  'insights',
  'practice',
  'settings',
  'training',
]);
const CHESSCOM_GAME_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?chess\.com\/(?:(?:analysis\/)?game\/(?:live|daily)|live\/game|daily\/game|game)\/\d+/i;

/** Recognises a pasted game link (instead of a PGN). */
export function parseGameLink(text: string): GameLink | null {
  const input = text.trim();
  const lichess = LICHESS_GAME_URL_RE.exec(input);
  const gameId = lichess?.[1];
  if (gameId && !LICHESS_PAGES.has(gameId.toLowerCase())) return { site: 'lichess', gameId };
  return CHESSCOM_GAME_URL_RE.test(input) ? { site: 'chesscom' } : null;
}

export const CHESSCOM_LINK_MESSAGE =
  'That is a Chess.com game link. Chess Yes cannot open those directly: search for the player on ' +
  'the home page and pick the game from their list, or copy the PGN on Chess.com ' +
  '(Share → PGN) and paste it here.';

const FEN_RE = /^[pnbrqkPNBRQK1-8]+(?:\/[pnbrqkPNBRQK1-8]+){7}(?:\s|$)/;
const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;

/**
 * A clearer message than "Illegal move 1. …" for text that is not a PGN at all: a FEN,
 * a link, or text without tags or move numbers that fails on its very first word.
 * Returns null when the text looks like a PGN, so the parser's own message stays.
 */
export function notPgnMessage(text: string, parseError: string): string | null {
  const input = text.trim();
  if (FEN_RE.test(input)) {
    return (
      'That looks like a FEN, which describes a single position. ' +
      'Chess Yes reviews whole games: paste the PGN of the game, with its moves.'
    );
  }
  if (URL_RE.test(input)) {
    return (
      'That is a link, not a PGN. Chess Yes opens Lichess game links directly; for other sites, ' +
      'copy the game’s PGN (usually under Share or Download) and paste it here.'
    );
  }
  const failsOnFirstMove = /^Illegal move 1\.{1,3} /.test(parseError);
  const looksLikePgn = /^\s*\[/m.test(input) || /\b\d+\.\s*\S/.test(input);
  return failsOnFirstMove && !looksLikePgn ? NO_GAMES_MESSAGE : null;
}
