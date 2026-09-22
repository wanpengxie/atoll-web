import { describe, expect, it } from 'vitest';
import { emptyBrowsingFoldLease, reconcileBrowsingFoldLease } from '../src/model/browsing-fold-lease.js';

const row = (id, visualSlotID = id, role = undefined) => ({ id, visualSlotID, ...(role ? { role } : {}) });

describe('S-Z current latest-row owner for browsing fold lease', () => {
  it('consumes the explicit current latest row and ignores removed role fields', () => {
    const explicit = reconcileBrowsingFoldLease(emptyBrowsingFoldLease(), {
      activationID: 'a:1',
      mode: 'browsing',
      rows: [row('old'), row('new')],
      latestRowID: 'new',
      bookmarkID: 'new',
    });
    expect(explicit.visualSlotIDs).toEqual(['new']);

    const legacyOnly = reconcileBrowsingFoldLease(emptyBrowsingFoldLease(), {
      activationID: 'a:1',
      mode: 'browsing',
      rows: [row('old', 'slot:old', { latest: true })],
      bookmarkID: 'old',
    });
    expect(legacyOnly.visualSlotIDs).toEqual([]);
  });

  it('keeps the browsing bookmark slot across an append until the reader witnesses the new tail', () => {
    const entered = reconcileBrowsingFoldLease(emptyBrowsingFoldLease(), {
      activationID: 'a:1',
      mode: 'browsing',
      rows: [row('old')],
      latestRowID: 'old',
      bookmarkID: 'old',
    });
    const appended = reconcileBrowsingFoldLease(entered, {
      activationID: 'a:1',
      mode: 'browsing',
      rows: [row('old'), row('new')],
      latestRowID: 'new',
      bookmarkID: 'old',
    });
    expect(appended.visualSlotIDs).toEqual(['old']);

    const visited = reconcileBrowsingFoldLease(appended, {
      activationID: 'a:1',
      mode: 'browsing',
      rows: [row('old'), row('new')],
      latestRowID: 'new',
      bookmarkID: 'new',
    });
    expect(visited.visualSlotIDs).toEqual(['old', 'new']);
  });

  it('retains a reciprocal replacement in its canonical visual slot and revokes stale activations', () => {
    const entered = reconcileBrowsingFoldLease(emptyBrowsingFoldLease(), {
      activationID: 'a:1',
      mode: 'browsing',
      rows: [row('old', 'slot:old')],
      latestRowID: 'old',
      bookmarkID: 'old',
    });
    const replaced = reconcileBrowsingFoldLease(entered, {
      activationID: 'a:1',
      mode: 'browsing',
      rows: [row('new', 'slot:old')],
      latestRowID: 'new',
      bookmarkID: 'old',
    });
    expect(replaced.visualSlotIDs).toEqual(['slot:old']);
    expect(reconcileBrowsingFoldLease(replaced, {
      activationID: 'a:1', mode: 'following', rows: [row('new', 'slot:old')], latestRowID: 'new',
    })).toBe(emptyBrowsingFoldLease());
  });
});
