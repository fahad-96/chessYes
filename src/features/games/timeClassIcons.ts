import type { ComponentType } from 'react';
import { CalendarDays, Clock, Flame, Hourglass, Rocket, Timer, Zap } from 'lucide-react';
import type { TimeClass } from '@/core/types';

/** Icon for each time class, shared by the game rows and the filter chips. */
export const TIME_CLASS_ICONS: Record<TimeClass, ComponentType<{ className?: string }>> = {
  ultrabullet: Rocket,
  bullet: Zap,
  blitz: Flame,
  rapid: Timer,
  classical: Hourglass,
  daily: CalendarDays,
  unknown: Clock,
};
