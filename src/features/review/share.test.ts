import { describe, expect, it } from 'vitest';
import { initialPly, pgnFileName, reviewLink } from './share';

describe('reviewLink', () => {
  const base = 'https://kibitz.example/#/review/lichess/abcd1234';

  it('adds the ply to the hash route', () => {
    expect(reviewLink(base, 12)).toBe(`${base}?ply=12`);
  });

  it('replaces an existing ply and keeps other parameters', () => {
    expect(reviewLink(`${base}?ply=3&x=1`, 7)).toBe(`${base}?ply=7&x=1`);
  });

  it('removes the ply at the start position', () => {
    expect(reviewLink(`${base}?ply=3`, 0)).toBe(base);
    expect(reviewLink(base, 0)).toBe(base);
  });

  it('keeps the part before the hash untouched', () => {
    expect(reviewLink('http://localhost:5181/kibitz/?utm=a#/review/pgn/1', 2)).toBe(
      'http://localhost:5181/kibitz/?utm=a#/review/pgn/1?ply=2',
    );
  });

  it('uses the normal query without a hash', () => {
    expect(reviewLink('https://kibitz.example/review/x?a=b', 4)).toBe(
      'https://kibitz.example/review/x?a=b&ply=4',
    );
  });
});

describe('initialPly', () => {
  it('reads and clamps the ply', () => {
    expect(initialPly('?ply=12', 40)).toBe(12);
    expect(initialPly('?ply=99', 40)).toBe(40);
    expect(initialPly('?ply=0', 40)).toBe(0);
  });

  it('ignores missing or invalid values', () => {
    expect(initialPly('', 40)).toBe(0);
    expect(initialPly('?ply=-3', 40)).toBe(0);
    expect(initialPly('?ply=abc', 40)).toBe(0);
    expect(initialPly('?ply=2.5', 40)).toBe(0);
  });
});

describe('pgnFileName', () => {
  it('builds a safe name with the date', () => {
    expect(
      pgnFileName({
        white: { name: 'Paul Morphy' },
        black: { name: 'Duke Karl / Count Isouard' },
        endTime: Date.UTC(2024, 4, 1, 12),
      }),
    ).toBe('Paul-Morphy-vs-Duke-Karl-Count-Isouard-2024-05-01.pgn');
  });

  it('leaves out an unknown date and replaces empty names', () => {
    expect(pgnFileName({ white: { name: 'José' }, black: { name: '???' } })).toBe(
      'Jose-vs-Black.pgn',
    );
  });
});
