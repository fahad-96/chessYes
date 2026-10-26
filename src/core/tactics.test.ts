import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { bestMoveSentence, describeLine, findMotifs, storyMatters } from './tactics';
import type { DescribeLineOptions } from './tactics';
import type { LineStory, MotifType } from './types';

/** Motifs of a move as "type square>targets" strings, for compact assertions. */
function motifs(fen: string, uci: string): string[] {
  return findMotifs(fen, uci).map((m) => `${m.type} ${m.square}>${m.targets.join(',')}`);
}

function types(fen: string, uci: string): MotifType[] {
  return findMotifs(fen, uci).map((m) => m.type);
}

function story(fen: string, pv: string, options: DescribeLineOptions): LineStory {
  return describeLine(fen, pv.split(' '), options);
}

// Made-up but legal positions for the classic patterns; real games further down.
const ROYAL_FORK = 'r5k1/pppq1p1p/6p1/3N4/8/8/PPP2PPP/3Q2K1 w - - 0 1';
const KNIGHT_ON_C7 = 'r3k3/pp3ppp/8/1N6/8/8/PPP2PPP/4K3 w - - 0 1';
/** 1.e4 e5 2.Nf3 d6 3.d4 Nc6: 4.Bb5 pins the knight to the king. */
const PHILIDOR = 'r1bqkbnr/ppp2ppp/2np4/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R w KQkq - 1 4';
/** 1.d4 d5 2.c4 e6 3.Nc3 Nf6: 4.Bg5 pins the knight to the queen. */
const QUEENS_GAMBIT = 'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 2 4';
const SKEWER = '6r1/8/4k3/8/2P5/5B2/8/K7 w - - 0 1';
const DISCOVERED_CHECK = '3qk3/8/8/4N3/8/8/8/4R1K1 w - - 0 1';
const DOUBLE_CHECK = '4k3/3q4/8/8/4N3/8/8/4R1K1 w - - 0 1';
const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
/** The Opera Game (Morphy, Paris 1858) before 16.Qb8+. */
const OPERA_16 = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16';
/** A Greek gift set-up: Bxh7+ Kxh7 Ng5+ is a sacrifice for an attack, not for material. */
const GREEK_GIFT = 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R2QK2R w KQ - 0 8';

/*
 * The user's game fahadkmr - JJose8 (Chess.com, 2026), with Stockfish 19 lite lines
 * (depth 13-16): 16.c4? missed 16.Ba3, 25.Rd8+ missed 25.Rc1, 31.Rg8?? hangs the rook,
 * 53...e2 missed a forced mate starting with 53...Bxc4.
 */
const GAME = {
  before6Bxc3: 'rnbqk1nr/ppp2ppp/8/4p3/1b6/2N3P1/PPPPNPBP/R1BQK2R b KQkq - 2 6',
  after6Bxc3: 'rnbqk1nr/ppp2ppp/8/4p3/8/2b3P1/PPPPNPBP/R1BQK2R w KQkq - 0 7',
  bxc3Line: 'b2c3 b8c6 e1g1 g8e7 d2d4 c8e6 d4e5 e6d5 f2f4 e8g8 d1d3 d5g2 g1g2 d8d5',
  after15OO: 'rnb2rk1/pp4pp/5p2/4p3/8/1PP3P1/PB3PBP/3RR1K1 w - - 1 16',
  ba3Line: 'b2a3 f8e8 g2d5 g8h8 d5f7 b8c6 f7e8 c8g4 e8d7 g4d1 e1d1 a8d8 d1d5 c6b8',
  before25: '5k2/p2R1bpp/5p2/4p3/8/1P4P1/r4P1P/4R1K1 w - - 0 25',
  rc1Line: 'e1c1 f7e8 c1c8 e5e4 d7d8 f6f5 d8e8 f8f7 g1g2 a7a5 c8d8 a2e2',
  before31: '7R/1R4p1/3k1p1p/4p3/p7/1b4P1/r4P1P/6K1 w - - 2 31',
  after31Rg8: '6R1/1R4p1/3k1p1p/4p3/p7/1b4P1/r4P1P/6K1 b - - 3 31',
  bxg8Line: 'b3g8 g1f1 g8c4 f1e1 a4a3 b7a7 d6c5 a7c7 c5b4 c7c8 c4d5 c8b8',
  rxg7Line: 'b7g7 b3d5 h8d8 d6c5 f2f4 d5c6 f4e5 f6e5 d8c8 a2c2 g7g6 c5b6',
  before53e2: '5K2/5bp1/5pkp/8/2R5/4p1P1/8/4r3 b - - 5 53',
  bxc4Line: 'f7c4 g3g4 e3e2 g4g5 e1b1 f8e7 e2e1q e7d7 e1e6 d7c7 e6e5 c7c6 e5d5 c6c7 b1b7 c7c8 d5d7',
};

