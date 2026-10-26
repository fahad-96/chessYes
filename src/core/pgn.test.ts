import { describe, expect, it } from 'vitest';
import { START_FEN } from './notation';
import { PgnError, parsePgn, readPgnHeaders, splitPgnGames } from './pgn';

// Same layout as a Chess.com download: headers, blank line, one line of movetext.
const CHESSCOM_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2024.01.15"]
[Round "-"]
[White "alice_test"]
[Black "bob_test"]
[Result "1-0"]
[ECO "C50"]
[WhiteElo "1512"]
[BlackElo "1490"]
[TimeControl "180"]
[Termination "alice_test won by checkmate"]
[Link "https://www.chess.com/game/live/100000001"]

1. e4 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:59.2]} 2. Bc4 {[%clk 0:02:58.1]} 2... Nc6 {[%clk 0:02:57.5]} 3. Qh5 {[%clk 0:02:56]} 3... Nf6 {[%clk 0:02:50.3]} 4. Qxf7# {[%clk 0:02:55.1]} 1-0
`;

// Lichess style: spaced comments, evals next to clocks, analysis comments and variations.
const LICHESS_PGN = `[Event "Rated Blitz game"]
[Site "https://lichess.org/AbCdEfGh"]
[Date "2024.02.01"]
[White "carol_test"]
[Black "dave_test"]
[Result "0-1"]
[Variant "Standard"]
[TimeControl "180+0"]
[Annotator "lichess.org"]

