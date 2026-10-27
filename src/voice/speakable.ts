/**
 * Turns chess notation into text a speech engine reads naturally:
 * "Nxe5+" → "Knight takes e5 check", "O-O" → "castling kingside", "1-0" → "White wins".
 */

const PIECE_NAMES: Record<string, string> = {
  K: 'King',
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
};

const PROMOTION_NAMES: Record<string, string> = {
  Q: 'queen',
  R: 'rook',
  B: 'bishop',
  N: 'knight',
};

/**
 * One SAN move: castling, piece moves with optional disambiguation and capture,
 * pawn moves/captures with optional promotion, then optional check/mate and
 * annotation glyphs. Anchored so it only matches whole moves inside prose.
 */
const SAN_SOURCE =
  '(?:O-O-O|O-O|0-0-0|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)[+#]?(?:[!?]{1,2})?';
const SAN_EXACT = new RegExp(`^${SAN_SOURCE}$`);
const SAN_IN_TEXT = new RegExp(`(?<![\\w-])${SAN_SOURCE}(?![\\w-])`, 'g');
/** A move number right before a move ("31. Rg8", "12... Nf6"); read without the number. */
const NUMBERED_SAN = new RegExp(
  `(?<![\\w.])\\d+\\.(?:\\.\\.|…)?\\s*(?=${SAN_SOURCE}(?![\\w-]))`,
  'g',
);
/** A move followed by another one ("Ra1+ Kg2"): read with a pause between them. */
const SAN_BEFORE_SAN = new RegExp(`(?<![\\w-])(${SAN_SOURCE}) (?=${SAN_SOURCE}(?![\\w-]))`, 'g');

/** Spoken form of one SAN move; returns the input unchanged if it is not SAN. */
export function sanToSpeech(san: string): string {
  if (!SAN_EXACT.test(san)) return san;
  let move = san.replace(/[!?]+$/, '');
  let suffix = '';
  // No comma before "check": inside a sentence ("Nf6+ forks the king") it reads as one phrase.
  if (move.endsWith('#')) {
    suffix = ' checkmate';
    move = move.slice(0, -1);
  } else if (move.endsWith('+')) {
    suffix = ' check';
    move = move.slice(0, -1);
  }

  // A gerund fits every sentence: "Castling kingside is a blunder", "Best was castling".
  if (move === 'O-O-O' || move === '0-0-0') return `castling queenside${suffix}`;
  if (move === 'O-O' || move === '0-0') return `castling kingside${suffix}`;

  let promotion = '';
  const promo = /=([QRBN])$/.exec(move);
  if (promo) {
    promotion = ` promoting to a ${PROMOTION_NAMES[promo[1]!]}`;
    move = move.slice(0, -2);
  }

  const target = move.slice(-2);
  const head = move.slice(0, -2);
  const capture = head.endsWith('x');
  const origin = capture ? head.slice(0, -1) : head;
  const verb = capture ? ' takes ' : ' ';

  const piece = PIECE_NAMES[origin[0] ?? ''];
  if (piece) {
    // Disambiguation ("Nbd7", "R1e2") is read as-is: "Knight b d7".
    const from = origin.slice(1);
    return `${piece}${from ? ` ${from}` : ''}${verb}${target}${promotion}${suffix}`;
  }
  // Pawn: "exd5" → "e takes d5", "e4" → "e4".
  return `${origin ? `${origin}${verb}` : ''}${target}${promotion}${suffix}`;
}

/** Spoken form of an evaluation as the app prints it: "+1.3", "-0.4", "M3", "#-2". */
function mateToSpeech(moves: string): string {
  const n = Number(moves);
  return `mate in ${Math.abs(n)}`;
}

/**
 * Makes explanation text speakable: replaces every SAN move with its spoken form (without
 * move numbers) and expands results, mates, percentages and signed numbers.
 */
export function textToSpeech(text: string): string {
  return (
    text
      .replace(NUMBERED_SAN, '')
      .replace(SAN_BEFORE_SAN, '$1, ')
      .replace(SAN_IN_TEXT, (san: string, offset: number, whole: string) => {
        // Said in words right after the move: "Rd8# is checkmate", "e8=Q makes a new queen".
        const after = whole.slice(offset + san.length);
        let move = san;
        if (after.startsWith(' is checkmate')) move = move.replace('#', '');
        if (/^,? (?:and )?makes? a new\b/.test(after)) move = move.replace(/=[QRBN]/, '');
        return sanToSpeech(move);
      })
      // Results: "1-0", "0-1", "1/2-1/2", "½-½".
      .replace(/(?<![\w./-])1-0(?![\w/-]|\.\d)/g, 'White wins')
      .replace(/(?<![\w./-])0-1(?![\w/-]|\.\d)/g, 'Black wins')
      .replace(/(?<![\w./-])(?:1\/2-1\/2|½-½)(?![\w/-]|\.\d)/g, 'a draw')
      // Engine mates: "M3", "#3", "#-2".
      .replace(/(?<![\w#])[-−]?M(\d+)(?!\w)/g, (_, n: string) => mateToSpeech(n))
      .replace(/(?<![\w#])#(-?\d+)(?!\w)/g, (_, n: string) => mateToSpeech(n))
      .replace(/(\d)\s?%/g, '$1 percent')
      .replace(/(^|[\s(])\+(\d+(?:\.\d+)?)/g, '$1plus $2')
      .replace(/(^|[\s(])[-−](\d+(?:\.\d+)?)/g, '$1minus $2')
      .replace(/—|–/g, ', ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/,\s*,/g, ',')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** "castling kingside is a blunder." → "Castling kingside is a blunder." */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
