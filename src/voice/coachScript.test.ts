import { describe, expect, it } from 'vitest';
import openingsJson from '@/core/openings/data/openings.json';
import { createOpeningBook, type OpeningBookData } from '@/core/openings';
import { parsePgn } from '@/core/pgn';
import { buildGameReview } from '@/core/review';
import {
  CLASSIFICATIONS,
  type Classification,
  type GameReview,
  type MoveReview,
  type PositionAnalysis,
} from '@/core/types';
import { RATED_GAMES, USER_GAME_ID } from '@/core/__fixtures__/rated';
import { coachScript, coachSummary, sanClipKeys } from './coachScript';
import { CLIPS } from './vocabulary';

declare const process: { env: Record<string, string | undefined> };

const ENGINE = { name: 'Stockfish 19 lite', depth: 16, multiPv: 2 };
const book = createOpeningBook(openingsJson as unknown as OpeningBookData);

const RATED_REVIEWS: GameReview[] = RATED_GAMES.map((rated) =>
  buildGameReview(rated.game, rated.analyses, { book, engine: ENGINE }),
);

/** Every key coachScript emits for the moves that the vocabulary lacks. */
function missingKeys(reviews: GameReview[]): string[] {
  const missing = new Set<string>();
  for (const review of reviews) {
    for (const move of review.moves) {
      for (const { key } of coachScript(move).segments) if (!CLIPS.has(key)) missing.add(key);
    }
    for (const { key } of coachSummary(review).segments) if (!CLIPS.has(key)) missing.add(key);
  }
  return [...missing];
}

function moveAt(review: GameReview, san: string, color: 'w' | 'b'): MoveReview {
  const move = review.moves.find((m) => m.san === san && m.color === color);
  if (!move) throw new Error(`${san} not in the review`);
  return move;
}

/** A reviewed move with neutral defaults. */
function reviewed(overrides: Partial<MoveReview>): MoveReview {
  return {
    ply: 20,
    color: 'w',
    san: 'Nf3',
    uci: 'g1f3',
    classification: 'best',
    winBefore: 50,
    winAfter: 50,
    winLoss: 0,
    accuracy: 100,
    evalAfter: { type: 'cp', value: 20 },
    whiteWinAfter: 50,
    explanation: '',
    ...overrides,
  };
}

describe('coachScript on real reviews', () => {
  it('only says clips of the vocabulary', () => {
    expect(missingKeys(RATED_REVIEWS)).toEqual([]);
  });

  it('gives every move a line that starts with the move and ends a sentence', () => {
    for (const review of RATED_REVIEWS) {
      for (const move of review.moves) {
        const { segments, text } = coachScript(move);
        expect(segments.slice(0, sanClipKeys(move.san).length).map((s) => s.key)).toEqual(
          sanClipKeys(move.san),
        );
        expect(segments.length).toBeGreaterThanOrEqual(2);
        expect(segments.at(-1)!.pauseMsAfter).toBeUndefined();
        expect(segments.slice(0, -1).every((s) => (s.pauseMsAfter ?? 0) > 0)).toBe(true);
        expect(text).toMatch(/[.!?]$/);
        expect(text).not.toMatch(/\b(?:you|your)\b/i);
        expect(text).not.toMatch(/\s[,.]|,,|\.\./);
      }
    }
  });

  it('is deterministic, and the seed only changes the wording', () => {
    const move = RATED_REVIEWS[0]!.moves.find((m) => m.classification === 'blunder')!;
    expect(coachScript(move)).toEqual(coachScript(move));
    expect(coachScript(move)).toEqual(coachScript(move, { variantSeed: move.ply }));
    const variants = new Set(
      Array.from({ length: 12 }, (_, seed) => coachScript(move, { variantSeed: seed }).text),
    );
    expect(variants.size).toBeGreaterThan(1);
  });

  it('tells the blunder, its refutation and the better move in the calibration game', () => {
    const review = RATED_REVIEWS[RATED_GAMES.findIndex((game) => game.id === USER_GAME_ID)]!;
    const blunder = moveAt(review, 'Bf4', 'b');
    expect(blunder.classification).toBe('blunder');
    const { segments, text } = coachScript(blunder);
    expect(segments[0]!.key).toBe('move:Bf4');
    expect(segments.map((s) => s.key)).toEqual(
      expect.arrayContaining(['move:Rxh8+', 'phrase:skewer_k_r', 'phrase:it_wins_queen_rook']),
    );
    expect(text).toMatch(/^Bishop to f4\. .*blunder.*\. A few moves later, rook takes h8, check, /);
    expect(text).toMatch(/skewering the king and rook\. It wins the queen and a rook\. /);
    expect(text).toMatch(/bishop to e3|Bishop to e3/);
  });

  it('tells the idea of a great move', () => {
    const review = RATED_REVIEWS[RATED_GAMES.findIndex((game) => game.id === USER_GAME_ID)]!;
    const great = moveAt(review, 'Nxf4', 'w');
    expect(great.classification).toBe('great');
    expect(coachScript(great).text).toMatch(/^Knight takes f4\. .+ A few moves later, rook takes/);
  });
});

