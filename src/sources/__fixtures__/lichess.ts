/** One line of a real /api/games/user ndjson stream (Oct 2026), moves shortened. */
export const LICHESS_PGN = [
  '[Event "Titled Arena"]',
  '[Site "https://lichess.org/game/HqjDTU4A"]',
  '[Date "2026.10.14"]',
  '[White "DrNykterstein"]',
  '[Black "Night-King96"]',
  '[Result "1-0"]',
  '[UTCDate "2026.10.14"]',
  '[UTCTime "18:04:06"]',
  '[WhiteElo "3177"]',
  '[BlackElo "2848"]',
  '[WhiteTitle "GM"]',
  '[BlackTitle "GM"]',
  '[Variant "Standard"]',
  '[TimeControl "180+0"]',
  '[ECO "A50"]',
  '[Opening "Queen\'s Indian Accelerated"]',
  '[Termination "Normal"]',
  '',
  '1. d4 { [%clk 0:03:00] } 1... Nf6 { [%clk 0:03:00] } 2. c4 { [%clk 0:02:59] } 2... b6 { [%clk 0:02:59] } 1-0',
].join('\n');

export const LICHESS_GAME = {
  id: 'HqjDTU4A',
  rated: true,
  variant: 'standard',
  speed: 'blitz',
  perf: 'blitz',
  createdAt: 1792001046539,
  lastMoveAt: 1792001402854,
  status: 'resign',
  source: 'arena',
  players: {
    white: {
      user: { name: 'DrNykterstein', title: 'GM', id: 'drnykterstein' },
      rating: 3177,
      ratingDiff: 17,
    },
    black: {
      user: { name: 'Night-King96', title: 'GM', id: 'night-king96' },
      rating: 2848,
      ratingDiff: -2,
    },
  },
  winner: 'white',
  opening: { eco: 'A50', name: "Queen's Indian Accelerated", ply: 4 },
  moves: 'd4 Nf6 c4 b6',
  clocks: [18003, 18003, 17903, 17903],
  pgn: LICHESS_PGN,
  clock: { initial: 180, increment: 0, totalTime: 180 },
};

/** A copy of the fixture game with some fields replaced. */
export function lichessGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...LICHESS_GAME, ...overrides };
}
