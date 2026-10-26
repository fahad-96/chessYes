import { describe, expect, it, vi } from 'vitest';
import { START_FEN } from '@/core/notation';
import { checkMove, verdictForLoss } from './checkMove';

describe('verdictForLoss', () => {
  it('uses the review thresholds', () => {
    expect(verdictForLoss(0)).toBe('excellent');
    expect(verdictForLoss(2)).toBe('excellent');
    expect(verdictForLoss(2.1)).toBe('good');
    expect(verdictForLoss(5)).toBe('good');
    expect(verdictForLoss(5.1)).toBe('wrong');
  });
});

describe('checkMove', () => {
  it('accepts the engine move without evaluating', async () => {
    const evaluate = vi.fn();
    const result = await checkMove({
      fen: START_FEN,
      uci: 'e2e4',
      bestUci: 'e2e4',
      winBest: 55,
      evaluate,
    });
    expect(result).toEqual({ verdict: 'best', legal: true, winAfter: 55, loss: 0, san: 'e4' });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('rejects illegal moves', async () => {
    const result = await checkMove({ fen: START_FEN, uci: 'e2e5', bestUci: 'e2e4', winBest: 55 });
    expect(result.legal).toBe(false);
    expect(result.verdict).toBe('wrong');
  });

  it('uses known evaluations before asking the engine', async () => {
    const evaluate = vi.fn();
    const result = await checkMove({
      fen: START_FEN,
      uci: 'd2d4',
      bestUci: 'e2e4',
      winBest: 55,
      known: [{ uci: 'd2d4', win: 54 }],
      evaluate,
    });
    expect(result.verdict).toBe('excellent');
    expect(result.loss).toBe(1);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('asks the evaluator for unknown moves and grades the loss', async () => {
    const evaluate = vi.fn().mockResolvedValue(45);
    const result = await checkMove({
      fen: START_FEN,
      uci: 'g1h3',
      bestUci: 'e2e4',
      winBest: 55,
      evaluate,
    });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(result.verdict).toBe('wrong');
    expect(result.loss).toBe(10);
  });

  it('treats any checkmate as winning, even if it is not the engine move', async () => {
    // White to move: both Qxf7# and other mates are fine.
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const result = await checkMove({ fen, uci: 'h5f7', bestUci: 'h5f7x', winBest: 97.5 });
    expect(result.verdict).toBe('excellent');
    expect(result.san).toBe('Qxf7#');
  });

  it('counts unknown moves as wrong when no evaluator is given', async () => {
    const result = await checkMove({ fen: START_FEN, uci: 'a2a3', bestUci: 'e2e4', winBest: 55 });
    expect(result).toMatchObject({ verdict: 'wrong', legal: true, winAfter: null });
  });
});
