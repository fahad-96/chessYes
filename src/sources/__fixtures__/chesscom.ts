import type { ChessComGame } from '../chesscom';

/** A game object from a real Chess.com monthly archive (Oct 2026), moves shortened. */
export const CHESSCOM_PGN = [
  '[Event "Live Chess"]',
  '[Site "Chess.com"]',
  '[Date "2026.10.02"]',
  '[Round "-"]',
  '[White "Hikaru"]',
  '[Black "mightysmasher"]',
  '[Result "1-0"]',
  '[CurrentPosition "3k4/3P4/8/8/7P/8/5P2/3R2KB b - - 0 55"]',
  '[Timezone "UTC"]',
  '[ECO "E62"]',
  '[ECOUrl "https://www.chess.com/openings/Kings-Indian-Defense-Fianchetto-Karlsbad-Panno-Uhlmann-Szabo-System-8.d5-Nb8"]',
  '[UTCDate "2026.10.02"]',
  '[UTCTime "22:05:06"]',
  '[WhiteElo "3451"]',
  '[BlackElo "2864"]',
  '[TimeControl "180"]',
  '[Termination "Hikaru won by resignation"]',
  '[StartTime "22:05:06"]',
  '[EndDate "2026.10.02"]',
  '[EndTime "22:09:59"]',
  '[Link "https://www.chess.com/game/live/184727190848"]',
  '',
  '1. d4 {[%clk 0:02:59.9]} 1... Nf6 {[%clk 0:02:59.2]} 2. c4 {[%clk 0:02:58.1]} 2... g6 {[%clk 0:02:58.5]} 1-0',
].join('\n');

export const CHESSCOM_GAME: ChessComGame = {
  url: 'https://www.chess.com/game/live/184727190848',
  pgn: CHESSCOM_PGN,
  time_control: '180',
  end_time: 1790978999,
  rated: true,
  accuracies: { white: 89.87, black: 79.93 },
  uuid: '53429d14-bead-11f1-8bef-2a4af901000f',
  initial_setup: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  fen: '3k4/3P4/8/8/7P/8/5P2/3R2KB b - - 0 55',
  time_class: 'blitz',
  rules: 'chess',
  white: { rating: 3451, result: 'win', username: 'Hikaru' },
  black: { rating: 2864, result: 'resigned', username: 'mightysmasher' },
  eco: 'https://www.chess.com/openings/Kings-Indian-Defense-Fianchetto-Karlsbad-Panno-Uhlmann-Szabo-System-8.d5-Nb8',
};

/** A copy of the fixture game with some fields replaced. */
export function chessComGame(overrides: Partial<ChessComGame> = {}): ChessComGame {
  return { ...CHESSCOM_GAME, ...overrides };
}
