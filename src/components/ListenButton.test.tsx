// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListenButton, speechFor } from './ListenButton';

const voice = vi.hoisted(() => ({
  supported: true,
  narrate: false,
  speaking: false,
  speak: vi.fn(async (_text: string) => undefined),
  stopSpeaking: vi.fn(),
}));

vi.mock('@/voice/voice', () => ({
  isVoiceSupported: () => voice.supported,
  speak: (text: string) => voice.speak(text),
  stopSpeaking: () => voice.stopSpeaking(),
  useVoiceSettings: { getState: () => ({ narrate: voice.narrate }) },
  useVoiceStatus: <T,>(select: (state: { speaking: boolean }) => T) =>
    select({ speaking: voice.speaking }),
}));

beforeEach(() => {
  Object.assign(voice, { supported: true, narrate: false, speaking: false });
  voice.speak.mockClear();
  voice.stopSpeaking.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('speechFor', () => {
  it('spells out moves and drops move numbers', () => {
    const spoken = speechFor('30. Ne7+ Kf8 31. Nxc8 wins material.');
    expect(spoken).not.toMatch(/\d+\./);
    expect(spoken).toMatch(/^Knight e7/);
    expect(spoken).toContain('wins material.');
    expect(speechFor('12... Qd7')).not.toContain('12');
  });

  it('leaves other numbers alone', () => {
    expect(speechFor('about 2.5 pawns')).toBe('about 2.5 pawns');
  });
});

describe('ListenButton', () => {
  it('reads the text aloud, and stops when it goes away', () => {
    const { unmount } = render(<ListenButton text="Nf6+ forks the king and queen." />);
    expect(voice.speak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    expect(voice.speak).toHaveBeenCalledWith(speechFor('Nf6+ forks the king and queen.'));
    unmount();
    expect(voice.stopSpeaking).toHaveBeenCalledOnce();
  });

  it('stops while speaking', () => {
    voice.speaking = true;
    render(<ListenButton text="Qxf7# is checkmate." />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(voice.stopSpeaking).toHaveBeenCalledOnce();
    expect(voice.speak).not.toHaveBeenCalled();
  });

  it('speaks on its own only when the read-aloud setting is on', () => {
    render(<ListenButton text="Qxf7# is checkmate." autoPlay />);
    expect(voice.speak).not.toHaveBeenCalled();
    cleanup();
    voice.narrate = true;
    render(<ListenButton text="Qxf7# is checkmate." autoPlay />);
    expect(voice.speak).toHaveBeenCalledOnce();
  });

  it('renders nothing without speech support, and never stops others’ speech', () => {
    voice.supported = false;
    const { container, unmount } = render(<ListenButton text="Qxf7#" />);
    expect(container.innerHTML).toBe('');
    unmount();
    expect(voice.stopSpeaking).not.toHaveBeenCalled();
  });
});
