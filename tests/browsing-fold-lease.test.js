import { describe, expect, it } from 'vitest';
import { emptyBrowsingFoldLease, reconcileBrowsingFoldLease } from '../src/model/browsing-fold-lease.js';

const rows = (...values) => values.map(([id, latest = false, visualSlotID = id]) => ({ id, visualSlotID, role: { latest } }));

describe('browsing automatic fold lease', () => {
  it('keeps the row that was latest when browsing started after an append', () => {
    const entered = reconcileBrowsingFoldLease(emptyBrowsingFoldLease(), {
      activationID: 'a:1', mode: 'browsing', rows: rows(['old', true]), bookmarkID: 'old',
    });
    expect(entered.visualSlotIDs).toEqual(['old']);

    const appended = reconcileBrowsingFoldLease(entered, {
      activationID: 'a:1', mode: 'browsing', rows: rows(['old'], ['new', true]), bookmarkID: 'old',
    });
    expect(appended.visualSlotIDs).toEqual(['old']);
  });

  it('is bounded by current rows and may adopt a newly witnessed latest row', () => {
    const old = reconcileBrowsingFoldLease(emptyBrowsingFoldLease(), {
      activationID: 'a:1', mode: 'browsing', rows: rows(['old', true]),
    });
    const visited = reconcileBrowsingFoldLease(old, {
      activationID: 'a:1', mode: 'browsing', rows: rows(['old'], ['new', true]), bookmarkID: 'new',
    });
    expect(visited.visualSlotIDs).toEqual(['old', 'new']);
    const trimmed = reconcileBrowsingFoldLease(visited, {
      activationID: 'a:1', mode: 'browsing', rows: rows(['new', true]), bookmarkID: 'new',
    });
    expect(trimmed.visualSlotIDs).toEqual(['new']);
  });

  it('revokes the lease on following or activation replacement', () => {
    const first = reconcileBrowsingFoldLease(emptyBrowsingFoldLease(), {
      activationID: 'a:1', mode: 'browsing', rows: rows(['old', true]),
    });
    expect(reconcileBrowsingFoldLease(first, {
      activationID: 'a:1', mode: 'following', rows: rows(['old', true]),
    })).toBe(emptyBrowsingFoldLease());
    const replacement = reconcileBrowsingFoldLease(first, {
      activationID: 'a:2', mode: 'browsing', rows: rows(['new', true]),
    });
    expect(replacement).toMatchObject({ activationID: 'a:2', visualSlotIDs: ['new'] });
  });

  it('keeps the lease across a reciprocal semantic replacement in the same visual slot', () => {
    const old = reconcileBrowsingFoldLease(emptyBrowsingFoldLease(), {
      activationID: 'a:1', mode: 'browsing', rows: rows(['old', true, 'slot:old']), bookmarkID: 'old',
    });
    const replaced = reconcileBrowsingFoldLease(old, {
      activationID: 'a:1', mode: 'browsing', rows: rows(['new', false, 'slot:old']), bookmarkID: 'old',
    });
    expect(replaced.visualSlotIDs).toEqual(['slot:old']);
  });
});
