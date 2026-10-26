import { Chess } from 'chess.js';
import type { Move } from 'chess.js';
import { START_FEN, moveNumberLabel } from './notation';
import type { ParsedGame, ParsedMove, TerminalState } from './types';

export class PgnError extends Error {
  override name = 'PgnError';
}

// ---------------------------------------------------------------------------
// Tokenizer
//
// We tokenize the PGN ourselves instead of relying on chess.js `loadPgn`:
// - chess.js keys comments by FEN, so clocks get lost or misattributed when a
//   position repeats; walking the tokens keeps each comment next to its move.
// - chess.js 1.4 rejects some valid inputs, e.g. a NAG right after a comment.
// - Replaying moves one by one lets errors name the offending move ("12. Nf3").
// ---------------------------------------------------------------------------

type TokenKind = 'tag' | 'comment' | 'open' | 'close' | 'nag' | 'number' | 'result' | 'move';

interface Token {
  kind: TokenKind;
  /** Offset in the normalized text; used to cut multi-game text apart. */
  start: number;
  /** Tag value, comment body, result, SAN (number prefix and !? removed) or raw text. */
  text: string;
  /** Tag name; empty for a malformed tag line. */
  name?: string;
  /** Set on a `{` comment that never closes. */
  unterminated?: boolean;
}