1. f3 { [%eval -0.52] [%clk 0:03:00] } 1... e5 { [%eval -0.41] [%clk 0:03:00] } 2. g4?? { [%eval #-1] [%clk 0:02:58] } { Blunder. Nc3 was best. } (2. Nc3 { [%clk 0:00:01] } d5 3. e4) 2... Qh4# { [%clk 0:02:59.5] } { Black wins by checkmate. } 0-1
`;

describe('parsePgn', () => {
  it('parses a Chess.com game with clocks', () => {
    const game = parsePgn(CHESSCOM_PGN);
    expect(game.headers.White).toBe('alice_test');
    expect(game.headers.Link).toBe('https://www.chess.com/game/live/100000001');
    expect(game.initialFen).toBe(START_FEN);
    expect(game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
    expect(game.moves.map((m) => m.clock)).toEqual([179.9, 179.2, 178.1, 177.5, 176, 170.3, 175.1]);
    expect(game.finalState).toBe('checkmate');

    const mate = game.moves[6]!;
    expect(mate).toMatchObject({
      ply: 7,
      moveNumber: 4,
      color: 'w',
      uci: 'h5f7',
      from: 'h5',
      to: 'f7',
      piece: 'q',
      captured: 'p',
      isCheck: true,
      isCheckmate: true,
    });
    expect(mate.promotion).toBeUndefined();
  });

  it('chains positions: each fenBefore is the previous fenAfter', () => {
    const { moves, initialFen } = parsePgn(CHESSCOM_PGN);
    expect(moves[0]!.fenBefore).toBe(initialFen);
    for (let i = 1; i < moves.length; i++) {
      expect(moves[i]!.fenBefore).toBe(moves[i - 1]!.fenAfter);
    }
  });

  it('parses a Lichess game with clocks, evals, analysis comments and variations', () => {
    const game = parsePgn(LICHESS_PGN);
    expect(game.moves.map((m) => m.san)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    expect(game.moves.map((m) => m.clock)).toEqual([180, 180, 178, 179.5]);
    expect(game.moves.map((m) => m.color)).toEqual(['w', 'b', 'w', 'b']);
    expect(game.moves.map((m) => m.moveNumber)).toEqual([1, 1, 2, 2]);
    expect(game.finalState).toBe('checkmate');
  });

  it('only keeps the tags that are present', () => {
    const { headers } = parsePgn('[White "x"]\n[Black "y"]\n\n1. e4 *');
    expect(headers).toEqual({ White: 'x', Black: 'y' });
  });

  it('writes castling as a king move in UCI', () => {
    const { moves } = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 O-O *');
    expect(moves[6]).toMatchObject({ san: 'O-O', uci: 'e1g1', from: 'e1', to: 'g1', piece: 'k' });
    expect(moves[9]).toMatchObject({ san: 'O-O', uci: 'e8g8', from: 'e8', to: 'g8', piece: 'k' });

    const long = parsePgn(
      '1. e4 Nf6 2. e5 d5 3. exd6 cxd6 4. d4 Nc6 5. Nc3 Bf5 6. Be3 Qd7 7. Qd2 O-O-O 8. O-O-O *',
    ).moves;
    expect(long[13]).toMatchObject({ san: 'O-O-O', uci: 'e8c8' });
    expect(long[14]).toMatchObject({ san: 'O-O-O', uci: 'e1c1' });
  });

  it('accepts castling written with zeros', () => {
    const { moves } = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 *');
    expect(moves[6]).toMatchObject({ san: 'O-O', uci: 'e1g1' });
  });

  it('records en passant captures', () => {
    const { moves } = parsePgn('1. e4 Nf6 2. e5 d5 3. exd6 *');
    expect(moves[4]).toMatchObject({
      san: 'exd6',
      uci: 'e5d6',
      piece: 'p',
      captured: 'p',
    });
    // The captured pawn on d5 is gone from the board.
    expect(moves[4]!.fenAfter.split(' ')[0]).toBe(
      'rnbqkb1r/ppp1pppp/3P1n2/8/8/8/PPPP1PPP/RNBQKBNR',
    );
  });

  it('records promotions, including capture-promotions and underpromotion', () => {
    const queen = parsePgn('[SetUp "1"]\n[FEN "8/1P4k1/8/8/8/8/6K1/8 w - - 0 1"]\n\n1. b8=Q *');
    expect(queen.moves[0]).toMatchObject({ san: 'b8=Q', uci: 'b7b8q', promotion: 'q' });

    const knight = parsePgn('[SetUp "1"]\n[FEN "1r4k1/P7/8/8/8/8/6K1/8 w - - 0 1"]\n\n1. axb8=N *');
    expect(knight.moves[0]).toMatchObject({
      san: 'axb8=N',
      uci: 'a7b8n',
      captured: 'r',
      promotion: 'n',
    });

    const black = parsePgn('[SetUp "1"]\n[FEN "8/6k1/8/8/8/8/p5K1/8 b - - 0 1"]\n\n1... a1=R *');
    expect(black.moves[0]).toMatchObject({ uci: 'a2a1r', color: 'b', promotion: 'r' });
  });

  it('numbers moves correctly for a game that starts from a FEN with Black to move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const game = parsePgn(`[SetUp "1"]\n[FEN "${fen}"]\n\n1... e5 2. Nf3 Nc6 3. Bb5 *`);
    expect(game.initialFen).toBe(fen);
    expect(game.moves.map((m) => [m.ply, m.moveNumber, m.color, m.san])).toEqual([
      [1, 1, 'b', 'e5'],
      [2, 2, 'w', 'Nf3'],
      [3, 2, 'b', 'Nc6'],
      [4, 3, 'w', 'Bb5'],
    ]);
  });

  it('uses the full-move number from the FEN', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 23';
    const { moves } = parsePgn(`[FEN "${fen}"]\n\n23. Bb5 a6 24. Ba4 *`);
    expect(moves.map((m) => [m.ply, m.moveNumber, m.color])).toEqual([
      [1, 23, 'w'],
      [2, 23, 'b'],
      [3, 24, 'w'],
    ]);
  });

  it('ignores comments, NAGs, annotations and nested variations', () => {
    const pgn = `{Game comment before the first move}
1. e4 $1 {Best by test} (1. d4 d5 (1... Nf6 2. c4 {[%clk 0:00:10]}) 2. c4) 1... e5!? ; to end of line
2.Nf3 $14 {[%clk 0:01:00]} Nc6 3. Bb5 a6?! $6 {comment} $2 *`;
    const { moves } = parsePgn(pgn);
    expect(moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(moves[0]!.clock).toBeUndefined(); // the clock inside the variation is not e4's
    expect(moves[2]!.clock).toBe(60);
  });

  it('skips %-escaped lines', () => {
    const { moves } = parsePgn('% exported by some tool\n1. e4 e5\n%ignored 2. d4\n2. Nf3 *');
    expect(moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('detects stalemate', () => {
    const game = parsePgn('[SetUp "1"]\n[FEN "k7/8/8/1Q6/8/8/8/7K w - - 0 1"]\n\n1. Qb6 1/2-1/2');
    expect(game.finalState).toBe('stalemate');
  });

  it('detects insufficient material', () => {
    const game = parsePgn(
      '[SetUp "1"]\n[FEN "8/8/8/4k3/8/8/3n4/4K3 w - - 0 1"]\n\n1. Kxd2 1/2-1/2',
    );
    expect(game.finalState).toBe('insufficient');
  });

  it('detects the fifty-move rule', () => {
    const game = parsePgn(
      '[SetUp "1"]\n[FEN "8/8/8/4k3/8/8/8/R3K3 w - - 99 80"]\n\n80. Ra2 1/2-1/2',
    );
    expect(game.finalState).toBe('fifty-move');
  });

  it('detects threefold repetition and keeps clocks aligned with repeated positions', () => {
    const pgn =
      '1. Nf3 {[%clk 0:01:00]} 1... Nf6 {[%clk 0:00:59]} 2. Ng1 {[%clk 0:00:58]} ' +
      '2... Ng8 {[%clk 0:00:57]} 3. Nf3 {[%clk 0:00:56]} 3... Nf6 {[%clk 0:00:55]} ' +
      '4. Ng1 {[%clk 0:00:54]} 4... Ng8 {[%clk 0:00:53]} 1/2-1/2';
    const game = parsePgn(pgn);
    expect(game.moves.map((m) => m.clock)).toEqual([60, 59, 58, 57, 56, 55, 54, 53]);
    expect(game.finalState).toBe('threefold');
  });

  it('leaves finalState unset for a game that is not over on the board', () => {
    const game = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0');
    expect(game.finalState).toBeUndefined();
    expect(game.moves.every((m) => m.clock === undefined)).toBe(true);
  });

  it('accepts a game with zero moves', () => {
    const game = parsePgn('[Event "Abandoned"]\n[Result "*"]\n\n*');
    expect(game.moves).toEqual([]);
    expect(game.initialFen).toBe(START_FEN);
    expect(game.finalState).toBeUndefined();
  });

  it('handles CRLF line endings and a byte-order mark', () => {
    const game = parsePgn('\uFEFF[White "x"]\r\n[Black "y"]\r\n\r\n1. e4 e5 *\r\n');
    expect(game.headers.White).toBe('x');
    expect(game.moves).toHaveLength(2);
  });

  it('only parses the first game of a multi-game text', () => {
    const game = parsePgn('[Event "1"]\n\n1. e4 *\n\n[Event "2"]\n\n1. d4 d5 *');
    expect(game.headers.Event).toBe('1');
    expect(game.moves.map((m) => m.san)).toEqual(['e4']);
  });

  it('throws PgnError naming the illegal move', () => {
    expect(() => parsePgn('1. e4 e5 2. Ke3 *')).toThrow(new PgnError('Illegal move 2. Ke3'));
    expect(() => parsePgn('1. e4 Ke7 *')).toThrow('Illegal move 1... Ke7');
    expect(() => parsePgn('hello world')).toThrow(PgnError);
  });

  it('throws PgnError for empty or malformed input', () => {
    expect(() => parsePgn('')).toThrow(PgnError);
    expect(() => parsePgn('  \n\t ')).toThrow(PgnError);
    expect(() => parsePgn('[SetUp "1"]\n[FEN "not a fen"]\n\n1. e4 *')).toThrow(/Invalid FEN/);
    expect(() => parsePgn('1. e4 {unterminated e5 *')).toThrow(/closing "\}"/);
    expect(() => parsePgn('1. e4 (1. d4 e5 *')).toThrow(/closing "\)"/);
    expect(() => parsePgn('1. e4 ) e5 *')).toThrow(PgnError);
    expect(() => parsePgn('[Event "x\n\n1. e4 *')).toThrow(/Malformed header/);
    expect(() => parsePgn('1. e4 -- 2. d4 *')).toThrow(/Null moves/);
  });
});

describe('splitPgnGames', () => {
  it('splits games separated by blank lines before a new tag block (CRLF tolerant)', () => {
    const text = [CHESSCOM_PGN.trim(), LICHESS_PGN.trim()].join('\n\n').replace(/\n/g, '\r\n');
    const games = splitPgnGames(text);
    expect(games).toHaveLength(2);
    expect(parsePgn(games[0]!).headers.White).toBe('alice_test');
    expect(parsePgn(games[1]!).headers.White).toBe('carol_test');
    expect(parsePgn(games[1]!).moves).toHaveLength(4);
  });

  it('splits games even without a blank line between them', () => {
    const games = splitPgnGames('[Event "a"]\n1. e4 1-0\n[Event "b"]\n1. d4 0-1');
    expect(games).toEqual(['[Event "a"]\n1. e4 1-0', '[Event "b"]\n1. d4 0-1']);
  });

  it('splits headerless games on their result markers', () => {
    expect(splitPgnGames('1. e4 e5 1-0\n\n1. d4 d5 0-1\n1. c4 *')).toEqual([
      '1. e4 e5 1-0',
      '1. d4 d5 0-1',
      '1. c4 *',
    ]);
  });

  it('accepts the "½-½" draw marker some exporters write', () => {
    expect(parsePgn('1. e4 e5 ½-½').moves).toHaveLength(2);
    expect(splitPgnGames('1. e4 e5 ½-½ 1. d4 d5 1-0')).toEqual(['1. e4 e5 ½-½', '1. d4 d5 1-0']);
  });

  it('does not split inside comments that look like tags', () => {
    const text =
      '[Event "a"]\n\n1. e4 {note:\n[Event "not a tag"]\n} e5 *\n\n[Event "b"]\n\n1. d4 *';
    const games = splitPgnGames(text);
    expect(games).toHaveLength(2);
    expect(parsePgn(games[0]!).moves).toHaveLength(2);
  });

  it('keeps trailing comments with their game and drops comment-only chunks', () => {
    expect(splitPgnGames('1. e4 1-0 {White resigned? no}\n\n{just a note}')).toEqual([
      '1. e4 1-0 {White resigned? no}\n\n{just a note}',
    ]);
    expect(splitPgnGames('{only a note}')).toEqual([]);
  });

  it('returns a single game and nothing for empty input', () => {
    expect(splitPgnGames(CHESSCOM_PGN)).toEqual([CHESSCOM_PGN.trim()]);
    expect(splitPgnGames('')).toEqual([]);
    expect(splitPgnGames('\n\n  \n')).toEqual([]);
  });
});

describe('readPgnHeaders', () => {
  it('reads tags and unescapes quotes and backslashes', () => {
    const headers = readPgnHeaders(
      '[Event "The \\"Big\\" Match"]\n[Site "C:\\\\chess"]\n[Round "-"]\n\n1. e4 *',
    );
    expect(headers).toEqual({ Event: 'The "Big" Match', Site: 'C:\\chess', Round: '-' });
  });

  it('reads Chess.com headers without touching the moves', () => {
    const headers = readPgnHeaders(CHESSCOM_PGN);
    expect(headers.White).toBe('alice_test');
    expect(headers.TimeControl).toBe('180');
    expect(Object.keys(headers)).toHaveLength(13);
  });

  it('tolerates several tags per line and unescaped inner quotes', () => {
    expect(readPgnHeaders('[White "a"][Black "b"]\n[Event "Rated "Blitz" game"]\n1. e4')).toEqual({
      White: 'a',
      Black: 'b',
      Event: 'Rated "Blitz" game',
    });
  });

  it('stops at the movetext and returns {} when there are no tags', () => {
    expect(readPgnHeaders('1. e4 e5 [Event "late"] *')).toEqual({});
    expect(readPgnHeaders('')).toEqual({});
  });
});
