import type { Color, GameReview, LineStory, MoveReview } from './types';

/**
 * Explanations and stories (explain.ts, tactics.ts) are written to the player who made the
 * move: "This hangs your knight", "Your opponent replies Nd5+". When the review is shown to a
 * known player, their opponent's moves read better addressed to that player instead: "This
 * hangs their knight", "You reply Nd5+". These functions do that rewrite. They know every
 * sentence pattern the two modules write (perspective.test.ts checks them), and leave any
 * other text unchanged.
 */

/** Verbs after "your opponent" (the viewer), and the form they take after "you". */
const VIEWER_VERBS: Record<string, string> = {
  replies: 'reply',
  sacrifices: 'sacrifice',
  comes: 'come',
  wins: 'win',
  does: 'do',
  is: 'are',
  was: 'were',
  'would be': 'would be',
};

/** Verbs after "you" (the mover), and the form they take after "your opponent". */
const MOVER_VERBS: Record<string, string> = {
  are: 'is',
  were: 'was',
  'would be': 'would be',
  sacrifice: 'sacrifices',
  offer: 'offers',
  come: 'comes',
  win: 'wins',
  had: 'had',
  missed: 'missed',
  let: 'let',
};

const alternatives = (verbs: Record<string, string>) => Object.keys(verbs).join('|');

/**
 * Every phrase that names one of the two players, longest first so that "your opponent's"
 * wins over "your opponent" and "your". Each match is rewritten exactly once.
 */
const PLAYER_PHRASE = new RegExp(
  [
    "your opponent's",
    `your opponent(?: (?:${alternatives(VIEWER_VERBS)}))?`,
    'now they are',
    `you(?: (?:${alternatives(MOVER_VERBS)}))?`,
    'your',
  ]
    .map((phrase) => `\\b${phrase}\\b`)
    .join('|'),
  'gi',
);

/** Sentences, each with its end punctuation and the spaces after it. */
const SENTENCE = /[^.!?]+(?:[.!?]+|$)\s*/g;

function rewritePhrase(phrase: string): string {
  const lower = phrase.toLowerCase();
  let replacement: string;
  if (lower === "your opponent's") replacement = 'your';
  else if (lower.startsWith('your opponent')) {
    const verb = lower.slice('your opponent'.length).trim();
    replacement = verb ? `you ${VIEWER_VERBS[verb] ?? verb}` : 'you';
  } else if (lower === 'now they are') replacement = 'now you are';
  else if (lower === 'your') replacement = 'their';
  else {
    const verb = lower.slice('you'.length).trim();
    replacement = verb ? `your opponent ${MOVER_VERBS[verb] ?? verb}` : 'your opponent';
  }
  return phrase[0] === phrase[0]?.toUpperCase() ? capitalize(replacement) : replacement;
}

function rewriteSentence(sentence: string): string {
  let text = sentence;
  // A second verb that shares the subject follows it: "Your opponent replies Rxg7+ and wins
  // your pawn" becomes "You reply Rxg7+ and win their pawn" (also "... and then wins").
  if (/^\s*Your opponent replies\b/.test(text)) {
    text = text.replace(
      /\band (then )?(wins|makes|traps)\b/g,
      (_, then: string | undefined, verb: string) => `and ${then ?? ''}${verb.slice(0, -1)}`,
    );
  } else if (/^\s*You sacrifice\b/.test(text)) {
    text = text.replace(/\band force mate\b/, 'and forces mate');
  }
  // "Defending" means the mover defending, who is now the opponent.
  text = text.replace('this makes defending harder', 'this makes it harder for them to defend');
  return text.replace(PLAYER_PHRASE, rewritePhrase);
}

/**
 * Rewrites a text addressed to the player who made a move so that it addresses that
 * player's opponent: "you" becomes "your opponent", "your opponent" becomes "you" (with the
 * verbs agreeing), and the mover's "your" becomes "their".
 */
export function addressOpponent(text: string): string {
  // Congratulations are for the player who mated, not the one who was mated.
  if (text.startsWith('Checkmate! Well played.')) {
    return text.replace('Checkmate! Well played.', 'Checkmate.');
  }
  return (text.match(SENTENCE) ?? [text]).map(rewriteSentence).join('');
}

/** Rewritten stories, kept by identity: review.ts reuses its stories across rebuilds. */
const rewrittenStories = new WeakMap<LineStory, LineStory>();

function storyForOpponent(story: LineStory): LineStory {
  let rewritten = rewrittenStories.get(story);
  if (!rewritten) {
    rewritten = { ...story, text: addressOpponent(story.text) };
    rewrittenStories.set(story, rewritten);
  }
  return rewritten;
}

function moveForOpponent(move: MoveReview): MoveReview {
  const rewritten: MoveReview = { ...move, explanation: addressOpponent(move.explanation) };
  if (move.why) rewritten.why = storyForOpponent(move.why);
  if (move.bestIdea) rewritten.bestIdea = storyForOpponent(move.bestIdea);
  return rewritten;
}

/**
 * The review as `viewer` reads it: the texts of the other side's moves address `viewer`
 * (see addressOpponent). Returns the review itself when the viewer is unknown.
 */
export function reviewForViewer(review: GameReview, viewer: Color | null): GameReview {
  if (!viewer) return review;
  return {
    ...review,
    moves: review.moves.map((move) => (move.color === viewer ? move : moveForOpponent(move))),
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
