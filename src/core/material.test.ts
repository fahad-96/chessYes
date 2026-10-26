import { describe, expect, it } from 'vitest';
import {
  detectSacrifice,
  isRegainedAtOnce,
  materialBalance,
  measureOffer,
  staticExchange,
} from './material';
import { START_FEN } from './notation';

/**
 * Positions from Morphy vs Duke of Brunswick & Count Isouard, Paris 1858 ("the Opera Game"):
 * 1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5
 * 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8
 * 17.Rd8# (FENs replayed with chess.js).
 */
const OPERA = {
  before10: 'rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10',
  before13: '3rkb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R w k - 3 13',
  before16: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16',
  final: '1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17',
};

describe('materialBalance', () => {
  it('is zero in the starting position', () => {
    expect(materialBalance(START_FEN)).toBe(0);
  });

  it('counts White minus Black in pawn units', () => {
    expect(materialBalance('4k3/8/8/8/8/8/8/3QK3 w - - 0 1')).toBe(9);
    // Morphy mates while down a queen and a knight: R+B+7P (15) against Q+R+B+N+5P (25).
    expect(materialBalance(OPERA.final)).toBe(-10);
  });
});

describe('staticExchange', () => {
  it('wins an undefended piece', () => {
    expect(staticExchange('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'd5')).toBe(3);
  });

  it('does not take a pawn defended by a pawn with a knight', () => {
    // Nxd5 exd5 loses the knight for a pawn, so White does better not to start.
    expect(staticExchange('4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1', 'd5')).toBe(0);
  });

  it('sees x-ray attackers behind the first capturer', () => {
    // Single rook: Rxd5 Rxd5 loses the exchange.
    expect(staticExchange('3rk3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'd5')).toBe(0);
    // Doubled rooks: Rxd5 Rxd5 Rxd5 nets the knight.
    expect(staticExchange('3rk3/8/8/3n4/8/8/3R4/3RK3 w - - 0 1', 'd5')).toBe(3);
  });

  it('ignores an attacker that is pinned to its king', () => {
    // The e2 knight cannot take on f4: Re8 pins it to the king on e1.
    expect(staticExchange('4r1k1/8/8/8/5b2/8/4N3/4K3 w - - 0 1', 'f4')).toBe(0);
    // With the king on f1 there is no pin and Nxf4 wins the bishop.
    expect(staticExchange('4r1k1/8/8/8/5b2/8/4N3/5K2 w - - 0 1', 'f4')).toBe(3);
  });

  it('lets a piece pinned only to the queen recapture (Elephant Trap)', () => {
    // 1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Bg5 Nbd7 5.cxd5 exd5: 6.Nxd5? Nxd5 is legal despite Bg5.
    const fen = 'r1bqkb1r/pppn1ppp/5n2/3p2B1/3P4/2N5/PP2PPPP/R2QKBNR w KQkq - 0 6';
    expect(staticExchange(fen, 'd5')).toBe(0);
  });

  it('never lets the king capture a defended piece', () => {
    expect(staticExchange('4k3/8/8/8/1b6/8/3n4/4K3 w - - 0 1', 'd2')).toBe(0);
    expect(staticExchange('4k3/8/8/8/8/8/3n4/4K3 w - - 0 1', 'd2')).toBe(3);
  });

  it('sends the king in last', () => {
    // Rxd2 Bxd2+ Kxd2: knight + bishop for the rook, +1 for White.
    expect(staticExchange('4k3/8/8/8/1b6/8/3n4/3RK3 w - - 0 1', 'd2')).toBe(1);
  });

  it('counts the promotion when a pawn captures onto the last rank', () => {
    // bxa8=Q: rook (5) + promotion (8).
    expect(staticExchange('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'a8')).toBe(13);
    // With Nb6 guarding a8 the new queen is lost: 13 - 9.
    expect(staticExchange('r3k3/1P6/1n6/8/8/8/8/4K3 w - - 0 1', 'a8')).toBe(4);
  });

  it('returns 0 for an empty square, an own piece or an invalid FEN', () => {
    expect(staticExchange(START_FEN, 'e4')).toBe(0);
    expect(staticExchange(START_FEN, 'e2')).toBe(0);
    expect(staticExchange(START_FEN, 'e7')).toBe(0);
    expect(staticExchange('not a fen', 'e4')).toBe(0);
  });
});

describe('detectSacrifice', () => {
  it('detects the Greek gift Bxh7+', () => {
    // 1.e4 e6 2.d4 d5 3.Nc3 Nf6 4.e5 Nfd7 5.Nf3 Be7 6.Bd3 O-O 7.Bxh7+ Kxh7: bishop for a pawn.
    const fen = 'rnbq1rk1/pppnbppp/4p3/3pP3/3P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 5 7';
    expect(detectSacrifice(fen, 'd3h7')).toEqual({ material: 2, square: 'h7', piece: 'b' });
  });

  it('detects the Sicilian exchange sacrifice ...Rxc3', () => {
    // Dragon, Yugoslav Attack: ...Rxc3 bxc3 gives a rook for a knight.
    const fen = '3q1rk1/pp1bppbp/3p1np1/7P/2rNP3/2N1BP2/PPPQ2P1/2KR3R b - - 0 14';
    expect(detectSacrifice(fen, 'c4c3')).toEqual({ material: 2, square: 'c3', piece: 'r' });
  });

  it('detects the queen sacrifice 16.Qb8+ in the Opera Game', () => {
    // Before the move the queen was safe (Qxb3 axb3 is an even trade); now Nxb8 wins it.
    expect(detectSacrifice(OPERA.before16, 'b3b8')).toEqual({
      material: 9,
      square: 'b8',
      piece: 'q',
    });
  });

  it('detects the exchange sacrifice 13.Rxd7 in the Opera Game', () => {
    // Rook for knight: Nxd7 Bxd7+ Rxd7 leaves Black a full exchange up.
    expect(detectSacrifice(OPERA.before13, 'd1d7')).toEqual({
      material: 2,
      square: 'd7',
      piece: 'r',
    });
  });

  it('nets the recaptured pawn in 10.Nxb5 (knight for two pawns is below the threshold)', () => {
    // 10.Nxb5 cxb5 11.Bxb5+ gives a knight (3) for two pawns, so only one pawn is offered.
    expect(measureOffer(OPERA.before10, 'c3b5')).toEqual({ material: 1, square: 'b5', piece: 'n' });
    expect(detectSacrifice(OPERA.before10, 'c3b5')).toBeNull();
  });

  it('detects a sacrifice with check that ignores attacked pieces (Traxler ...Bxf2+)', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 Bc5 5.Nxf7 Bxf2+: White must answer the check first.
    const fen = 'r1bqk2r/pppp1Npp/2n2n2/2b1p3/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 0 5';
    expect(detectSacrifice(fen, 'c5f2')).toEqual({ material: 2, square: 'f2', piece: 'b' });
  });

  it('detects a defender moving away and leaving another piece hanging', () => {
    // Nc3 guards the bishop on d5; after Ne4 the rook simply takes it.
    const fen = '3rk3/8/8/3B4/8/2N5/8/4K3 w - - 0 1';
    expect(detectSacrifice(fen, 'c3e4')).toEqual({ material: 3, square: 'd5', piece: 'b' });
  });

  it('detects a knight moved to a square attacked by a pawn', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.d3 h6 5.Ng5 hxg5 6.Bxg5: knight for a pawn.
    const fen = 'r1bqkb1r/pppp1pp1/2n2n1p/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5';
    expect(detectSacrifice(fen, 'f3g5')).toEqual({ material: 2, square: 'g5', piece: 'n' });
  });

  it('ignores a quiet developing move', () => {
    expect(detectSacrifice(START_FEN, 'g1f3')).toBeNull();
    expect(measureOffer(START_FEN, 'g1f3')?.material).toBe(0);
  });

  it('ignores an even trade (Bxc6 dxc6)', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.Bxc6: bishop for knight.
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    expect(detectSacrifice(fen, 'b5c6')).toBeNull();
    expect(measureOffer(fen, 'b5c6')?.material).toBe(0);
  });

  it('ignores a desperado: an attacked knight taking a defended pawn', () => {
    // The c3 knight is attacked by ...b4; 11.Nxd5 cxd5 only changes how it is lost.
    const fen = 'r1bq1rk1/p1bn1ppp/2p1pn2/2Pp4/1p1P4/1PNBPN2/P1Q2PPP/R1B2RK1 w - - 0 11';
    expect(detectSacrifice(fen, 'c3d5')).toBeNull();
    expect(measureOffer(fen, 'c3d5')?.material).toBe(0);
  });

  it('treats any already-attacked piece as lost, even one that could retreat', () => {
    // Deep Blue vs Kasparov 1997, game 6: 7...h6 8.Nxe6. The knight on g5 was attacked by the
    // h-pawn, so by this definition 8.Nxe6 is a desperado rather than a sacrifice.
    const fen = 'r1bqkb1r/pp1n1pp1/2p1pn1p/6N1/3P4/3B1N2/PPP2PPP/R1BQK2R w KQkq - 0 8';
    expect(detectSacrifice(fen, 'g5e6')).toBeNull();
  });

  it('ignores a gambit pawn (one pawn is below the threshold)', () => {
    // King's Gambit 2.f4: exf4 wins a pawn.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    expect(measureOffer(fen, 'f2f4')).toEqual({ material: 1, square: 'f4', piece: 'p' });
    expect(detectSacrifice(fen, 'f2f4')).toBeNull();
  });

  it('subtracts the promotion gain', () => {
    // e8=Q Rxe8 loses only the pawn.
    expect(measureOffer('r5k1/4P3/8/8/8/8/8/4K3 w - - 0 1', 'e7e8q')?.material).toBe(1);
  });

  it('does not count a piece that was already forked when the king steps out of check', () => {
    // ...Nc2+ forks Ke1 and Ra1: after Kd2 the rook is still lost, but Kd2 did not offer it.
    const fen = '4k3/8/8/8/8/8/2n5/R3K2R w KQ - 0 1';
    expect(measureOffer(fen, 'e1d2')?.material).toBeLessThanOrEqual(0);
    expect(detectSacrifice(fen, 'e1d2')).toBeNull();
    expect(detectSacrifice(fen, 'e1d1')).toBeNull();
    expect(detectSacrifice(fen, 'e1f2')).toBeNull();
  });

  it('does not count a piece that was already hanging when the mover blocks a check', () => {
    // Byrne - Fischer 1956, 29...Bf8: the only block against Qd8+; the rook on e1 hung before.
    const fen = '3Q2k1/1p3pbp/2p3p1/8/2b5/5N1P/r4nPK/4r3 b - - 1 29';
    expect(detectSacrifice(fen, 'g7f8')).toBeNull();
  });

  it('still counts a piece put en prise to answer a check', () => {
    // Re8+: blocking with Ne4 lets the rook take the knight; Ne2 is defended by the king.
    const fen = '4r1k1/8/8/8/8/2N5/8/4K3 w - - 0 1';
    expect(detectSacrifice(fen, 'c3e4')).toEqual({ material: 3, square: 'e4', piece: 'n' });
    expect(detectSacrifice(fen, 'c3e2')).toBeNull();
  });

  it('finds nothing offered by a move that ends the game', () => {
    // Nxe3 leaves king and knight against king: the game is drawn, so Kxe3 never happens.
    expect(measureOffer('8/8/8/8/5k2/4p3/2N5/3K4 w - - 0 60', 'c2e3')).toBeNull();
    // Checkmate (the Opera Game's 17.Rd8#) and stalemate offer nothing either.
    expect(
      measureOffer('1n2kb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 w k - 0 17', 'd1d8'),
    ).toBeNull();
    expect(measureOffer('7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', 'g1g6')).toBeNull();
  });

  it('returns null for illegal or malformed moves', () => {
    expect(detectSacrifice(START_FEN, 'e2e5')).toBeNull();
    expect(detectSacrifice(START_FEN, 'xyz')).toBeNull();
    expect(detectSacrifice('not a fen', 'e2e4')).toBeNull();
    expect(measureOffer(START_FEN, 'e2e5')).toBeNull();
  });
});

describe('isRegainedAtOnce', () => {
  it('sees a check whose rook is taken but uncovers an attack on the queen', () => {
    // 29.Rxg7+ Kxg7 30.Qxh5: rook and pawn for the queen.
    const fen = '3r1rk1/2p2pp1/p6p/1ppBp2q/4P1R1/3P1Q2/5PK1/8 w - - 4 29';
    expect(detectSacrifice(fen, 'g4g7')).not.toBeNull();
    expect(isRegainedAtOnce(fen, 'g4g7', ['g8g7', 'f3h5', 'd8d5'])).toBe(true);
  });

  it('sees a capture that wins the piece back at once (...Nxe4 Nxe4 Bxg5)', () => {
    const fen = 'r2qk2r/1p2bppp/p1npbn2/4p1B1/4P3/2N1N3/PPP2PPP/R2QKB1R b KQkq - 5 10';
    expect(isRegainedAtOnce(fen, 'f6e4', ['c3e4', 'e7g5'])).toBe(true);
  });

  it('keeps a real sacrifice whose material does not come back (Greek gift Bxh7+)', () => {
    const fen = 'rnbq1rk1/pppnbppp/4p3/3pP3/3P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 5 7';
    expect(isRegainedAtOnce(fen, 'd3h7', ['g8h7', 'f3g5', 'h7g8'])).toBe(false);
  });

  it('ignores quiet moves, declined offers and lines too short to tell', () => {
    const fen = 'r1bqkb1r/pppp1pp1/2n2n1p/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5';
    // 5.Ng5 hxg5 6.Bxg5: quiet, so it stays a sacrifice whatever the line.
    expect(isRegainedAtOnce(fen, 'f3g5', ['h6g5', 'c1g5'])).toBe(false);
    const greek = 'rnbq1rk1/pppnbppp/4p3/3pP3/3P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 5 7';
    expect(isRegainedAtOnce(greek, 'd3h7', ['g8h8', 'f3g5'])).toBe(false);
    expect(isRegainedAtOnce(greek, 'd3h7', ['g8h7'])).toBe(false);
    expect(isRegainedAtOnce(greek, 'd3h7', ['g8h7', 'e1e8'])).toBe(false);
    expect(isRegainedAtOnce('not a fen', 'd3h7', ['g8h7', 'f3g5'])).toBe(false);
  });
});
