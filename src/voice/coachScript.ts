/**
 * The coach's spoken line for a move, built only from the voice pack's clips (vocabulary.ts),
 * plus the same words as text for captions and for the device voice.
 *
 * A line is one to three short sentences: the move and its verdict ("Rook to g8. That's a
 * blunder."), then the most important reason (the refutation of an error, the idea behind a
 * brilliant or great move, a mate), then the better move for errors ("Rook takes g7 was
 * better."). Everything is neutral third person, so it reads right for either player.
 *
 * The reasons follow core/explain.ts and core/tactics.ts: a story (LineStory) is told when
 * it matters (storyMatters) and when the move's explanation tells it too, so the voice and
 * the text on screen agree. Pure: the same move and seed always give the same line.
 */
import { Chess } from 'chess.js';
import { materialBalance } from '@/core/material';
import { parseUci } from '@/core/notation';
import { storyMatters } from '@/core/tactics';
import type {
  Color,
  GameReview,
  LineStory,
  Motif,
  MotifType,
  MoveReview,
  SacrificeInfo,
  Score,
} from '@/core/types';
import {
  CLIPS,
  MATERIAL_NOUNS,
  MATE_ENDINGS,
  MOTIF_FALLBACK_KEYS,
  PHRASES,
  castlingKey,
  discoveredAttackKey,
  forkKey,
  freeKey,
  mateKey,
  materialKey,
  nowKey,
  numberKey,
  pinKey,
  sacrificeKey,
  sanClipKeys,
  skewerKey,
  stillKey,
  verdictKeys,
  wrongPieceKey,
  type Clip,
  type Level,
  type MaterialNoun,
  type PieceType,
  type Side,
} from './vocabulary';

export interface CoachSegment {
  /** A clip of the voice pack (vocabulary.ts). */
  key: string;
  /**
   * Silence between this clip's speech and the next clip's; absent on the last one. The voice
   * pack keeps CLIP_MARGIN_MS of the recording's own silence at each end of every clip, so a
   * player starts the next clip at this clip's end - 2 * CLIP_MARGIN_MS + pauseMsAfter.
   */
  pauseMsAfter?: number;
}

/** Silence the voice pack keeps before and after the speech of each clip (chess-yes-voice). */
export const CLIP_MARGIN_MS = 40;

export interface CoachScript {
  segments: CoachSegment[];
  /** The same words as plain text: captions, and the device voice when clips are missing. */
  text: string;
}

export interface CoachScriptOptions {
  /** Picks among the ways to say a verdict; the ply by default, so replays say the same. */
  variantSeed?: number;
}

/** What the coach says for a reviewed move. */
export function coachScript(move: MoveReview, options: CoachScriptOptions = {}): CoachScript {
  const keys = sanClipKeys(move.san);
  if (keys.length === 0) return { segments: [], text: '' };
  const seed = options.variantSeed ?? move.ply;
  if (move.san.includes('#')) return render([...keys, pick(MATE_ENDINGS, seed, 1)]);

  const verdicts = verdictKeys(move.classification);
  // "Still in the opening book." needs a move before it.
  keys.push(
    pick(
      move.classification === 'book' && move.ply <= 2 ? verdicts.slice(0, 2) : verdicts,
      seed,
      0,
    ),
  );
  switch (move.classification) {
    case 'inaccuracy':
    case 'mistake':
    case 'blunder':
    case 'missedWin':
      keys.push(...errorLine(move, seed));
      break;
    case 'brilliant':
      keys.push(...brilliantLine(move));
      break;
    case 'great':
      keys.push(...greatLine(move, seed));
      break;
    case 'best':
    case 'excellent':
      keys.push(...ideaLine(move));
      break;
    default:
      break; // good, book, forced: the verdict says it all
  }
  if (isDrawn(move) && !keys.includes(PHRASES.gameDrawn)) keys.push(PHRASES.gameDrawn);
  return render(keys);
}

/** The game summary: "White's accuracy: 73. Black's accuracy: 57." */
export function coachSummary(review: GameReview): CoachScript {
  return render([
    PHRASES.accuracyWhite,
    numberKey(review.white.accuracy),
    PHRASES.accuracyBlack,
    numberKey(review.black.accuracy),
  ]);
}

/**
 * A line from clip keys, with the pauses and caption a coach line gets: just a move while it
 * is not analysed yet ("Knight to f3."), or a fixed sample line.
 */
export function scriptFromKeys(keys: readonly string[]): CoachScript {
  return render([...keys]);
}

export { sanClipKeys };

// ---------------------------------------------------------------------------
// Lines per label
// ---------------------------------------------------------------------------

interface Reason {
  keys: string[];
  /** Whether the reason already names the better move. */
  namesBest: boolean;
}

const MISSED_PREFIX = 'You missed ';

/** Reason, then the better move: mirrors explain.ts's findReason and adviseBest. */
function errorLine(move: MoveReview, seed: number): string[] {
  const reason = errorReason(move);
  const better = reason.namesBest ? [] : betterMove(move, seed);
  return better.length > 0 ? [...reason.keys, BREAK, ...better] : reason.keys;
}

