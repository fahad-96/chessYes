import { describe, expect, it } from 'vitest';
import { FAQ } from '@/features/home/faq';
import { renderPage } from './entry-server';

// The same rendering the build uses to write the public pages as static HTML.
describe('renderPage', () => {
  it('renders the landing page in place, with its heading and links', async () => {
    const html = await renderPage('/');
    expect(html).toContain('Free chess game review');
    expect(html).toMatch(/>Start<\/a>/);
    expect(html).toMatch(/href="\/play"/);
    // Plain HTML: no hidden content waiting for a script, no loading spinner.
    expect(html).not.toMatch(/<script|hidden id="S:|aria-label="Loading"/);
  });

  it('renders each public page', async () => {
    expect(await renderPage('/play')).toContain('The eight levels');
    expect(await renderPage('/puzzles')).toMatch(/<h1[^>]*>Puzzles<\/h1>/);
    const about = await renderPage('/about');
    expect(about).toContain('About Chess Yes');
    expect(about).toContain(FAQ[0]!.question);
    expect(await renderPage('/home')).toContain('Connect your account');
  });

  it('renders the not-found page for unknown paths', async () => {
    expect(await renderPage('/no-such-page')).toContain('This page is off the board');
  });

  it('renders under a sub-path base URL', async () => {
    const html = await renderPage('/play', '/chessYes/');
    expect(html).toContain('Play Stockfish');
    expect(html).toMatch(/href="\/chessYes\/import"|href="\/chessYes\/"/);
  });
});