describe('findMotifs: forks', () => {
  it('finds the royal fork Nf6+ (king and queen)', () => {
    const [fork] = findMotifs(ROYAL_FORK, 'd5f6');
    expect(fork).toEqual({
      type: 'fork',
      step: 0,
      by: 'w',
      square: 'f6',
      targets: ['g8', 'd7'],
      phrase: 'forks the king and queen',
    });
    // Moving the knight also opens the d-file from the queen on d1 to the queen on d7.
    expect(motifs(ROYAL_FORK, 'd5f6')).toContain('discovered-attack d1>d7');
  });

  it('finds Nc7+ forking the king and the rook', () => {
    expect(motifs(KNIGHT_ON_C7, 'b5c7')).toEqual(['fork c7>e8,a8']);
    expect(findMotifs(KNIGHT_ON_C7, 'b5c7')[0]?.phrase).toBe('forks the king and rook');
  });

  it('does not call it a fork when the forking piece is simply taken', () => {
    // With a pawn on g7, ...gxf6 removes the knight for free.
    const pawnOnG7 = 'r5k1/pppq1ppp/8/3N4/8/8/PPP2PPP/3Q2K1 w - - 0 1';
    expect(types(pawnOnG7, 'd5f6')).not.toContain('fork');
  });

  it('does not count defended pieces worth no more than the attacker', () => {
    // Nd5 hits both bishops, but the king guards them: taking one only trades it.
    const fen = '3k4/2b1b3/8/8/8/2N5/8/4K3 w - - 0 1';
    expect(types(fen, 'c3d5')).toEqual([]);
  });

  it('counts undefended pieces as fork targets ("forks the rook and bishop")', () => {
    const fen = '4k3/8/1r6/8/5b2/2N5/8/4K3 w - - 0 1';
    expect(findMotifs(fen, 'c3d5')[0]?.phrase).toBe('forks the rook and bishop');
  });
});

describe('findMotifs: pins and skewers', () => {
  it('finds an absolute pin (4.Bb5 pins the knight on c6 to the king)', () => {
    const [pin] = findMotifs(PHILIDOR, 'f1b5');
    expect(pin).toMatchObject({ type: 'pin', square: 'b5', targets: ['e8', 'c6'] });
    expect(pin?.phrase).toBe('pins the knight to the king');
  });

  it('finds a relative pin (4.Bg5 pins the knight on f6 to the queen)', () => {
    const [pin] = findMotifs(QUEENS_GAMBIT, 'c1g5');
    expect(pin).toMatchObject({ type: 'pin', square: 'g5', targets: ['d8', 'f6'] });
    expect(pin?.phrase).toBe('pins the knight to the queen');
  });

  it('reports a pin only when the move creates it', () => {
    const afterBb5 = 'r1bqkbnr/ppp2ppp/2np4/1B2p3/3PP3/5N2/PPP2PPP/RNBQK2R b KQkq - 2 4';
    expect(types(afterBb5, 'a7a6')).toEqual([]);
    const afterA6 = 'r1bqkbnr/1pp2ppp/p1np4/1B2p3/3PP3/5N2/PPP2PPP/RNBQK2R w KQkq - 0 5';
    expect(types(afterA6, 'h2h3')).not.toContain('pin');
  });

  it('is no pin when the piece behind is worth less', () => {
    // Bb5 hits the queen with a knight behind it, and the queen simply takes the bishop.
    const fen = '4n2k/8/2q5/8/8/3B4/8/6K1 w - - 0 1';
    expect(findMotifs(fen, 'd3b5')).toEqual([]);
    // Defended by the a4 pawn, the bishop skewers the queen and the loose knight.
    const defended = '4n2k/8/2q5/8/P7/3B4/8/6K1 w - - 0 1';
    expect(motifs(defended, 'd3b5')).toEqual(['skewer b5>c6,e8']);
    expect(findMotifs(defended, 'd3b5')[0]?.phrase).toBe('skewers the queen and knight');
  });

  it('finds a skewer through the king (Bd5+ wins the rook on g8)', () => {
    const [skewer] = findMotifs(SKEWER, 'f3d5');
    expect(skewer).toMatchObject({ type: 'skewer', square: 'd5', targets: ['e6', 'g8'] });
    expect(skewer?.phrase).toBe('skewers the king and rook');
  });
});

