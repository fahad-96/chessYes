// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { isEditableTarget, isSpaceTarget, shortcutForKey, useReviewKeyboard } from './keyboard';

afterEach(cleanup);

describe('shortcutForKey', () => {
  it('maps navigation keys', () => {
    expect(shortcutForKey('ArrowLeft')).toBe('prev');
    expect(shortcutForKey('ArrowRight')).toBe('next');
    expect(shortcutForKey('Home')).toBe('first');
    expect(shortcutForKey('End')).toBe('last');
    expect(shortcutForKey('f')).toBe('flip');
    expect(shortcutForKey('F')).toBe('flip');
    expect(shortcutForKey('Escape')).toBe('exit');
    expect(shortcutForKey(' ')).toBe('play');
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

describe('isSpaceTarget', () => {
  it('detects controls that Space activates', () => {
    const button = document.createElement('button');
    const icon = document.createElement('span');
    button.append(icon);
    expect(isSpaceTarget(button)).toBe(true);
    expect(isSpaceTarget(icon)).toBe(true);
    expect(isSpaceTarget(document.body)).toBe(false);
    expect(isSpaceTarget(null)).toBe(false);
  });
});

describe('useReviewKeyboard', () => {
  function setup() {
    const handlers = {
      prev: vi.fn(),
      next: vi.fn(),
      first: vi.fn(),
      last: vi.fn(),
      flip: vi.fn(),
      exit: vi.fn(() => false),
      play: vi.fn(),
    };
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

  it('leaves the default alone when the handler declines the key', () => {
    const handlers = setup();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(handlers.exit).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it('plays with Space, except on a focused button', () => {
    const handlers = setup();
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.body.dispatchEvent(space);
    expect(handlers.play).toHaveBeenCalledOnce();
    expect(space.defaultPrevented).toBe(true);
    const button = document.createElement('button');
    document.body.append(button);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(handlers.play).toHaveBeenCalledOnce();
    button.remove();
  });

  it('ignores keys inside dialogs and menus', () => {
    const handlers = setup();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.append(item);
    document.body.append(menu);
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(handlers.exit).not.toHaveBeenCalled();
    expect(handlers.next).not.toHaveBeenCalled();
    menu.remove();
  });
});
