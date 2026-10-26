import { describe, expect, it } from 'vitest';
import type { MoveReview, ParsedMove, PositionAnalysis } from '@/core/types';
import { PgnError } from '@/core/pgn';
import { NetworkError, NotFoundError, RateLimitError } from '@/sources/http';
import {
  analysingMoveNumber,
  arrowsForMove,
  baseTimeSeconds,
  clockAtPly,
  contiguousCount,
  deeperPreset,
  deeperPresets,
  describeLoadError,
  evalBarValueAt,
  evalTextAt,
  formatEta,
  formatLine,
  initialOrientation,
  isAbortError,
  isAnalysisComplete,
  isReviewableVariant,
  mergeAnalyses,
  nextMoveNumber,
  progressPercent,
  progressText,
  resultLabel,
} from './reviewHelpers';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function analysis(score: number, fen = START): PositionAnalysis {
  return {
    fen,
    depth: 12,
    lines: [{ pv: ['e2e4'], score: { type: 'cp', value: score }, depth: 12 }],
  };
}

function parsedMove(ply: number, clock?: number): ParsedMove {
  const color = ply % 2 === 1 ? 'w' : 'b';
  return {
    ply,
    moveNumber: Math.ceil(ply / 2),
    color,
    san: 'x',
    uci: 'a2a3',
    from: 'a2',
    to: 'a3',
    piece: 'p',
    fenBefore: START,
    fenAfter: START,
    isCheck: false,
    isCheckmate: false,
    ...(clock === undefined ? {} : { clock }),
  };
}

function moveReview(patch: Partial<MoveReview>): MoveReview {
  return {
    ply: 1,
    color: 'w',
    san: 'Nf3',
    uci: 'g1f3',
    classification: 'mistake',
    winBefore: 50,
    winAfter: 35,
    winLoss: 15,
    accuracy: 60,
    evalAfter: { type: 'cp', value: -80 },
    whiteWinAfter: 35,
    explanation: '',
    ...patch,
  };
}

const line = (uci: string, san: string) => ({
  uci,
  san,
  score: { type: 'cp' as const, value: 20 },
  pvUci: [uci],
  pvSan: [san],
});

