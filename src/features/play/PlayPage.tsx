import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ArrowRight, Flag, Plus, RotateCcw, ScanSearch, Undo2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Board, type BoardOrientation } from '@/components/Board';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/SegmentedControl';
import { Spinner } from '@/components/ui/Spinner';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import type { Color } from '@/core/types';
import { reviewPath } from '@/features/games/gameList';
import { PlayerStrip } from '@/features/review/PlayerStrip';
import { cn } from '@/lib/cn';
import { recordFromPgn, savePgnGame } from '@/sources/pgnImport';
import {
  PLAYER_NAME,
  describeOutcome,
  opposite,
  outcomeForPlayer,
  sideToMoveAfter,
  toPgn,
  type PlayGame,
  type PlayPosition,
} from './game';
import { ENGINE_LEVELS, engineLevel, engineName } from './levels';
import { usePlayGame, type ColorChoice, type PlayControls, type PlaySetup } from './usePlayGame';

const toOrientation = (color: Color): BoardOrientation => (color === 'w' ? 'white' : 'black');

/** Play a game against Stockfish at one of eight strengths, then review it. */
export default function PlayPage() {
  useDocumentTitle('Play Stockfish · Chess Yes');
  const play = usePlayGame();
  if (!play.game || !play.position) {
    return <SetupScreen setup={play.setup} onStart={(setup) => play.start(setup)} />;
  }
  return <GameScreen play={play} game={play.game} position={play.position} />;
}

const COLOR_OPTIONS: readonly SegmentedOption<ColorChoice>[] = [
  { value: 'w', label: 'White', icon: <span aria-hidden="true">♔</span> },
  { value: 'random', label: 'Random' },
  { value: 'b', label: 'Black', icon: <span aria-hidden="true">♚</span> },
];

function SetupScreen({
  setup,
  onStart,
}: {
  setup: PlaySetup;
  onStart: (setup: PlaySetup) => void;
}) {
  const [color, setColor] = useState<ColorChoice>(setup.color);
  const [levelId, setLevelId] = useState(setup.level);
  const level = engineLevel(levelId);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Play Stockfish</h1>
        <p className="mt-1.5 text-muted">
          Pick a side and a strength. When the game is over, review it move by move.
        </p>
      </header>
      <Card className="flex flex-col gap-5 p-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">Play as</h2>
          <SegmentedControl
            label="Play as"
            value={color}
            onChange={setColor}
            options={COLOR_OPTIONS}
            fullWidth
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-muted">Strength</legend>
          <div className="grid grid-cols-4 gap-2">
            {ENGINE_LEVELS.map((option) => (
              <label
                key={option.id}
                className={cn(
                  'flex h-14 cursor-pointer flex-col items-center justify-center rounded-lg border border-line bg-surface-2 text-center transition-colors hover:bg-surface-3',
                  'has-[:checked]:border-accent has-[:checked]:bg-accent/15 has-[:checked]:text-text',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent',
                )}
              >
                <input
                  type="radio"
                  name="play-level"
                  value={option.id}
                  checked={option.id === levelId}
                  onChange={() => setLevelId(option.id)}
                  className="sr-only"
                />
                <span className="tabular text-lg leading-none font-bold">{option.id}</span>
                <span className="mt-1 hidden text-[11px] leading-tight text-muted sm:block">
                  {option.name}
                </span>
                <span className="sr-only sm:hidden">{option.name}</span>
              </label>
            ))}
          </div>
          <p className="min-h-10 text-sm leading-relaxed" aria-live="polite">
            <span className="font-bold">
              Level {level.id}, {level.name}.
            </span>{' '}
            <span className="text-muted">{level.blurb}</span>
          </p>
        </fieldset>
        <Button
          variant="primary"
          size="xl"
          className="w-full"
          onClick={() => onStart({ color, level: levelId })}
        >
          Play
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </Button>
      </Card>
      <p className="text-sm text-muted">
        Stockfish runs on your device. The game is saved in this browser, so you can leave and come
        back to it.
      </p>
    </div>
  );
}

