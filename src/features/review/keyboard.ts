import { useEffect, useRef } from 'react';

export type ReviewShortcut = 'prev' | 'next' | 'first' | 'last' | 'flip' | 'exit' | 'play';

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
    case 'Escape':
      return 'exit';
    case ' ':
      return 'play';
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

/** True for controls that Space activates by itself (buttons, links, switches, sliders). */
export function isSpaceTarget(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null;
  return (
    typeof element?.closest === 'function' &&
    !!element.closest('button,a[href],summary,[role="button"],[role="switch"],[role="slider"]')
  );
}

/** True inside a dialog or menu, which handle their own keys (Escape closes them). */
function inPopup(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null;
  return (
    typeof element?.closest === 'function' && !!element.closest('[role="dialog"],[role="menu"]')
  );
}

/**
 * Global review shortcuts: ← → step through moves, Home / End jump, F flips the board,
 * Space plays or pauses a line, Escape leaves a variation or a retry. Ignored while typing, inside dialogs and menus,
 * with modifier keys held, or when a focused widget (such as the eval graph slider)
 * already handled the key. A handler that returns false leaves the key's default alone.
 */
export function useReviewKeyboard(
  handlers: Record<Exclude<ReviewShortcut, 'play'>, () => void | boolean> & {
    play?: () => void | boolean;
  },
) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isEditableTarget(event.target) || inPopup(event.target)) return;
      const shortcut = shortcutForKey(event.key);
      if (!shortcut) return;
      if (shortcut === 'play' && isSpaceTarget(event.target)) return;
      const handler = handlersRef.current[shortcut];
      if (handler && handler() !== false) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