describe('errors', () => {
  it('recognises abort errors', () => {
    expect(isAbortError(new DOMException('stop', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it('explains every load failure in plain words', () => {
    const notFound = describeLoadError(new NotFoundError('404'), 'lichess/abc');
    expect(notFound.kind).toBe('not-found');
    expect(notFound.message).toContain('Lichess');

    const imported = describeLoadError(new NotFoundError('gone'), 'pgn/123');
    expect(imported.retryable).toBe(false);
    expect(imported.message).toContain('Import the PGN again');

    const limited = describeLoadError(new RateLimitError('429'), 'chesscom/a/2026/10/1');
    expect(limited).toMatchObject({ kind: 'rate-limit', retryable: true });
    expect(limited.message).toContain('Chess.com');

    expect(describeLoadError(new NetworkError('offline'), 'lichess/abc')).toMatchObject({
      kind: 'network',
      retryable: true,
    });
    expect(describeLoadError(new PgnError('Bad move 12. Qx9'), 'pgn/1')).toMatchObject({
      kind: 'pgn',
      message: 'Bad move 12. Qx9',
      retryable: false,
    });
    expect(describeLoadError('weird', 'lichess/abc')).toMatchObject({
      kind: 'unknown',
      message: 'weird',
    });
  });

  it('matches errors by name too (e.g. across module copies)', () => {
    const error = Object.assign(new Error('x'), { name: 'RateLimitError' });
    expect(describeLoadError(error, 'lichess/abc').kind).toBe('rate-limit');
  });

  it('only reviews standard chess', () => {
    expect(isReviewableVariant('standard')).toBe(true);
    expect(isReviewableVariant('Standard')).toBe(true);
    expect(isReviewableVariant('chess960')).toBe(false);
  });
});

describe('analysis bookkeeping', () => {
  it('walks presets from fast to deep', () => {
    expect(deeperPreset('fast')).toBe('standard');
    expect(deeperPreset('standard')).toBe('deep');
    expect(deeperPreset('deep')).toBeNull();
    expect(deeperPresets('fast')).toEqual(['deep', 'standard']);
    expect(deeperPresets('deep')).toEqual([]);
  });

  it('counts the analysed prefix', () => {
    const a = analysis(10);
    expect(contiguousCount([])).toBe(0);
    expect(contiguousCount([a, a, null, a])).toBe(2);
    expect(isAnalysisComplete([a, a, a], 3)).toBe(true);
    expect(isAnalysisComplete([a, null, a], 3)).toBe(false);
    expect(isAnalysisComplete(null, 3)).toBe(false);
  });

  it('merges memory and cache, preferring memory', () => {
    const memory = analysis(1);
    const cached = analysis(2);
    const merged = mergeAnalyses([memory, null], [cached, cached, cached], 3);
    expect(merged).toEqual([memory, cached, cached]);
    expect(mergeAnalyses(null, null, 3)).toEqual([]);
    // Never longer than the game.
    expect(mergeAnalyses([memory, memory, memory], null, 2)).toHaveLength(2);
  });

  it('formats the time left', () => {
    expect(formatEta(2_000)).toBe('almost done');
    expect(formatEta(38_000)).toBe('about 40 s left');
    expect(formatEta(6_000)).toBe('about 5 s left');
    expect(formatEta(130_000)).toBe('about 2 min left');
  });

  it('describes progress', () => {
    expect(progressText({ done: 23, total: 82, currentDepth: 16, etaMs: 40_000 }, 81)).toBe(
      'Analysing move 23 of 81 · depth 16 · about 40 s left',
    );
    expect(progressText({ done: 0, total: 82 }, 81)).toBe('Analysing move 1 of 81');
    expect(analysingMoveNumber(90, 81)).toBe(81);
    expect(progressPercent({ done: 41, total: 82 })).toBe(50);
    expect(progressPercent(null)).toBe(0);
  });
});

describe('display helpers', () => {
  it('formats results', () => {
    expect(resultLabel('1/2-1/2')).toBe('½-½');
    expect(resultLabel('1-0')).toBe('1-0');
  });

  it('reads the starting time', () => {
    expect(baseTimeSeconds('180+2')).toBe(180);
    expect(baseTimeSeconds('600')).toBe(600);
    expect(baseTimeSeconds('1/86400')).toBeUndefined();
    expect(baseTimeSeconds(undefined)).toBeUndefined();
  });

  it('finds each player’s clock at a ply', () => {
    const moves = [parsedMove(1, 178), parsedMove(2, 175), parsedMove(3, 170), parsedMove(4, 160)];
    expect(clockAtPly(moves, 0, 'w', '180+2')).toBe(180);
    expect(clockAtPly(moves, 1, 'w', '180+2')).toBe(178);
    expect(clockAtPly(moves, 1, 'b', '180+2')).toBe(180);
    expect(clockAtPly(moves, 3, 'w', '180+2')).toBe(170);
    expect(clockAtPly(moves, 3, 'b', '180+2')).toBe(175);
    expect(clockAtPly([parsedMove(1), parsedMove(2)], 2, 'w', '180+2')).toBeUndefined();
  });

  it('numbers engine lines', () => {
    expect(formatLine(['Nf3', 'Nc6', 'Bb5'], 12, 'w')).toBe('12. Nf3 Nc6 13. Bb5');
    expect(formatLine(['Nc6', 'Bb5', 'a6'], 12, 'b')).toBe('12... Nc6 13. Bb5 a6');
    expect(formatLine(['a', 'b', 'c', 'd'], 1, 'w', 2)).toBe('1. a b');
    expect(formatLine([], 5, 'w')).toBe('');
  });

  it('knows where the reply starts', () => {
    expect(nextMoveNumber({ moveNumber: 7, color: 'w' })).toEqual({ moveNumber: 7, color: 'b' });
    expect(nextMoveNumber({ moveNumber: 7, color: 'b' })).toEqual({ moveNumber: 8, color: 'w' });
  });

  it('orients the board towards the player being browsed', () => {
    const record = {
      id: 'chesscom/MagnusFan/2026/10/123',
      white: { name: 'Opponent' },
      black: { name: 'magnusfan' },
    };
    expect(initialOrientation(record, [])).toBe('black');
    const lichess = { id: 'lichess/abc', white: { name: 'Alice' }, black: { name: 'Bob' } };
    expect(initialOrientation(lichess, ['bob'])).toBe('black');
    expect(initialOrientation(lichess, ['carol'])).toBe('white');
  });
});

describe('arrowsForMove', () => {
  it('shows the better move and, for real errors, the punishing reply', () => {
    const review = moveReview({
      best: line('d2d4', 'd4'),
      playedLine: line('e7e5', 'e5'),
      classification: 'blunder',
    });
    expect(arrowsForMove(review, true)).toEqual([
      { from: 'd2', to: 'd4', kind: 'best' },
      { from: 'e7', to: 'e5', kind: 'threat' },
    ]);
  });

  it('draws nothing when the best move was played', () => {
    const review = moveReview({ best: line('g1f3', 'Nf3'), classification: 'best' });
    expect(arrowsForMove(review, true)).toEqual([]);
  });

  it('skips the reply arrow for small errors', () => {
    const review = moveReview({
      best: line('d2d4', 'd4'),
      playedLine: line('e7e5', 'e5'),
      classification: 'inaccuracy',
    });
    expect(arrowsForMove(review, true)).toEqual([{ from: 'd2', to: 'd4', kind: 'best' }]);
  });

  it('respects the toggle and book moves', () => {
    const review = moveReview({ best: line('d2d4', 'd4') });
    expect(arrowsForMove(review, false)).toEqual([]);
    expect(arrowsForMove({ ...review, classification: 'book' }, true)).toEqual([]);
    expect(arrowsForMove(undefined, true)).toEqual([]);
  });
});

describe('evalBarValueAt / evalTextAt', () => {
  it('uses the best line of the position', () => {
    const analyses = [analysis(130)];
    expect(evalBarValueAt(analyses, 0)).toEqual({
      kind: 'score',
      score: { type: 'cp', value: 130 },
    });
    expect(evalTextAt(analyses, 0)).toBe('+1.3');
  });

  it('is null for positions not analysed yet', () => {
    expect(evalBarValueAt([analysis(0), null], 1)).toBeNull();
    expect(evalBarValueAt([analysis(0)], 5)).toBeNull();
    expect(evalTextAt([], 0)).toBeNull();
  });

  it('shows the result of finished games', () => {
    // Fool's mate: White to move and mated.
    const mated: PositionAnalysis = {
      fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
      depth: 0,
      lines: [],
      terminal: 'checkmate',
    };
    expect(evalBarValueAt([mated], 0)).toEqual({ kind: 'final', whiteWinPercent: 0, label: '0-1' });
    const stalemate: PositionAnalysis = { ...mated, terminal: 'stalemate' };
    expect(evalTextAt([stalemate], 0)).toBe('½-½');
  });
});
