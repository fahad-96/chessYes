import { describe, expect, it } from 'vitest';
import { parseBestMove, parseInfoLine } from './uci';

const FULL_LINE =
  'info depth 12 seldepth 18 multipv 1 score cp 34 nodes 12345 nps 500000 hashfull 10 ' +
  'tbhits 0 time 24 pv e2e4 e7e5 g1f3';

describe('parseInfoLine', () => {
  it('parses every field of a full line with White to move', () => {
    expect(parseInfoLine(FULL_LINE, 'w')).toEqual({
      depth: 12,
      seldepth: 18,
      multipv: 1,
      score: { type: 'cp', value: 34 },
      bound: false,
      pv: ['e2e4', 'e7e5', 'g1f3'],
      nodes: 12345,
      nps: 500000,
      timeMs: 24,
    });
  });

  it('negates centipawn scores when Black is to move', () => {
    const info = parseInfoLine('info depth 10 multipv 2 score cp 34 pv e7e5 g1f3', 'b');
    expect(info?.score).toEqual({ type: 'cp', value: -34 });
    expect(info?.multipv).toBe(2);
  });

  it('keeps a zero score as plain 0 (not -0) when Black is to move', () => {
    // toBe uses Object.is, so this fails for -0.
    expect(parseInfoLine('info depth 5 score cp 0 pv e7e5', 'b')?.score.value).toBe(0);
  });

  it('converts mate scores to White’s point of view', () => {
    // White to move and mates in 3.
    expect(parseInfoLine('info depth 20 score mate 3 pv a1a8', 'w')?.score).toEqual({
      type: 'mate',
      value: 3,
    });
    // White to move and gets mated in 2.
    expect(parseInfoLine('info depth 20 score mate -2 pv g1h1', 'w')?.score).toEqual({
      type: 'mate',
      value: -2,
    });
    // Black to move and gets mated in 3: White mates in 3.
    expect(parseInfoLine('info depth 20 score mate -3 pv g8h8', 'b')?.score).toEqual({
      type: 'mate',
      value: 3,
    });
    // Black to move and mates in 1: White gets mated.
    expect(parseInfoLine('info depth 20 score mate 1 pv a8a1', 'b')?.score).toEqual({
      type: 'mate',
      value: -1,
    });
  });

  it('flags lowerbound and upperbound scores', () => {
    const lower = parseInfoLine('info depth 14 score cp 20 lowerbound nodes 99 pv d2d4', 'w');
    expect(lower).toMatchObject({ bound: true, score: { type: 'cp', value: 20 }, nodes: 99 });
    const upper = parseInfoLine('info depth 14 score cp 20 upperbound pv d7d5', 'b');
    expect(upper).toMatchObject({ bound: true, score: { type: 'cp', value: -20 } });
  });

  it('defaults multipv to 1 and leaves missing optional fields undefined', () => {
    const info = parseInfoLine('info depth 3 score cp -15 pv g1f3', 'w');
    expect(info).toEqual({
      depth: 3,
      multipv: 1,
      score: { type: 'cp', value: -15 },
      bound: false,
      pv: ['g1f3'],
    });
  });

  it('reads the optional wdl triple and flips it for Black', () => {
    const line = 'info depth 9 multipv 1 score cp 50 wdl 300 600 100 nodes 10 pv e2e4';
    expect(parseInfoLine(line, 'w')?.wdl).toEqual([300, 600, 100]);
    expect(parseInfoLine(line, 'b')?.wdl).toEqual([100, 600, 300]);
    expect(parseInfoLine(line, 'w')?.nodes).toBe(10);
  });

  it('returns null for lines without a score or a pv', () => {
    expect(parseInfoLine('info string NNUE evaluation using nn-61e7af4bb97d.nnue', 'w')).toBeNull();
    expect(parseInfoLine('info depth 1 currmove e2e4 currmovenumber 1', 'w')).toBeNull();
    expect(parseInfoLine('info depth 0 score mate 0', 'w')).toBeNull();
    expect(parseInfoLine('info depth 7 score cp 12 nodes 100', 'w')).toBeNull();
    expect(parseInfoLine('info nodes 100 score cp 12 pv e2e4', 'w')).toBeNull();
  });

  it('ignores lines that are not info lines', () => {
    expect(parseInfoLine('bestmove e2e4', 'w')).toBeNull();
    expect(parseInfoLine('readyok', 'w')).toBeNull();
    expect(parseInfoLine('', 'w')).toBeNull();
  });

  it('tolerates extra whitespace and unknown tokens', () => {
    const info = parseInfoLine('  info  depth 4 sbhits 3 score  cp 7  pv  e2e4  e7e5 ', 'w');
    expect(info).toMatchObject({ depth: 4, score: { type: 'cp', value: 7 }, pv: ['e2e4', 'e7e5'] });
  });
});

describe('parseBestMove', () => {
  it('parses a best move with a ponder move', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ best: 'e2e4', ponder: 'e7e5' });
  });

  it('parses a best move without ponder, including promotions', () => {
    expect(parseBestMove('bestmove e7e8q')).toEqual({ best: 'e7e8q' });
  });

  it('returns a null best move when there is no legal move', () => {
    expect(parseBestMove('bestmove (none)')).toEqual({ best: null });
  });

  it('returns null for other lines', () => {
    expect(parseBestMove('info depth 1 score cp 0 pv e2e4')).toBeNull();
    expect(parseBestMove('uciok')).toBeNull();
  });
});
