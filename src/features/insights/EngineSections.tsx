import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ClassificationIcon } from '@/components/ClassificationIcon';
import { CLASSIFICATION_META } from '@/components/classificationMeta';
import { StatTile } from '@/components/ui/StatTile';
import { moveNumberLabel } from '@/core/notation';
import { reviewPath } from '@/features/games/gameList';
import { formatAccuracy, formatTimeClass } from '@/lib/format';
import { LineChart } from './LineChart';
import { Section } from './Section';
import { WdlBar } from './WdlBar';
import { formatDay, formatPercent, plural } from './format';
import {
  ENDGAME_MATERIAL,
  OPENING_MOVES,
  PHASES,
  TIME_TROUBLE_SHARE,
  accuracyTrend,
  biggestMistakes,
  labelRates,
  mean,
  openingCosts,
  phaseAccuracy,
  timeTrouble,
  type AccuracyPoint,
  type CostlyMove,
  type Phase,
  type PlayerEntry,
} from './stats';

const MOVING_AVERAGE = 5;

const opponentOf = ({ entry, color }: { entry: PlayerEntry['entry']; color: 'w' | 'b' }) =>
  color === 'w' ? entry.record.black : entry.record.white;

// ---------------------------------------------------------------------------
// Accuracy
// ---------------------------------------------------------------------------

export function AccuracySection({
  entries,
  username,
}: {
  entries: readonly PlayerEntry[];
  username: string;
}) {
  const navigate = useNavigate();
  const trend = useMemo(() => accuracyTrend(entries, MOVING_AVERAGE), [entries]);
  const yours = mean(trend.map((p) => p.accuracy));
  const theirs = mean(
    trend.flatMap((p) => (p.opponentAccuracy === null ? [] : [p.opponentAccuracy])),
  );
  const open = (point: AccuracyPoint) =>
    navigate(reviewPath(point.gameId, { as: username }), { state: { record: point.entry.record } });

  return (
    <Section
      title="Accuracy"
      description={`Game accuracy in ${plural(entries.length, 'reviewed game')}, oldest to newest.`}
    >
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <StatTile
          label="Your average"
          value={yours === null ? '—' : formatAccuracy(yours)}
          detail="Mean game accuracy"
        />
        <StatTile
          label="Your opponents"
          value={theirs === null ? '—' : formatAccuracy(theirs)}
          detail="In the same games"
        />
      </div>
      {trend.length >= 2 ? (
        <figure className="mt-5">
          <LineChart
            label={`Accuracy per game with a ${MOVING_AVERAGE}-game average. Use the arrow keys to read each game, Enter to open its review.`}
            xs={trend.map((_, i) => i)}
            values={trend.map((p) => p.average)}
            context={trend.map((p) => p.accuracy)}
            yBounds={[0, 100]}
            height={200}
            formatY={(value) => String(Math.round(value))}
            integerTicks
            xLabels={[
              formatDay(trend[0]!.entry.record.endTime),
              formatDay(trend.at(-1)!.entry.record.endTime),
            ]}
            describe={(index) => {
              const point = trend[index]!;
              const opponent = opponentOf(point);
              return {
                value: `${formatAccuracy(point.accuracy)} accuracy`,
                details: [
                  `${MOVING_AVERAGE}-game average ${formatAccuracy(point.average)}`,
                  `vs ${opponent.name} · ${formatDay(point.entry.record.endTime)}`,
                ],
              };
            }}
            onActivate={(index) => open(trend[index]!)}
          />
          <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="kb-viz inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: 'var(--viz-context)' }}
              />
              Each game
            </span>
            <span className="kb-viz inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-0.5 w-4 rounded-full"
                style={{ background: 'var(--viz-series)' }}
              />
              Average of the last {MOVING_AVERAGE} games
            </span>
          </figcaption>
        </figure>
      ) : null}
      <GamesTable trend={trend} username={username} />
    </Section>
  );
}

