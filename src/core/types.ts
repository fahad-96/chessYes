/**
 * Shared domain types. Everything in `src/core` is plain TypeScript with no
 * React or browser APIs, so it can be unit-tested and reused (CLI, worker, ...).
 */
import type { Color, PieceSymbol, Square } from 'chess.js';

export type { Color, PieceSymbol, Square };

// ---------------------------------------------------------------------------
// Engine output
// ---------------------------------------------------------------------------

/**
 * An engine evaluation, ALWAYS from White's point of view.
 * - `cp`: centipawns, positive = White is better.
 * - `mate`: signed number of moves to mate, positive = White mates.
 *   Never 0: positions that are already over use `PositionAnalysis.terminal`.
 */
export type Score = { type: 'cp'; value: number } | { type: 'mate'; value: number };

export interface EngineLine {
  /** Principal variation in UCI notation (e.g. "e2e4", "e7e8q"); pv[0] is the candidate move. */
  pv: string[];
  /** Evaluation after this line, White's point of view. */
  score: Score;
  /** Depth this line was searched to. */
  depth: number;
}

/** Why a position has no legal continuation (or is a dead draw). */
export type TerminalState = 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty-move';

export interface PositionAnalysis {
  /** FEN of the analysed position. */
  fen: string;
  /** Deepest completed depth (can be below the requested depth when the time cap hit). */
  depth: number;
  /** MultiPV lines, best first for the side to move. Empty when `terminal` is set. */
  lines: EngineLine[];
  /** Set for positions where the game is over; no engine search is run for them. */
  terminal?: TerminalState;
  nodes?: number;
  timeMs?: number;
  /**
   * Set on an analysis from the verification pass (engine/refine.ts): the full pass's
   * analysis it replaced. A move is judged by verified analyses only when both of its
   * positions were verified (see core/review.ts), never by one of each.
   */
  unverified?: PositionAnalysis;
}

export interface AnalysisSettings {
  /** Target search depth per position. */
  depth: number;
  /** Number of lines to search. 2 is needed to detect "Great" (only-move) moves. */
  multiPv: number;
  /** Hard cap per position in milliseconds so slow devices never stall. */
  maxTimeMs: number;
}

