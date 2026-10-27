import type { Classification } from '@/core/types';

export interface ClassificationMeta {
  /** Short label for legends and tables, e.g. "Inaccuracy". */
  label: string;
  /** Indefinite article that goes with `phrase` ("an inaccuracy", "a blunder"). */
  article: 'a' | 'an';
  /** CSS colour of the label, e.g. "var(--c-blunder)". */
  colorVar: string;
  /** One-sentence explanation of what the label means, for legends and tooltips. */
  description: string;
  /** Noun phrase used in sentences: "Nf5 is a blunder", "e4 is a book move". */
  phrase: string;
  /** Annotation symbol for plain-text contexts (PGN export, screen readers skip it). */
  symbol: string;
}

/**
 * Display metadata for every classification. Colours come from the design tokens
 * in index.css (--c-<name>), so themes can restyle them in one place.
 */
export const CLASSIFICATION_META: Record<Classification, ClassificationMeta> = {
  brilliant: {
    label: 'Brilliant',
    article: 'a',
    colorVar: 'var(--c-brilliant)',
    description:
      'A sound sacrifice: the move gives up material and is still the best or close to it.',
    phrase: 'brilliant move',
    symbol: '!!',
  },
  great: {
    label: 'Great',
    article: 'a',
    colorVar: 'var(--c-great)',
    description: 'The only good move: every alternative was clearly worse.',
    phrase: 'great move',
    symbol: '!',
  },
  best: {
    label: 'Best',
    article: 'a',
    colorVar: 'var(--c-best)',
    description: "The engine's top choice, or a move that loses nothing.",
    phrase: 'best move',
    symbol: '★',
  },
  excellent: {
    label: 'Excellent',
    article: 'an',
    colorVar: 'var(--c-excellent)',
    description: 'Almost as good as the best move.',
    phrase: 'excellent move',
    symbol: '',
  },
  good: {
    label: 'Good',
    article: 'a',
    colorVar: 'var(--c-good)',
    description: 'A solid move that gives away only a little.',
    phrase: 'good move',
    symbol: '',
  },
  book: {
    label: 'Book',
    article: 'a',
    colorVar: 'var(--c-book)',
    description: 'A known opening move from the opening book.',
    phrase: 'book move',
    symbol: '',
  },
  forced: {
    label: 'Forced',
    article: 'a',
    colorVar: 'var(--c-forced)',
    description: 'The only legal move in the position.',
    phrase: 'forced move',
    symbol: '',
  },
  inaccuracy: {
    label: 'Inaccuracy',
    article: 'an',
    colorVar: 'var(--c-inaccuracy)',
    description: 'A weaker move that makes the position somewhat worse.',
    phrase: 'inaccuracy',
    symbol: '?!',
  },
  mistake: {
    label: 'Mistake',
    article: 'a',
    colorVar: 'var(--c-mistake)',
    description: 'A bad move that noticeably worsens the position.',
    phrase: 'mistake',
    symbol: '?',
  },
  blunder: {
    label: 'Blunder',
    article: 'a',
    colorVar: 'var(--c-blunder)',
    description: 'A serious error that throws away a large part of the advantage or the game.',
    phrase: 'blunder',
    symbol: '??',
  },
  missedWin: {
    label: 'Miss',
    article: 'a',
    colorVar: 'var(--c-missedWin)',
    description:
      "A real chance (a mate, a material win or your opponent's error to punish) was there, and the move let it slip.",
    phrase: 'miss',
    symbol: '?',
  },
};

/**
 * Sentence describing a move's label: "Nf5 is a blunder", "e4 is a book move",
 * "Qxd5 is the best move" (the definite article reads better for Best).
 */
export function verdictText(san: string, classification: Classification): string {
  const meta = CLASSIFICATION_META[classification];
  const article = classification === 'best' ? 'the' : meta.article;
  return `${san} is ${article} ${meta.phrase}`;
}