function errorReason(move: MoveReview): Reason {
  const { color, best, explanation } = move;
  const none = (keys: string[]): Reason => ({ keys, namesBest: false });
  if (isDrawn(move)) {
    // A stalemate instead of a mate: "And the game ends in a draw. There was mate in seven, ..."
    const mate = mateFor(best?.score, color);
    if (mate === null || !best) return none([PHRASES.gameDrawn]);
    return {
      keys: [PHRASES.gameDrawn, mateKey('missed', mate), ...sanClipKeys(best.san)],
      namesBest: true,
    };
  }

  const against = mateFor(move.evalAfter, opposite(color));
  if (against !== null) {
    if (mateFor(best?.score, opposite(color)) !== null) return none([PHRASES.speedsUpMate]);
    const reply = move.playedLine?.san;
    if (!reply) return none([against === 1 ? mateKey('allows', 1) : PHRASES.allowsForcedMate]);
    return none([mateKey('allows', against), ...sanClipKeys(reply)]);
  }

  const missed = mateFor(best?.score, color);
  if (missed !== null && best) {
    const stillMating = mateFor(move.evalAfter, color) !== null;
    const lead = stillMating ? PHRASES.fasterMate : mateKey('missed', missed);
    return { keys: [lead, ...sanClipKeys(best.san)], namesBest: true };
  }

  const { why, bestIdea } = move;
  if (why?.kind === 'refutation' && storyMatters(why) && explanation.includes(why.text.trim())) {
    const recapture = move.san.includes('x') ? (parseUci(move.uci)?.to ?? null) : null;
    const keys = tellStory(readLine(why, color, { startFen: bestIdea?.fen, recapture }));
    if (keys.length > 0) return none(keys);
  }
  // "You missed Nf6+, which forks ..." as the reason itself.
  if (bestIdea && missedIdeaIn(explanation, bestIdea, MISSED_PREFIX)) {
    const keys = tellStory(readLine(bestIdea, color, { startFen: bestIdea.fen, played: move.san }));
    if (keys.length > 0) return { keys, namesBest: true };
  }
  const material = materialReason(move);
  if (material) return material;
  return none([standing(move)]);
}

/**
 * "Right square, wrong rook." when `better` is said with the same clips as the move played
 * (the other rook to the same square); null otherwise.
 */
function wrongPiece(played: string, better: string): string | null {
  const said = sanClipKeys(played);
  const other = sanClipKeys(better);
  if (played === better || said.join(' ') !== other.join(' ')) return null;
  const piece = /^[QRBN]/.exec(better)?.[0];
  return piece ? wrongPieceKey(piece.toLowerCase() as 'q' | 'r' | 'b' | 'n') : null;
}

/** explain.ts's material reasons, read back from the explanation. */
function materialReason({ explanation, san }: MoveReview): Reason | null {
  const hangs = /This hangs your (queen|rook|bishop|knight) on [a-h][1-8]: (\S+) wins it\./.exec(
    explanation,
  );
  if (hangs) {
    const noun = NOUN_OF_PIECE[hangs[1] as 'queen' | 'rook' | 'bishop' | 'knight'];
    return { keys: [...sanClipKeys(hangs[2]!), materialKey('winning', noun)], namesBest: false };
  }
  const pawn = /This loses the pawn on [a-h][1-8] to (\S+)\./.exec(explanation);
  if (pawn) {
    return { keys: [...sanClipKeys(pawn[1]!), materialKey('winning', 'pawn')], namesBest: false };
  }
  const loses = /This loses (.+?)(?: after \S+)?\./.exec(explanation);
  if (loses) return { keys: [materialKey('loses', nounOfText(loses[1]!))], namesBest: false };
  const missed = /You missed (\S+), which wins (.+?)\./.exec(explanation);
  if (missed) {
    return { keys: missedGain(san, missed[1]!, nounOfText(missed[2]!)), namesBest: true };
  }
  return null;
}

/** "Best was knight to f6, winning a pawn.", or "Right square, wrong knight. It wins a pawn." */
function missedGain(played: string, better: string, noun: MaterialNoun): string[] {
  const wrong = wrongPiece(played, better);
  if (wrong) return [wrong, materialKey('it-wins', noun)];
  return [PHRASES.bestWas, ...sanClipKeys(better), materialKey('winning', noun)];
}

