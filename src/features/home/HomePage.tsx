import { Link } from 'react-router-dom';
import heroUrl from '@/assets/brand/hero-chess.webp';
import { GithubIcon } from '@/components/ui/GithubIcon';
import { LogoMark } from '@/components/ui/Logo';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import { pageTitle } from '@/app/seo';
import { REPO_URL } from '@/features/about/links';

/** The quiet row of links at the foot of the landing page (also how search engines find the app). */
const FOOT_LINKS = [
  { to: '/home', label: 'Free game review' },
  { to: '/import', label: 'PGN analysis' },
  { to: '/play', label: 'Play Stockfish' },
  { to: '/puzzles', label: 'Puzzles' },
  { to: '/about#faq', label: 'FAQ' },
  { to: '/about', label: 'About' },
] as const;

/**
 * The landing page: one screen, the photo, the headline and a single way in. Everything else
 * lives in the app behind "Get started" (/home). Layout renders this page without its header
 * and footer. The hero is dark in every theme, so its text is always light.
 */
export default function HomePage() {
  useDocumentTitle(pageTitle('/'));
  return (
    <div className="kb-hero relative isolate flex min-h-[100svh] flex-col overflow-hidden text-white">
      <img
        src={heroUrl}
        alt=""
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 -z-20 h-full w-full object-cover object-[58%_40%]"
      />
      <div aria-hidden="true" className="kb-hero-scrim-left absolute inset-0 -z-10" />

      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 pt-5 sm:px-8 sm:pt-7">
        <Link
          to="/"
          aria-label="Chess Yes home"
          className="inline-flex items-center gap-3 rounded-lg"
        >
          <LogoMark size={40} />
          <span className="font-display text-[1.9rem] leading-none tracking-tight">
            Chess <em className="text-[#9ed36a]">Yes</em>
          </span>
        </Link>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <GithubIcon className="h-5 w-5" />
          <span className="sr-only">Source code on GitHub</span>
        </a>
      </header>

      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {/* The headline sits on the left, over the darker side of the photo. */}
        <div className="mx-auto flex w-full max-w-7xl flex-1 items-center px-5 py-10 sm:px-8">
          <div className="max-w-xl">
            <p className="mb-6 text-xs font-medium tracking-[0.22em] text-white/70 uppercase">
              Free chess game review
            </p>
            <h1 className="font-display text-[clamp(3.6rem,10vw,8rem)] leading-[0.9] tracking-[-0.02em] drop-shadow-[0_6px_40px_rgb(0_0_0/0.5)]">
              Every move,
              <br />
              <em className="kb-display-accent">explained.</em>
            </h1>
            <p className="mt-6 max-w-sm text-base text-pretty text-white/80 sm:text-lg">
              Stockfish in your browser. Your Chess.com and Lichess games, reviewed for free.
            </p>
          </div>
        </div>
        {/* One way in, centred low on the screen. */}
        <div className="flex justify-center px-5 pb-8 sm:pb-10">
          <Link
            to="/home"
            className="kb-start inline-flex h-14 min-w-44 items-center justify-center rounded-full px-10 text-lg font-bold tracking-[0.28em] uppercase sm:h-16 sm:min-w-52"
          >
            Start
          </Link>
        </div>
      </main>

      <footer className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-7">
        <nav aria-label="Chess Yes">
          <ul className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/70">
            {FOOT_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="transition-colors hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
            <li aria-hidden="true" className="text-white/30">
              ·
            </li>
            <li className="text-white/50">© {new Date().getFullYear()} Chess Yes</li>
          </ul>
        </nav>
      </footer>
    </div>
  );
}
