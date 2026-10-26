import { START_FEN } from './notation';
import type {
  Classification,
  Color,
  GameRecord,
  GameReview,
  MoveReview,
  ParsedGame,
  ParsedMove,
  Score,
} from './types';

/**
 * Exports a reviewed game as PGN that other chess tools understand: the original headers,
 * NAGs for the labels, `[%eval]` and `[%clk]` comments (the format Lichess and most GUIs
 * read), a short note on every inaccuracy or worse with the engine's better line as a
 * variation, and the story behind errors and brilliant or great moves.
 */

/** Standard NAGs: $1 good (!), $2 poor (?), $3 brilliant (!!), $4 blunder (??), $6 dubious (?!). */
const NAGS: Partial<Record<Classification, string>> = {
  brilliant: '$3',
  great: '$1',
  inaccuracy: '$6',
  mistake: '$2',
  blunder: '$4',
};

/** Labels that get a written note ("Mistake. Best was Nf3."). */
const ERROR_LABELS: Partial<Record<Classification, string>> = {
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  missedWin: 'Missed win',
};

/** Labels whose story (MoveReview.why) is written next to the move. */
const STORY_LABELS: ReadonlySet<Classification> = new Set([
  'brilliant',
  'great',
  'inaccuracy',
  'mistake',
  'blunder',
  'missedWin',
]);

/** The tags every PGN starts with, in this order (PGN spec 8.1.1). */
const SEVEN_TAG_ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'] as const;

/** Export format recommends lines of at most 80 characters. */
const LINE_WIDTH = 80;

/** Moves of the engine's better line written as a variation when it has no story. */
const VARIATION_PLIES = 6;

const RESULT_RE = /^(?:1-0|0-1|1\/2-1\/2|\*)$/;

/** `[%eval]` value: pawns with two decimals ("0.17", "-1.50") or "#3" / "#-2" for mates. */
export function formatPgnEval(score: Score): string {
  if (score.type === 'mate') return `#${score.value}`;
  // (-0).toFixed(2) is "0.00", so a draw never prints as "-0.00".
  return (score.value / 100).toFixed(2);
}

