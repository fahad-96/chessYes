import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameReview, LineStory, ParsedGame } from '@/core/types';
import { textToSpeech } from '@/voice/speakable';
import { isVoiceSupported, speak, stopSpeaking, useVoiceSettings } from '@/voice/voice';
import { TOUR_GAP_MS, TOUR_MIN_MS, moveLabelAt, narrationAt, tourPlies } from './coach';
import type { Variation } from './variation';

export interface TourState {
  /** Position in the list of key moments. */
  index: number;
  total: number;
  ply: number;
  /** "31. Rg8" */
  label: string;
  /** How long the moment's story takes to play on the board (0 without one). */
  storyMs: number;
}

export interface CoachOptions {
  game: ParsedGame;
  review: GameReview | null;
  /** The game position on the board. */
  ply: number;
  variation: Variation | null;
  /** A retry is in progress: the coach stays quiet and any tour stops. */
  busy: boolean;
  /**
   * Shows a key moment on the board: jumps to the move and plays its story when it has one.
   * Returns how long the story takes to play in ms (0 without one).
   */
  showMoment: (ply: number) => number;
}

export interface CoachControls {
  /** The browser can speak at all (otherwise every voice control is hidden). */
  supported: boolean;
  narrate: boolean;
  setNarrate: (on: boolean) => void;
  /** Key moments that can be narrated. */
  tourPlies: number[];
  tour: TourState | null;
  startTour: () => void;
  stopTour: () => void;
  nextMoment: () => void;
}

/**
 * The voice coach on the review screen:
 * - with narration on, stepping to a move reads its verdict and story aloud (interrupting
 *   the previous one), and "Show why" reads the story while its line plays;
 * - "Narrate key moments" walks through the review's key moments, showing each on the
 *   board and moving on when its narration ends.
 */
export function useCoach({
  game,
  review,
  ply,
  variation,
  busy,
  showMoment,
}: CoachOptions): CoachControls {
  const supported = useMemo(() => isVoiceSupported(), []);
  const narrateSetting = useVoiceSettings((s) => s.narrate);
  const setVoice = useVoiceSettings((s) => s.set);
  const narrate = supported && narrateSetting;
  const [tour, setTour] = useState<TourState | null>(null);
  const plies = useMemo(() => tourPlies(game, review), [game, review]);

  // Latest values for callbacks that run later (timers, speech promises).
  const latest = useRef({ game, review, plies, showMoment, ply, variation, tour });
  useEffect(() => {
    latest.current = { game, review, plies, showMoment, ply, variation, tour };
  });

  // Speech never outlives the review screen.
  useEffect(() => () => stopSpeaking(), []);

  const goToMoment = useCallback((index: number) => {
    const { plies: list, game: g, showMoment: show } = latest.current;
    const target = list[index];
    if (target === undefined) {
      setTour(null);
      return;
    }
    stopSpeaking();
    const storyMs = show(target);
    setTour({ index, total: list.length, ply: target, label: moveLabelAt(g, target), storyMs });
  }, []);

  const stopTour = useCallback(() => {
    if (latest.current.tour) stopSpeaking();
    setTour(null);
  }, []);
  const startTour = useCallback(() => goToMoment(0), [goToMoment]);
  const tourIndex = tour?.index ?? null;
  const nextMoment = useCallback(() => {
    if (tourIndex !== null) goToMoment(tourIndex + 1);
  }, [goToMoment, tourIndex]);

  // Tell each key moment, then move on once the narration (and its story) has finished.
  useEffect(() => {
    if (!tour) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const minimum = Math.max(TOUR_MIN_MS, tour.storyMs + TOUR_GAP_MS);
    const { game: g, review: r } = latest.current;
    void speak(narrationAt(g, r, tour.ply)).then(() => {
      if (cancelled) return;
      const wait = Math.max(TOUR_GAP_MS, minimum - (Date.now() - startedAt));
      timer = setTimeout(() => {
        if (tour.index + 1 >= tour.total) setTour(null);
        else goToMoment(tour.index + 1);
      }, wait);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tour, goToMoment]);

  // Moving away from the moment being told (or starting a retry) ends the tour. Only a
  // change of position counts: the tour's own jump may land a render after its state.
  const tourPlyRef = useRef(ply);
  useEffect(() => {
    const moved = ply !== tourPlyRef.current;
    tourPlyRef.current = ply;
    if (tour && (busy || (moved && ply !== tour.ply))) stopTour();
  }, [tour, busy, ply, stopTour]);

  // Narrate each move as the user steps through the game.
  const spokenPlyRef = useRef(ply);
  useEffect(() => {
    if (spokenPlyRef.current === ply) return;
    spokenPlyRef.current = ply;
    if (!narrate || tour || busy) return;
    if (ply === 0) stopSpeaking();
    else void speak(narrationAt(game, review, ply));
  }, [ply, narrate, tour, busy, game, review]);

  // "Show why" reads the story while its line plays; leaving the line stops it.
  const story: LineStory | undefined =
    variation?.kind === 'story' ? variation.story?.story : undefined;
  const storyRef = useRef<LineStory | undefined>(undefined);
  useEffect(() => {
    const previous = storyRef.current;
    storyRef.current = story;
    if (story === previous || !narrate || tour) return;
    if (story) void speak(textToSpeech(story.text));
    else stopSpeaking();
  }, [story, narrate, tour]);

  const setNarrate = useCallback(
    (on: boolean) => {
      setVoice({ narrate: on });
      if (!on) {
        stopSpeaking();
        return;
      }
      // Say something right away, so the user hears that it works (this is also the user
      // gesture browsers want before they allow speech).
      const { game: g, review: r, ply: p, variation: v } = latest.current;
      const shownStory = v?.kind === 'story' ? v.story?.story : undefined;
      if (shownStory) void speak(textToSpeech(shownStory.text));
      else if (p > 0) void speak(narrationAt(g, r, p));
      else void speak('I will read each move aloud as you step through the game.');
    },
    [setVoice],
  );

  return {
    supported,
    narrate,
    setNarrate,
    tourPlies: plies,
    tour,
    startTour,
    stopTour,
    nextMoment,
  };
}
