// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { isEditableTarget, shortcutForKey, useReviewKeyboard } from './keyboard';

afterEach(cleanup);

describe('shortcutForKey', () => {
  it('maps navigation keys', () => {
    expect(shortcutForKey('ArrowLeft')).toBe('prev');
    expect(shortcutForKey('ArrowRight')).toBe('next');
    expect(shortcutForKey('Home')).toBe('first');
    expect(shortcutForKey('End')).toBe('last');
    expect(shortcutForKey('f')).toBe('flip');
    expect(shortcutForKey('F')).toBe('flip');
    expect(shortcutForKey('ArrowUp')).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('detects text entry', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('select'))).toBe(true);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});

describe('useReviewKeyboard', () => {
  function setup() {
    const handlers = { prev: vi.fn(), next: vi.fn(), first: vi.fn(), last: vi.fn(), flip: vi.fn() };
    renderHook(() => useReviewKeyboard(handlers));
    return handlers;
  }

  it('runs the shortcut and prevents the default scroll', () => {
    const handlers = setup();
    const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(handlers.last).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores typing, modifiers and keys already handled', () => {
    const handlers = setup();
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }),
    );
    const handled = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(handlers.flip).not.toHaveBeenCalled();
    expect(handlers.next).not.toHaveBeenCalled();
    expect(handlers.prev).not.toHaveBeenCalled();
    input.remove();
  });
});
