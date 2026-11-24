/**
 * The questions on the home page. Plain data, so the same answers also go into the page's
 * structured data (FAQPage, see app/seo.ts).
 */
export interface FaqItem {
  question: string;
  answer: string;
  /** An in-app link shown after the answer. */
  link?: { to: string; label: string };
}

export const FAQ: readonly FaqItem[] = [
  {
    question: 'Is Chess Yes really free?',
    answer:
      'Yes, completely. There is no account, no paywall and no limit on how many games you review. Stockfish runs in your own browser, so a review costs nothing to run, and the code is open source under the GPL.',
  },
  {
    question: 'How do I review my Chess.com games for free?',
    answer:
      'Enter your Chess.com username above and pick a game. Chess Yes reviews it in seconds: every move classified from Brilliant to Blunder, accuracy for both players, an evaluation graph and the reason behind each key move. You can also paste a game link or a PGN.',
  },
  {
    question: 'Does it work with Lichess games?',
    answer:
      'Yes. Choose Lichess, enter your username or paste a game link, and the review works the same way. A PGN from any other site or from a book works too.',
    link: { to: '/import', label: 'Paste a PGN' },
  },
  {
    question: 'How is accuracy calculated?',
    answer:
      "Every move is judged by how much it lowered your chance of winning, worked out from Stockfish's evaluation before and after the move. The accuracy model is calibrated against published accuracy figures from Chess.com game reviews, so the numbers come close to them, and the Lichess scale is one switch away in Settings.",
    link: { to: '/about', label: 'How it works' },
  },
  {
    question: 'Can I play against Stockfish?',
    answer:
      'Yes. Play lets you face Stockfish at eight levels, from a beginner who leaves pieces hanging to full strength. When the game is over, review it move by move in one click.',
    link: { to: '/play', label: 'Play Stockfish' },
  },
  {
    question: 'Are my games private?',
    answer:
      'Yes. Games, analyses and puzzles are stored only in your browser. There are no accounts, no ads and no tracking.',
  },
  {
    question: 'Does it work on my phone, and offline?',
    answer:
      'Yes. Analysis depth adapts to your device, you can swipe through the moves, and after the first visit Chess Yes installs as an app and works offline.',
  },
];
