import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, RefreshCw, SearchX, UserX } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import {
  PLATFORM_LABELS,
  isPlatform,
  playerPath,
  validateUsername,
} from '@/features/home/username';
import { availableTimeClasses, type TimeClassFilter } from '@/features/games/gameList';
import { cacheKey, loadErrorMessage, type PlayerProfile } from '@/features/games/playerGames';
import { TIME_CLASS_ICONS } from '@/features/games/timeClassIcons';
import { usePlayerGames } from '@/features/games/usePlayerGames';
import { formatTimeClass } from '@/lib/format';
import type { Platform } from '@/state/settings';
import { AnalyseCard } from './AnalyseCard';
import { isJobActive, useInsightsJob } from './analysisJob';
import {
  AccuracySection,
  CostlyOpeningsSection,
  LabelsSection,
  MistakesSection,
  PhaseSection,
  TimeTroubleSection,
} from './EngineSections';
import { OpeningsSection } from './OpeningsSection';
import { EndingsSection, OverviewSection, TimeClassSection } from './ResultsSections';
import { EmptyNote, ErrorNote, Section } from './Section';
import { formatDay, plural } from './format';
import { byTimeClass, endingStats, insightGames, overview } from './stats';
import { useOpeningNames, usePlayerLibrary } from './useInsightsData';
import './insights.css';

type SampleSize = '100' | '300' | 'all';

const SAMPLE_OPTIONS: { value: SampleSize; label: string }[] = [
  { value: '100', label: 'Last 100' },
  { value: '300', label: 'Last 300' },
  { value: 'all', label: 'All loaded' },
];

interface InsightsView {
  sample: SampleSize;
  timeClass: TimeClassFilter;
}

/** The filters survive a trip to a review and back. */
const viewMemory = new Map<string, InsightsView>();

/** /insights/:platform/:username: results, openings and engine insights across many games. */
export default function InsightsPage() {
  const params = useParams();
  const username = (params.username ?? '').trim();
  if (!isPlatform(params.platform)) {
    return (
      <Notice icon={<SearchX className="h-6 w-6" />} title="Unknown game site">
        Kibitz can load games from Chess.com and Lichess.
      </Notice>
    );
  }
  const problem = validateUsername(params.platform, username);
  if (problem) {
    return (
      <Notice icon={<SearchX className="h-6 w-6" />} title="That username does not look right">
        {problem}
      </Notice>
    );
  }
  const key = cacheKey(params.platform, username);
  return <PlayerInsights key={key} platform={params.platform} username={username} />;
}