/** The chart's data as a list of games: the accessible twin, and a way into each review. */
function GamesTable({ trend, username }: { trend: AccuracyPoint[]; username: string }) {
  const [open, setOpen] = useState(false);
  const newestFirst = useMemo(() => [...trend].reverse(), [trend]);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex min-h-10 items-center gap-1 rounded-md pr-2 text-sm text-muted hover:text-text"
      >
        {open ? (
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        )}
        {open ? 'Hide the games' : 'Show the games'}
      </button>
      {open && (
        <div className="-mx-4 mt-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full text-sm">
            <caption className="sr-only">Accuracy per reviewed game, newest first</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="pb-2 font-medium">
                  Game
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  You
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Opponent
                </th>
              </tr>
            </thead>
            <tbody>
              {newestFirst.map((point) => {
                const opponent = opponentOf(point);
                return (
                  <tr key={point.gameId} className="border-t border-line/60">
                    <th scope="row" className="py-2 pr-2 text-left font-normal">
                      <Link
                        to={reviewPath(point.gameId, { as: username })}
                        state={{ record: point.entry.record }}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        vs {opponent.name}
                      </Link>
                      <span className="block text-xs text-muted">
                        {formatDay(point.entry.record.endTime)} ·{' '}
                        {formatTimeClass(point.entry.record.timeClass)}
                      </span>
                    </th>
                    <td className="tabular py-2 text-right font-semibold">
                      {formatAccuracy(point.accuracy)}
                    </td>
                    <td className="tabular py-2 text-right text-muted">
                      {point.opponentAccuracy === null
                        ? '—'
                        : formatAccuracy(point.opponentAccuracy)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Move labels
// ---------------------------------------------------------------------------

export function LabelsSection({ entries }: { entries: readonly PlayerEntry[] }) {
  const rates = useMemo(() => labelRates(entries), [entries]);
  const max = Math.max(0.0001, ...rates.flatMap((r) => [r.youPerGame, r.opponentsPerGame]));
  return (
    <Section title="Move quality" description="How often each label came up per game.">
      <div className="kb-viz mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <LegendSwatch color="var(--viz-series)">You</LegendSwatch>
        <LegendSwatch color="var(--viz-context)">Your opponents</LegendSwatch>
      </div>
      <table className="kb-viz w-full text-sm">
        <caption className="sr-only">Labels per game for you and your opponents</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Label</th>
            <th scope="col">You, per game</th>
            <th scope="col">Opponents, per game</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((rate) => {
            const meta = CLASSIFICATION_META[rate.label];
            return (
              <tr key={rate.label} className="border-t border-line/60 first:border-t-0">
                <th
                  scope="row"
                  className="w-32 py-2 pr-3 text-left align-middle font-normal sm:w-40"
                >
                  <span className="inline-flex items-center gap-2">
                    <ClassificationIcon classification={rate.label} size={18} decorative />
                    {meta.label}
                  </span>
                </th>
                <td className="py-2 align-middle" colSpan={2}>
                  <PairedBar
                    you={rate.youPerGame}
                    them={rate.opponentsPerGame}
                    max={max}
                    youLabel={rate.youPerGame.toFixed(2)}
                    themLabel={rate.opponentsPerGame.toFixed(2)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

function LegendSwatch({ color, children }: { color: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {children}
    </span>
  );
}

function PairedBar({
  you,
  them,
  max,
  youLabel,
  themLabel,
}: {
  you: number;
  them: number;
  max: number;
  youLabel: string;
  themLabel: string;
}) {
  const row = (value: number, label: string, color: string, name: string) => (
    <div className="flex items-center gap-2">
      <div className="h-2 min-w-0 flex-1">
        <div
          className="h-full rounded-r-[4px]"
          style={{
            width: `${(value / max) * 100}%`,
            background: color,
            minWidth: value > 0 ? 3 : 0,
          }}
        />
      </div>
      <span className="tabular w-10 shrink-0 text-right text-xs">
        <span className="sr-only">{name}: </span>
        {label}
      </span>
    </div>
  );
  return (
    <div className="space-y-[2px]">
      {row(you, youLabel, 'var(--viz-series)', 'You')}
      {row(them, themLabel, 'var(--viz-context)', 'Opponents')}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<Phase, string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

export function PhaseSection({ entries }: { entries: readonly PlayerEntry[] }) {
  const phases = useMemo(() => phaseAccuracy(entries), [entries]);
  return (
    <Section
      title="Accuracy by phase"
      description="The average accuracy of your moves in each phase."
    >
      <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
        {PHASES.map((phase) => {
          const { you, opponents } = phases[phase];
          return (
            <StatTile
              key={phase}
              label={PHASE_LABELS[phase]}
              value={you.accuracy === null ? '—' : formatAccuracy(you.accuracy)}
              detail={
                you.moves === 0 ? (
                  'No moves in this phase yet'
                ) : (
                  <>
                    <span className="block">{plural(you.moves, 'move')}</span>
                    <span className="block">
                      Opponents{' '}
                      {opponents.accuracy === null ? '—' : formatAccuracy(opponents.accuracy)}
                    </span>
                  </>
                )
              }
            >
              <Meter value={you.accuracy} />
            </StatTile>
          );
        })}
      </div>
      <details className="mt-3 text-sm text-muted">
        <summary className="inline-flex min-h-10 cursor-pointer items-center">
          How the phases are defined
        </summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            <span className="text-text">Opening:</span> book moves, and each side’s first{' '}
            {OPENING_MOVES} moves.
          </li>
          <li>
            <span className="text-text">Endgame:</span> after that, once the knights, bishops, rooks
            and queens left on the board add up to {ENDGAME_MATERIAL} points or less (knight and
            bishop 3, rook 5, queen 9; both sides together), for example a rook and a minor piece
            against a rook.
          </li>
          <li>
            <span className="text-text">Middlegame:</span> everything in between.
          </li>
        </ul>
        <p className="mt-2">
          Phase accuracy is the plain average of each move’s accuracy, from the win % before and
          after the move.
        </p>
      </details>
    </Section>
  );
}

/** A thin 0-100 track under a tile value. */
function Meter({ value }: { value: number | null }) {
  return (
    <div className="kb-viz mt-1 h-1.5 rounded-full bg-surface-3" aria-hidden="true">
      {value !== null && (
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(2, value)}%`, background: 'var(--viz-series)' }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time trouble
// ---------------------------------------------------------------------------

export function TimeTroubleSection({ entries }: { entries: readonly PlayerEntry[] }) {
  const stats = useMemo(() => timeTrouble(entries), [entries]);
  const share = Math.round(TIME_TROUBLE_SHARE * 100);
  return (
    <Section
      title="Time trouble"
      description={`Moves you played with less than ${share}% of your starting time left.`}
    >
      {stats.games === 0 ? (
        <p className="text-sm text-muted">
          None of these reviewed games has clock times (daily games and some imports do not).
        </p>
      ) : (
        <>
          {/* Two by two where the section shares its row (lg), one row where it is wide. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-2">
            <StatTile
              label="Games"
              value={`${stats.gamesInTrouble} of ${stats.games}`}
              detail="Got into time trouble"
            />
            <StatTile
              label="Moves"
              value={formatPercent((stats.troubleMoves / Math.max(1, stats.moves)) * 100)}
              detail={`${stats.troubleMoves} of ${plural(stats.moves, 'move')} in time trouble`}
            />
            <StatTile
              label="Errors in time trouble"
              value={stats.troubleRate === null ? '—' : stats.troubleRate.toFixed(1)}
              detail="Per 100 moves"
            />
            <StatTile
              label="Errors with time to spare"
              value={stats.calmRate === null ? '—' : stats.calmRate.toFixed(1)}
              detail="Per 100 moves"
            />
          </div>
          <p className="mt-3 text-xs text-muted">
            Errors are mistakes, blunders and misses. The clock is the time you had left after each
            move, from the game’s clock times.
          </p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Openings that cost the most
// ---------------------------------------------------------------------------

const COSTLY_ROWS = 5;

export function CostlyOpeningsSection({
  entries,
  knownFamilies,
}: {
  entries: readonly PlayerEntry[];
  knownFamilies: ReadonlySet<string>;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => openingCosts(entries, knownFamilies), [entries, knownFamilies]);
  const visible = showAll ? rows : rows.slice(0, COSTLY_ROWS);
  return (
    <Section
      title="Your costliest openings"
      description="Your accuracy and score per opening family, lowest accuracy first."
    >
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Accuracy and score per opening</caption>
          {/* On phones the games count moves under the name, leaving the name room to wrap
              between words rather than inside them. */}
          <colgroup>
            <col />
            <col className="hidden w-16 sm:table-column" />
            <col className="w-[4.5rem] sm:w-20" />
            <col className="w-14 sm:w-16" />
          </colgroup>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="pb-2 text-left font-medium">
                Opening
              </th>
              <th scope="col" className="hidden pb-2 text-right font-medium sm:table-cell">
                Games
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Accuracy
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.family} className="border-t border-line/60">
                <th scope="row" className="py-2 pr-2 text-left font-medium">
                  {/* Names wrap on phones: a cut-off name could be any of several openings. */}
                  <span className="block break-words">{row.family}</span>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <WdlBar results={row.results} className="w-16 shrink-0 sm:w-24" />
                    <span className="tabular text-xs font-normal text-muted sm:hidden">
                      {row.games} {row.games === 1 ? 'game' : 'games'}
                    </span>
                  </div>
                </th>
                <td className="tabular hidden py-2 text-right sm:table-cell">{row.games}</td>
                <td className="tabular py-2 text-right font-semibold">
                  {formatAccuracy(row.accuracy)}
                </td>
                <td className="tabular py-2 text-right">{formatPercent(row.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > COSTLY_ROWS && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          aria-expanded={showAll}
          className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-md pr-2 text-sm text-muted hover:text-text"
        >
          {showAll ? (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
          {showAll ? `Show ${COSTLY_ROWS}` : `Show all ${rows.length}`}
        </button>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Biggest mistakes
// ---------------------------------------------------------------------------

export function MistakesSection({
  entries,
  username,
}: {
  entries: readonly PlayerEntry[];
  username: string;
}) {
  const mistakes = useMemo(() => biggestMistakes(entries, 10), [entries]);
  return (
    <Section
      title="Biggest mistakes"
      description="Your ten moves that cost the most winning chances. Open one to see it on the board."
    >
      {mistakes.length === 0 ? (
        <p className="text-sm text-muted">No inaccuracies, mistakes or blunders. Impressive.</p>
      ) : (
        <ol className="space-y-2">
          {mistakes.map((item) => (
            <MistakeRow
              key={`${item.entry.gameId}:${item.move.ply}`}
              item={item}
              username={username}
            />
          ))}
        </ol>
      )}
    </Section>
  );
}

function MistakeRow({ item, username }: { item: CostlyMove; username: string }) {
  const { entry, move } = item;
  const opponent = opponentOf(item);
  const fullMove = Number(move.fenBefore.split(' ')[5]) || Math.ceil(move.ply / 2);
  const meta = CLASSIFICATION_META[move.classification];
  return (
    <li>
      <Link
        to={reviewPath(entry.gameId, { as: username, ply: move.ply })}
        state={{ record: entry.record }}
        className="group flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 transition-colors hover:bg-surface-2"
      >
        <ClassificationIcon classification={move.classification} size={22} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">
              {moveNumberLabel(fullMove, move.color)}
              {move.san}
            </span>
            <span className="text-xs text-muted">{meta.label}</span>
            {move.best && (
              <span className="hidden text-xs text-muted sm:inline">
                · best was <span className="font-medium text-text">{move.best.san}</span>
              </span>
            )}
          </p>
          {move.best && (
            // Phones: on its own line, so no line starts with a stray separator. Only one of the
            // two is ever displayed, so screen readers hear it once.
            <p className="text-xs text-muted sm:hidden">
              Best was <span className="font-medium text-text">{move.best.san}</span>
            </p>
          )}
          <p className="truncate text-xs text-muted">
            vs {opponent.name} · {formatDay(entry.record.endTime)}
          </p>
        </div>
        <span
          className="tabular shrink-0 text-right text-sm font-semibold"
          title="Your winning chances before and after the move"
        >
          −{Math.round(move.winLoss)}
          <span className="block text-[11px] font-normal text-muted">
            <span className="sr-only">win chance from </span>
            {Math.round(move.winBefore)}% → {Math.round(move.winAfter)}%
          </span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}