describe('coachScript lines', () => {
  it('ends a checkmate with a closing phrase instead of a verdict', () => {
    const { segments, text } = coachScript(
      reviewed({ san: 'Qxf7#', uci: 'h5f7', evalAfter: null }),
      { variantSeed: 3 },
    );
    expect(segments[0]!.key).toBe('move:Qxf7#');
    expect(segments).toHaveLength(2);
    expect(text).toMatch(/^Queen takes f7, checkmate! /);
  });

  it('says the verdict alone for book, forced and good moves', () => {
    for (const classification of ['book', 'forced', 'good'] as Classification[]) {
      const { segments } = coachScript(reviewed({ classification, san: 'e4', uci: 'e2e4' }));
      expect(segments.map((s) => s.key)[0]).toBe('sq:e4');
      expect(segments).toHaveLength(2);
    }
  });

  it('names the mate an error allows, with its first move', () => {
    const { segments, text } = coachScript(
      reviewed({
        color: 'b',
        san: 'g5',
        uci: 'g7g5',
        classification: 'blunder',
        evalAfter: { type: 'mate', value: 1 },
        best: { uci: 'e7e5', san: 'e5', score: { type: 'cp', value: 0 }, pvUci: [], pvSan: [] },
        playedLine: {
          uci: 'd1h5',
          san: 'Qh5#',
          score: { type: 'mate', value: 1 },
          pvUci: ['d1h5'],
          pvSan: ['Qh5#'],
        },
      }),
      { variantSeed: 0 },
    );
    expect(segments.map((s) => s.key)).toContain('phrase:allows_mate_1');
    // The better move starts a sentence of its own after the mating move.
    expect(text).toMatch(
      /This allows mate in one\. Queen to h5, checkmate! (Best was e5|The better move was e5|e5 was (better|stronger))\.$/,
    );
  });

  it('names a missed mate and does not repeat the better move', () => {
    const { text } = coachScript(
      reviewed({
        classification: 'missedWin',
        winBefore: 100,
        winAfter: 80,
        best: {
          uci: 'h1h8',
          san: 'Rh8+',
          score: { type: 'mate', value: 3 },
          pvUci: [],
          pvSan: [],
        },
      }),
    );
    expect(text).toMatch(/There was mate in three, starting with rook to h8, check!$/);
  });

  it('says how the position stands after an error with no story', () => {
    const { text } = coachScript(
      reviewed({
        classification: 'mistake',
        winBefore: 60,
        winAfter: 30,
        explanation: 'Mistake. You were clearly better, but now your opponent is clearly better.',
        best: { uci: 'd2d4', san: 'd4', score: { type: 'cp', value: 90 }, pvUci: [], pvSan: [] },
      }),
      { variantSeed: 1 },
    );
    expect(text).toMatch(/Now Black is clearly better\./);
    expect(text).toMatch(/d4/);
  });

  it('notes a draw on the board', () => {
    const { text } = coachScript(
      reviewed({ classification: 'blunder', san: 'Kg6', uci: 'h5g6', evalAfter: null }),
    );
    expect(text).toContain('And the game ends in a draw.');
  });

  it('names castling as a noun inside a sentence', () => {
    for (let seed = 0; seed < 8; seed++) {
      const { segments, text } = coachScript(
        reviewed({
          classification: 'inaccuracy',
          winBefore: 55,
          winAfter: 45,
          best: { uci: 'e1g1', san: 'O-O', score: { type: 'cp', value: 30 }, pvUci: [], pvSan: [] },
        }),
        { variantSeed: seed },
      );
      expect(segments.map((s) => s.key)).toContain('phrase:castling_kingside');
      expect(text).toMatch(
        /(Best was|The better move was) castling kingside\.$|Castling kingside was (better|stronger)\.$/,
      );
    }
    // The move itself is still announced.
    expect(coachScript(reviewed({ san: 'O-O', uci: 'e1g1' })).text).toMatch(/^Castles kingside\. /);
  });

  it('does not name a better move that sounds like the move played', () => {
    const { text } = coachScript(
      reviewed({
        san: 'Rab1',
        uci: 'a1b1',
        classification: 'mistake',
        winBefore: 55,
        winAfter: 35,
        best: { uci: 'f1b1', san: 'Rfb1', score: { type: 'cp', value: 30 }, pvUci: [], pvSan: [] },
      }),
    );
    expect(text).toMatch(/^Rook to b1\. .+ Right square, wrong rook\.$/);
  });

  it('names the mate a stalemating move missed', () => {
    const { text } = coachScript(
      reviewed({
        san: 'Kh6',
        uci: 'g5h6',
        classification: 'missedWin',
        winBefore: 100,
        winAfter: 50,
        evalAfter: null,
        best: { uci: 'h5g5', san: 'Kg5', score: { type: 'mate', value: 7 }, pvUci: [], pvSan: [] },
      }),
    );
    expect(text).toMatch(
      /And the game ends in a draw\. There was mate in seven, starting with king to g5\.$/,
    );
  });

  it('keeps "still in the opening book" for after the first moves', () => {
    for (let seed = 0; seed < 12; seed++) {
      const first = coachScript(
        reviewed({ classification: 'book', san: 'e4', uci: 'e2e4', ply: 1 }),
        {
          variantSeed: seed,
        },
      );
      expect(first.text).not.toMatch(/Still/);
    }
  });

  it('gives the only-move reason for a great move without a story', () => {
    const { text } = coachScript(reviewed({ classification: 'great', winAfter: 50 }));
    expect(text).toMatch(/^Knight to f3\. .+ The only (move that holds|good move here)\.$/);
  });
});