function PlayerInsights({ platform, username }: { platform: Platform; username: string }) {
  useDocumentTitle(`${username} · Insights · Kibitz`);
  const playerKey = cacheKey(platform, username);
  const games = usePlayerGames(platform, username);
  const { data, status, loadMore, loadingMore, error } = games;
  const [view, setViewState] = useState<InsightsView>(
    () => viewMemory.get(playerKey) ?? { sample: '100', timeClass: 'all' },
  );
  const setView = (next: InsightsView) => {
    viewMemory.set(playerKey, next);
    setViewState(next);
  };

  const name = data?.profile.username ?? username;
  const allGames = useMemo(() => (data ? insightGames(data.games, name) : []), [data, name]);
  const target = view.sample === 'all' ? null : Number(view.sample);
  const sample = useMemo(
    () => (target === null ? allGames : allGames.slice(0, target)),
    [allGames, target],
  );
  const timeClasses = useMemo(() => availableTimeClasses(sample), [sample]);
  const timeClass =
    view.timeClass !== 'all' && timeClasses.includes(view.timeClass) ? view.timeClass : 'all';
  const scoped = useMemo(
    () => (timeClass === 'all' ? sample : sample.filter((game) => game.timeClass === timeClass)),
    [sample, timeClass],
  );

  // "Last 100 / 300": keep loading older pages (one request at a time) until there are enough.
  const needMore = !!data && target !== null && allGames.length < target && data.hasMore;
  useEffect(() => {
    if (needMore && !loadingMore && !error) loadMore();
  }, [needMore, loadingMore, error, loadMore]);

  const names = useOpeningNames(sample);
  const { familyOf } = names;
  // Families seen in the sample, so reviewed games named elsewhere land in the same rows.
  const knownFamilies = useMemo(() => {
    const families = new Set<string>();
    if (familyOf) for (const game of sample) families.add(familyOf(game));
    return families;
  }, [familyOf, sample]);

  const stats = useMemo(
    () => ({
      overview: overview(scoped, name),
      timeClasses: byTimeClass(scoped, name),
      endings: endingStats(scoped, name),
    }),
    [scoped, name],
  );

  const job = useInsightsJob();
  const ourJob = job?.playerKey === playerKey ? job : null;
  const library = usePlayerLibrary(
    platform,
    name,
    ourJob ? `${ourJob.analysed}|${ourJob.status}` : 'idle',
  );
  const entries = useMemo(
    () =>
      library.entries?.filter(
        (item) => timeClass === 'all' || item.entry.record.timeClass === timeClass,
      ) ?? null,
    [library.entries, timeClass],
  );

  if (status === 'not-found') {
    return (
      <Notice
        icon={<UserX className="h-6 w-6" />}
        title={`No ${PLATFORM_LABELS[platform]} player called “${username}”`}
      >
        Check the spelling, or search again.
      </Notice>
    );
  }

  const first = scoped.at(-1)?.endTime;
  const last = scoped[0]?.endTime;
  const range = first && last ? ` · ${formatDay(first)} to ${formatDay(last)}` : '';
  const tcLabel = timeClass === 'all' ? '' : ` ${formatTimeClass(timeClass).toLowerCase()}`;
  const scope = `${plural(scoped.length, `${tcLabel.trim()} game`.trim())}${range}`;

  return (
    <div className="space-y-5">
      <Link
        to={playerPath(platform, name)}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-md text-sm text-muted hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {data ? `${name}’s games` : 'Games'}
      </Link>

      <p aria-live="polite" className="sr-only">
        {status === 'loading' || loadingMore ? (games.progressLabel ?? 'Loading games') : ''}
      </p>

      {status === 'error' && !data ? (
        <Card className="p-4">
          <ErrorNote
            message={loadErrorMessage(error?.kind ?? 'other', platform)}
            onRetry={games.retry}
          />
        </Card>
      ) : !data ? (
        <LoadingState label={games.progressLabel} />
      ) : (
        <>
          <Header profile={data.profile} onRefresh={games.refresh} />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <SegmentedControl
                label="How many games"
                value={view.sample}
                onChange={(sampleSize) => setView({ ...view, sample: sampleSize })}
                options={SAMPLE_OPTIONS}
              />
              {timeClasses.length > 1 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Time control">
                  <Chip
                    selected={timeClass === 'all'}
                    onClick={() => setView({ ...view, timeClass: 'all' })}
                  >
                    All
                  </Chip>
                  {timeClasses.map((tc) => {
                    const Icon = TIME_CLASS_ICONS[tc];
                    return (
                      <Chip
                        key={tc}
                        selected={timeClass === tc}
                        onClick={() => setView({ ...view, timeClass: tc })}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatTimeClass(tc)}
                      </Chip>
                    );
                  })}
                </div>
              )}
            </div>
            <LoadStatus
              count={allGames.length}
              target={target}
              loading={loadingMore || needMore}
              progressLabel={games.progressLabel}
              hasMore={data.hasMore}
              error={error ? loadErrorMessage(error.kind, platform) : null}
              onRetry={games.retry}
              onLoadMore={loadMore}
            />
          </div>

          {scoped.length === 0 ? (
            loadingMore || needMore ? null : (
              <EmptyNote>
                No finished standard games{data.games.length > 0 ? ' among the loaded games' : ''}{' '}
                yet. Insights cover standard chess; other variants are left out.
              </EmptyNote>
            )
          ) : (
            <>
              <OverviewSection overview={stats.overview} scope={scope} />
              <TimeClassSection
                groups={stats.timeClasses}
                games={scoped}
                username={name}
                showTable={timeClass === 'all' && stats.timeClasses.length > 1}
              />
              <EndingsSection endings={stats.endings} />
              <OpeningsSection
                games={scoped}
                username={name}
                platform={platform}
                familyOf={familyOf}
                progress={names.progress}
                bookFailed={names.bookFailed}
              />
            </>
          )}

          <Section
            title="Engine insights"
            description={
              entries && entries.length > 0
                ? `From ${plural(entries.length, `reviewed${tcLabel} game`)} in your library.`
                : 'Accuracy, mistakes and time trouble from games Stockfish has reviewed.'
            }
          >
            <AnalyseCard
              platform={platform}
              username={name}
              games={scoped}
              job={job}
              reviewedCount={library.entries?.length ?? 0}
            />
            {library.failed && !entries && (
              <div className="mt-4">
                <ErrorNote message="Your library could not be read." onRetry={library.reload} />
              </div>
            )}
            {entries && entries.length === 0 && !isJobActive(ourJob) && (
              <p className="mt-4 text-sm text-muted">
                No reviewed{tcLabel} games yet. Analyse a few above, or open any game from your
                list: every finished review is added to your library.
              </p>
            )}
          </Section>

          {entries && entries.length > 0 && (
            <>
              <AccuracySection entries={entries} username={name} />
              <div className="grid gap-5 lg:grid-cols-2">
                <LabelsSection entries={entries} />
                <PhaseSection entries={entries} />
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <TimeTroubleSection entries={entries} />
                <CostlyOpeningsSection entries={entries} knownFamilies={knownFamilies} />
              </div>
              <MistakesSection entries={entries} username={name} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Header({ profile, onRefresh }: { profile: PlayerProfile; onRefresh: () => void }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = profile.avatar && !avatarFailed;
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      {showAvatar ? (
        <img
          src={profile.avatar}
          alt=""
          width={56}
          height={56}
          referrerPolicy="no-referrer"
          onError={() => setAvatarFailed(true)}
          className="h-14 w-14 shrink-0 rounded-xl border border-line bg-surface-2 object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-xl font-bold text-muted uppercase"
        >
          {profile.username.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {profile.title && <Badge tone="accent">{profile.title}</Badge>}
          <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
            {profile.username}
          </h1>
        </div>
        <p className="mt-0.5 text-sm text-muted">
          Insights · {PLATFORM_LABELS[profile.platform]} · standard chess
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        aria-label="Reload games"
        title="Reload games"
      >
        <RefreshCw className="h-[18px] w-[18px]" aria-hidden="true" />
      </Button>
    </div>
  );
}

function LoadStatus({
  count,
  target,
  loading,
  progressLabel,
  hasMore,
  error,
  onRetry,
  onLoadMore,
}: {
  count: number;
  target: number | null;
  loading: boolean;
  progressLabel: string | null;
  hasMore: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  if (error) {
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-danger" role="alert">
        {error}
        <Button size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      </p>
    );
  }
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner className="h-4 w-4" label="Loading" />
        {progressLabel ?? 'Loading games'}…{' '}
        <span className="tabular">
          {target ? `${Math.min(count, target)} of ${target} games so far` : `${count} so far`}
        </span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      {target !== null && count < target
        ? `Only ${plural(count, 'finished standard game')} on record.`
        : `${plural(count, 'finished standard game')} loaded.`}
      {target === null && hasMore && (
        <Button size="sm" onClick={onLoadMore}>
          Load older games
        </Button>
      )}
    </p>
  );
}

function LoadingState({ label }: { label: string | null }) {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-10 w-72 max-w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-2xl" />
      <p className="flex items-center justify-center gap-2 text-sm text-muted">
        <Spinner label="Loading" />
        {label ? `${label}…` : 'Loading games…'}
      </p>
    </div>
  );
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="text-muted" aria-hidden="true">
        {icon}
      </span>
      <h1 className="text-lg font-semibold break-words">{title}</h1>
      <p className="text-sm text-muted">{children}</p>
      <Link to="/" className={buttonClass('secondary', 'md', 'mt-2')}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to search
      </Link>
    </Card>
  );
}