/** `[%clk]` value: "h:mm:ss", with tenths when the clock has them ("0:02:59.9"). */
export function formatPgnClock(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const hours = Math.floor(tenths / 36_000);
  const minutes = Math.floor((tenths % 36_000) / 600);
  const secs = Math.floor((tenths % 600) / 10);
  const fraction = tenths % 10;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(secs)}${fraction ? `.${fraction}` : ''}`;
}

function escapeTagValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\\"]/g, (ch) => `\\${ch}`);
}

/**
 * A comment as tokens for line wrapping: "{", its words, "}". Comments end at the first
 * "}", so braces inside the text are dropped; `[%eval ...]` commands stay on one line.
 */
function comment(text: string): string[] {
  const words = text.replace(/[{}]/g, '').match(/\[%[^\]]*\]|\S+/g) ?? [];
  return ['{', ...words, '}'];
}

function headerLines(game: ParsedGame, record: GameRecord): string[] {
  const fallback: Record<(typeof SEVEN_TAG_ROSTER)[number], string> = {
    Event: '?',
    Site: record.url ?? '?',
    Date: '????.??.??',
    Round: '?',
    White: record.white.name || '?',
    Black: record.black.name || '?',
    Result: record.result,
  };
  const headers: Record<string, string> = { ...game.headers };
  if (game.initialFen !== START_FEN && !headers.FEN) {
    headers.SetUp = '1';
    headers.FEN = game.initialFen;
  }
  const ordered: [string, string][] = SEVEN_TAG_ROSTER.map((name) => [
    name,
    headers[name] ?? fallback[name],
  ]);
  for (const [name, value] of Object.entries(headers)) {
    if (!(SEVEN_TAG_ROSTER as readonly string[]).includes(name)) ordered.push([name, value]);
  }
  return ordered.map(([name, value]) => `[${name} "${escapeTagValue(value)}"]`);
}

function moveComment(
  move: ParsedMove,
  moveReview: MoveReview | undefined,
  opening: GameReview['opening'],
): string | null {
  const parts: string[] = [];
  if (moveReview?.evalAfter) parts.push(`[%eval ${formatPgnEval(moveReview.evalAfter)}]`);
  if (move.clock !== undefined) parts.push(`[%clk ${formatPgnClock(move.clock)}]`);
  const label = moveReview ? ERROR_LABELS[moveReview.classification] : undefined;
  if (moveReview && label) {
    const best = moveReview.best;
    parts.push(
      best && best.uci !== moveReview.uci ? `${label}. Best was ${best.san}.` : `${label}.`,
    );
  }
  const story = moveReview?.why?.text.trim();
  if (moveReview && story && STORY_LABELS.has(moveReview.classification)) parts.push(story);
  if (opening && opening.lastBookPly === move.ply) {
    parts.push([opening.eco, opening.name].filter(Boolean).join(' '));
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Numbers a SAN line that starts with `color`'s move `moveNumber`: "31. Rxg7 a3 32. Rxh6". */
function numberedLine(sans: readonly string[], moveNumber: number, color: Color): string[] {
  let number = moveNumber;
  let side = color;
  return sans.map((san, index) => {
    const token = side === 'w' ? `${number}. ${san}` : index === 0 ? `${number}... ${san}` : san;
    if (side === 'b') number++;
    side = side === 'w' ? 'b' : 'w';
    return token;
  });
}

/**
 * The engine's better move as a variation after an error, e.g.
 * "(31. Rxg7 a3 32. Rxh6 { You missed Rxg7, which wins the pawn on g7. })". The moves are
 * the story's when there is one (it stops once the point is made), else the engine line.
 */
function bestVariation(move: ParsedMove, moveReview: MoveReview | undefined): string[] {
  if (!moveReview || !ERROR_LABELS[moveReview.classification]) return [];
  const { best, bestIdea } = moveReview;
  if (!best || best.uci === moveReview.uci) return [];
  const fromStory = !!bestIdea && bestIdea.movesSan[0] === best.san;
  const sans = fromStory ? bestIdea.movesSan : best.pvSan.slice(0, VARIATION_PLIES);
  if (sans.length === 0) return [];
  const story = fromStory ? bestIdea.text.trim() : '';
  const tokens = [
    ...numberedLine(sans, move.moveNumber, move.color),
    ...(story ? comment(story) : []),
  ];
  tokens[0] = `(${tokens[0]}`;
  tokens[tokens.length - 1] = `${tokens[tokens.length - 1]})`;
  return tokens;
}

/** Joins tokens into lines of at most LINE_WIDTH characters (a longer token gets its own line). */
function wrap(tokens: readonly string[]): string {
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > LINE_WIDTH) {
      lines.push(line);
      line = token;
    } else {
      line = line ? `${line} ${token}` : token;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/**
 * The game as annotated PGN. Moves without a review (analysis still running) are written
 * without annotations. `parsePgn` reads the result back to the same moves and clocks (it
 * skips the variations).
 */
export function annotatedPgn(game: ParsedGame, record: GameRecord, review: GameReview): string {
  const tokens: string[] = comment(
    `Reviewed with ${review.engine.name} (depth ${review.engine.depth})`,
  );
  // Black's move needs its own number at the start and after a comment or a variation.
  let numberBlack = true;
  for (const move of game.moves) {
    const moveReview = review.moves[move.ply - 1];
    // Number, SAN and NAG stay together so a line never ends between them.
    const parts: string[] = [];
    if (move.color === 'w') parts.push(`${move.moveNumber}.`);
    else if (numberBlack) parts.push(`${move.moveNumber}...`);
    parts.push(move.san);
    const nag = moveReview ? NAGS[moveReview.classification] : undefined;
    if (nag) parts.push(nag);
    tokens.push(parts.join(' '));
    const text = moveComment(move, moveReview, review.opening);
    if (text) tokens.push(...comment(text));
    const variation = bestVariation(move, moveReview);
    tokens.push(...variation);
    numberBlack = text !== null || variation.length > 0;
  }
  const result = game.headers.Result ?? '';
  tokens.push(RESULT_RE.test(result) ? result : record.result);
  return `${headerLines(game, record).join('\n')}\n\n${wrap(tokens)}\n`;
}
