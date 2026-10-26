import { useId } from 'react';
import { Search, X } from 'lucide-react';
import type { TimeClass } from '@/core/types';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { formatTimeClass } from '@/lib/format';
import type { GameFilters, ResultFilter } from './gameList';
import { TIME_CLASS_ICONS } from './timeClassIcons';

const RESULT_OPTIONS: { value: ResultFilter; label: string }[] = [
  { value: 'all', label: 'Any result' },
  { value: 'win', label: 'Wins' },
  { value: 'loss', label: 'Losses' },
  { value: 'draw', label: 'Draws' },
];

interface GameFiltersBarProps {
  filters: GameFilters;
  onChange: (filters: GameFilters) => void;
  timeClasses: TimeClass[];
}

/** Time-class and result chips plus an opponent search box. */
export function GameFiltersBar({ filters, onChange, timeClasses }: GameFiltersBarProps) {
  const searchId = useId();
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Time control">
          <Chip
            selected={filters.timeClass === 'all'}
            onClick={() => onChange({ ...filters, timeClass: 'all' })}
          >
            All games
          </Chip>
          {timeClasses.map((tc) => {
            const Icon = TIME_CLASS_ICONS[tc];
            return (
              <Chip
                key={tc}
                selected={filters.timeClass === tc}
                onClick={() => onChange({ ...filters, timeClass: tc })}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {formatTimeClass(tc)}
              </Chip>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Result">
          {RESULT_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              selected={filters.result === option.value}
              onClick={() => onChange({ ...filters, result: option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search opponents
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <Input
          id={searchId}
          type="search"
          value={filters.opponent}
          onChange={(event) => onChange({ ...filters, opponent: event.target.value })}
          placeholder="Search opponents"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          inputSize="md"
          className="pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {filters.opponent && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, opponent: '' })}
            aria-label="Clear opponent search"
            className="absolute top-1/2 right-2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