describe('findMotifs: discoveries, captures, promotions and mates', () => {
  it('finds a discovered check', () => {
    expect(motifs(DISCOVERED_CHECK, 'e5c6')).toEqual(['discovered-check e1>e8']);
  });

  it('finds a double check', () => {
    expect(motifs(DOUBLE_CHECK, 'e4f6')).toEqual(['fork f6>e8,d7', 'double-check f6>e8']);
  });

  it('finds a capture of an undefended piece, but not of a defended one', () => {
    // 1.e4 e5 2.Nf3 Qg5?? 3.Nxg5
    const qg5 = 'rnb1kbnr/pppp1ppp/8/4p1q1/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const [hanging] = findMotifs(qg5, 'f3g5');
    expect(hanging).toMatchObject({ type: 'hanging-piece', square: 'g5', targets: ['g5'] });
    expect(hanging?.phrase).toBe('wins the undefended queen on g5');
    // 1.e4 e5 2.Nf3 Nc6 3.Nxe5? Nxe5: the pawn was defended.
    const scotch = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    expect(types(scotch, 'f3e5')).toEqual([]);
  });

  it('finds a promotion only when the new piece is safe', () => {
    expect(motifs('8/4P1k1/8/8/8/8/6K1/8 w - - 0 1', 'e7e8q')).toEqual(['promotion e8>']);
    expect(types('r7/4P1k1/8/8/8/8/6K1/8 w - - 0 1', 'e7e8q')).toEqual([]);
  });

  it('names a back-rank mate, and only plain checkmate otherwise', () => {
    expect(findMotifs(BACK_RANK, 'd1d8')).toEqual([
      {
        type: 'back-rank-mate',
        step: 0,
        by: 'w',
        square: 'd8',
        targets: ['g8'],
        phrase: 'delivers a back-rank mate',
      },
    ]);
    // 17.Rd8# in the Opera Game: the bishop on g5 covers e7, so the king is not hemmed in.
    const opera17 = '1n2kb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 w k - 0 17';
    expect(types(opera17, 'd1d8')).toEqual(['checkmate']);
  });

  it('returns nothing for illegal or malformed moves and bad positions', () => {
    expect(findMotifs(ROYAL_FORK, 'd5d6')).toEqual([]);
    expect(findMotifs(ROYAL_FORK, 'zz')).toEqual([]);
    expect(findMotifs('not a fen', 'e2e4')).toEqual([]);
  });
});

