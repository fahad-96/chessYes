import { describe, expect, it } from 'vitest';
import type { LineStory, Motif } from '@/core/types';
import {
  STORY_MOTIF_STEP_MS,
  STORY_STEP_MS,
  motifArrows,
  storyBeneficiary,
  storyDuration,
  storyFrame,
  storyOutcome,
  storyStart,
  storyStepDelay,
  storyTitle,
  storyTone,
  uncoveredAttacker,
} from './story';
import { autoplayDelay } from './useVariation';
import {
  playUciMove,
  seekVariation,
  storyVariation,
  type StoryContext,
  type Variation,
} from './variation';

/** White to move: Nf6+ forks the king on g8 and the queen on d7, then takes the queen. */
const FORK_FEN = '6k1/3q1p1p/8/8/4N3/8/5PPP/6K1 w - - 0 31';

const forkMotif: Motif = {
  type: 'fork',
  step: 0,
  by: 'w',
  square: 'f6',
  targets: ['g8', 'd7'],
  phrase: 'forks the king and queen',
};

const refutation: LineStory = {
  kind: 'refutation',
  fen: FORK_FEN,
  movesUci: ['e4f6', 'g8g7', 'f6d7'],
  movesSan: ['Nf6+', 'Kg7', 'Nxd7'],
  motifs: [forkMotif],
  materialSwing: -9,
  text: 'Your opponent replies Nf6+, forking your king and queen, and wins the queen.',
};

function context(story: LineStory, overrides: Partial<StoryContext> = {}): StoryContext {
  return {
    story,
    player: 'b',
    mover: 'b',
    afterMove: story.kind === 'refutation',
    anchorLabel: '30... Qd7',
    san: 'Qd7',
    classification: 'blunder',
    ...overrides,
  };
}

function at(variation: Variation, index: number): Variation {
  return seekVariation(variation, index);
}

describe('storyVariation', () => {
  it('replays the story from its FEN', () => {
    const variation = storyVariation(60, context(refutation))!;
    expect(variation.kind).toBe('story');
    expect(variation.startPly).toBe(60);
    expect(variation.startFen).toBe(FORK_FEN);
    expect(variation.moves.map((m) => m.san)).toEqual(['Nf6+', 'Kg7', 'Nxd7']);
    expect(variation.index).toBe(0);
  });

  it('is null when the first move is not legal there', () => {
    expect(storyVariation(1, context({ ...refutation, movesUci: ['e4e5'] }))).toBeNull();
    expect(storyVariation(1, context({ ...refutation, movesUci: [] }))).toBeNull();
  });

  it('starts after the move or before it, as its FEN says', () => {
    const before = '6k1/5p1p/8/8/4N3/8/5PPP/3q2K1 b - - 0 30';
    const move = { ply: 60, fenAfter: FORK_FEN };
    expect(storyStart(refutation, move)).toEqual({ startPly: 60, afterMove: true });
    expect(storyStart({ fen: before }, move)).toEqual({ startPly: 59, afterMove: false });
    // Move counters do not matter.
    expect(storyStart({ fen: FORK_FEN.replace(' 0 31', ' 3 40') }, move).afterMove).toBe(true);
  });
});

