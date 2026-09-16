import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { measuredLayout, readingAnchor, readingPosition, survivingAnchor } from '../src/model/measured-layout.js';

describe('reading layout invariants', () => {
  it('preserves the CURRENT row offset across arbitrary prefix and size changes', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 1, max: 2400 }), { minLength: 4, maxLength: 120 }),
      fc.array(fc.integer({ min: 1, max: 1800 }), { maxLength: 60 }),
      fc.nat(), fc.integer({ min: 0, max: 999 }),
      (sizes, prefix, choice, fraction) => {
        const rows = sizes.map((size, id) => ({ id: `r-${id}`, size }));
        const table = new Map(rows.map((r) => [r.id, { size: r.size }]));
        const old = measuredLayout(rows, table);
        const index = choice % rows.length;
        // This includes user motion made AFTER the fetch started.
        const position = old.offsets[index] + sizes[index] * fraction / 1000;
        const anchor = readingAnchor(old, position);
        const preceding = prefix.map((size, id) => ({ id: `p-${id}`, size }));
        for (const row of preceding) table.set(row.id, { size: row.size });
        for (let i = 0; i < index; i++) table.set(rows[i].id, { size: sizes[i] * 1.375 });
        const next = measuredLayout([...preceding, ...rows], table);
        const restored = readingPosition(next, anchor);
        const nextIndex = next.indexes.get(anchor.rowID);
        expect(next.leading + next.offsets[nextIndex] - restored).toBeCloseTo(anchor.offset, 7);
        expect(readingAnchor(next, restored).rowID).toBe(anchor.rowID);
      },
    ), { numRuns: 600, seed: 16092026 });
  });

  it('does not move browsing when only content below the anchor grows', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const sizes = new Map([['a', { size: 53 }], ['b', { size: 480 }], ['c', { size: 900 }]]);
    const before = measuredLayout(rows, sizes);
    const anchor = readingAnchor(before, 135);
    sizes.set('c', { size: 4000 });
    const after = measuredLayout([...rows, { id: 'live' }], sizes);
    expect(readingPosition(after, anchor)).toBe(135);
  });

  it('uses a surviving neighbour when the anchor is removed, never an implicit tail jump', () => {
    const previous = measuredLayout(['a', 'b', 'c', 'd'].map((id) => ({ id })), new Map());
    const next = measuredLayout(['a', 'c', 'd'].map((id) => ({ id })), new Map());
    expect(survivingAnchor(previous, next, { rowID: 'b', offset: -17 }))
      .toEqual({ rowID: 'c', offset: -17 });
  });
});
