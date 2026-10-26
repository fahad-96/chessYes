import { memo, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawBrushes, DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import type { Classification, Square } from '@/core/types';
import { sideToMove } from '@/core/notation';
import { cn } from '@/lib/cn';
import { classificationBadgeSvg } from './ClassificationIcon';
import './Board.css';

export type BoardOrientation = 'white' | 'black';

export interface BoardArrow {
  from: Square;
  to: Square;
  /** best = engine's suggestion, threat = opponent's strongest reply, played = the move made. */
  kind: 'best' | 'threat' | 'played';
}

export interface BoardBadge {
  square: Square;
  classification: Classification;
}

export interface BoardInteraction {
  /** Which side may move pieces. Defaults to the side to move in `fen`. */
  color?: 'white' | 'black';
  /**
   * Called with a legal move in UCI (e.g. "e2e4", "e7e8q") after the user moves a piece.
   * Return false to reject it: the board then snaps back to `fen`. To accept, update `fen`.
   */
  onMove: (uci: string) => boolean | void;
}

export interface BoardProps {
  fen: string;
  orientation: BoardOrientation;
  lastMove?: [Square, Square];
  /** Highlights the king of the side to move. */
  check?: boolean;
  arrows?: readonly BoardArrow[];
  badge?: BoardBadge | null;
  coordinates?: boolean;
  /** Lets the user move pieces (legal moves only). Omit for a view-only board. */
  interactive?: BoardInteraction | null;
  className?: string;
}

type PromotionPiece = 'q' | 'r' | 'b' | 'n';
const PROMOTION_PIECES: { piece: PromotionPiece; name: string }[] = [
  { piece: 'q', name: 'queen' },
  { piece: 'r', name: 'rook' },
  { piece: 'b', name: 'bishop' },
  { piece: 'n', name: 'knight' },
];

/**
 * A chessground piece image. The piece-set CSS targets `.cg-wrap piece.<role>.<color>`,
 * and React warns about unknown tags, so the <piece> element is created by hand.
 */
function PieceImage({ className }: { className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const piece = document.createElement('piece');
    piece.className = className;
    host.replaceChildren(piece);
  }, [className]);
  return <span ref={ref} aria-hidden="true" />;
}

/** Legal destinations per origin square, in chessground's format. */
function legalDests(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  let moves;
  try {
    moves = new Chess(fen).moves({ verbose: true });
  } catch {
    return dests; // invalid FEN: nothing is movable
  }
  for (const move of moves) {
    const list = dests.get(move.from) ?? [];
    if (!list.includes(move.to)) list.push(move.to);
    dests.set(move.from, list);
  }
  return dests;
}

/** True when moving from `from` to `to` is a pawn promotion in `fen`. */
function isPromotion(fen: string, from: string, to: string): boolean {
  try {
    return new Chess(fen)
      .moves({ verbose: true })
      .some((move) => move.from === from && move.to === to && move.promotion !== undefined);
  } catch {
    return false;
  }
}

/**
 * Arrow colours. Chessground writes these into SVG attributes, where CSS variables
 * do not resolve, so they are literal colours chosen to read on every board theme.
 * The four default brushes are required by the type and kept for completeness.
 */