describe('coachSummary', () => {
  it('reads both accuracies as numbers', () => {
    const review = RATED_REVIEWS[0]!;
    const { segments, text } = coachSummary({
      ...review,
      white: { ...review.white, accuracy: 73.4 },
      black: { ...review.black, accuracy: 56.6 },
    });
    expect(segments.map((s) => s.key)).toEqual([
      'phrase:accuracy_white',
      'num:73',
      'phrase:accuracy_black',
      'num:57',
    ]);
    expect(text).toBe("White's accuracy: 73. Black's accuracy: 57.");
  });
});

// ---------------------------------------------------------------------------
// Opt-in: every move of a dataset of real games with engine analyses.
//
//   VOICE_REVIEW_DIR  folder with dataset.json ([{ url, pgn }]) and analyses/<id>.d16.json
//                     ({ analyses }), as written by src/core/accuracyCalibration.test.ts
//
// VOICE_REVIEW_DIR=../kb-tools/calib npx vitest run src/voice/coachScript.test.ts
// ---------------------------------------------------------------------------

interface NodeFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
}

async function nodeFs(): Promise<NodeFs> {
  const specifier = 'node:fs/promises';
  return (await import(/* @vite-ignore */ specifier)) as NodeFs;
}

const DATASET_DIR = process.env.VOICE_REVIEW_DIR;

describe.skipIf(!DATASET_DIR)('coachScript on a dataset of real games', () => {
  it(
    'only says clips of the vocabulary, on every move',
    async () => {
      const fs = await nodeFs();
      const dataset = JSON.parse(await fs.readFile(`${DATASET_DIR}/dataset.json`, 'utf8')) as {
        url: string;
        pgn: string;
      }[];
      const files = new Set(await fs.readdir(`${DATASET_DIR}/analyses`));
      const reviews: GameReview[] = [];
      for (const entry of dataset) {
        const id = entry.url.split('/').pop()!;
        const file = [...files].find((name) => name.startsWith(`${id}.`));
        if (!file) continue;
        const { analyses } = JSON.parse(
          await fs.readFile(`${DATASET_DIR}/analyses/${file}`, 'utf8'),
        ) as { analyses: PositionAnalysis[] };
        reviews.push(buildGameReview(parsePgn(entry.pgn), analyses, { book, engine: ENGINE }));
      }
      expect(reviews.length).toBeGreaterThan(0);
      expect(missingKeys(reviews)).toEqual([]);

      // Examples for reading: a few lines of each label, spread over the dataset.
      const moves = reviews.flatMap((review) => review.moves);
      const lines: string[] = [];
      for (const classification of CLASSIFICATIONS) {
        const of = moves.filter((move) => move.classification === classification);
        const count = ['blunder', 'mistake', 'brilliant', 'great', 'missedWin'].includes(
          classification,
        )
          ? 5
          : 2;
        for (let i = 0; i < count && i < of.length; i++) {
          const move = of[Math.floor(((i + 0.5) * of.length) / count)]!;
          lines.push(`[${classification}] ${coachScript(move).text}`);
        }
      }
      const said = moves.flatMap((move) => coachScript(move).segments.map((s) => s.key));
      const vague = said.filter((key) => /^phrase:motif_|_material$/.test(key)).length;
      console.log(
        `${reviews.length} games, ${moves.length} moves, ${new Set(said).size} clips used, ` +
          `${vague} generic motif or material clips\n${lines.join('\n')}`,
      );
    },
    10 * 60_000,
  );
});
