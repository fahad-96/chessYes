import { describe, expect, it } from 'vitest';
import { basenameFor, pathFromLegacyHash } from './routes';

describe('basenameFor', () => {
  it('turns the base URL into a router basename', () => {
    expect(basenameFor('/')).toBe('/');
    expect(basenameFor('/chessYes/')).toBe('/chessYes');
    expect(basenameFor('')).toBe('/');
  });
});

describe('pathFromLegacyHash', () => {
  it('turns an old #/ link into the path, keeping its query', () => {
    expect(pathFromLegacyHash('/', '#/review/lichess/abcd1234?ply=12')).toBe(
      '/review/lichess/abcd1234?ply=12',
    );
    expect(pathFromLegacyHash('/', '#/import')).toBe('/import');
    expect(pathFromLegacyHash('/', '#/')).toBe('/');
  });

  it('keeps a sub-path base', () => {
    expect(pathFromLegacyHash('/chessYes/', '#/play')).toBe('/chessYes/play');
  });

  it('leaves other fragments alone', () => {
    expect(pathFromLegacyHash('/', '')).toBeNull();
    expect(pathFromLegacyHash('/', '#main')).toBeNull();
    expect(pathFromLegacyHash('/', '#')).toBeNull();
  });
});