describe('storyFrame', () => {
  const variation = storyVariation(60, context(refutation))!;

  it('previews the first move at the start', () => {
    expect(storyFrame(variation)).toEqual({
      arrows: [{ from: 'e4', to: 'f6', kind: 'threat' }],
      highlights: [],
      caption: 'After 30... Qd7',
      phrases: [],
    });
  });

  it('draws the fork at the step where it happens', () => {
    expect(storyFrame(at(variation, 1))).toEqual({
      arrows: [
        { from: 'f6', to: 'g8', kind: 'threat' },
        { from: 'f6', to: 'd7', kind: 'threat' },
      ],
      highlights: [],
      caption: '31. Nf6+ — forks the king and queen',
      phrases: ['forks the king and queen'],
    });
  });

  it('names captures on steps without a motif', () => {
    expect(storyFrame(at(variation, 2))?.caption).toBe('31... Kg7');
    expect(storyFrame(at(variation, 2))?.arrows).toEqual([]);
    expect(storyFrame(at(variation, 3))?.caption).toBe('32. Nxd7 — takes the queen');
  });

  it('draws the player’s own tactic in green', () => {
    // Seen from White's side, the same fork is White's idea.
    const white = storyVariation(60, context(refutation, { player: 'w' }))!;
    expect(storyFrame(at(white, 1))?.arrows.every((a) => a.kind === 'best')).toBe(true);
    expect(storyFrame(white)?.arrows[0]?.kind).toBe('best');
  });

  it('says "Instead of" for the better move', () => {
    const missed: LineStory = { ...refutation, kind: 'missed', motifs: [] };
    const variation2 = storyVariation(59, context(missed, { player: 'w', mover: 'w' }))!;
    expect(storyFrame(variation2)?.caption).toBe('Instead of 30... Qd7');
  });

  it('introduces an idea that starts with the move itself', () => {
    const idea: LineStory = { ...refutation, kind: 'idea' };
    const variation2 = storyVariation(59, context(idea, { player: 'w', mover: 'w' }))!;
    expect(storyFrame(variation2)?.caption).toBe('The idea behind 30... Qd7');
    const after = storyVariation(60, context(idea, { afterMove: true }))!;
    expect(storyFrame(after)?.caption).toBe('After 30... Qd7');
  });

  it('rings a promotion square and a trapped piece', () => {
    const promotion: LineStory = {
      kind: 'idea',
      fen: '8/P6k/8/8/8/8/8/K7 w - - 0 50',
      movesUci: ['a7a8q'],
      movesSan: ['a8=Q'],
      motifs: [
        { type: 'promotion', step: 0, by: 'w', square: 'a8', targets: [], phrase: 'promotes' },
      ],
      materialSwing: 8,
      text: 'The pawn promotes.',
    };
    const variation2 = storyVariation(98, context(promotion, { player: 'w', mover: 'w' }))!;
    expect(storyFrame(at(variation2, 1))).toMatchObject({
      highlights: ['a8'],
      caption: '50. a8=Q — promotes',
    });
    const trapped = {
      ...promotion,
      motifs: [
        {
          ...promotion.motifs[0]!,
          type: 'trapped-piece' as const,
          targets: ['h7' as const],
          phrase: 'traps the king',
        },
      ],
    };
    expect(storyFrame(at(storyVariation(98, context(trapped))!, 1))?.highlights).toEqual(['h7']);
  });

  it('captions and rings the sacrifice, and rings fork targets next to the forking piece', () => {
    // 20.Rxh7+! Kxh7 21.Nf6+ forks the king and queen.
    const sacrifice: LineStory = {
      kind: 'idea',
      fen: '2r4k/pppq1p1p/6p1/8/4N3/7R/PPP2PP1/4R1K1 w - - 2 20',
      movesUci: ['h3h7', 'h8h7', 'e4f6'],
      movesSan: ['Rxh7+', 'Kxh7', 'Nf6+'],
      motifs: [{ ...forkMotif, step: 2, targets: ['h7', 'd7'] }],
      materialSwing: 4,
      sacrifice: { piece: 'r', square: 'h7' },
      text: 'You sacrifice the rook on h7: after Kxh7, Nf6+ forks the king and queen and wins the queen.',
    };
    const line = storyVariation(38, context(sacrifice, { player: 'w', mover: 'w' }))!;
    expect(storyFrame(at(line, 1))).toMatchObject({
      caption: '20. Rxh7+ — sacrifices the rook on h7',
      highlights: ['h7'],
    });
    expect(storyFrame(at(line, 2))?.caption).toBe('20... Kxh7 — takes the rook');
    // From f6 the knight is two squares from h7 and d7: arrows show the fork.
    expect(storyFrame(at(line, 3))?.highlights).toEqual([]);
    // A fork of two adjacent pieces (Rxg7+ hitting Kh7 and Bf7) rings them.
    const adjacent: LineStory = {
      kind: 'refutation',
      fen: '8/5bpk/7p/8/8/8/6R1/6K1 w - - 0 55',
      movesUci: ['g2g7'],
      movesSan: ['Rxg7+'],
      motifs: [
        { ...forkMotif, square: 'g7', targets: ['h7', 'f7'], phrase: 'forks the king and bishop' },
      ],
      materialSwing: -4,
      text: 'Your opponent replies Rxg7+, forking your king and bishop, and wins the bishop.',
    };
    const fork = storyVariation(108, context(adjacent))!;
    expect(storyFrame(at(fork, 1))?.highlights).toEqual(['h7', 'f7']);
  });

  it('is null for other variations', () => {
    expect(storyFrame({ ...variation, kind: 'line', story: undefined })).toBeNull();
  });
});

