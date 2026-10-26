import type { PuzzleTheme } from './generate';

/** Display names of the puzzle themes (filter chips and the solution panel). */
export const THEME_LABELS: Record<PuzzleTheme, string> = {
  mate: 'Mate',
  material: 'Win material',
  defence: 'Defence',
  'missed-win': 'Missed win',
  endgame: 'Endgame',
};

/** What each theme means, for tooltips and screen readers. */
export const THEME_DESCRIPTIONS: Record<PuzzleTheme, string> = {
  mate: 'The best line ends in checkmate.',
  material: 'The best line wins at least two pawns’ worth of material.',
  defence: 'You were worse: find the move that holds.',
  'missed-win': 'You were winning, and the move played let the win slip.',
  endgame: 'Few pieces are left on the board.',
};