function GameScreen({
  play,
  game,
  position,
}: {
  play: PlayControls;
  game: PlayGame;
  position: PlayPosition;
}) {
  const navigate = useNavigate();
  const [flipped, setFlipped] = useState(false);
  // The resign confirmation belongs to the position it was opened in: a move closes it.
  const plies = game.moves.length;
  const [resignAt, setResignAt] = useState<number | null>(null);
  const confirmResign = resignAt === plies;
  const [reviewError, setReviewError] = useState<string | null>(null);
  const playerColor = game.player;
  const bottom = flipped ? opposite(playerColor) : playerColor;
  const top = opposite(bottom);
  const toMove = sideToMoveAfter(game.moves);
  const over = game.outcome !== null;
  const nameOf = (color: Color) => (color === playerColor ? PLAYER_NAME : engineName(game.level));

  const { move } = play;
  const interactive = useMemo(
    () => (over ? null : { color: toOrientation(playerColor), onMove: move }),
    [over, playerColor, move],
  );

  const review = async () => {
    setReviewError(null);
    try {
      const record = recordFromPgn(toPgn(game));
      await savePgnGame(record);
      navigate(reviewPath(record.id, { as: PLAYER_NAME }), { state: { record } });
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      <h1 className="sr-only">Play Stockfish</h1>
      <section
        aria-label="Game board"
        className="flex flex-col gap-2 md:mx-auto md:w-full md:max-w-[max(20rem,calc(100dvh-26rem))] lg:sticky lg:top-20 lg:max-w-[calc(100dvh-14rem)] lg:min-w-[22rem]"
      >
        <PlayerStrip player={{ name: nameOf(top) }} color={top} toMove={!over && toMove === top} />
        <Board
          fen={position.fen}
          orientation={toOrientation(bottom)}
          lastMove={position.lastMove}
          check={position.check}
          interactive={interactive}
        />
        <PlayerStrip
          player={{ name: nameOf(bottom) }}
          color={bottom}
          toMove={!over && toMove === bottom}
        />
      </section>

      <div className="flex min-w-0 flex-col gap-3 lg:gap-4">
        <Card className="flex flex-col gap-4 p-4">
          <GameStatus play={play} game={game} position={position} />

          {over ? (
            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => void review()}
                disabled={game.moves.length === 0}
              >
                <ScanSearch className="h-5 w-5" aria-hidden="true" />
                Review this game
              </Button>
              {reviewError && (
                <p role="alert" className="text-sm text-danger">
                  {reviewError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => play.start({ color: play.setup.color, level: game.level })}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Rematch
                </Button>
                <Button variant="secondary" onClick={play.leave}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New game
                </Button>
              </div>
            </div>
          ) : confirmResign ? (
            <div
              role="group"
              aria-label="Confirm resignation"
              className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3"
            >
              <p className="text-sm font-medium">Resign this game?</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="danger"
                  onClick={() => {
                    setResignAt(null);
                    play.resign();
                  }}
                >
                  <Flag className="h-4 w-4" aria-hidden="true" />
                  Resign
                </Button>
                <Button variant="secondary" autoFocus onClick={() => setResignAt(null)}>
                  Keep playing
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" onClick={play.takeBack} disabled={!play.canTakeBack}>
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                Take back
              </Button>
              <Button variant="secondary" onClick={() => setFlipped((value) => !value)}>
                <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
                Flip
              </Button>
              <Button variant="secondary" onClick={() => setResignAt(plies)}>
                <Flag className="h-4 w-4" aria-hidden="true" />
                Resign
              </Button>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-medium text-muted">Moves</h2>
          <MoveTable san={position.san} />
        </Card>

        {!over && (
          <p className="text-sm text-muted">
            Level {game.level}, {engineLevel(game.level).name}. Your game is saved in this browser.
          </p>
        )}
      </div>
    </div>
  );
}

function GameStatus({
  play,
  game,
  position,
}: {
  play: PlayControls;
  game: PlayGame;
  position: PlayPosition;
}) {
  const verdict = outcomeForPlayer(game);
  if (verdict) {
    const headline = verdict === 'win' ? 'You won!' : verdict === 'loss' ? 'You lost' : 'Draw';
    return (
      <div role="status" className="flex flex-col gap-1">
        <p
          className={cn(
            'text-2xl font-bold tracking-tight',
            verdict === 'win' && 'text-accent',
            verdict === 'loss' && 'text-danger',
          )}
        >
          {headline}
        </p>
        <p className="text-sm text-muted">{describeOutcome(game)}.</p>
      </div>
    );
  }

  if (play.engine.status === 'error') {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p className="font-bold text-danger">Stockfish could not move.</p>
        <p className="text-sm text-muted">{play.engine.message}</p>
        <Button variant="secondary" size="sm" className="self-start" onClick={play.retryEngine}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  const thinking = play.engine.status === 'thinking';
  return (
    <div role="status" aria-live="polite" className="flex min-h-12 items-center gap-3">
      {thinking ? (
        <>
          <Spinner className="text-muted" label="Stockfish is thinking" />
          <p className="text-lg font-bold">Stockfish is thinking…</p>
        </>
      ) : (
        <p className="text-lg font-bold">
          Your move{position.check && <span className="text-danger">, you are in check</span>}
        </p>
      )}
    </div>
  );
}

/** The moves so far, two per row, scrolled to the newest. */
function MoveTable({ san }: { san: readonly string[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [san.length]);

  if (san.length === 0) {
    return <p className="text-sm text-muted">No moves yet.</p>;
  }
  const last = san.length - 1;
  const cell = (index: number) => (
    <span className={cn(index === last && 'font-bold')}>{san[index] ?? ''}</span>
  );
  const rows: number[] = [];
  for (let i = 0; i < san.length; i += 2) rows.push(i);
  return (
    <ol
      ref={listRef}
      aria-label="Moves played"
      className="grid max-h-56 grid-cols-[2.5rem_1fr_1fr] gap-x-2 gap-y-0.5 overflow-y-auto font-mono text-sm lg:max-h-[calc(100dvh-30rem)] lg:min-h-24"
    >
      {rows.map((index) => (
        <li key={index} className="contents">
          <span className="tabular text-muted">{index / 2 + 1}.</span>
          {cell(index)}
          {cell(index + 1)}
        </li>
      ))}
    </ol>
  );
}