const WHITESPACE_RE = /\s+/y;
const TAG_RE = /\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\\n]|\\.)*)"\s*\]/y;
// Fallback for sloppy exporters that leave quotes inside the value unescaped.
const LOOSE_TAG_RE = /\[\s*([A-Za-z0-9_]+)\s+"(.*)"\s*\][^\S\n]*(?=\n|$)/y;
const NAG_RE = /\$\d*/y;
const WORD_RE = /[^\s{}();[$]+/y;
const RESULT_RE = /^(?:1-0|0-1|1\/2-1\/2|\*)$/;
const MOVE_NUMBER_PREFIX_RE = /^\d+(?:\.+|…)/;
const ANNOTATION_SUFFIX_RE = /[!?]+$/;
const EN_PASSANT_SUFFIX_RE = /^e\.?p\.?$/i;
const NULL_MOVES = new Set(['--', 'Z0', '0000', '@@@@']);

function matchAt(re: RegExp, text: string, index: number): RegExpExecArray | null {
  re.lastIndex = index;
  return re.exec(text);
}

function lineEnd(text: string, index: number): number {
  const end = text.indexOf('\n', index);
  return end === -1 ? text.length : end;
}

function unescapeTagValue(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}

/** Strips a BOM and normalizes line endings so offsets and regexes see plain `\n`. */
function normalize(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/** Classifies a bare word of movetext: result, move number, SAN, or noise to skip. */
function wordToken(word: string, start: number): Token | null {
  if (RESULT_RE.test(word)) return { kind: 'result', start, text: word };
  let san = word.replace(MOVE_NUMBER_PREFIX_RE, '');
  if (san === '' || /^\d+$/.test(san)) return { kind: 'number', start, text: word };
  san = san.replace(ANNOTATION_SUFFIX_RE, '');
  // Leftover dots ("1 ... Nf6") and "e.p." markers carry no move.
  if (san === '' || /^\.+$/.test(san) || EN_PASSANT_SUFFIX_RE.test(san)) return null;
  return { kind: 'move', start, text: san };
}

function* tokenize(text: string): Generator<Token> {
  let i = 0;
  while (i < text.length) {
    const whitespace = matchAt(WHITESPACE_RE, text, i);
    if (whitespace) {
      i += whitespace[0].length;
      continue;
    }
    const start = i;
    const ch = text[i];
    // A `%` in the first column escapes the whole line (PGN spec 6).
    if (ch === '%' && (i === 0 || text[i - 1] === '\n')) {
      i = lineEnd(text, i);
      continue;
    }
    switch (ch) {
      case '{': {
        const close = text.indexOf('}', i + 1);
        if (close === -1) {
          yield { kind: 'comment', start, text: text.slice(i + 1), unterminated: true };
          return;
        }
        yield { kind: 'comment', start, text: text.slice(i + 1, close) };
        i = close + 1;
        continue;
      }
      case ';': {
        const end = lineEnd(text, i);
        yield { kind: 'comment', start, text: text.slice(i + 1, end) };
        i = end;
        continue;
      }
      case '(':
        yield { kind: 'open', start, text: ch };
        i += 1;
        continue;
      case ')':
        yield { kind: 'close', start, text: ch };
        i += 1;
        continue;
      case '}':
        i += 1; // stray closing brace: nothing to attach it to
        continue;
      case '$': {
        const nag = matchAt(NAG_RE, text, i);
        const length = nag ? nag[0].length : 1;
        yield { kind: 'nag', start, text: text.slice(i, i + length) };
        i += length;
        continue;
      }
      case '[': {
        const tag = matchAt(TAG_RE, text, i) ?? matchAt(LOOSE_TAG_RE, text, i);
        if (tag) {
          yield { kind: 'tag', start, name: tag[1] ?? '', text: unescapeTagValue(tag[2] ?? '') };
          i += tag[0].length;
        } else {
          const end = lineEnd(text, i);
          yield { kind: 'tag', start, name: '', text: text.slice(i, end).trim() };
          i = end;
        }
        continue;
      }
      default: {
        const word = matchAt(WORD_RE, text, i)?.[0] ?? text.slice(i, i + 1);
        i += word.length;
        const token = wordToken(word, start);
        if (token) yield token;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const CLOCK_RE = /\[%clk\s+(\d+(?::\d+){1,2}(?:\.\d+)?)\s*\]/;

/** Seconds from a `[%clk h:mm:ss(.f)]` command inside a comment, if present. */
function parseClock(comment: string): number | undefined {
  const match = CLOCK_RE.exec(comment);
  if (!match?.[1]) return undefined;
  const seconds = match[1].split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return Math.round(seconds * 1000) / 1000; // drop float noise such as 179.89999999
}

function createBoard(headers: Record<string, string>): Chess {
  const fen = headers.FEN?.trim() || START_FEN;
  try {
    return new Chess(fen);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PgnError(`Invalid FEN header "${fen}": ${reason}`);
  }
}

function playSan(board: Chess, san: string): Move {
  const label = `${moveNumberLabel(board.moveNumber(), board.turn())} ${san}`;
  if (NULL_MOVES.has(san)) throw new PgnError(`Null moves are not supported (${label})`);
  try {
    // Some exporters write castling with zeros; chess.js only understands letters.
    return board.move(san.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O'), { strict: false });
  } catch {
    throw new PgnError(`Illegal move ${label}`);
  }
}

function toParsedMove(move: Move, ply: number): ParsedMove {
  const parsed: ParsedMove = {
    ply,
    moveNumber: Number(move.before.split(' ')[5]),
    color: move.color,
    san: move.san,
    uci: move.lan,
    from: move.from,
    to: move.to,
    piece: move.piece,
    fenBefore: move.before,
    fenAfter: move.after,
    isCheck: /[+#]$/.test(move.san),
    isCheckmate: move.san.endsWith('#'),
  };
  if (move.captured) parsed.captured = move.captured;
  if (move.promotion) parsed.promotion = move.promotion;
  return parsed;
}

function finalStateOf(board: Chess): TerminalState | undefined {
  if (board.isCheckmate()) return 'checkmate';
  if (board.isStalemate()) return 'stalemate';
  if (board.isInsufficientMaterial()) return 'insufficient';
  if (board.isThreefoldRepetition()) return 'threefold';
  if (board.isDrawByFiftyMoves()) return 'fifty-move';
  return undefined;
}

/**
 * Parses a single-game PGN with chess.js.
 * - Handles headers, comments, NAGs, variations (ignored; main line only), FEN/SetUp starts.
 * - Extracts `[%clk h:mm:ss(.f)]` clock comments into ParsedMove.clock (seconds).
 * - Sets finalState when the last position is checkmate, stalemate, insufficient
 *   material, threefold repetition or the fifty-move rule.
 * - `headers` holds only the tags present in the PGN (no "?" placeholders).
 * - When the text holds several games, only the first is parsed (see splitPgnGames).
 * @throws PgnError with a readable message when the PGN cannot be parsed.
 */
export function parsePgn(pgn: string): ParsedGame {
  const text = normalize(pgn);
  if (text.trim() === '') throw new PgnError('The PGN is empty.');

  const headers: Record<string, string> = {};
  const moves: ParsedMove[] = [];
  let board: Chess | null = null;
  let depth = 0;

  for (const token of tokenize(text)) {
    if (token.kind === 'tag') {
      if (board) break; // headers of the next game
      if (!token.name) throw new PgnError(`Malformed header line: ${token.text}`);
      headers[token.name] = token.text;
      continue;
    }
    if (token.kind === 'comment' && token.unterminated) {
      throw new PgnError('A comment is missing its closing "}".');
    }
    if (token.kind === 'comment' && !board) continue; // comment before the game starts

    board ??= createBoard(headers);
    if (token.kind === 'open') {
      depth += 1;
    } else if (token.kind === 'close') {
      if (depth === 0) throw new PgnError('Unexpected ")" without a matching "(".');
      depth -= 1;
    } else if (depth > 0) {
      continue; // inside a variation: only the main line counts
    } else if (token.kind === 'result') {
      break;
    } else if (token.kind === 'move') {
      moves.push(toParsedMove(playSan(board, token.text), moves.length + 1));
    } else if (token.kind === 'comment') {
      // A comment belongs to the main-line move before it; keep the first clock found.
      const last = moves[moves.length - 1];
      if (last && last.clock === undefined) {
        const clock = parseClock(token.text);
        if (clock !== undefined) last.clock = clock;
      }
    }
  }
  if (depth > 0) throw new PgnError('A variation is missing its closing ")".');

  board ??= createBoard(headers);
  // The board now holds the final position; it is still the start when no move was played.
  const game: ParsedGame = { headers, initialFen: moves[0]?.fenBefore ?? board.fen(), moves };
  const finalState = finalStateOf(board);
  if (finalState) game.finalState = finalState;
  return game;
}

/** Splits a text containing several PGN games into individual PGN strings. */
export function splitPgnGames(text: string): string[] {
  const source = normalize(text);
  const games: string[] = [];
  let start = -1;
  let hasGameData = false; // a tag or a move: a chunk with only comments is not a game
  let inMovetext = false;
  let ended = false;
  let depth = 0;

  const flush = (end: number) => {
    if (start >= 0 && hasGameData) games.push(source.slice(start, end).trim());
    start = -1;
    hasGameData = inMovetext = ended = false;
    depth = 0;
  };

  for (const token of tokenize(source)) {
    // A new game starts with a tag after movetext, or with anything after a result
    // (trailing comments stay with the game they follow).
    const newGame = (token.kind === 'tag' && inMovetext) || (ended && token.kind !== 'comment');
    if (newGame) flush(token.start);
    if (start < 0) start = token.start;

    switch (token.kind) {
      case 'tag':
      case 'move':
        hasGameData = true;
        inMovetext ||= token.kind === 'move';
        break;
      case 'open':
        depth += 1;
        inMovetext = true;
        break;
      case 'close':
        depth = Math.max(0, depth - 1);
        inMovetext = true;
        break;
      case 'result':
        inMovetext = true;
        ended ||= depth === 0;
        break;
      case 'nag':
      case 'number':
        inMovetext = true;
        break;
      case 'comment':
        break;
    }
  }
  flush(source.length);
  return games;
}

/** Reads the PGN header tags without parsing moves (fast; used for listing pasted games). */
export function readPgnHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const token of tokenize(normalize(pgn))) {
    if (token.kind === 'comment') continue;
    if (token.kind !== 'tag') break; // movetext starts: the tokenizer stops here, lazily
    if (token.name) headers[token.name] = token.text;
  }
  return headers;
}
