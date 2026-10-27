/**
 * The voice pack's vocabulary: the closed set of clips the coach can say, each rendered once
 * by the speech model and stitched together in the browser (see coachScript.ts).
 *
 * Every clip is a natural phrase on its own: a move with its check or mate built in ("Knight
 * to f3, check!"), a verdict ("That's a blunder."), a reason ("forking the king and queen"),
 * so stitching never glues single function words together. All wording is neutral third
 * person (no "you"), so the same clip is right for either player.
 *
 * Keys are stable ASCII ids, in four namespaces:
 * - `move:` + SAN without disambiguation or annotations ("move:Nf3", "move:Nxe5+",
 *   "move:exd5#", "move:O-O+"). A promotion is the pawn move followed by a promotion phrase.
 * - `sq:` + square, for pawn pushes ("sq:e4", "sq:e4+", "sq:e4#").
 * - `phrase:` + snake_case id, for everything else.
 * - `num:` + 0..100, for the accuracies of the game summary.
 *
 * This file has no runtime imports, so scripts/voice-clips.mjs can load it with Node's type
 * stripping and write the clip list the voice pack is rendered from.
 */
import type { Classification } from '@/core/types';

/** Bump when a clip's key or text changes: the voice pack must then be rendered again. */
export const VOCABULARY_VERSION = 1;
/** The Kokoro-82M voice the pack is rendered with. */
export const VOICE = 'af_bella';

/**
 * How a clip joins its neighbours, for captions and pauses:
 * - move: a move ("Knight to f3", "e4", "Castles kingside, check!");
 * - promotion: "promoting to a queen", right after a pawn move;
 * - sentence: a whole sentence ("That's a blunder.");
 * - lead: the start of a sentence that a move or a number completes ("Best was", "After");
 * - tail: a clause that follows a move ("winning the rook for free");
 * - predicate: the end of a sentence whose subject is the move before it ("was better.").
 */
export type ClipKind = 'move' | 'promotion' | 'sentence' | 'lead' | 'tail' | 'predicate';

export interface Clip {
  key: string;
  /** Exactly what the speech model says. */
  text: string;
  /** The same words for captions and for the device voice (differs only in spelling). */
  caption: string;
  kind: ClipKind;
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export type PieceLetter = 'K' | 'Q' | 'R' | 'B' | 'N';
/** Piece types in the order the coach lists them: most valuable first, the king on top. */
export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

const PIECE_LETTERS: readonly PieceLetter[] = ['K', 'Q', 'R', 'B', 'N'];
const PIECE_WORDS: Record<PieceLetter, string> = {
  K: 'King',
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
};
export const PIECE_NAMES: Record<PieceType, string> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};
const FILES = 'abcdefgh';
const SQUARES: readonly string[] = [...FILES].flatMap((file) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => `${file}${rank}`),
);

export type Suffix = '' | '+' | '#';
const SUFFIXES: readonly Suffix[] = ['', '+', '#'];
/** Moves to the first or last rank: a pawn there promotes, and the promotion takes the check. */
const NO_SUFFIX: readonly Suffix[] = [''];
const SUFFIX_WORDS: Record<Suffix, string> = { '': '', '+': ', check!', '#': ', checkmate!' };

/**
 * A pawn's file as the model should say it before "takes". eSpeak reads a lone "a" as the
 * article ("uh takes b6"); "Eh" comes out as the letter. The caption keeps the "a".
 */
function spokenFile(file: string): string {
  return file === 'a' ? 'Eh' : file;
}

type Promotion = 'Q' | 'R' | 'B' | 'N';
const PROMOTIONS: readonly Promotion[] = ['Q', 'R', 'B', 'N'];
const SUFFIX_IDS: Record<Suffix, string> = { '': '', '+': '_check', '#': '_mate' };

/** The phrase that follows a promoting pawn move: "promoting to a queen, check!". */
export function promotionKey(piece: Promotion, suffix: Suffix): string {
  return `phrase:promote_${piece.toLowerCase()}${SUFFIX_IDS[suffix]}`;
}

