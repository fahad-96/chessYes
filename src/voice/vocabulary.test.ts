import { describe, expect, it } from 'vitest';
import { RATED_GAMES } from '@/core/__fixtures__/rated';
import {
  CLIPS,
  VOCABULARY,
  VOICE,
  clipList,
  numberWords,
  sanClipKeys,
  verdictKeys,
} from './vocabulary';

const FILES = 'abcdefgh';
const SQUARES = [...FILES].flatMap((file) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${file}${r}`));
const SUFFIXES = ['', '+', '#'];

/** Every shape of SAN a game can contain, with disambiguation and annotations. */
function everySan(): string[] {
  const sans: string[] = [];
  for (const piece of 'KQRBN') {
    for (const from of ['', 'b', '3', 'b3']) {
      for (const capture of ['', 'x']) {
        for (const square of SQUARES) {
          for (const suffix of SUFFIXES) sans.push(`${piece}${from}${capture}${square}${suffix}`);
        }
      }
    }
  }
  for (const [i, file] of [...FILES].entries()) {
    for (let rank = 1; rank <= 8; rank++) {
      const lastRank = rank === 1 || rank === 8;
      const endings = lastRank ? ['=Q', '=R', '=B', '=N'] : [''];
      for (const ending of endings) {
        for (const suffix of SUFFIXES) {
          sans.push(`${file}${rank}${ending}${suffix}`);
          for (const target of [FILES[i - 1], FILES[i + 1]]) {
            if (target) sans.push(`${file}x${target}${rank}${ending}${suffix}`);
          }
        }
      }
    }
  }
  for (const castle of ['O-O', 'O-O-O', '0-0', '0-0-0']) {
    for (const suffix of SUFFIXES) sans.push(`${castle}${suffix}`);
  }
  return sans;
}

describe('the vocabulary', () => {
  it('has unique ASCII keys in four namespaces and stays under 3,000 clips', () => {
    expect(CLIPS.size).toBe(VOCABULARY.length);
    expect(VOCABULARY.length).toBeLessThan(3000);
    for (const { key, text, caption } of VOCABULARY) {
      expect(key).toMatch(/^(move|sq|phrase|num):[\x21-\x7e]+$/);
      expect(text).toMatch(/^[\x20-\x7e]+$/);
      expect(text.trim()).toBe(text);
      expect(caption.length).toBeGreaterThan(0);
    }
    const counts: Record<string, number> = {};
    for (const { key } of VOCABULARY) {
      const namespace = key.split(':')[0]!;
      counts[namespace] = (counts[namespace] ?? 0) + 1;
    }
    expect(counts).toEqual({ move: 2206, sq: 160, phrase: 323, num: 101 });
  });

  it('never says "you": every clip is right for either player', () => {
    for (const { text } of VOCABULARY) expect(text).not.toMatch(/\b(?:you|your)\b/i);
  });

  it('says every SAN a game can contain', () => {
    const missing = everySan().filter((san) => {
      const keys = sanClipKeys(san);
      return keys.length === 0 || keys.some((key) => !CLIPS.has(key));
    });
    expect(missing).toEqual([]);
    for (const { game } of RATED_GAMES) {
      for (const move of game.moves) {
        expect(sanClipKeys(move.san).every((key) => CLIPS.has(key))).toBe(true);
      }
    }
  });

  it('maps SAN to its clips, dropping disambiguation and annotations', () => {
    expect(sanClipKeys('Nf3')).toEqual(['move:Nf3']);
    expect(sanClipKeys('Nbd7+')).toEqual(['move:Nd7+']);
    expect(sanClipKeys('R1xe2#')).toEqual(['move:Rxe2#']);
    expect(sanClipKeys('Qh4xe1!?')).toEqual(['move:Qxe1']);
    expect(sanClipKeys('e4')).toEqual(['sq:e4']);
    expect(sanClipKeys('e7+')).toEqual(['sq:e7+']);
    expect(sanClipKeys('exd5#')).toEqual(['move:exd5#']);
    expect(sanClipKeys('e8=Q')).toEqual(['sq:e8', 'phrase:promote_q']);
    expect(sanClipKeys('exd1=N+')).toEqual(['move:exd1', 'phrase:promote_n_check']);
    expect(sanClipKeys('O-O-O+')).toEqual(['move:O-O-O+']);
    expect(sanClipKeys('0-0')).toEqual(['move:O-O']);
    expect(sanClipKeys('1-0')).toEqual([]);
    expect(sanClipKeys('hello')).toEqual([]);
  });

  it('builds the check or mate into the move, and spells the a-file for the model', () => {
    expect(CLIPS.get('move:Nf3+')?.text).toBe('Knight to f3, check!');
    expect(CLIPS.get('move:Nxe5#')?.text).toBe('Knight takes e5, checkmate!');
    expect(CLIPS.get('move:exd5')?.text).toBe('e takes d5');
    expect(CLIPS.get('move:O-O+')?.text).toBe('Castles kingside, check!');
    expect(CLIPS.get('sq:e4')?.text).toBe('e4');
    expect(CLIPS.get('phrase:promote_q_mate')?.text).toBe('promoting to a queen, checkmate!');
    // eSpeak reads a lone "a" as the article; the caption keeps the notation.
    expect(CLIPS.get('move:axb6')).toMatchObject({ text: 'Eh takes b6', caption: 'a takes b6' });
    expect(CLIPS.get('phrase:castling_queenside_check')?.text).toBe('Castling queenside, check!');
  });

  it('lists forked pieces the way a coach says them', () => {
    expect(CLIPS.get('phrase:fork_kq')?.text).toBe('forking the king and queen.');
    expect(CLIPS.get('phrase:fork_rr')?.text).toBe('forking both rooks.');
    expect(CLIPS.get('phrase:fork_kqr')?.text).toBe('forking the king, queen and rook.');
    expect(CLIPS.get('phrase:fork_krr')?.text).toBe('forking the king and both rooks.');
    expect(CLIPS.get('phrase:fork_rrb')?.text).toBe('forking both rooks and the bishop.');
  });

  it('has two or three ways to say each verdict', () => {
    for (const classification of ['brilliant', 'blunder', 'missedWin'] as const) {
      const keys = verdictKeys(classification);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      expect(keys.every((key) => CLIPS.has(key))).toBe(true);
    }
    expect(CLIPS.get(verdictKeys('blunder')[0]!)?.text).toBe("That's a blunder.");
  });

  it('says numbers in words', () => {
    expect([0, 7, 15, 20, 21, 73, 99, 100].map(numberWords)).toEqual([
      'zero',
      'seven',
      'fifteen',
      'twenty',
      'twenty-one',
      'seventy-three',
      'ninety-nine',
      'one hundred',
    ]);
    expect(CLIPS.get('num:73')).toMatchObject({ text: 'seventy-three.', caption: '73.' });
  });

  it('lists the clips for the voice pack in a stable order', () => {
    const list = clipList();
    expect(list.version).toBe(1);
    expect(list.voice).toBe(VOICE);
    expect(list.clips).toHaveLength(VOCABULARY.length);
    expect(list.clips[0]).toEqual({ key: 'move:Ka1', text: 'King to a1' });
    expect(Object.keys(list.clips[0]!)).toEqual(['key', 'text']);
  });
});
