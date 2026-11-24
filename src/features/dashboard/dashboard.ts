import type { GameRecord, TimeClass } from '@/core/types';
import { playerColor } from '@/features/games/gameList';

/** "Good morning" (5:00-11:59), "Good afternoon" (12:00-17:59) or "Good evening". */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export interface RatingChip {
  timeClass: TimeClass;
  rating: number;
}

/** The time classes shown as rating chips, in this order. */
const RATED_CLASSES: TimeClass[] = ['rapid', 'blitz', 'bullet', 'classical', 'daily'];

/**
 * The player's current rating per time class, read from their most recent game of each class
 * (no extra request: the games carry the ratings). Classes they have not played are left out.
 */
export function latestRatings(games: readonly GameRecord[], username: string): RatingChip[] {
  const newestFirst = [...games].sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
  const chips: RatingChip[] = [];
  for (const timeClass of RATED_CLASSES) {
    for (const game of newestFirst) {
      if (game.timeClass !== timeClass) continue;
      const color = playerColor(game, username);
      const rating =
        color === 'w' ? game.white.rating : color === 'b' ? game.black.rating : undefined;
      if (rating !== undefined) {
        chips.push({ timeClass, rating });
        break;
      }
    }
  }
  return chips;
}

/** The newest games first, at most `count`. */
export function recentGames(games: readonly GameRecord[], count: number): GameRecord[] {
  return [...games].sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0)).slice(0, count);
}
