/**
 * The voice coach's words: what is said for a move of the game, and for a key moment.
 * Pure, so the wording can be tested without a speech engine.
 */
import type { GameReview, ParsedGame } from '@/core/types';
import { moveNumberLabel } from '@/core/notation';
import { storyMatters } from '@/core/tactics';
import { capitalize, moveNarration, textToSpeech } from '@/voice/speakable';

/** Shortest time a key moment stays on screen while it is narrated. */
export const TOUR_MIN_MS = 2500;
/** Pause after a key moment has been told, before the next one. */
export const TOUR_GAP_MS = 900;

/**
 * What the coach says for the move at `ply`: the verdict and the story of the move (or its
 * explanation), or just the move while it has not been analysed. Empty at the start.
 */
export function narrationAt(game: ParsedGame, review: GameReview | null, ply: number): string {
  const move = game.moves[ply - 1];
  if (!move) return '';
  const moveReview = review?.moves[ply - 1];
  if (!moveReview) return capitalize(textToSpeech(`${move.san}.`));
  // The explanation usually leads with the story already, and says more around it; the
  // story is told instead only when it shows something the explanation leaves out. Not
  // for a Miss: its explanation is about the chance let go ("You had mate in 6..."), and
  // already tells the opponent's reply when that is the main reason.
  const { why, explanation, classification } = moveReview;
  const story =
    why &&
    classification !== 'missedWin' &&
    storyMatters(why) &&
    !explanation.includes(why.text.trim())
      ? why.text
      : undefined;
  return moveNarration({
    san: move.san,
    color: move.color,
    classification: moveReview.classification,
    explanation,
    story,
    bestSan: moveReview.best?.san,
  });
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