export interface AnalysisProgress {
  /** Positions finished (including ones restored from cache). */
  done: number;
  total: number;
  /** Rough time remaining in ms, once there is enough data to estimate it. */
  etaMs?: number;
  /** Depth reached on the position currently being searched. */
  currentDepth?: number;
  /** Engine speed in nodes per second, if reported. */
  nps?: number;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export type GameSource = 'chesscom' | 'lichess' | 'pgn';
export type TimeClass =
  'ultrabullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily' | 'unknown';
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface PlayerInfo {
  name: string;
  rating?: number;
  title?: string;
}

/** A game as listed from a data source. Contains the full PGN. */
export interface GameRecord {
  /**
   * Route-safe unique id that can be resolved back to the game:
   * - `chesscom/<username>/<yyyy>/<mm>/<gameId>`
   * - `lichess/<gameId>`
   * - `pgn/<hash>`
   */
  id: string;
  source: GameSource;
  /** Link to the game on its original site. */
  url?: string;
  white: PlayerInfo;
  black: PlayerInfo;
  result: GameResult;
  /** Human-readable ending, e.g. "Hikaru won by resignation". */
  termination?: string;
  timeClass: TimeClass;
  /** e.g. "180+2" or "1/86400". */
  timeControl?: string;
  rated?: boolean;
  /** Unix epoch milliseconds when the game ended (or started when the end is unknown). */
  endTime?: number;
  /** Unix epoch milliseconds when the game started, when the source reports it. */
  startTime?: number;
  eco?: string;
  openingName?: string;
  /** Only `standard` games can be reviewed; other variants are listed but disabled. */
  variant: string;
  pgn: string;
}

export interface ParsedMove {
  /** 1-based index of this half-move in the game (1 = first move played). */
  ply: number;
  /** Full-move number as printed in notation ("12" in 12...Nf6). */
  moveNumber: number;
  color: Color;
  san: string;
  /** UCI notation, e.g. "e2e4", "e1g1" (castling as king move), "e7e8q". */
  uci: string;
  from: Square;
  to: Square;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  fenBefore: string;
  fenAfter: string;
  isCheck: boolean;
  isCheckmate: boolean;
  /** Mover's remaining clock after the move in seconds, from a `[%clk h:mm:ss]` comment. */
  clock?: number;
}

export interface ParsedGame {
  headers: Record<string, string>;
  /** Starting FEN (standard start position unless the PGN has a FEN/SetUp header). */
  initialFen: string;
  moves: ParsedMove[];
  /** Set when the final position is game-over on the board (mate, stalemate, ...). */
  finalState?: TerminalState;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/** Display order of the classifications (best to worst). */
export const CLASSIFICATIONS = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'forced',
  'inaccuracy',
  'mistake',
  'blunder',
  'missedWin',
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

export interface SuggestedLine {
  /** First move of the line in UCI. */
  uci: string;
  /** First move of the line in SAN. */
  san: string;
  /** Evaluation at the end of the line (White POV). */
  score: Score;
  pvUci: string[];
  /** Same line in SAN, starting with `san`. */
  pvSan: string[];
}

export interface SacrificeInfo {
  /** Material (pawn units) the mover stands to lose immediately, >= 2. */
  material: number;
  /** Square of the piece that is offered. */
  square: Square;
  /** The piece that is offered. */
  piece: PieceSymbol;
}

export interface MoveReview {
  ply: number;
  color: Color;
  san: string;
  uci: string;
  classification: Classification;
  /** Mover's win % (0-100) before the move, assuming best play. */
  winBefore: number;
  /** Mover's win % after the move that was played. */
  winAfter: number;
  /** max(0, winBefore - winAfter). */
  winLoss: number;
  /** Lichess-style accuracy of this single move, 0-100. */
  accuracy: number;
  /** Evaluation after the move (White POV); null when the game is over after it. */
  evalAfter: Score | null;
  /** White's win % after the move (drives the eval graph and bar). */
  whiteWinAfter: number;
  /** Engine's top move in the position before the move. */
  best?: SuggestedLine;
  /** Engine's second choice in the position before the move (MultiPV 2). */
  secondBest?: SuggestedLine;
  /** Engine's continuation after the played move (starts with the opponent's reply). */
  playedLine?: SuggestedLine;
  sacrifice?: SacrificeInfo;
  /** Plain-English explanation of the move. */
  explanation: string;
  /**
   * Why the move deserves its label, as a short line the UI can play on the board:
   * the refutation after a bad move, or the idea behind a good one (see LineStory.kind).
   */
  why?: LineStory;
  /** For moves that were not the best: what the engine's best move would have achieved. */
  bestIdea?: LineStory;
  /** Opening name when the position after the move is in the opening book. */
  opening?: { eco: string; name: string };
}

/** A tactical pattern spotted along an engine line. */
export type MotifType =
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered-attack'
  | 'discovered-check'
  | 'double-check'
  | 'hanging-piece'
  | 'trapped-piece'
  | 'promotion'
  | 'back-rank-mate'
  | 'checkmate';

export interface Motif {
  type: MotifType;
  /** Index in LineStory.movesUci of the move that creates the motif (0 = first move). */
  step: number;
  /** Colour of the side that executes the motif. */
  by: Color;
  /** Square of the piece that executes it, after the move (the forking knight, the pinning bishop...). */
  square: Square;
  /** Squares of the pieces it hits (forked, pinned + the piece behind, skewered...), most valuable first. */
  targets: Square[];
  /** Short phrase for sentences, e.g. "forks the king and queen", "pins the knight to the queen". */
  phrase: string;
}

/** A line of moves with the story it tells, for "show me why" on the board and in speech. */
export interface LineStory {
  /**
   * - 'refutation': what the opponent does after a bad move (the line after the move played);
   * - 'idea': what a good move (brilliant, great, best) achieves (the move itself, then the
   *   engine line after it, from the position before the move);
   * - 'missed': what the engine's best move would have achieved (the line from the position before).
   */
  kind: 'refutation' | 'idea' | 'missed';
  /** FEN the line starts from. */
  fen: string;
  /** The moves worth showing (usually 2-6 plies), UCI and SAN. */
  movesUci: string[];
  movesSan: string[];
  motifs: Motif[];
  /**
   * Material won (+) or lost (-) by the player whose move is being reviewed by the end of
   * the shown line, in pawn units, relative to the position the line starts from (for a
   * refutation built with describeLine's `startFen`, the position before the reviewed move).
   */
  materialSwing: number;
  /** Forced mate length when the line ends in checkmate (moves of the winning side). */
  mateIn?: number;
  /**
   * Set when the line's first move gives material away that is not won straight back: the
   * piece the reply takes and its square ("You sacrifice the rook on h7").
   */
  sacrifice?: { piece: PieceSymbol; square: Square };
  /**
   * One or two plain sentences telling the story, written for the player whose move is
   * reviewed, e.g. "You sacrifice the rook on h7: after Kxh7, Nf6+ forks the king and queen
   * and wins the queen." (core/perspective.ts rewrites it for that player's opponent.)
   */
  text: string;
}

export interface PlayerReview {
  /** Game accuracy 0-100 (Lichess formula). */
  accuracy: number;
  counts: Record<Classification, number>;
}

export interface GameReview {
  /** Bump REVIEW_FORMAT_VERSION in core/review.ts when this shape changes (invalidates caches). */
  version: number;
  engine: { name: string; depth: number; multiPv: number };
  moves: MoveReview[];
  white: PlayerReview;
  black: PlayerReview;
  /** White's win % per position; index 0 is the start, length = moves.length + 1. */
  whiteWinPercents: number[];
  /** Deepest named opening reached while the game was still in book. */
  opening?: { eco: string; name: string; lastBookPly: number };
  /** Plies (1-based) of the most instructive moments, sorted ascending. */
  keyMoments: number[];
}