describe('describeLine: ideas and missed chances', () => {
  it('tells the fork and stops once the queen is taken', () => {
    const line = 'd5f6 g8g7 f6d7 a8d8 d7c5 b7b6';
    const idea = story(ROYAL_FORK, line, { kind: 'idea', player: 'w' });
    expect(idea).toMatchObject({
      kind: 'idea',
      fen: ROYAL_FORK,
      movesUci: ['d5f6', 'g8g7', 'f6d7'],
      movesSan: ['Nf6+', 'Kg7', 'Nxd7'],
      materialSwing: 9,
      text: 'Nf6+ forks the king and queen and wins the queen.',
    });
    expect(idea.motifs.map((m) => `${m.type}@${m.step}`)).toEqual([
      'fork@0',
      'discovered-attack@0',
    ]);
    expect(idea.mateIn).toBeUndefined();

    const missed = story(ROYAL_FORK, line, { kind: 'missed', player: 'w' });
    expect(missed.text).toBe('You missed Nf6+, which forks the king and queen and wins the queen.');
  });

  it('tells a skewer and a discovered check', () => {
    expect(story(SKEWER, 'f3d5 e6e5 d5g8 e5d4', { kind: 'idea', player: 'w' }).text).toBe(
      'Bd5+ skewers the king and rook and wins the rook.',
    );
    expect(story(DISCOVERED_CHECK, 'e5c6 e8f7 c6d8', { kind: 'idea', player: 'w' }).text).toBe(
      'Nc6+ gives a discovered check and wins the queen.',
    );
  });

  it('tells a queen sacrifice that mates (16.Qb8+ Nxb8 17.Rd8#)', () => {
    const idea = story(OPERA_16, 'b3b8 d7b8 d1d8', { kind: 'idea', player: 'w' });
    expect(idea.text).toBe('You sacrifice the queen on b8: after Nxb8, Rd8# is checkmate.');
    expect(idea.mateIn).toBe(2);
    expect(idea.materialSwing).toBe(-9);
    expect(idea.motifs).toMatchObject([{ type: 'checkmate', step: 2, square: 'd8' }]);

    const missed = story(OPERA_16, 'b3b8 d7b8 d1d8', { kind: 'missed', player: 'w' });
    expect(missed.text).toBe('You had mate in 2: Qb8+ Nxb8 Rd8#.');
  });

  it('does not invent a tactic for a sacrifice that buys an attack (Greek gift)', () => {
    const short = story(GREEK_GIFT, 'd3h7 g8h7 f3g5 h7g8 d1h5', { kind: 'idea', player: 'w' });
    expect(short.text).toBe('You sacrifice the bishop on h7.');
    expect(short.motifs).toEqual([]);
    // Picking up the f7 pawn later does not win the bishop back: still no tactic to tell.
    const long = 'd3h7 g8h7 f3g5 h7g8 d1h5 f8e8 h5f7 g8h8';
    const longer = story(GREEK_GIFT, long, { kind: 'idea', player: 'w' });
    expect(longer.text).toBe('You sacrifice the bishop on h7.');
    expect(longer.motifs).toEqual([]);
  });

  it('describes a pin that wins a piece (25.Rc1! Be8 26.Rc8)', () => {
    const missed = story(GAME.before25, GAME.rc1Line, { kind: 'missed', player: 'w' });
    expect(missed.text).toBe(
      'You missed Rc1: after Be8, Rc8 pins the bishop to the king and wins the bishop.',
    );
    expect(missed.motifs).toMatchObject([{ type: 'pin', step: 2, square: 'c8' }]);
  });

  it('shortens long lines to "a few moves later" (16.Ba3! traps the rook)', () => {
    const missed = story(GAME.after15OO, GAME.ba3Line, { kind: 'missed', player: 'w' });
    expect(missed.movesSan).toEqual(['Ba3', 'Re8', 'Bd5+', 'Kh8', 'Bf7', 'Nc6', 'Bxe8']);
    expect(missed.text).toBe(
      'You missed Ba3: a few moves later, Bxe8 wins the undefended rook on e8.',
    );
    expect(bestMoveSentence(missed)).toBe(
      'Best was Ba3: a few moves later, Bxe8 wins the undefended rook on e8.',
    );
  });

  it('names a simple material gain (31.Rxg7)', () => {
    const missed = story(GAME.before31, GAME.rxg7Line, { kind: 'missed', player: 'w' });
    expect(missed.movesSan).toEqual(['Rxg7']);
    expect(missed.text).toBe('You missed Rxg7, which wins the undefended pawn on g7.');
  });

  it('leaves a mate too long to show to the engine score (53...Bxc4, mate in 9)', () => {
    const missed = story(GAME.before53e2, GAME.bxc4Line, { kind: 'missed', player: 'b' });
    expect(missed.mateIn).toBeUndefined();
    expect(missed.movesSan[0]).toBe('Bxc4');
    expect(missed.text).toBe('You missed Bxc4, which wins the undefended rook on c4.');
  });
});

