import { describe, expect, it } from 'vitest';
import { isPlatform, parseUsernameInput, playerPath, validateUsername } from './username';

describe('validateUsername', () => {
  it('accepts valid Chess.com usernames', () => {
    expect(validateUsername('chesscom', 'hikaru')).toBeNull();
    expect(validateUsername('chesscom', 'Magnus_Carlsen-2')).toBeNull();
    expect(validateUsername('chesscom', '  abc  ')).toBeNull();
    expect(validateUsername('chesscom', 'a'.repeat(25))).toBeNull();
  });

  it('applies Chess.com length limits (3-25)', () => {
    expect(validateUsername('chesscom', 'ab')).toMatch(/3 to 25/);
    expect(validateUsername('chesscom', 'a'.repeat(26))).toMatch(/3 to 25/);
  });

  it('applies Lichess length limits (2-30)', () => {
    expect(validateUsername('lichess', 'ab')).toBeNull();
    expect(validateUsername('lichess', 'a'.repeat(30))).toBeNull();
    expect(validateUsername('lichess', 'a')).toMatch(/2 to 30/);
    expect(validateUsername('lichess', 'a'.repeat(31))).toMatch(/2 to 30/);
  });

  it('rejects empty input and invalid characters', () => {
    expect(validateUsername('chesscom', '   ')).toBe('Enter a Chess.com username.');
    expect(validateUsername('lichess', '')).toBe('Enter a Lichess username.');
    expect(validateUsername('chesscom', 'bad name')).toMatch(/letters, numbers/);
    expect(validateUsername('lichess', 'name!')).toMatch(/letters, numbers/);
    expect(validateUsername('lichess', 'naïve')).toMatch(/letters, numbers/);
  });
});

describe('parseUsernameInput', () => {
  it('keeps bare usernames and strips a leading @', () => {
    expect(parseUsernameInput('  hikaru ')).toEqual({ username: 'hikaru' });
    expect(parseUsernameInput('@DrNykterstein')).toEqual({ username: 'DrNykterstein' });
  });

  it('extracts Chess.com profile URLs', () => {
    expect(parseUsernameInput('https://www.chess.com/member/Hikaru')).toEqual({
      username: 'Hikaru',
      platform: 'chesscom',
    });
    expect(parseUsernameInput('chess.com/member/hikaru/games?x=1')).toEqual({
      username: 'hikaru',
      platform: 'chesscom',
    });
    expect(parseUsernameInput('https://www.chess.com/stats/live/rapid/hikaru')).toEqual({
      username: 'hikaru',
      platform: 'chesscom',
    });
  });

  it('extracts Lichess profile URLs', () => {
    expect(parseUsernameInput('https://lichess.org/@/DrNykterstein')).toEqual({
      username: 'DrNykterstein',
      platform: 'lichess',
    });
    expect(parseUsernameInput('lichess.org/@/thibault/all')).toEqual({
      username: 'thibault',
      platform: 'lichess',
    });
  });

  it('falls back to the raw text for unrecognised URLs', () => {
    expect(parseUsernameInput('https://lichess.org/abcd1234').platform).toBeUndefined();
  });
});

describe('helpers', () => {
  it('recognises platforms', () => {
    expect(isPlatform('chesscom')).toBe(true);
    expect(isPlatform('lichess')).toBe(true);
    expect(isPlatform('chess.com')).toBe(false);
    expect(isPlatform(undefined)).toBe(false);
  });

  it('builds player routes', () => {
    expect(playerPath('chesscom', ' hikaru ')).toBe('/player/chesscom/hikaru');
    expect(playerPath('lichess', 'a-b_c')).toBe('/player/lichess/a-b_c');
  });
});
