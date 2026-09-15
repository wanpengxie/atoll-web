import { describe, expect, it, vi } from 'vitest';
import {
  createHistoryDemandPort,
  HISTORY_INTENT,
  HISTORY_URGENCY,
  normalizeHistoryDemandPort,
} from '../src/model/history-demand.js';

describe('visual history demand port', () => {
  it('adds semantic defaults without exposing scheduler controls', async () => {
    const open = vi.fn(async (demand) => demand);
    const markRead = vi.fn();
    const port = createHistoryDemandPort({ channelId: 'c0', status: { hasOlder: true }, open, markRead });

    await expect(port.open({ anchorSeq: 42 })).resolves.toEqual({
      intent: HISTORY_INTENT.scrollHistory,
      urgency: HISTORY_URGENCY.interactive,
      anchorSeq: 42,
    });
    port.markRead(99);
    expect(markRead).toHaveBeenCalledWith(99);
    expect(port.status).toMatchObject({ hasOlder: true, localReplicaReady: true });
    expect(port).not.toHaveProperty('priority');
    expect(port).not.toHaveProperty('requestPage');
  });

  it('preserves an explicitly stated user intent and urgency', async () => {
    const open = vi.fn(async (demand) => demand);
    const port = createHistoryDemandPort({ open });
    await expect(port.open({
      intent: HISTORY_INTENT.jumpToSource,
      urgency: HISTORY_URGENCY.blocking,
      anchorSeq: 7,
    })).resolves.toMatchObject({
      intent: HISTORY_INTENT.jumpToSource,
      urgency: HISTORY_URGENCY.blocking,
      anchorSeq: 7,
    });
  });

  it('adapts the previous flat Timeline contract at one boundary', async () => {
    const loadOlder = vi.fn(async (demand) => demand);
    const onReadLatest = vi.fn();
    const port = normalizeHistoryDemandPort({ channelId: 'legacy', hasOlder: true, loadOlder, onReadLatest });

    await port.open({ anchorSeq: 8 });
    port.markRead(12);
    expect(loadOlder).toHaveBeenCalledWith(expect.objectContaining({
      anchorSeq: 8,
      intent: HISTORY_INTENT.scrollHistory,
      urgency: HISTORY_URGENCY.interactive,
    }));
    expect(onReadLatest).toHaveBeenCalledWith(12);
    expect(port.status.hasOlder).toBe(true);
  });
});
