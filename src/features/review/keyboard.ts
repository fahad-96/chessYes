import { useEffect, useRef } from 'react';

export type ReviewShortcut = 'prev' | 'next' | 'first' | 'last' | 'flip';

/** Maps a KeyboardEvent.key to a review shortcut. */
export function shortcutForKey(key: string): ReviewShortcut | null {
  switch (key) {
    case 'ArrowLeft':
      return 'prev';
    case 'ArrowRight':
      return 'next';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'f':
    case 'F':
      return 'flip';
    default:
      return null;
  }
}

/** True when keys typed at this target belong to a text field, select or editable region. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  return (
    tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable === true
  );
}

/**
 * Global review shortcuts: ← → step through moves, Home / End jump, F flips the board.
 * Ignored while typing, with modifier keys held, or when a focused widget (such as the
 * eval graph slider) already handled the key.
 */
export function useReviewKeyboard(handlers: Record<ReviewShortcut, () => void>) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isEditableTarget(event.target)) return;
      const shortcut = shortcutForKey(event.key);
      if (!shortcut) return;
      event.preventDefault();
      handlersRef.current[shortcut]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
