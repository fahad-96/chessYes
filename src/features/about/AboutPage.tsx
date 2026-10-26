import type { ReactNode } from 'react';
import { Cpu, ExternalLink, Gauge, Globe, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { LogoMark } from '@/components/ui/Logo';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import { CLASSIFICATION_DOC_URL, REPO_URL } from './links';

interface Credit {
  name: string;
  href: string;
  license: string;
  note: string;
  /** Link to a license text we ship with the app. */
  licenseHref?: string;
}

const STOCKFISH_LICENSE_URL = `${import.meta.env.BASE_URL}engine/STOCKFISH-LICENSE.txt`;

const CREDITS: Credit[] = [
  {
    name: 'Stockfish',
    href: 'https://github.com/official-stockfish/Stockfish',
    license: 'GPL-3.0',
    note: 'The chess engine behind every analysis.',
  },
  {
    name: 'stockfish.js',
    href: 'https://github.com/nmrugg/stockfish.js',
    license: 'GPL-3.0',
    note: 'Stockfish compiled to WebAssembly, by Nathan Rugg. Kibitz ships its single-threaded lite build unmodified.',
    licenseHref: STOCKFISH_LICENSE_URL,
  },
  {
    name: 'chessground',
    href: 'https://github.com/lichess-org/chessground',
    license: 'GPL-3.0',
    note: 'The interactive board, by the lichess-org developers.',
  },
  {
    name: 'chess.js',
    href: 'https://github.com/jhlywa/chess.js',
    license: 'BSD-2-Clause',
    note: 'Move generation, validation and PGN parsing.',
  },
  {
    name: 'chess-openings',
    href: 'https://github.com/lichess-org/chess-openings',
    license: 'CC0-1.0',
    note: 'Opening names and ECO codes, from the lichess-org dataset.',
  },
  {
    name: 'cburnett pieces',
    href: 'https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces',
    license: 'GPL-2.0-or-later / BSD / GFDL',
    note: 'Piece set by Colin M.L. Burnett.',
  },
  {
    name: 'React',
    href: 'https://react.dev',
    license: 'MIT',
    note: 'User interface library.',
  },
  {
    name: 'Tailwind CSS',
    href: 'https://tailwindcss.com',
    license: 'MIT',
    note: 'Styling.',
  },
  {
    name: 'Lucide',
    href: 'https://lucide.dev',
    license: 'ISC',
    note: 'Icons.',
  },
];

const HOW_IT_WORKS: { icon: ReactNode; title: string; body: ReactNode }[] = [
  {
    icon: <Globe className="h-5 w-5" />,
    title: 'Your games, from public APIs',
    body: (
      <>
        Games are fetched straight from your browser through the public Chess.com Published-Data API
        and the Lichess API. No key, no login, no server of ours in between. You can also paste any
        PGN.
      </>
    ),
  },
  {
    icon: <Cpu className="h-5 w-5" />,
    title: 'Stockfish on your device',
    body: (
      <>
        Stockfish 19, compiled to WebAssembly, runs in a Web Worker in your browser. It searches
        every position of the game, so a review costs nothing to run and works on phones too.
      </>
    ),
  },
  {
    icon: <Gauge className="h-5 w-5" />,
    title: 'Classified by win % lost',
    body: (
      <>
        Each move is judged by how much it lowered your chance of winning, the open model Lichess
        uses for accuracy. A centipawn matters more in a level position than when you are a rook up,
        and win % captures that. The exact rules are in{' '}
        <a
          href={CLASSIFICATION_DOC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-4 hover:underline"
        >
          docs/CLASSIFICATION.md
        </a>
        .
      </>
    ),
  },
  {
    icon: <Lock className="h-5 w-5" />,
    title: 'Private by design',
    body: (
      <>
        No accounts, no tracking, no ads. Your games, analyses and settings are stored only in your
        browser, and you can clear them any time in{' '}
        <Link to="/settings" className="text-accent underline-offset-4 hover:underline">
          Settings
        </Link>
        .
      </>
    ),
  },
];

/** /about: what Kibitz is, how it works, privacy, credits and licenses. */
export default function AboutPage() {
  useDocumentTitle('About · Kibitz');
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="flex items-start gap-4">
        <LogoMark size={48} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">About Kibitz</h1>
          <p className="mt-2 leading-relaxed text-muted">
            To kibitz is to comment on a game you are watching. Kibitz comments on yours: a free,
            open-source game review for every chess player, with every move classified, accuracy for
            both sides, an evaluation graph and plain-English explanations. Game review should not
            sit behind a paywall.
          </p>
        </div>
      </header>

      <section aria-labelledby="how-heading" className="space-y-3">
        <h2 id="how-heading" className="text-lg font-semibold">
          How it works
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.title}>
              <Card className="h-full p-4">
                <span
                  className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent"
                  aria-hidden="true"
                >
                  {item.icon}
                </span>
                <h3 className="font-medium">{item.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{item.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="licenses-heading" className="space-y-3">
        <h2 id="licenses-heading" className="text-lg font-semibold">
          Credits and licenses
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Kibitz is free software under the{' '}
          <a
            href={`${REPO_URL}/blob/main/LICENSE`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-4 hover:underline"
          >
            GNU GPL v3.0 or later
          </a>
          . The complete source code is on{' '}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-4 hover:underline"
          >
            GitHub
          </a>
          . It stands on the shoulders of these projects:
        </p>
        <Card className="divide-y divide-line">
          {CREDITS.map((credit) => (
            <div
              key={credit.name}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <a
                  href={credit.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:text-accent hover:underline"
                >
                  {credit.name}
                  <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                </a>
                <p className="mt-0.5 text-sm text-muted">{credit.note}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:justify-end">
                <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                  {credit.license}
                </span>
                {credit.licenseHref && (
                  <a
                    href={credit.licenseHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline-offset-4 hover:underline"
                  >
                    License text
                  </a>
                )}
              </div>
            </div>
          ))}
        </Card>
      </section>

      <section
        aria-labelledby="disclaimer-heading"
        className="rounded-2xl border border-line bg-surface-2 p-4"
      >
        <h2 id="disclaimer-heading" className="text-sm font-semibold">
          Disclaimer
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Kibitz is an independent project. It is not affiliated with, endorsed by, or connected to
          Chess.com or Lichess.
        </p>
      </section>
    </div>
  );
}
