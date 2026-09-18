import { describe, expect, it, vi } from 'vitest';
import {
  createHistoryDemandPort,
  exactReadIdentities,
  HISTORY_INTENT,
  HISTORY_URGENCY,
  physicalReadSeq,
} from '../src/model/history-demand.js';

describe('visual history demand port', () => {
  it('adds semantic defaults without exposing scheduler controls', async () => {
    const open = vi.fn(async (demand) => demand);
    const markRead = vi.fn();
    const status = {
      hasOlder: true, attached: true, messageCurrent: true,
      generation: 7, presentationRevision: 12,
    };
    const port = createHistoryDemandPort({ channelId: 'c0', status, open, markRead });

    await expect(port.open({ anchorSeq: 42 })).resolves.toEqual({
      intent: HISTORY_INTENT.scrollHistory,
      urgency: HISTORY_URGENCY.interactive,
      anchorSeq: 42,
    });
    const receipt = {
      channelId: 'c0', viewKey: 'c0:all', activationID: 'activation-1',
      generation: 7, sourceRevision: 12, scope: 'all', actorFilterCount: 0,
      atTail: true, following: true, surfaceVisible: true, installedHighSeq: 99,
      visibleRows: [{ messageID: 'row-99', seqHigh: 99 }],
    };
    port.markRead(receipt, { viewKey: 'c0:all', activationID: 'activation-1' });
    expect(markRead).toHaveBeenCalledWith({
      physicalSeq: 99,
      identities: [{ messageID: 'row-99', seqHigh: 99 }],
      receipt,
    });
    expect(port.status).toMatchObject({ hasOlder: true, localReplicaReady: true });
    expect(port).not.toHaveProperty('priority');
    expect(port).not.toHaveProperty('requestPage');
  });

  it('preserves an explicitly stated user intent and urgency', async () => {
    const open = vi.fn(async (demand) => demand);
    const port = createHistoryDemandPort({ open });
    await expect(port.open({
      intent: HISTORY_INTENT.searchContext,
      urgency: HISTORY_URGENCY.blocking,
      anchorSeq: 7,
    })).resolves.toMatchObject({
      intent: HISTORY_INTENT.searchContext,
      urgency: HISTORY_URGENCY.blocking,
      anchorSeq: 7,
    });
  });

  it('keeps filtered exact-identity acknowledgement separate from the physical channel cursor', () => {
    const base = {
      channelId: 'c0', viewKey: 'c0:mine', activationID: 'activation-2',
      generation: 4, sourceRevision: 20, scope: 'mine', actorFilterCount: 0,
      atTail: true, following: true, surfaceVisible: true, installedHighSeq: 18,
      visibleRows: [{ messageID: 'mine-18', seqHigh: 18 }],
    };
    const status = { attached: true, messageCurrent: true, generation: 4, presentationRevision: 20 };
    const authority = { viewKey: base.viewKey, activationID: base.activationID };
    expect(physicalReadSeq({ channelId: 'c0', status, authority, receipt: base })).toBe(0);
    expect(exactReadIdentities({ channelId: 'c0', status, authority, receipt: base })).toEqual([
      { messageID: 'mine-18', seqHigh: 18 },
    ]);
    const markRead = vi.fn();
    const port = createHistoryDemandPort({ channelId: 'c0', status, markRead });
    port.markRead(base, authority);
    expect(markRead).toHaveBeenCalledWith(expect.objectContaining({
      physicalSeq: 0,
      identities: [{ messageID: 'mine-18', seqHigh: 18 }],
    }));
    expect(physicalReadSeq({
      channelId: 'c0', status, authority: { viewKey: 'c0:all:agent', activationID: base.activationID },
      receipt: { ...base, viewKey: 'c0:all:agent', scope: 'all', actorFilterCount: 1 },
    })).toBe(0);
  });

  it('rejects stale view, activation-less, generation, revision, and numeric-only receipts', () => {
    const status = { attached: true, messageCurrent: true, generation: 5, presentationRevision: 30 };
    const valid = {
      channelId: 'c0', viewKey: 'c0:all', activationID: 'activation-3',
      generation: 5, sourceRevision: 30, scope: 'all', actorFilterCount: 0,
      atTail: true, following: true, surfaceVisible: true, installedHighSeq: 21,
      visibleRows: [{ messageID: 'row-21', seqHigh: 21 }],
    };
    const authority = { viewKey: valid.viewKey, activationID: valid.activationID };
    const decide = (receipt, current = authority) => physicalReadSeq({ channelId: 'c0', status, authority: current, receipt });
    expect(decide(valid)).toBe(21);
    expect(decide({ ...valid, channelId: 'c1' })).toBe(0);
    expect(decide({ ...valid, activationID: '' })).toBe(0);
    expect(decide({ ...valid, generation: 4 })).toBe(0);
    expect(decide({ ...valid, sourceRevision: 29 })).toBe(0);
    expect(decide({ ...valid, visibleRows: [] })).toBe(0);
    expect(physicalReadSeq({
      channelId: 'c0', status, authority,
      receipt: { ...valid, visibleRows: [{ messageID: 'old-row', seqHigh: 20 }] },
    })).toBe(0);
    expect(decide(valid, { ...authority, activationID: 'activation-new' })).toBe(0);
    expect(decide(valid, { ...authority, viewKey: 'c0:all:new-view' })).toBe(0);
    expect(decide({ ...valid, actorFilterCount: Number.NaN })).toBe(0);
    expect(decide({ ...valid, actorFilterCount: -1 })).toBe(0);
    expect(decide({ ...valid, following: false })).toBe(0);
  });

});