describe('motifArrows', () => {
  const move = (fen: string, uci: string) => playUciMove(fen, uci)!;

  it('draws a pin from the pinning piece through the pinned piece to the king', () => {
    const pinMove = move('4k3/3n4/8/8/8/8/8/4KB2 w - - 0 1', 'f1b5');
    const pin: Motif = {
      type: 'pin',
      step: 0,
      by: 'w',
      square: 'b5',
      // Most valuable first: the king behind, then the pinned knight.
      targets: ['e8', 'd7'],
      phrase: 'pins the knight to the king',
    };
    expect(motifArrows(pin, pinMove, 'w')).toEqual([{ from: 'b5', to: 'e8', kind: 'best' }]);
    expect(motifArrows({ ...pin, targets: ['d7', 'e8'] }, pinMove, 'b')).toEqual([
      { from: 'b5', to: 'e8', kind: 'threat' },
    ]);
  });

  it('draws a skewer to the piece behind', () => {
    const skewerMove = move('q3k3/8/8/8/8/8/8/4K2R w - - 0 1', 'h1h8');
    const skewer: Motif = {
      type: 'skewer',
      step: 0,
      by: 'w',
      square: 'h8',
      targets: ['e8', 'a8'],
      phrase: 'skewers the king and queen',
    };
    expect(motifArrows(skewer, skewerMove, 'w')).toEqual([{ from: 'h8', to: 'a8', kind: 'best' }]);
  });

  it('draws a discovered attack from the uncovered piece, whatever square it names', () => {
    const fen = '4k3/4q3/8/8/4N3/8/8/4RK2 w - - 0 1';
    const discovery = move(fen, 'e4c5');
    const motif: Motif = {
      type: 'discovered-attack',
      step: 0,
      by: 'w',
      square: 'c5',
      targets: ['e7'],
      phrase: 'uncovers an attack on the queen',
    };
    expect(motifArrows(motif, discovery, 'w')).toEqual([{ from: 'e1', to: 'e7', kind: 'best' }]);
    expect(motifArrows({ ...motif, square: 'e1' }, discovery, 'w')).toEqual([
      { from: 'e1', to: 'e7', kind: 'best' },
    ]);
  });

  it('draws both checking pieces of a double check', () => {
    // Nf6 is check from the knight and uncovers the rook on e1 against the king on e8.
    const doubleCheck = move('4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1', 'e4f6');
    const motif: Motif = {
      type: 'double-check',
      step: 0,
      by: 'w',
      square: 'f6',
      targets: ['e8'],
      phrase: 'gives double check',
    };
    expect(motifArrows(motif, doubleCheck, 'b')).toEqual([
      { from: 'f6', to: 'e8', kind: 'threat' },
      { from: 'e1', to: 'e8', kind: 'threat' },
    ]);
  });

  it('draws mates from the mating piece and skips zero-length arrows', () => {
    const mate = move('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8');
    const backRank: Motif = {
      type: 'back-rank-mate',
      step: 0,
      by: 'w',
      square: 'a8',
      targets: ['g8'],
      phrase: 'mates on the back rank',
    };
    expect(motifArrows(backRank, mate, 'w')).toEqual([{ from: 'a8', to: 'g8', kind: 'best' }]);
    const hanging: Motif = { ...backRank, type: 'hanging-piece', targets: ['a8'] };
    expect(motifArrows(hanging, mate, 'w')).toEqual([]);
  });
});