describe('describeLine: refutations', () => {
  it('tells the reply that hangs a piece (31.Rg8?? Bxg8)', () => {
    const why = story(GAME.after31Rg8, GAME.bxg8Line, {
      kind: 'refutation',
      player: 'w',
      reviewedSan: 'Rg8',
    });
    expect(why).toMatchObject({
      kind: 'refutation',
      movesUci: ['b3g8'],
      movesSan: ['Bxg8'],
      materialSwing: -5,
      text: 'This leaves your rook on g8 unprotected: Bxg8 takes it for free.',
    });
    expect(why.motifs).toMatchObject([
      { type: 'hanging-piece', step: 0, by: 'b', square: 'g8', targets: ['g8'] },
    ]);
  });

  it('tells a fork from the opponent side, with "your" pieces', () => {
    const why = story(KNIGHT_ON_C7, 'b5c7 e8d7 c7a8 d7c6', { kind: 'refutation', player: 'b' });
    expect(why.text).toBe(
      'Your opponent replies Nc7+, forking your king and rook, and wins the rook.',
    );
    expect(why.movesSan).toEqual(['Nc7+', 'Kd7', 'Nxa8']);
    expect(why.materialSwing).toBe(-5);
  });

  it('spells out a short mate, and names a back-rank mate', () => {
    const afterRd7 = '2r3k1/p2R1ppp/8/8/8/8/P4PPP/6K1 b - - 1 1';
    const why = story(afterRd7, 'c8c1 d7d1 c1d1', { kind: 'refutation', player: 'w' });
    expect(why.text).toBe('This allows a back-rank mate: Rc1+ Rd1 Rxd1#.');
    expect(why.mateIn).toBe(2);
    const scholar = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    expect(story(scholar, 'h5f7', { kind: 'refutation', player: 'b' }).text).toBe(
      'This allows mate in 1 with Qxf7#.',
    );
  });

  it('does not call taking back a hanging piece (6...Bxc3 7.bxc3)', () => {
    const why = story(GAME.after6Bxc3, GAME.bxc3Line, {
      kind: 'refutation',
      player: 'b',
      reviewedSan: 'Bxc3',
      startFen: GAME.before6Bxc3,
    });
    expect(why.motifs).toEqual([]);
    expect(why.text).toBe('After bxc3 and a few more moves, dxe5 wins a pawn.');
    // Counted from before 6...Bxc3, so the knight for the bishop is a trade: a pawn is lost.
    expect(why.materialSwing).toBe(-1);
  });

  it('says when a promotion cannot be stopped', () => {
    const fen = '8/6k1/8/8/8/8/4p1K1/8 b - - 0 1';
    expect(story(fen, 'e2e1q g2f2', { kind: 'refutation', player: 'w' }).text).toBe(
      'Your opponent replies e1=Q and makes a new queen.',
    );
  });

  it('keeps a quiet line short and neutral', () => {
    const why = story(GAME.before6Bxc3, 'b8c6 a2a3 b4c3 e2c3', { kind: 'refutation', player: 'w' });
    // The trade on c3 changes nothing, so only the reply is shown.
    expect(why.movesSan).toEqual(['Nc6']);
    expect(why.text).toBe("Your opponent's best reply is Nc6.");
    expect(storyMatters(why)).toBe(false);
  });
});

/** UCI of a SAN move in `fen`, and the position after it. */
function play(fen: string, san: string): { uci: string; fen: string } {
  const chess = new Chess(fen);
  const move = chess.move(san);
  return { uci: `${move.from}${move.to}${move.promotion ?? ''}`, fen: chess.fen() };
}

