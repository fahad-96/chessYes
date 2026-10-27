/**
 * The voice coach's words: the coach line for a move of the game, for a key moment and for
 * the story on the board. Pure, so the wording can be tested without a speech engine.
 * Lines come from voice/coachScript.ts: clips of the coach voice pack, with the same words as
 * text for the device voice.
 */
import type { GameReview, ParsedGame } from '@/core/types';
import { moveNumberLabel } from '@/core/notation';
import { coachScript, coachSummary, sanClipKeys, scriptFromKeys } from '@/voice/coachScript';
import type { CoachScript } from '@/voice/coachScript';
import { capitalize, textToSpeech } from '@/voice/speakable';
import type { Variation } from './variation';

/** Shortest time a key moment stays on screen while it is narrated. */
export const TOUR_MIN_MS = 2500;
/** Pause after a key moment has been told, before the next one. */
export const TOUR_GAP_MS = 900;
/** Lines prefetched ahead of the move being narrated (fewer on slow connections). */
export const PREFETCH_LINES = 3;

const SILENCE: CoachScript = { segments: [], text: '' };

/**
 * What the coach says for the move at `ply`: the move, its verdict and the main reason, or
 * just the move while it has not been analysed. Silent at the start.
 */
export function narrationAt(game: ParsedGame, review: GameReview | null, ply: number): CoachScript {
  const move = game.moves[ply - 1];
  if (!move) return SILENCE;
  const moveReview = review?.moves[ply - 1];
  const script =
    moveReview && moveReview.san === move.san
      ? coachScript(moveReview)
      : scriptFromKeys(sanClipKeys(move.san));
  // A move the vocabulary cannot say (it never happens in a legal game): the device voice reads it.
  if (script.segments.length === 0)
    return { segments: [], text: capitalize(textToSpeech(`${move.san}.`)) };
  return script;
}

/**
 * Said when narration is switched on before the first move: the accuracies when the game is
 * reviewed, otherwise a short sentence in the device voice.
 */
export function introduction(review: GameReview | null): CoachScript | string {
  return review
    ? coachSummary(review)
    : 'I will read each move aloud as you step through the game.';
}

/** The move of the game a story ("Show why") is about: after its move, or instead of it. */
export function storyMovePly(variation: Variation | null): number | null {
  if (variation?.kind !== 'story' || !variation.story) return null;
  return variation.story.afterMove ? variation.startPly : variation.startPly + 1;
}

/** The coach line for the move whose story is on the board. */
export function storyNarration(
  game: ParsedGame,
  review: GameReview | null,
  variation: Variation | null,
): CoachScript {
  const ply = storyMovePly(variation);
  return ply === null ? SILENCE : narrationAt(game, review, ply);
}

/** The lines of the given moves (the next few), to prefetch while one is narrated. */
export function upcomingLines(
  game: ParsedGame,
  review: GameReview | null,
  plies: readonly number[],
): CoachScript[] {
  return plies.map((ply) => narrationAt(game, review, ply)).filter((s) => s.segments.length > 0);
}

/** "31. Rg8" for the move at `ply`, or "" when there is none. */
export function moveLabelAt(game: ParsedGame, ply: number): string {
  const move = game.moves[ply - 1];
  return move ? `${moveNumberLabel(move.moveNumber, move.color)} ${move.san}` : '';
}

/** Key moments that can be narrated: plies of the game that have a reviewed move. */
export function tourPlies(game: ParsedGame, review: GameReview | null): number[] {
  if (!review) return [];
  return review.keyMoments.filter((ply) => !!game.moves[ply - 1] && !!review.moves[ply - 1]);
}