describe('uncoveredAttacker', () => {
  it('finds the slider behind the square a piece left', () => {
    expect(uncoveredAttacker('4k3/4q3/8/2N5/8/8/8/4RK2 w - - 0 1', 'e4', 'e7', 'w')).toBe('e1');
    // Diagonal: the bishop on a1 behind the vacated c3, aimed at f6.
    expect(uncoveredAttacker('4k3/8/5q2/8/8/8/8/B3K3 w - - 0 1', 'c3', 'f6', 'w')).toBe('a1');
  });

  it('returns null when there is no matching slider', () => {
    // A rook does not attack along a diagonal.
    expect(uncoveredAttacker('4k3/8/5q2/8/8/8/8/R3K3 w - - 0 1', 'c3', 'f6', 'w')).toBeNull();
    // Squares that are not on one line.
    expect(uncoveredAttacker('4k3/4q3/8/8/8/8/8/4RK2 w - - 0 1', 'd4', 'e7', 'w')).toBeNull();
    // A piece of the other side behind.
    expect(uncoveredAttacker('4k3/4q3/8/8/8/8/8/4rK2 w - - 0 1', 'e4', 'e7', 'w')).toBeNull();
  });
});

describe('story timing', () => {
  const variation = storyVariation(60, context(refutation))!;

  it('lingers on the step with the motif', () => {
    expect(storyStepDelay(variation)).toBe(STORY_STEP_MS);
    expect(storyStepDelay(at(variation, 1))).toBe(STORY_MOTIF_STEP_MS);
    expect(storyStepDelay(at(variation, 2))).toBe(STORY_STEP_MS);
    expect(autoplayDelay(at(variation, 1))).toBe(STORY_MOTIF_STEP_MS);
    expect(storyDuration(variation)).toBe(2 * STORY_STEP_MS + STORY_MOTIF_STEP_MS);
  });
});

describe('storyOutcome', () => {
  it('counts the material for the side the board takes', () => {
    // Black's blunder loses the queen: bad for Black, good when seen from White's side.
    expect(storyOutcome(storyVariation(60, context(refutation))!)).toEqual({
      text: '−9',
      good: false,
    });
    expect(storyOutcome(storyVariation(60, context(refutation, { player: 'w' }))!)).toEqual({
      text: '+9',
      good: true,
    });
    expect(storyOutcome(storyVariation(60, context({ ...refutation, materialSwing: 0.4 }))!)).toBe(
      null,
    );
  });

  it('shows mates for whoever delivers them', () => {
    const mate = { ...refutation, mateIn: 2 };
    // The line's last move is White's: a mate against Black.
    expect(storyOutcome(storyVariation(60, context(mate))!)).toEqual({
      text: 'Mate in 2',
      good: false,
    });
  });
});

describe('story wording', () => {
  it('titles each kind of story', () => {
    expect(storyTitle('refutation', 'Rg8', 'blunder')).toBe('Why Rg8 is a blunder');
    expect(storyTitle('idea', 'Rxh7+', 'brilliant')).toBe('Why Rxh7+ is a brilliant move');
    expect(storyTitle('idea', 'Nf3', 'best')).toBe('Why Nf3 is the best move');
    expect(storyTitle('missed', 'Rg8', 'blunder', 'Rxg7')).toBe('What Rxg7 would have done');
  });

  it('knows whom the line is good for', () => {
    expect(storyBeneficiary(context(refutation))).toBe('w');
    expect(storyTone(context(refutation))).toBe('threat');
    expect(storyTone(context(refutation, { player: 'w' }))).toBe('idea');
    const idea = { ...refutation, kind: 'idea' as const };
    expect(storyTone(context(idea, { mover: 'w', player: 'w' }))).toBe('idea');
    expect(storyTone(context(idea, { mover: 'w', player: 'b' }))).toBe('threat');
  });
});