/** "Rook takes g7 was better.", or the better move's idea when the explanation tells it. */
function betterMove(move: MoveReview, seed: number): string[] {
  const { best, bestIdea, explanation } = move;
  if (!best || best.san === move.san) return [];
  if (bestIdea && missedIdeaIn(explanation, bestIdea, 'Best was ')) {
    const line = readLine(bestIdea, move.color, { startFen: bestIdea.fen, played: move.san });
    const keys = tellStory(line);
    if (keys.length > 0) return keys;
  }
  const gain = /Best was (\S+), which wins (.+?)\./.exec(explanation);
  if (gain?.[1] === best.san) return missedGain(move.san, best.san, nounOfText(gain[2]!));
  const wrong = wrongPiece(move.san, best.san);
  if (wrong) return [wrong];
  const said = sanClipKeys(best.san);
  // "Queen to h5, check! was better" reads badly: a check or promotion takes the lead form.
  const plain = said.length === 1 && !/[+#]$/.test(best.san);
  const forms = [
    [PHRASES.bestWas, ...said],
    [PHRASES.betterMoveWas, ...said],
    ...(plain
      ? [
          [...said, PHRASES.wasBetter],
          [...said, PHRASES.wasStronger],
        ]
      : []),
  ];
  return pick(forms, seed, 2);
}

/** Whether the explanation tells the missed story, after `prefix` ("Best was ", ...). */
function missedIdeaIn(explanation: string, idea: LineStory, prefix: string): boolean {
  if (idea.kind !== 'missed' || !idea.text.startsWith(MISSED_PREFIX)) return false;
  if (idea.motifs.length === 0 && idea.materialSwing < 1) return false;
  return explanation.includes(`${prefix}${idea.text.slice(MISSED_PREFIX.length).trim()}`);
}

function brilliantLine(move: MoveReview): string[] {
  const sacrifice = move.sacrifice ? sacrificeOf(move.sacrifice) : null;
  const { why } = move;
  if (why && ideaPays(why)) {
    const line = readLine(why, move.color);
    const keys = tellStory(line, sacrifice);
    // "A knight sacrifice! It wins a pawn." undersells it: the point is that the sacrifice
    // holds ("does best not to take it", "it is sound"), as the explanation says.
    const pawnOnly =
      keys.length === 2 && keys[0] === (line?.sacrifice ?? sacrifice) && (line?.gain ?? 0) <= 1;
    if (keys.length > 0 && !pawnOnly) return keys;
  }
  const keys = sacrifice ? [sacrifice] : [];
  const mate = mateFor(move.evalAfter, move.color);
  if (mate !== null) keys.push(mateKey('forces', mate + 1));
  else if (sacrifice) keys.push(PHRASES.andItWorks);
  return keys;
}

function greatLine(move: MoveReview, seed: number): string[] {
  const idea = ideaLine(move);
  if (idea.length > 0) return idea;
  // explain.ts's "the only move that keeps you winning / your advantage / the balance".
  const win = move.winAfter;
  if (win >= STANDING.winning) return [PHRASES.onlyMoveWins];
  if (win >= STANDING.slightlyBetter) return [PHRASES.onlyMoveKeepsEdge];
  if (win > 100 - STANDING.slightlyBetter) {
    return [pick([PHRASES.onlyMoveHolds, PHRASES.onlyGoodMove], seed, 3)];
  }
  return [PHRASES.onlyMoveFights];
}

/** The idea behind a good move, when its story pays off; a mate it forces otherwise. */
function ideaLine(move: MoveReview): string[] {
  const { why } = move;
  if (why && ideaPays(why)) {
    const keys = tellStory(readLine(why, move.color));
    if (keys.length > 0) return keys;
  }
  const mate = mateFor(move.evalAfter, move.color);
  if (mate !== null && move.classification !== 'excellent') return [mateKey('forces', mate + 1)];
  return [];
}

/** Whether an idea story shows a payoff worth telling (explain.ts's ideaPays). */
function ideaPays(story: LineStory): boolean {
  if (story.kind !== 'idea') return false;
  return story.mateIn !== undefined || story.motifs.length > 0 || story.materialSwing >= 1;
}

// ---------------------------------------------------------------------------
// Telling a line
// ---------------------------------------------------------------------------

/** Most moves spelled out before the move that carries out the tactic. */
const MAX_LISTED_MOVES = 2;

/**
 * The story of a line as clips:
 * - refutation: "Bishop takes g8, winning the rook for free." / "This allows mate in two,
 *   starting with queen to h5, check!" / "This loses a piece.";
 * - idea (the move was just said): "A queen sacrifice! After knight takes b8, rook to d8,
 *   checkmate!" / "Forking the king and queen. It wins the queen." / "It wins a pawn.";
 * - missed: "Best was knight to f6, check, forking the king and queen. It wins the queen." /
 *   "There was mate in three, starting with ...".
 * Returns [] when the line has nothing to tell.
 */
function tellStory(line: Line | null, extraSacrifice: string | null = null): string[] {
  if (!line) return [];
  const { story, steps } = line;
  const { kind } = story;
  const first = steps[0]!;
  const sacrifice = line.sacrifice ?? extraSacrifice;

  if (line.mates) {
    const mateIn = story.mateIn ?? null;
    if (kind === 'refutation') return [mateKey('allows', mateIn), ...sanClipKeys(first.san)];
    if (kind === 'missed') return [mateKey('missed', mateIn), ...sanClipKeys(first.san)];
    if (sacrifice && mateIn === 2 && steps.length === 3) {
      return [
        sacrifice,
        PHRASES.after,
        ...sanClipKeys(steps[1]!.san),
        ...sanClipKeys(steps[2]!.san),
      ];
    }
    return [...(sacrifice ? [sacrifice] : []), mateKey('forces', mateIn)];
  }

  const opener: string[] = [];
  if (kind === 'missed') {
    const wrong = line.played ? wrongPiece(line.played, first.san) : null;
    opener.push(...(wrong ? [wrong] : [PHRASES.bestWas, ...sanClipKeys(first.san)]));
  }
  if (kind === 'refutation' && sacrifice) opener.push(...sanClipKeys(first.san));
  if (sacrifice) opener.push(sacrifice);
  // After a whole sentence ("A rook sacrifice!", "Right square, wrong rook."), what the first
  // move wins is a sentence too: "It wins the exchange.", not "Winning the exchange."
  const afterSentence = CLIPS.get(opener.at(-1) ?? '')?.kind === 'sentence';
  const winning = (noun: MaterialNoun) => materialKey(afterSentence ? 'it-wins' : 'winning', noun);
  // The moves before the tactic are listed from here: a refutation starts with the reply,
  // the other kinds have just named their first move.
  const from = kind === 'refutation' && !sacrifice ? 0 : 1;

  // "A knight sacrifice! ... winning a pawn for free" would contradict itself.
  const event = line.main ? motifEvent(line, line.main, !sacrifice) : captureEvent(line);
  if (!event) {
    if (!sacrifice) return [];
    return kind === 'idea' ? [...opener, PHRASES.andItWorks] : opener;
  }
  if (event.overall) {
    const noun = event.noun;
    if (kind === 'refutation') return [...opener, materialKey('loses', noun)];
    if (kind === 'idea') return [...opener, materialKey('it-wins', noun)];
    return [...opener, winning(noun)];
  }

  const k = event.step;
  if (k === 0) {
    if (kind === 'refutation' && !sacrifice) return [...sanClipKeys(first.san), ...event.tail];
    const alone = kind === 'idea' || afterSentence;
    return [...opener, ...(alone ? (event.alone ?? event.tail) : event.tail)];
  }
  // A missed move is named with what it wins overall; its later tactics make the line long.
  if (kind === 'missed') return [...opener, winning(line.gainNoun)];
  const listed = k - from <= MAX_LISTED_MOVES;
  const lead = !listed
    ? [PHRASES.fewMovesLater]
    : k > from
      ? [PHRASES.after, ...steps.slice(from, k).flatMap((step) => sanClipKeys(step.san))]
      : [];
  return [...opener, ...lead, ...sanClipKeys(steps[k]!.san), ...event.tail];
}

interface StoryEvent {
  /** The step of the line the event happens at. */
  step: number;
  /** Said right after that step's move: "forking the king and queen. It wins the queen." */
  tail: string[];
  /** Said instead when the move is the one just named (an idea's first move). */
  alone?: string[];
  /** The line wins material without one move to pin it on: "This loses a piece." */
  overall?: boolean;
  noun: MaterialNoun;
}

const FORMING_MOTIFS: ReadonlySet<MotifType> = new Set([
  'fork',
  'pin',
  'skewer',
  'discovered-attack',
  'discovered-check',
  'double-check',
]);

/** `free`: whether "winning the rook for free" may be said (not after a sacrifice). */
function motifEvent(line: Line, motif: Motif, free: boolean): StoryEvent | null {
  const k = motif.step;
  const step = line.steps[k];
  if (!step) return null;
  const won = nounBetween(line, step.before);
  const noun = won ?? 'material';
  if (FORMING_MOTIFS.has(motif.type)) {
    const wins = won ? [materialKey('it-wins', won)] : [];
    return { step: k, tail: [motifKey(motif), ...wins], noun };
  }
  if (motif.type === 'hanging-piece') {
    const hanging = /^wins the (undefended )?(queen|rook|bishop|knight|pawn)\b/.exec(motif.phrase);
    const victim = hanging ? PIECE_OF_NAME[hanging[2]!]! : null;
    // When the story goes on ("Bxb7 takes it for free and then wins the exchange"), the whole
    // gain says what the move costs: "Bishop takes b7, winning the exchange and a pawn."
    const goesOn =
      / and then /.test(line.story.text) &&
      won !== null &&
      won !== 'material' &&
      won !== VICTIM_NOUNS[victim ?? 'k'];
    if (victim && hanging?.[1] && !goesOn && free) {
      return {
        step: k,
        tail: [freeKey('tail', victim)],
        alone: [freeKey('sentence', victim)],
        noun,
      };
    }
    // The piece taken, when the rest of the line makes the count hard to name.
    const victimOnly = hanging?.[1] && !goesOn;
    const taken =
      victim && (victimOnly || won === null || won === 'material') ? VICTIM_NOUNS[victim] : noun;
    return {
      step: k,
      tail: [materialKey('winning', taken)],
      alone: [materialKey('it-wins', taken)],
      noun: taken,
    };
  }
  if (motif.type === 'promotion') return { step: k, tail: [], alone: [], noun };
  // A trapped piece, or anything new: what it wins.
  return {
    step: k,
    tail: [materialKey('winning', noun)],
    alone: [materialKey('it-wins', noun)],
    noun,
  };
}

/** The clip for a fork, pin, skewer or discovered attack, from its phrase in Motif.phrase. */
function motifKey(motif: Motif): string {
  const phrase = motif.phrase;
  switch (motif.type) {
    case 'fork': {
      const pieces = pieceListOf(phrase.replace(/^forks /, ''));
      const key = pieces && pieces.length <= 3 ? forkKey(pieces) : null;
      return key && CLIPS.has(key) ? key : MOTIF_FALLBACK_KEYS.fork;
    }
    case 'pin': {
      const pin = /^pins the (\w+) to the (\w+)$/.exec(phrase);
      const key = pin && pinKey(PIECE_OF_NAME[pin[1]!]!, PIECE_OF_NAME[pin[2]!]!);
      return key && CLIPS.has(key) ? key : MOTIF_FALLBACK_KEYS.pin;
    }
    case 'skewer': {
      const pieces = pieceListOf(phrase.replace(/^skewers /, ''));
      const key = pieces?.length === 2 ? skewerKey(pieces[0]!, pieces[1]!) : null;
      return key && CLIPS.has(key) ? key : MOTIF_FALLBACK_KEYS.skewer;
    }
    case 'discovered-attack': {
      const target = /^uncovers an attack on the (\w+)$/.exec(phrase);
      const key = target && discoveredAttackKey(PIECE_OF_NAME[target[1]!]!);
      return key && CLIPS.has(key) ? key : MOTIF_FALLBACK_KEYS['discovered-attack'];
    }
    case 'double-check':
      return 'phrase:double_check';
    default:
      return 'phrase:discovered_check';
  }
}

/** "the king and queen" → [k, q]; "both rooks" → [r, r]; "the queen and two rooks" → [q, r, r]. */
function pieceListOf(text: string): PieceType[] | null {
  const list = text.replace(/^both /, 'two ').replace(/^the /, '');
  const pieces: PieceType[] = [];
  for (const item of list.split(/, | and /)) {
    const counted = /^(two|three) (\w+)s$/.exec(item);
    const type = PIECE_OF_NAME[counted ? counted[2]! : item];
    if (!type) return null;
    pieces.push(...Array<PieceType>(counted?.[1] === 'three' ? 3 : counted ? 2 : 1).fill(type));
  }
  return pieces.length >= 2 ? pieces : null;
}

/**
 * The line's gain when no tactic tells it: the capture that wins it ("Bishop takes g8,
 * winning a pawn"), as tactics.ts's materialText decides; otherwise the gain overall.
 */
function captureEvent(line: Line): StoryEvent | null {
  if (line.gain < 1) return null;
  const noun = line.gainNoun;
  const decisive = decisiveCapture(line);
  const captures = line.steps.filter(
    (step, i) =>
      step.mover === line.side && step.captured && (i === decisive || !isRecapture(line, i)),
  ).length;
  if (decisive !== null && captures === 1 && captureAccountsFor(line, decisive)) {
    return {
      step: decisive,
      tail: [materialKey('winning', noun)],
      alone: [materialKey('it-wins', noun)],
      noun,
    };
  }
  return { step: 0, tail: [], overall: true, noun };
}

// ---------------------------------------------------------------------------
// Reading a line
// ---------------------------------------------------------------------------

interface Step {
  san: string;
  /** FEN before and after the move. */
  before: string;
  after: string;
  mover: Color;
  to: string;
  captured?: PieceType;
  checkmate: boolean;
}

interface Line {
  story: LineStory;
  /** The move under review, for a missed story: its better move may sound the same. */
  played: string | null;
  steps: Step[];
  /** Who carries out the story: the opponent in a refutation, the player otherwise. */
  side: Color;
  /** Material the side wins over the line, pawn units. */
  gain: number;
  /** The same, in words. */
  gainNoun: MaterialNoun;
  /** Whether the line ends in the side's checkmate. */
  mates: boolean;
  /** The motif the story leads with (tactics.ts's writeStory). */
  main?: Motif;
  /** "A queen sacrifice!" when the story opens with one. */
  sacrifice: string | null;
  /** Square the move before the line captured on (a refutation follows the move reviewed). */
  recapture: string | null;
}

interface ReadOptions {
  /** The position the material is counted from when that is not the line's own start. */
  startFen?: string;
  /** The square the move before the line captured on (a refutation follows the move). */
  recapture?: string | null;
  /** The move under review (for a missed story). */
  played?: string;
}

/** Replays a story's line. */
function readLine(
  story: LineStory,
  player: Color,
  { startFen, recapture = null, played }: ReadOptions = {},
): Line | null {
  const chess = loadPosition(story.fen);
  if (!chess || story.movesUci.length === 0) return null;
  const steps: Step[] = [];
  for (const uci of story.movesUci) {
    const parsed = parseUci(uci);
    if (!parsed) return null;
    const before = chess.fen();
    try {
      const played = chess.move(parsed);
      steps.push({
        san: played.san,
        before,
        after: chess.fen(),
        mover: played.color,
        to: played.to,
        captured: played.captured as PieceType | undefined,
        checkmate: chess.isCheckmate(),
      });
    } catch {
      return null; // chess.js throws on illegal moves
    }
  }

  const side = story.kind === 'refutation' ? opposite(player) : player;
  const gain = side === player ? story.materialSwing : -story.materialSwing;
  const last = steps.at(-1)!;
  const line: Line = {
    story,
    played: played ?? null,
    steps,
    side,
    gain,
    gainNoun: nounOfCounts(wonOverLine(story, side, gain, last.after, startFen)) ?? valueNoun(gain),
    mates: last.checkmate && last.mover === side,
    sacrifice: null,
    recapture,
  };
  line.main = mainMotif(line);
  // Only when the story on screen tells it ("Your opponent sacrifices the rook on d3: ..."):
  // a capture that leaves a piece behind is told as the capture ("hxg7 takes it for free").
  if (story.sacrifice && /sacrific/i.test(story.text)) {
    line.sacrifice = sacrificeOfLine(line, story.sacrifice.piece);
  }
  return line;
}

/** tactics.ts's MOTIF_ORDER: which motif a story leads with. */
const MOTIF_ORDER: MotifType[] = [
  'back-rank-mate',
  'checkmate',
  'fork',
  'skewer',
  'pin',
  'double-check',
  'discovered-check',
  'discovered-attack',
  'trapped-piece',
  'hanging-piece',
  'promotion',
];

/** The strongest motif that explains the gain, earliest first (tactics.ts's writeStory). */
function mainMotif(line: Line): Motif | undefined {
  const { steps, side } = line;
  const end = material(steps.at(-1)!.after, side);
  const startMaterial = end - line.gain;
  const candidates = line.story.motifs.filter((motif) => {
    const step = steps[motif.step];
    if (!step) return false;
    // explainsGain: the line from the motif on wins at least half of the whole gain.
    if (2 * (end - material(step.before, side)) < end - startMaterial) return false;
    // winsBack: a capture that only wins back a piece lost earlier in the line.
    const selfContained =
      motif.type === 'hanging-piece' ||
      motif.type === 'promotion' ||
      motif.type === 'trapped-piece';
    return !(
      selfContained &&
      motif.step > 0 &&
      pieceMaterial(step.before, side) < pieceMaterial(steps[0]!.before, side)
    );
  });
  return candidates.sort(
    (a, b) => MOTIF_ORDER.indexOf(a.type) - MOTIF_ORDER.indexOf(b.type) || a.step - b.step,
  )[0];
}

/** Whether step `i` only takes back on the square the move before it captured on. */
function isRecapture(line: Line, i: number): boolean {
  const step = line.steps[i];
  const square =
    i === 0 ? line.recapture : line.steps[i - 1]?.captured ? line.steps[i - 1]!.to : null;
  return Boolean(step?.captured) && step?.to === square;
}

const RANKS: Record<PieceType, number> = { k: 100, q: 9, r: 5, b: 3, n: 3, p: 1 };

/** The side's capture of the most valuable piece, not counting recaptures (tactics.ts). */
function decisiveCapture(line: Line): number | null {
  const pickCapture = (recaptures: boolean) => {
    let decisive: number | null = null;
    line.steps.forEach((step, i) => {
      if (step.mover !== line.side || !step.captured || isRecapture(line, i) !== recaptures) return;
      const best = decisive === null ? undefined : line.steps[decisive]!.captured;
      if (!best || RANKS[step.captured] > RANKS[best]) decisive = i;
    });
    return decisive;
  };
  return pickCapture(false) ?? pickCapture(true);
}

/** Whether the capture at step `i` tells the line's gain (tactics.ts's captureAccountsFor). */
function captureAccountsFor(line: Line, i: number): boolean {
  const { steps, side } = line;
  const step = steps[i]!;
  const reply = steps[i + 1];
  const end = reply?.captured && reply.to === step.to ? i + 1 : i;
  const after = (k: number) => material(steps[k]!.after, side);
  const first = i > 0 && isRecapture(line, 0) ? 1 : 0;
  const start = material(steps[first]!.before, side);
  if (material(step.before, side) !== start) return false;
  if (2 * (after(end) - start) < line.gain) return false;
  for (let k = end + 1; k < steps.length; k++) if (after(k) > after(k - 1)) return false;
  return true;
}

function sacrificeOfLine(line: Line, piece: string): string | null {
  const [first, reply] = line.steps;
  if (!first || !reply) return null;
  const down = material(first.before, line.side) - material(reply.after, line.side);
  if (piece === 'r' && down === 2) return sacrificeKey('exchange');
  return piece === 'q' || piece === 'r' || piece === 'b' || piece === 'n'
    ? sacrificeKey(piece)
    : null;
}

function sacrificeOf({ piece, material: amount }: SacrificeInfo): string | null {
  if (piece === 'r' && amount === 2) return sacrificeKey('exchange');
  return piece === 'q' || piece === 'r' || piece === 'b' || piece === 'n'
    ? sacrificeKey(piece)
    : null;
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

type Counts = Record<'q' | 'r' | 'b' | 'n' | 'p', number>;

/** `side`'s pieces minus the opponent's, by type. */
function pieceDifference(fen: string, side: Color): Counts {
  const counts: Counts = { q: 0, r: 0, b: 0, n: 0, p: 0 };
  for (const char of fen.split(' ')[0] ?? '') {
    const type = char.toLowerCase();
    if (!(type in counts)) continue;
    const white = char !== type;
    counts[type as keyof Counts] += white === (side === 'w') ? 1 : -1;
  }
  return counts;
}

function countsBetween(fromFen: string, toFen: string, side: Color): Counts {
  const before = pieceDifference(fromFen, side);
  const after = pieceDifference(toFen, side);
  return {
    q: after.q - before.q,
    r: after.r - before.r,
    b: after.b - before.b,
    n: after.n - before.n,
    p: after.p - before.p,
  };
}

/**
 * What the side wins over a line, by piece type, counted from `startFen` when it accounts for
 * the line's gain, else from the line's start. A story about a move that takes back (review.ts's
 * trade baseline) counts from before the opponent's capture: the piece that capture took is
 * then given back in the count. Null when that piece cannot be told.
 */
function wonOverLine(
  story: LineStory,
  side: Color,
  gain: number,
  endFen: string,
  startFen: string | undefined,
): Counts | null {
  const gained = (fen: string) => material(endFen, side) - material(fen, side);
  if (startFen && gained(startFen) === gain) return countsBetween(startFen, endFen, side);
  const won = countsBetween(story.fen, endFen, side);
  const taken = gained(story.fen) - gain;
  if (taken === 0) return won;
  const values: Record<number, keyof Counts> = { 1: 'p', 3: won.b > 0 ? 'b' : 'n', 5: 'r', 9: 'q' };
  const type = values[taken];
  return type ? { ...won, [type]: won[type] - 1 } : null;
}

/** What the side wins from `fromFen` to the end of the line, in words. */
function nounBetween(line: Line, fromFen: string): MaterialNoun | null {
  return nounOf(countsBetween(fromFen, line.steps.at(-1)!.after, line.side));
}

function nounOfCounts(won: Counts | null): MaterialNoun | null {
  return won && nounOf(won);
}

/** Names a material gain with the vocabulary's nouns; null when less than a pawn is won. */
function nounOf(won: Counts): MaterialNoun | null {
  let { b, n } = won;
  const { q, r, p } = won;
  // Knights won for bishops cancel out.
  if (n * b < 0) {
    const traded = Math.min(Math.abs(n), Math.abs(b));
    n -= Math.sign(n) * traded;
    b -= Math.sign(b) * traded;
  }
  const minors = n + b;
  const value = q * 9 + r * 5 + minors * 3 + p;
  if (value < 1) return null;
  // A trade too mixed to name: big ones still say so.
  const mixed: MaterialNoun = value >= 8 ? 'lot_of_material' : 'material';

  if (q === 0 && r === 0 && minors === 0) {
    return p === 1 ? 'pawn' : p === 2 ? 'two_pawns' : p === 3 ? 'three_pawns' : 'material';
  }
  // One piece (or the exchange) and up to two pawns besides: "the rook and a pawn".
  const withPawns = (noun: 'queen' | 'rook' | 'bishop' | 'knight' | 'exchange'): MaterialNoun =>
    p === 1 ? `${noun}_pawn` : p === 2 ? `${noun}_two_pawns` : noun;
  if (q === 1) {
    if (r === 0 && minors === 0) return withPawns('queen');
    if (r === -1 && minors === 0) return 'queen_for_rook';
    if (r === 0 && minors === -1) return 'queen_for_piece';
    if (r === 0 && minors === -2) return 'queen_for_two_pieces';
    if (r === -1 && minors === -1) return 'queen_for_rook_piece';
    if (r === 1 && minors === 0) return 'queen_rook';
    if (r === 0 && minors === 1) return 'queen_piece';
    return mixed;
  }
  if (q === -1) return r === 2 && minors === 0 ? 'two_rooks_for_queen' : mixed;
  if (r === 1 && minors === 0) {
    if (p === -1) return 'rook_for_pawn';
    if (p === -2) return 'rook_for_two_pawns';
    return p >= 0 ? withPawns('rook') : 'material';
  }
  if (r === 1 && minors === -1) return p >= 0 ? withPawns('exchange') : 'exchange';
  if (r === 2 && minors === 0) return 'two_rooks';
  if (r === 1 && minors === 1) return 'rook_piece';
  if (r === -1 && minors === 2) return 'two_pieces_for_rook';
  if (r === 0 && minors === 1) {
    if (p === -1) return 'piece_for_pawn';
    if (p === -2) return 'piece_for_two_pawns';
    return withPawns(b === 1 ? 'bishop' : 'knight');
  }
  if (r === 0 && minors === 2) return 'two_pieces';
  return mixed;
}

/** A gain known only by its size. */
function valueNoun(gain: number): MaterialNoun {
  return gain === 1 ? 'pawn' : 'material';
}

const VICTIM_NOUNS: Record<PieceType, MaterialNoun> = {
  k: 'material',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};

const NOUN_OF_PIECE = {
  queen: 'queen',
  rook: 'rook',
  bishop: 'bishop',
  knight: 'knight',
} as const satisfies Record<string, MaterialNoun>;

const NOUN_BY_TEXT = new Map<string, MaterialNoun>(
  (Object.keys(MATERIAL_NOUNS) as MaterialNoun[]).map((noun) => [MATERIAL_NOUNS[noun], noun]),
);

/** explain.ts's material words ("your queen", "a rook", "a piece for two pawns") as a noun. */
function nounOfText(text: string): MaterialNoun {
  const words = text.trim().replace(/^your /, 'the ');
  return (
    NOUN_BY_TEXT.get(words) ??
    NOUN_BY_TEXT.get(words.replace(/^an? (queen|rook|bishop|knight)\b/, 'the $1')) ??
    // "the knight for a pawn", "the rook for two pawns"
    NOUN_BY_TEXT.get(words.replace(/^the (knight|bishop) for\b/, 'a piece for')) ??
    NOUN_BY_TEXT.get(words.replace(/^the rook for\b/, 'a rook for')) ??
    'material'
  );
}

const PIECE_OF_NAME: Record<string, PieceType | undefined> = {
  king: 'k',
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
  pawn: 'p',
};

function material(fen: string, side: Color): number {
  const balance = materialBalance(fen);
  return side === 'w' ? balance : -balance;
}

/** Material in pieces only (no pawns), pawn units, side minus opponent. */
function pieceMaterial(fen: string, side: Color): number {
  const { q, r, b, n } = pieceDifference(fen, side);
  return q * 9 + r * 5 + (b + n) * 3;
}

// ---------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------

/** explain.ts's standings, as the mover's win %: winning, clearly and slightly better. */
const STANDING = { winning: 72, clearlyBetter: 58, slightlyBetter: 53 } as const;

/** Who is better and by how much, from the mover's win %: 3 = mover winning ... -3. */
function standingRank(moverWin: number): number {
  if (moverWin >= STANDING.winning) return 3;
  if (moverWin >= STANDING.clearlyBetter) return 2;
  if (moverWin >= STANDING.slightlyBetter) return 1;
  if (moverWin > 100 - STANDING.slightlyBetter) return 0;
  if (moverWin > 100 - STANDING.clearlyBetter) return -1;
  if (moverWin > 100 - STANDING.winning) return -2;
  return -3;
}

const LEVELS: Record<number, Level> = { 1: 'slightly_better', 2: 'clearly_better', 3: 'winning' };

/** "Now Black is winning." or "White is still clearly better, though." after an error. */
function standing(move: MoveReview): string {
  const before = standingRank(move.winBefore);
  const after = standingRank(move.winAfter);
  const sideOf = (rank: number): Side | null =>
    rank === 0 ? null : rank > 0 === (move.color === 'w') ? 'white' : 'black';
  const level = LEVELS[Math.abs(after)] ?? null;
  const still = move.classification === 'missedWin' ? after >= 2 : before === after;
  return still ? stillKey(sideOf(after), level) : nowKey(sideOf(after), level);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Silence after a clip, by what follows it. */
function pauseAfter(clip: Clip, next: Clip, index: number): number {
  switch (clip.kind) {
    case 'move':
    case 'promotion':
      if (next.kind === 'promotion') return 40;
      if (next.kind === 'predicate') return 60;
      if (next.kind === 'tail') return 140;
      if (next.kind === 'move') return 220;
      return index === 0 ? 380 : 320;
    case 'lead':
      return clip.caption.endsWith(',') ? 160 : 50;
    case 'tail':
      return next.kind === 'tail' ? 160 : 340;
    default:
      return 340;
  }
}

/**
 * Marks the end of a sentence between two runs of keys whose clips would otherwise run on
 * (a reason that ends with a move, then the better move). Not a clip: render drops it.
 */
const BREAK = '';
const SENTENCE_PAUSE_MS = 340;

const CASTLING_KEY = /^move:(O-O(?:-O)?)([+#]?)$/;

/** "Best was castling kingside.", "Castling queenside was better." inside a sentence. */
function castlingInSentences(keys: string[]): string[] {
  return keys.map((key, i) => {
    const castle = CASTLING_KEY.exec(key);
    if (!castle) return key;
    const named = CLIPS.get(keys[i - 1] ?? '')?.kind === 'lead';
    const subject = CLIPS.get(keys[i + 1] ?? '')?.kind === 'predicate';
    if (!named && !subject) return key;
    return castlingKey(castle[1] as 'O-O' | 'O-O-O', castle[2] as '' | '+' | '#');
  });
}

function render(said: string[]): CoachScript {
  const keys = castlingInSentences(said);
  const segments: CoachSegment[] = [];
  /** Clips, each with whether a sentence ends before it; undefined for an unknown key. */
  const clips: { clip: Clip | undefined; breakBefore: boolean }[] = [];
  let breakBefore = false;
  for (const key of keys) {
    if (key === BREAK) {
      breakBefore = clips.length > 0;
      continue;
    }
    segments.push({ key });
    clips.push({ clip: CLIPS.get(key), breakBefore });
    breakBefore = false;
  }
  clips.forEach(({ clip }, i) => {
    const next = clips[i + 1];
    if (!clip || !next?.clip) return;
    segments[i]!.pauseMsAfter = next.breakBefore
      ? SENTENCE_PAUSE_MS
      : pauseAfter(clip, next.clip, i);
  });
  const known = clips.filter(
    (entry): entry is { clip: Clip; breakBefore: boolean } => !!entry.clip,
  );
  return { segments, text: captionOf(known) };
}

/** Joins the clips' captions into sentences: "Knight to f6, check, forking the king ...". */
function captionOf(clips: { clip: Clip; breakBefore: boolean }[]): string {
  let text = '';
  let previous: Clip | undefined;
  for (const { clip, breakBefore } of clips) {
    const { caption, kind } = clip;
    if (!previous) {
      text = kind === 'tail' ? capitalize(caption) : caption;
    } else if (breakBefore) {
      text = `${endSentence(text)} ${kind === 'tail' ? capitalize(caption) : caption}`;
    } else if (previous.kind === 'move' || previous.kind === 'promotion') {
      if (kind === 'move' || kind === 'promotion' || kind === 'tail') {
        text = `${text.replace(/!$/, '')}, ${kind === 'move' ? lowerFirst(caption) : caption}`;
      } else if (kind === 'predicate') {
        text = `${text.replace(/!$/, '')} ${caption}`;
      } else {
        text = `${endSentence(text)} ${caption}`;
      }
    } else if (previous.kind === 'lead') {
      text = `${text} ${kind === 'move' ? lowerFirst(caption) : caption}`;
    } else if (previous.kind === 'tail') {
      text =
        kind === 'tail'
          ? `${text}, ${caption}`
          : `${endSentence(text)} ${kind === 'move' ? caption : capitalize(caption)}`;
    } else {
      text = `${text} ${kind === 'tail' ? capitalize(caption) : caption}`;
    }
    previous = clip;
  }
  return text ? endSentence(text) : '';
}

function endSentence(text: string): string {
  return /[.!?:]$/.test(text) ? text : `${text}.`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Knight takes b8" → "knight takes b8" inside a sentence; pawn moves are already lower case. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** One of `items`, the same for the same seed; `salt` keeps separate choices independent. */
function pick<T>(items: readonly T[], seed: number, salt: number): T {
  let hash = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d) >>> 0;
  hash = (hash ^ (hash >>> 12)) >>> 0;
  return items[hash % items.length]!;
}

/** The game ended with the move, without checkmate: a draw on the board. */
function isDrawn(move: MoveReview): boolean {
  return move.evalAfter === null && !move.san.includes('#');
}

/** Moves to mate for `color`, or null when the score is not a forced mate for that side. */
function mateFor(score: Score | null | undefined, color: Color): number | null {
  if (!score || score.type !== 'mate') return null;
  const moves = color === 'w' ? score.value : -score.value;
  return moves > 0 ? moves : null;
}

function opposite(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

function loadPosition(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null; // invalid FEN
  }
}