describe('describeLine: material told the way it changes hands', () => {
  it('plays an exchange running at the horizon to its end (Byrne-Fischer 15...Nxc3!!)', () => {
    const before = 'r4rk1/pp2Bpbp/1qp3p1/8/2BPn1b1/Q1P2N2/P4PPP/3RK2R b K - 2 15';
    const pv = 'e7c5 f8e8 e1f1 g4e6 a3c3 b6c5 d4c5 g7c3 c4e6 e8e6 g2g3';
    const idea = story(before, `${play(before, 'Nxc3').uci} ${pv}`, { kind: 'idea', player: 'b' });
    // Not cut after 21.dxc5, with Black's queen just lost: 21...Bxc3 wins White's back.
    expect(idea.movesSan.at(-1)).toBe('Bxc3');
    expect(idea.materialSwing).toBe(1);
    expect(idea.text).toBe('After Nxc3 and a few more moves, you come out a pawn ahead.');
  });

  it('does not take a line cut at the walk limit for a finished exchange', () => {
    const before = '3r1rk1/ppp2ppp/8/8/1n6/4P1PP/PqP1QPB1/1R3RK1 b - - 5 17';
    const { fen } = play(before, 'Qxc2');
    const pv = 'e2c2 b4c2 f1c1 d8d2 b1b2 f8d8 c1c2 d2c2 b2c2 g7g6 g2f1 d8d1 g1g2';
    const why = story(fen, pv, {
      kind: 'refutation',
      player: 'b',
      reviewedSan: 'Qxc2',
      startFen: before,
    });
    expect(why.movesSan.slice(-3)).toEqual(['Rcxc2', 'Rxc2', 'Rxc2']);
    expect(why.materialSwing).toBe(-2);
    expect(why.text).toBe(
      'After Qxc2 Nxc2 Rfc1 Rd2, Rb2 pins your knight to your rook and wins the knight.',
    );
  });

  it('credits a promotion, not a later pawn capture, with the queen won', () => {
    const before = '5q2/pk3PB1/1p6/8/7P/3p2P1/P7/KR3R2 b - - 2 41';
    const { fen } = play(before, 'Qc5');
    const why = story(fen, 'f7f8q c5f8 f1f8 b6b5 b1d1 b7c6 d1d3 c6b6', {
      kind: 'refutation',
      player: 'b',
      reviewedSan: 'Qc5',
      startFen: before,
    });
    expect(why.text).toBe('Your opponent replies f8=Q and makes a new queen.');
    expect(why.materialSwing).toBe(-9);
  });

  it('says what a capture goes on to win when it is only the start (Qxg7+, then the queen)', () => {
    const before = '8/4Q1pp/8/3R1p2/4q1k1/K7/5P1P/1r6 w - - 6 39';
    const pv = 'g4f3 g7g3 f3e2 d5e5 e2f1 e5e4 f5e4 h2h4';
    const idea = story(before, `${play(before, 'Qxg7+').uci} ${pv}`, { kind: 'idea', player: 'w' });
    expect(idea.text).toBe('Qxg7+ wins the undefended pawn on g7 and then the queen for a rook.');
    expect(idea.materialSwing).toBe(5);
    // The same for a capture later in the line (16.Ba3 Re8 17.Bd5+ Be6 18.Bxb7, then Bxa8).
    const missed = story(GAME.after15OO, 'b2a3 f8e8 g2d5 c8e6 d5b7 b8d7 b7a8 e8a8', {
      kind: 'missed',
      player: 'w',
    });
    expect(missed.text).toBe(
      'You missed Ba3: after Re8 Bd5+ Be6, Bxb7 wins the undefended pawn on b7 and then the exchange.',
    );
  });

  it('tells a recapture that wins material (30.Rxg6? Rxg6 wins the exchange)', () => {
    const before = 'r1b1k3/p2n4/1pp2Rn1/3pP2Q/P2P2r1/2PqP1P1/8/RNB1K1N1 w Qq - 3 30';
    const { fen } = play(before, 'Rxg6');
    const why = story(fen, 'g4g6 g1h3 d7f8 h3f4 d3c2 c1a3', {
      kind: 'refutation',
      player: 'w',
      reviewedSan: 'Rxg6',
      startFen: before,
    });
    expect(why.text).toBe('Your opponent replies Rxg6 and wins the exchange.');
    expect(why.materialSwing).toBe(-2);
  });

  it('says a piece is still hanging when it already was before the move', () => {
    // Before 30...c4, White could already play Qxe5+.
    const before = '3r1r2/2p2pk1/p6p/1ppBp2Q/4P3/3P4/5PK1/8 b - - 0 30';
    const { fen } = play(before, 'c4');
    const why = story(fen, 'h5e5 g7g8 d3c4 c7c6 d5c6 b5c4 c6d5 d8c8', {
      kind: 'refutation',
      player: 'b',
      reviewedSan: 'c4',
      startFen: before,
    });
    expect(why.text).toBe('Your pawn on e5 is still hanging: Qxe5+ takes it for free.');
    // Without the position before the move there is nothing to compare with.
    const plain = story(fen, 'h5e5 g7g8', { kind: 'refutation', player: 'b' });
    expect(plain.text).toBe('This leaves your pawn on e5 unprotected: Qxe5+ takes it for free.');
  });

  it('counts pawns won when pieces went back ("the queen and a pawn for a rook")', () => {
    const fen = '3r1rk1/2p2pp1/p6p/1ppBp2q/4P1R1/3P1Q2/5PK1/8 w - - 4 29';
    expect(story(fen, 'g4g7 g8g7 f3h5', { kind: 'idea', player: 'w' }).text).toBe(
      'Rxg7+ uncovers an attack on the queen and wins the queen and a pawn for a rook.',
    );
  });

  it('does not list pawns as fork targets', () => {
    const fen = '5r2/2p2pk1/p6p/4p2Q/2BrP3/8/5PK1/8 w - - 1 33';
    expect(story(fen, 'h5e5 g7g8 e5d4', { kind: 'idea', player: 'w' }).text).toBe(
      'Qxe5+ forks the king and rook and wins the rook and a pawn.',
    );
    // A check that also hits a loose pawn is no fork.
    expect(types('6k1/8/8/8/8/8/1p6/K2Q4 w - - 0 1', 'd1d5')).not.toContain('fork');
  });
});