/**
 * Castling named inside a sentence ("Best was castling kingside.", "Castling queenside was
 * better."), where the announcement "Castles kingside" would not be grammatical.
 */
export function castlingKey(side: 'O-O' | 'O-O-O', suffix: Suffix): string {
  return `phrase:castling_${side === 'O-O' ? 'kingside' : 'queenside'}${SUFFIX_IDS[suffix]}`;
}

const SAN_CASTLE = /^(O-O-O|O-O|0-0-0|0-0)([+#])?$/;
const SAN_PIECE = /^([KQRBN])[a-h]?[1-8]?(x?)([a-h][1-8])([+#])?$/;
const SAN_PAWN = /^(?:([a-h])x)?([a-h][1-8])(?:=?([QRBN]))?([+#])?$/;

/**
 * The clips that say a SAN move, in order: one, or two for a promotion (the pawn move, then
 * "promoting to a queen" with the check or mate). Disambiguation ("Nbd7", "R1e2") and
 * annotations ("!?") are dropped. Returns [] for text that is not a SAN move.
 */
export function sanClipKeys(san: string): string[] {
  const move = san.trim().replace(/[!?]+$/, '');
  const castle = SAN_CASTLE.exec(move);
  if (castle) {
    const side = castle[1]!.replace(/0/g, 'O');
    return [`move:${side}${castle[2] ?? ''}`];
  }
  const piece = SAN_PIECE.exec(move);
  if (piece) return [`move:${piece[1]}${piece[2]}${piece[3]}${piece[4] ?? ''}`];
  const pawn = SAN_PAWN.exec(move);
  if (!pawn) return [];
  const [, from, to, promoted, check] = pawn;
  const suffix = (check ?? '') as Suffix;
  const base = from ? `move:${from}x${to}` : `sq:${to}`;
  if (promoted) return [base, promotionKey(promoted as Promotion, suffix)];
  return [`${base}${suffix}`];
}

function moveClips(): Clip[] {
  const clips: Clip[] = [];
  const add = (key: string, text: string, caption = text, kind: ClipKind = 'move') =>
    clips.push({ key, text, caption, kind });

  for (const letter of PIECE_LETTERS) {
    for (const square of SQUARES) {
      for (const capture of [false, true]) {
        for (const suffix of SUFFIXES) {
          const verb = capture ? 'takes' : 'to';
          add(
            `move:${letter}${capture ? 'x' : ''}${square}${suffix}`,
            `${PIECE_WORDS[letter]} ${verb} ${square}${SUFFIX_WORDS[suffix]}`,
          );
        }
      }
    }
  }

  // Pawn captures, from a neighbouring file. One that lands on the first or last rank is a
  // promotion: its check or mate goes with the promotion phrase.
  for (const [i, file] of [...FILES].entries()) {
    for (const target of [FILES[i - 1], FILES[i + 1]]) {
      if (!target) continue;
      for (let rank = 1; rank <= 8; rank++) {
        const lastRank = rank === 1 || rank === 8;
        for (const suffix of lastRank ? NO_SUFFIX : SUFFIXES) {
          const square = `${target}${rank}`;
          const words = `takes ${square}${SUFFIX_WORDS[suffix]}`;
          add(
            `move:${file}x${square}${suffix}`,
            `${spokenFile(file)} ${words}`,
            `${file} ${words}`,
          );
        }
      }
    }
  }

  for (const [san, side] of [
    ['O-O', 'kingside'],
    ['O-O-O', 'queenside'],
  ] as const) {
    for (const suffix of SUFFIXES) {
      add(`move:${san}${suffix}`, `Castles ${side}${SUFFIX_WORDS[suffix]}`);
      add(castlingKey(san, suffix), `Castling ${side}${SUFFIX_WORDS[suffix]}`);
    }
  }

  for (const piece of PROMOTIONS) {
    const name = PIECE_NAMES[piece.toLowerCase() as PieceType];
    for (const suffix of SUFFIXES) {
      add(
        promotionKey(piece, suffix),
        `promoting to a ${name}${SUFFIX_WORDS[suffix]}`,
        undefined,
        'promotion',
      );
    }
  }
  return clips;
}

/** Pawn pushes: the square alone ("e4"), with check or mate except on the last ranks. */
function squareClips(): Clip[] {
  const clips: Clip[] = [];
  for (const square of SQUARES) {
    const lastRank = square.endsWith('1') || square.endsWith('8');
    for (const suffix of lastRank ? NO_SUFFIX : SUFFIXES) {
      const text = `${square}${SUFFIX_WORDS[suffix]}`;
      clips.push({ key: `sq:${square}${suffix}`, text, caption: text, kind: 'move' });
    }
  }
  return clips;
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/** Two or three ways to say each label; the coach picks one per move (coachScript.ts). */
const VERDICTS: Record<Classification, readonly string[]> = {
  brilliant: ['Brilliant!', 'What a brilliant move!', 'A brilliant move!'],
  great: ['Great move!', 'Great find!', 'A great move!'],
  best: ['The best move.', "That's the best move.", 'Best move.'],
  excellent: ['An excellent move.', 'Excellent move.', 'Excellent!'],
  good: ['A good move.', 'Good move.', "That's a good move."],
  book: ['A book move.', 'Book move.', 'Still in the opening book.'],
  forced: ['The only legal move.', "It's the only legal move.", 'Forced.'],
  inaccuracy: ["That's an inaccuracy.", 'An inaccuracy.', 'A slight inaccuracy.'],
  mistake: ["That's a mistake.", 'A mistake.', "Hmm, that's a mistake."],
  blunder: ["That's a blunder.", "Oh no, that's a blunder.", 'A blunder!'],
  missedWin: ["That's a miss.", 'A chance missed.', 'That misses a chance.'],
};

const VERDICT_IDS: Record<Classification, string> = {
  brilliant: 'brilliant',
  great: 'great',
  best: 'best',
  excellent: 'excellent',
  good: 'good',
  book: 'book',
  forced: 'forced',
  inaccuracy: 'inaccuracy',
  mistake: 'mistake',
  blunder: 'blunder',
  missedWin: 'miss',
};

/** Every way to say a label, as clip keys. */
export function verdictKeys(classification: Classification): string[] {
  return VERDICTS[classification].map(
    (_, i) => `phrase:verdict_${VERDICT_IDS[classification]}_${i + 1}`,
  );
}

function verdictClips(): Clip[] {
  return (Object.keys(VERDICTS) as Classification[]).flatMap((classification) => {
    const keys = verdictKeys(classification);
    return VERDICTS[classification].map((text, i) => sentence(keys[i]!, text));
  });
}

// ---------------------------------------------------------------------------
// Tactics
// ---------------------------------------------------------------------------

const ORDER: readonly PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];
const COUNT_WORDS = ['no', 'one', 'two', 'three'];

/** Piece types in listing order: king, queen, rook, bishop, knight, pawn. */
export function byValue(types: readonly PieceType[]): PieceType[] {
  return [...types].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

/**
 * "the king and queen", "both rooks", "the queen and both rooks", "both rooks and the bishop",
 * "the king, queen and rook".
 */
function pieceList(types: readonly PieceType[]): string {
  const sorted = byValue(types);
  const groups = [...new Set(sorted)].map((type) => {
    const count = sorted.filter((other) => other === type).length;
    const name = PIECE_NAMES[type];
    return count === 1 ? `the ${name}` : `${count === 2 ? 'both' : COUNT_WORDS[count]} ${name}s`;
  });
  const joined =
    groups.length === 1 ? groups[0]! : `${groups.slice(0, -1).join(', ')} and ${groups.at(-1)}`;
  // "the king, the queen and the rook" reads as "the king, queen and rook".
  return joined.replace(/(?<=\bthe \w+(?:, | and ))the /g, '');
}

/** A fork of these pieces (2 or 3 of them, any order), e.g. "phrase:fork_kq". */
export function forkKey(types: readonly PieceType[]): string {
  return `phrase:fork_${byValue(types).join('')}`;
}
/** A pin of `pinned` to `behind`, e.g. "phrase:pin_n_q" (the knight to the queen). */
export function pinKey(pinned: PieceType, behind: PieceType): string {
  return `phrase:pin_${pinned}_${behind}`;
}
/** A skewer through `front` to `behind`, e.g. "phrase:skewer_k_r". */
export function skewerKey(front: PieceType, behind: PieceType): string {
  return `phrase:skewer_${front}_${behind}`;
}
/** A discovered attack on `target`, e.g. "phrase:discovered_attack_q". */
export function discoveredAttackKey(target: PieceType): string {
  return `phrase:discovered_attack_${target}`;
}

/** Generic wording for a motif whose pieces are not known. */
export const MOTIF_FALLBACK_KEYS = {
  fork: 'phrase:motif_fork',
  pin: 'phrase:motif_pin',
  skewer: 'phrase:motif_skewer',
  'discovered-attack': 'phrase:motif_discovered_attack',
} as const;

/**
 * Forked pieces (tactics.ts): two or three pieces, pawns not counted, the king and the queen
 * at most once, any other piece at most twice.
 */
function forkSets(): PieceType[][] {
  const pieces: PieceType[] = ['k', 'q', 'r', 'b', 'n'];
  const sets: PieceType[][] = [];
  const grow = (set: PieceType[], from: number) => {
    if (set.length >= 2) sets.push(set);
    if (set.length === 3) return;
    for (let i = from; i < pieces.length; i++) {
      const type = pieces[i]!;
      const limit = type === 'k' || type === 'q' ? 1 : 2;
      if (set.filter((other) => other === type).length < limit) grow([...set, type], i);
    }
  };
  grow([], 0);
  return sets;
}

function tacticClips(): Clip[] {
  const clips: Clip[] = [];
  const add = (key: string, text: string) => clips.push(tail(key, text));
  for (const set of forkSets()) add(forkKey(set), `forking ${pieceList(set)}`);

  // Pins and skewers as tactics.ts finds them: a rook, bishop or knight pinned to the king or
  // to a more valuable piece (a queen can always take the pinner); a skewer through the king
  // or through a piece worth more than the one behind it.
  const values: Record<PieceType, number> = { k: 100, q: 9, r: 5, b: 3, n: 3, p: 1 };
  const targets: PieceType[] = ['q', 'r', 'b', 'n'];
  for (const pinned of ['r', 'b', 'n'] as PieceType[]) {
    for (const behind of ['k', ...targets] as PieceType[]) {
      if (values[behind] <= values[pinned]) continue;
      add(
        pinKey(pinned, behind),
        `pinning the ${PIECE_NAMES[pinned]} to the ${PIECE_NAMES[behind]}`,
      );
    }
  }
  for (const front of ['k', ...targets] as PieceType[]) {
    for (const behind of targets) {
      if (values[front] <= values[behind]) continue;
      add(
        skewerKey(front, behind),
        `skewering the ${PIECE_NAMES[front]} and ${PIECE_NAMES[behind]}`,
      );
    }
  }
  for (const target of [...targets, 'p'] as PieceType[]) {
    add(discoveredAttackKey(target), `uncovering an attack on the ${PIECE_NAMES[target]}`);
  }
  add('phrase:discovered_check', 'giving a discovered check');
  add('phrase:double_check', 'giving a double check');
  add(MOTIF_FALLBACK_KEYS.fork, 'with a fork');
  add(MOTIF_FALLBACK_KEYS.pin, 'with a pin');
  add(MOTIF_FALLBACK_KEYS.skewer, 'with a skewer');
  add(MOTIF_FALLBACK_KEYS['discovered-attack'], 'with a discovered attack');

  for (const type of ['q', 'r', 'b', 'n', 'p'] as PieceType[]) {
    const piece = type === 'p' ? 'a pawn' : `the ${PIECE_NAMES[type]}`;
    add(freeKey('tail', type), `winning ${piece} for free`);
    clips.push(sentence(freeKey('sentence', type), `It wins ${piece} for free.`));
  }

  for (const type of ['q', 'r', 'b', 'n', 'exchange'] as const) {
    const name = type === 'exchange' ? 'An exchange' : `A ${PIECE_NAMES[type]}`;
    clips.push(sentence(sacrificeKey(type), `${name} sacrifice!`));
  }
  return clips;
}

/** "winning the rook for free" after a move, or "It wins the rook for free." on its own. */
export function freeKey(form: 'tail' | 'sentence', type: PieceType): string {
  return form === 'tail' ? `phrase:winning_free_${type}` : `phrase:it_wins_free_${type}`;
}

/** "A queen sacrifice!", "An exchange sacrifice!". */
export function sacrificeKey(type: 'q' | 'r' | 'b' | 'n' | 'exchange'): string {
  return `phrase:sacrifice_${type}`;
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

/** What changes hands, in the words of every material clip. */
export const MATERIAL_NOUNS = {
  queen: 'the queen',
  rook: 'the rook',
  bishop: 'the bishop',
  knight: 'the knight',
  piece: 'a piece',
  exchange: 'the exchange',
  pawn: 'a pawn',
  two_pawns: 'two pawns',
  three_pawns: 'three pawns',
  queen_pawn: 'the queen and a pawn',
  rook_pawn: 'the rook and a pawn',
  bishop_pawn: 'the bishop and a pawn',
  knight_pawn: 'the knight and a pawn',
  exchange_pawn: 'the exchange and a pawn',
  queen_two_pawns: 'the queen and two pawns',
  rook_two_pawns: 'the rook and two pawns',
  bishop_two_pawns: 'the bishop and two pawns',
  knight_two_pawns: 'the knight and two pawns',
  exchange_two_pawns: 'the exchange and two pawns',
  two_pieces: 'two pieces',
  two_rooks: 'two rooks',
  queen_rook: 'the queen and a rook',
  queen_piece: 'the queen and a piece',
  rook_piece: 'a rook and a piece',
  queen_for_rook: 'the queen for a rook',
  queen_for_piece: 'the queen for a piece',
  queen_for_two_pieces: 'the queen for two pieces',
  queen_for_rook_piece: 'the queen for a rook and a piece',
  two_rooks_for_queen: 'two rooks for the queen',
  rook_for_pawn: 'a rook for a pawn',
  rook_for_two_pawns: 'a rook for two pawns',
  piece_for_pawn: 'a piece for a pawn',
  piece_for_two_pawns: 'a piece for two pawns',
  two_pieces_for_rook: 'two pieces for a rook',
  material: 'material',
  lot_of_material: 'a lot of material',
} as const;

export type MaterialNoun = keyof typeof MATERIAL_NOUNS;

/**
 * How material is told: "winning a pawn" after a move, "It wins a pawn." for the move just
 * named, "This loses a pawn." for the move under review.
 */
export type MaterialFrame = 'winning' | 'it-wins' | 'loses';

export function materialKey(frame: MaterialFrame, noun: MaterialNoun): string {
  const prefix = { winning: 'winning', 'it-wins': 'it_wins', loses: 'this_loses' }[frame];
  return `phrase:${prefix}_${noun}`;
}

function materialClips(): Clip[] {
  return (Object.keys(MATERIAL_NOUNS) as MaterialNoun[]).flatMap((noun) => {
    const words = MATERIAL_NOUNS[noun];
    return [
      tail(materialKey('winning', noun), `winning ${words}`),
      sentence(materialKey('it-wins', noun), `It wins ${words}.`),
      sentence(materialKey('loses', noun), `This loses ${words}.`),
    ];
  });
}

// ---------------------------------------------------------------------------
// Mates
// ---------------------------------------------------------------------------

/** Longest mate said with its number; longer ones use the generic wording. */
export const MAX_SPOKEN_MATE = 15;

export type MateFrame = 'allows' | 'missed' | 'forces';

/**
 * - allows: "This allows mate in one." (then the mating move), or "This allows mate in
 *   three, starting with" (then the first move);
 * - missed: "There was mate in one." / "There was mate in three, starting with";
 * - forces: "This forces mate in three." (n >= 2).
 * Mates longer than MAX_SPOKEN_MATE (or of unknown length) use the generic clip.
 */
export function mateKey(frame: MateFrame, moves: number | null): string {
  const n = moves !== null && moves >= 1 && moves <= MAX_SPOKEN_MATE ? moves : null;
  if (frame === 'forces')
    return n !== null && n >= 2 ? `phrase:forces_mate_${n}` : 'phrase:forces_mate';
  return n === null ? `phrase:${frame}_mate` : `phrase:${frame}_mate_${n}`;
}

function mateClips(): Clip[] {
  const clips: Clip[] = [];
  for (let n = 1; n <= MAX_SPOKEN_MATE; n++) {
    const words = `mate in ${numberWords(n)}`;
    if (n === 1) {
      clips.push(sentence(mateKey('allows', 1), `This allows ${words}.`));
      clips.push(sentence(mateKey('missed', 1), `There was ${words}.`));
    } else {
      clips.push(lead(mateKey('allows', n), `This allows ${words}, starting with`));
      clips.push(lead(mateKey('missed', n), `There was ${words}, starting with`));
      clips.push(sentence(mateKey('forces', n), `This forces ${words}.`));
    }
  }
  clips.push(lead(mateKey('allows', null), 'This allows a forced mate, starting with'));
  clips.push(lead(mateKey('missed', null), 'There was a forced mate, starting with'));
  clips.push(sentence(mateKey('forces', null), 'This forces mate.'));
  clips.push(sentence(PHRASES.allowsForcedMate, 'This allows a forced mate.'));
  clips.push(lead(PHRASES.fasterMate, 'There was a faster mate, starting with'));
  clips.push(sentence(PHRASES.speedsUpMate, 'This only speeds up the mate.'));
  return clips;
}

// ---------------------------------------------------------------------------
// Other phrases
// ---------------------------------------------------------------------------

export const PHRASES = {
  after: 'phrase:after',
  fewMovesLater: 'phrase:few_moves_later',
  bestWas: 'phrase:best_was',
  betterMoveWas: 'phrase:better_move_was',
  wasBetter: 'phrase:was_better',
  wasStronger: 'phrase:was_stronger',
  andItWorks: 'phrase:and_it_works',
  gameDrawn: 'phrase:game_drawn',
  allowsForcedMate: 'phrase:allows_forced_mate',
  fasterMate: 'phrase:faster_mate',
  speedsUpMate: 'phrase:speeds_up_mate',
  onlyMoveWins: 'phrase:only_move_keeps_win',
  onlyMoveKeepsEdge: 'phrase:only_move_keeps_advantage',
  onlyMoveHolds: 'phrase:only_move_holds',
  onlyGoodMove: 'phrase:only_good_move',
  onlyMoveFights: 'phrase:only_move_keeps_fight',
  accuracyWhite: 'phrase:accuracy_white',
  accuracyBlack: 'phrase:accuracy_black',
} as const;

/** Said after a checkmating move instead of a verdict. */
export const MATE_ENDINGS: readonly string[] = [
  'phrase:mate_end_1',
  'phrase:mate_end_2',
  'phrase:mate_end_3',
];

export type Level = 'winning' | 'clearly_better' | 'slightly_better';
export type Side = 'white' | 'black';

/**
 * "Right square, wrong rook.": the better move says the same words as the move played (the
 * other rook to the same square), so naming it would sound like the move just criticised.
 */
export function wrongPieceKey(piece: 'q' | 'r' | 'b' | 'n'): string {
  return `phrase:wrong_piece_${piece}`;
}

/** "Now Black is winning." / "Now the position is equal." */
export function nowKey(side: Side | null, level: Level | null): string {
  return side && level ? `phrase:now_${side}_${level}` : 'phrase:now_equal';
}
/** "White is still winning, though." / "The position is still equal, though." */
export function stillKey(side: Side | null, level: Level | null): string {
  return side && level ? `phrase:still_${side}_${level}` : 'phrase:still_equal';
}

function otherClips(): Clip[] {
  const clips: Clip[] = [
    lead(PHRASES.after, 'After'),
    lead(PHRASES.fewMovesLater, 'A few moves later,'),
    lead(PHRASES.bestWas, 'Best was'),
    lead(PHRASES.betterMoveWas, 'The better move was'),
    { key: PHRASES.wasBetter, text: 'was better.', caption: 'was better.', kind: 'predicate' },
    {
      key: PHRASES.wasStronger,
      text: 'was stronger.',
      caption: 'was stronger.',
      kind: 'predicate',
    },
    sentence(PHRASES.andItWorks, 'And it works!'),
    sentence(PHRASES.gameDrawn, 'And the game ends in a draw.'),
    sentence(PHRASES.onlyMoveWins, 'The only move that keeps the win.'),
    sentence(PHRASES.onlyMoveKeepsEdge, 'The only move that keeps the advantage.'),
    sentence(PHRASES.onlyMoveHolds, 'The only move that holds.'),
    sentence(PHRASES.onlyGoodMove, 'The only good move here.'),
    sentence(PHRASES.onlyMoveFights, 'The only move that keeps the fight going.'),
    sentence(MATE_ENDINGS[0]!, 'Game over!'),
    sentence(MATE_ENDINGS[1]!, 'What a finish!'),
    sentence(MATE_ENDINGS[2]!, "And that's the game!"),
  ];
  const levels: Record<Level, string> = {
    winning: 'winning',
    clearly_better: 'clearly better',
    slightly_better: 'slightly better',
  };
  for (const side of ['white', 'black'] as const) {
    const name = side === 'white' ? 'White' : 'Black';
    for (const level of Object.keys(levels) as Level[]) {
      clips.push(sentence(nowKey(side, level), `Now ${name} is ${levels[level]}.`));
      clips.push(sentence(stillKey(side, level), `${name} is still ${levels[level]}, though.`));
    }
  }
  clips.push(sentence(nowKey(null, null), 'Now the position is equal.'));
  clips.push(sentence(stillKey(null, null), 'The position is still equal, though.'));
  for (const piece of ['q', 'r', 'b', 'n'] as const) {
    clips.push(sentence(wrongPieceKey(piece), `Right square, wrong ${PIECE_NAMES[piece]}.`));
  }
  return clips;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 0..100 in words: "seventy-three". */
export function numberWords(n: number): string {
  if (n === 100) return 'one hundred';
  if (n < 20) return ONES[n]!;
  const ones = n % 10;
  return ones ? `${TENS[Math.floor(n / 10)]}-${ONES[ones]}` : TENS[Math.floor(n / 10)]!;
}

/** A whole number 0..100 (a game accuracy), e.g. "num:73". */
export function numberKey(n: number): string {
  return `num:${Math.min(100, Math.max(0, Math.round(n)))}`;
}

function numberClips(): Clip[] {
  const clips: Clip[] = [
    lead(PHRASES.accuracyWhite, "White's accuracy:"),
    lead(PHRASES.accuracyBlack, "Black's accuracy:"),
  ];
  for (let n = 0; n <= 100; n++) {
    clips.push({
      key: numberKey(n),
      text: `${numberWords(n)}.`,
      caption: `${n}.`,
      kind: 'sentence',
    });
  }
  return clips;
}

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

function sentence(key: string, text: string): Clip {
  return { key, text, caption: text, kind: 'sentence' };
}
function lead(key: string, text: string): Clip {
  return { key, text, caption: text, kind: 'lead' };
}
/** A clause after a move: the model says it as a finished phrase, the caption runs on. */
function tail(key: string, text: string): Clip {
  return { key, text: `${text}.`, caption: text, kind: 'tail' };
}

/** Every clip, in a stable order: moves, squares, then phrases and numbers. */
export const VOCABULARY: readonly Clip[] = [
  ...moveClips(),
  ...squareClips(),
  ...verdictClips(),
  ...tacticClips(),
  ...materialClips(),
  ...mateClips(),
  ...otherClips(),
  ...numberClips(),
];

/** Clips by key. */
export const CLIPS: ReadonlyMap<string, Clip> = new Map(VOCABULARY.map((clip) => [clip.key, clip]));

/** The clip list the voice pack is rendered from (clips.json). */
export interface ClipList {
  version: number;
  voice: string;
  clips: { key: string; text: string }[];
}

export function clipList(): ClipList {
  return {
    version: VOCABULARY_VERSION,
    voice: VOICE,
    clips: VOCABULARY.map(({ key, text }) => ({ key, text })),
  };
}
