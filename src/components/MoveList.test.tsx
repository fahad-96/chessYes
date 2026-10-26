// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Classification, Color } from '@/core/types';
import { groupMovePairs, MoveList, type MoveListItem } from './MoveList';

afterEach(cleanup);

function item(ply: number, san: string, firstColor: Color = 'w', firstNumber = 1): MoveListItem {
  const offset = firstColor === 'w' ? 0 : 1;
  const index = ply - 1 + offset;
  return {
    ply,
    moveNumber: firstNumber + Math.floor(index / 2),
    color: index % 2 === 0 ? 'w' : 'b',
    san,
  };
}

describe('groupMovePairs', () => {
  it('pairs White and Black moves under one number', () => {
    const rows = groupMovePairs([item(1, 'e4'), item(2, 'e5'), item(3, 'Nf3')]);
    expect(rows.map((r) => [r.moveNumber, r.white?.san, r.black?.san])).toEqual([
      [1, 'e4', 'e5'],
      [2, 'Nf3', undefined],
    ]);
  });

  it('starts with an empty White cell when Black moves first', () => {
    const rows = groupMovePairs([item(1, 'Nc6', 'b', 12), item(2, 'Bb5', 'b', 12)]);
    expect(rows.map((r) => [r.moveNumber, r.white?.san, r.black?.san])).toEqual([
      [12, undefined, 'Nc6'],
      [13, 'Bb5', undefined],
    ]);
  });
});

describe('MoveList', () => {
  const moves = [item(1, 'e4'), item(2, 'e5'), item(3, 'Qh5'), item(4, 'Nc6')];
  const classifications: Classification[] = ['book', 'book', 'inaccuracy'];

  it('labels moves with their classification and marks the current one', () => {
    const { container } = render(
      <MoveList
        moves={moves}
        classifications={classifications}
        currentPly={3}
        onSelect={() => undefined}
        pendingFromPly={4}
      />,
    );
    expect(screen.getByRole('button', { name: 'Qh5, Inaccuracy' })).toHaveProperty(
      'ariaCurrent',
      'step',
    );
    expect(screen.getByRole('button', { name: 'Nc6, not analysed yet' })).toBeTruthy();
    // One badge per analysed move; the pending move has none.
    expect(container.querySelectorAll('svg')).toHaveLength(3);
  });

  it('jumps to a move when clicked', () => {
    const onSelect = vi.fn();
    render(
      <MoveList
        moves={moves}
        classifications={classifications}
        currentPly={0}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'e5, Book' }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});