describe('describeLine: sacrifices', () => {
  /** 2r4k/ppp2p1p/3q2p1/8/8/2N4R/PPP2PP1/4R1K1 w after 19.Ne4 Qd7: 20.Rxh7+! Kxh7 21.Nf6+. */
  const AFTER_QD7 = '2r4k/pppq1p1p/6p1/8/4N3/7R/PPP2PP1/4R1K1 w - - 2 20';

  it('names the sacrifice and exposes it on the story', () => {
    const idea = story(AFTER_QD7, 'h3h7 h8h7 e4f6 h7g7 f6d7', { kind: 'idea', player: 'w' });
    expect(idea.text).toBe(
      'You sacrifice the rook on h7: after Kxh7, Nf6+ forks the king and queen and wins the queen.',
    );
    expect(idea.sacrifice).toEqual({ piece: 'r', square: 'h7' });
    expect(storyMatters(idea)).toBe(true);
  });

  it('is no sacrifice when the first move answers a check', () => {
    const before = '7r/Bbk3pp/2q1Bn2/5p2/8/p1Qr4/4KP1P/1N3R2 w - - 1 26';
    const { fen } = play(before, 'Qa5+');
    const why = story(fen, 'c7d6 e2d3 d6e6 f1e1 e6f7 b1c3 h8c8 a5b4 f7g8 d3d2', {
      kind: 'refutation',
      player: 'w',
      reviewedSan: 'Qa5+',
      startFen: before,
    });
    expect(why.sacrifice).toBeUndefined();
    expect(why.text).not.toContain('sacrifice');
    expect(storyMatters(why)).toBe(false);
  });

  it('is no sacrifice when the first move takes back what the move before captured', () => {
    // After ...Rxd4, Qxd4 Rxd4 gives the queen for a rook, but taking back is no choice.
    const fen = '3r2k1/5ppp/8/8/3r4/8/3Q1PPP/6K1 w - - 0 1';
    const line = story(fen, 'd2d4 d8d4', { kind: 'idea', player: 'w', previousCaptureOn: 'd4' });
    expect(line.sacrifice).toBeUndefined();
    expect(line.text).toBe('Qxd4 is the strongest move here.');
    // Without the capture before, the same moves give the queen away.
    expect(story(fen, 'd2d4 d8d4', { kind: 'idea', player: 'w' }).sacrifice).toEqual({
      piece: 'q',
      square: 'd4',
    });
  });

  it('is no sacrifice when the piece taken was already hanging before the move', () => {
    // The knight on b5 was attacked by the a6 pawn before Qd5: it was left, not given.
    const fen = '6k1/5ppp/p7/1N6/8/8/5PPP/3Q2K1 w - - 0 1';
    const idea = story(fen, 'd1d5 a6b5', { kind: 'idea', player: 'w' });
    expect(idea.sacrifice).toBeUndefined();
    expect(idea.text).toBe('Qd5 is the strongest move here.');
  });
});