const BRUSHES: DrawBrushes = {
  green: { key: 'g', color: '#15781b', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
  best: { key: 'kbBest', color: '#22a35a', opacity: 0.95, lineWidth: 12 },
  threat: { key: 'kbThreat', color: '#d93f45', opacity: 0.85, lineWidth: 9 },
  played: { key: 'kbPlayed', color: '#4a7fd9', opacity: 0.8, lineWidth: 9 },
};

function buildShapes(arrows: readonly BoardArrow[], badge: BoardBadge | null | undefined) {
  const shapes: DrawShape[] = arrows
    .filter((arrow) => arrow.from !== arrow.to)
    .map((arrow) => ({ orig: arrow.from, dest: arrow.to, brush: arrow.kind }));
  if (badge) {
    shapes.push({
      orig: badge.square,
      customSvg: { html: classificationBadgeSvg(badge.classification) },
    });
  }
  return shapes;
}

const NO_ARROWS: readonly BoardArrow[] = [];

/**
 * View-only chess board (chessground). The board is created once and updated in
 * place, so moving through a game animates pieces instead of re-rendering.
 *
 * Resizing needs no extra code: chessground observes its wrapper element itself.
 * (Calling api.redrawAll() from another ResizeObserver would leak an observer per
 * call, because every redraw registers a new one.)
 */
export const Board = memo(function Board({
  fen,
  orientation,
  lastMove,
  check = false,
  arrows = NO_ARROWS,
  badge,
  coordinates = true,
  interactive = null,
  className,
}: BoardProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const positionedRef = useRef(false);
  const [promotion, setPromotion] = useState<{
    from: Key;
    to: Key;
    color: 'white' | 'black';
  } | null>(null);
  // Latest values for chessground callbacks, which are registered once.
  const fenRef = useRef(fen);
  fenRef.current = fen;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  /** The last config applied from props, to snap back to after a rejected move. */
  const configRef = useRef<Config | null>(null);
  // Parents usually pass a fresh `interactive` object on every render; only these two
  // facts should re-configure the board (otherwise an open promotion picker would close).
  const interactiveMode = interactive ? (interactive.color ?? 'turn') : null;
  const isInteractive = interactiveMode !== null;

  /** Sends a move to the parent; snaps back to the current position if it is rejected. */
  const submitMove = useRef((uci: string) => {
    const accepted = interactiveRef.current?.onMove(uci);
    if (accepted === false) resetPosition();
  }).current;

  function resetPosition() {
    if (configRef.current) apiRef.current?.set(configRef.current);
  }

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    // Chessground binds its input handlers only when created without viewOnly, so the
    // board is re-created when interactivity is switched on or off (cheap, and keeps
    // view-only boards free of touch handlers that would block scrolling and swipes).
    const api = Chessground(element, {
      viewOnly: !isInteractive,
      coordinates,
      disableContextMenu: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: false, visible: true, brushes: BRUSHES },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (orig, dest) => {
            if (isPromotion(fenRef.current, orig, dest)) {
              const color = sideToMove(fenRef.current) === 'w' ? 'white' : 'black';
              setPromotion({ from: orig, to: dest, color });
              return;
            }
            submitMove(`${orig}${dest}`);
          },
        },
      },
    });
    apiRef.current = api;
    positionedRef.current = false;
    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, [coordinates, submitMove, isInteractive]);

  const lastFrom = lastMove?.[0];
  const lastTo = lastMove?.[1];

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const turnColor = sideToMove(fen) === 'w' ? 'white' : 'black';
    const config: Config = {
      fen,
      orientation,
      turnColor,
      check: check ? turnColor : false,
      lastMove: lastFrom && lastTo ? [lastFrom, lastTo] : undefined,
      viewOnly: interactiveMode === null,
      movable:
        interactiveMode === null
          ? { color: undefined, dests: new Map() }
          : {
              color: interactiveMode === 'turn' ? turnColor : interactiveMode,
              dests: legalDests(fen),
            },
    };
    configRef.current = config;
    if (!positionedRef.current) {
      // Show the first position immediately instead of animating from the start position.
      positionedRef.current = true;
      api.set({ animation: { enabled: false } });
      api.set(config);
      api.set({ animation: { enabled: true, duration: 180 } });
    } else {
      api.set(config);
    }
  }, [fen, orientation, check, lastFrom, lastTo, coordinates, interactiveMode]);

  // A new position (or leaving interactive mode) cancels an open promotion choice.
  useEffect(() => setPromotion(null), [fen, interactiveMode]);

  const choosePromotion = (piece: PromotionPiece | null) => {
    const pending = promotion;
    setPromotion(null);
    if (!pending) return;
    if (piece) submitMove(`${pending.from}${pending.to}${piece}`);
    else resetPosition();
  };

  useEffect(() => {
    apiRef.current?.setAutoShapes(buildShapes(arrows, badge));
  }, [arrows, badge, coordinates, isInteractive]);

  return (
    <div className={cn('kb-board', className)}>
      <div ref={elementRef} />
      {promotion && (
        <div
          className="kb-promotion"
          role="dialog"
          aria-label="Choose a promotion piece"
          onKeyDown={(event) => event.key === 'Escape' && choosePromotion(null)}
        >
          <div className="kb-promotion-row cg-wrap">
            {PROMOTION_PIECES.map(({ piece, name }) => (
              <button
                key={piece}
                type="button"
                className="kb-promotion-choice"
                aria-label={`Promote to ${name}`}
                onClick={() => choosePromotion(piece)}
                // The queen is by far the most common choice.
                autoFocus={piece === 'q'}
              >
                <PieceImage className={`${name} ${promotion.color}`} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="kb-promotion-cancel"
            onClick={() => choosePromotion(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
});