describe('storyMatters', () => {
  const base: LineStory = {
    kind: 'refutation',
    fen: ROYAL_FORK,
    movesUci: ['d5f6'],
    movesSan: ['Nf6+'],
    motifs: [],
    materialSwing: 0,
    text: '',
  };

  it('counts material only when it goes the way of the story', () => {
    expect(storyMatters({ ...base, materialSwing: -3 })).toBe(true);
    expect(storyMatters({ ...base, materialSwing: 3 })).toBe(false);
    expect(storyMatters({ ...base, kind: 'missed', materialSwing: -8 })).toBe(false);
    expect(storyMatters({ ...base, kind: 'missed', materialSwing: 1 })).toBe(true);
    expect(storyMatters({ ...base, kind: 'idea', materialSwing: -1 })).toBe(false);
  });

  it('keeps sacrifices, mates and motifs whatever the material', () => {
    const sacrifice = { piece: 'r' as const, square: 'h7' as const };
    expect(storyMatters({ ...base, kind: 'idea', materialSwing: -5, sacrifice })).toBe(true);
    expect(storyMatters({ ...base, kind: 'idea', materialSwing: -9, mateIn: 2 })).toBe(true);
  });

  it('does not count a missed sacrifice that the text tells neutrally', () => {
    // 29...Qxf6 was the only defence against Rxg5#: the queen is given up for a pawn.
    const fen = '5rk1/1pp2p1n/p1q2P1Q/3p1Rp1/1P1Pr3/2P5/6PP/5RK1 b - - 2 29';
    const missed = story(fen, 'c6f6 f5f6 c7c6 f6f3 f7f6 h6g6 g8h8 f3h3', {
      kind: 'missed',
      player: 'b',
    });
    expect(missed.sacrifice).toEqual({ piece: 'q', square: 'f6' });
    expect(missed.text).toBe('Qxf6 was the strongest move.');
    expect(storyMatters(missed)).toBe(false);
  });
});

describe('describeLine: robustness', () => {
  it('stops at the first illegal move', () => {
    const idea = story(ROYAL_FORK, 'd5f6 g8g7 a1a8 f6d7', { kind: 'idea', player: 'w' });
    expect(idea.movesUci).toEqual(['d5f6', 'g8g7']);
    expect(idea.text).toBe('Nf6+ is the strongest move here.');
  });

  it('returns an empty story for an unusable line', () => {
    for (const [fen, pv] of [
      ['not a fen', ['e2e4']],
      [ROYAL_FORK, []],
      [ROYAL_FORK, ['zz']],
    ] as const) {
      const empty = describeLine(fen, [...pv], { kind: 'missed', player: 'w' });
      expect(empty).toMatchObject({ movesUci: [], movesSan: [], motifs: [], text: '' });
      expect(storyMatters(empty)).toBe(false);
    }
  });

  it('only rewrites missed stories into a "Best was" sentence', () => {
    const idea = story(ROYAL_FORK, 'd5f6 g8g7 f6d7', { kind: 'idea', player: 'w' });
    expect(bestMoveSentence(idea)).toBeNull();
    const missed = story(ROYAL_FORK, 'd5f6 g8g7 f6d7', { kind: 'missed', player: 'w' });
    expect(bestMoveSentence(missed)).toBe(
      'Best was Nf6+, which forks the king and queen and wins the queen.',
    );
    const mate = story(OPERA_16, 'b3b8 d7b8 d1d8', { kind: 'missed', player: 'w' });
    expect(bestMoveSentence(mate)).toBeNull();
  });
});
