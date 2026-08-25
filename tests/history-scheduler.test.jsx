// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelFeed } from '../src/app/hooks/useChannelFeed.js';

function setup(historyBefore) {
  return renderHook(() => useChannelFeed({
    wireRef: { current: { historyBefore } },
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { feed: () => {}, self: () => {} } },
    activeChannelRef: { current: 'c0' },
    onRoster: () => {}, onError: () => {}, onChannelsDiscovered: () => {},
    onDirectoryInvalidated: () => {}, onTimerFired: () => {},
    onSubmissionFeed: () => {}, onAccessChanged: () => {},
  }));
}

afterEach(() => vi.restoreAllMocks());

describe('history read-ahead scheduler', () => {
  it('不等待滚动，串行填满目标蓄水池并在消费后补水', async () => {
    let hook;
    const historyBefore = vi.fn((channelId, beforeSeq, limit) => {
      for (let seq = beforeSeq - limit; seq < beforeSeq; seq += 1) {
        hook.result.current.enqueue(channelId, seq, {
          id: `history-${seq}`, kind: 'event', type: 'human.note', visibility: 'public',
          sender: { id: 'me', kind: 'human' }, payload: { text: `历史 ${seq}` },
        });
      }
      return Promise.resolve({
        channel_id: channelId, head_seq: 1_200, oldest_seq: beforeSeq - limit,
        newest_seq: beforeSeq - 1, has_older: true, rows: [],
      });
    });
    hook = setup(historyBefore);
    act(() => {
      hook.result.current.setHistoryGrants([{ channel_id: 'c0', head_seq: 1_200, oldest_seq: 1_000, has_older: true }]);
      hook.result.current.maintainHistory('c0', 400);
    });
    await waitFor(() => expect(historyBefore).toHaveBeenCalledTimes(2));
    expect(historyBefore.mock.calls.map((call) => call.slice(1))).toEqual([[1_000, 200], [800, 200]]);
    expect(hook.result.current.statesRef.current.get('c0')).toBeUndefined();
    expect(hook.result.current.historyFor('c0').buffered).toBe(400);
    // Filling the invisible reservoir must not publish 200-row progress ticks
    // through React; this is what froze large channels on mobile.
    expect(hook.result.current.version).toBe(1);

    act(() => {
      expect(hook.result.current.revealHistory('c0', 32)).toBe(32);
      hook.result.current.flush();
    });
    expect(hook.result.current.statesRef.current.get('c0').rows.size).toBe(32);
    await waitFor(() => expect(historyBefore).toHaveBeenCalledTimes(3));
    expect(historyBefore.mock.calls[2].slice(1)).toEqual([600, 200]);
    hook.unmount();
  });

  it('历史读取期间实时消息仍直接进入主状态', async () => {
    let resolvePage;
    const historyBefore = vi.fn(() => new Promise((resolve) => { resolvePage = resolve; }));
    const hook = setup(historyBefore);
    act(() => {
      hook.result.current.setHistoryGrants([{ channel_id: 'c0', head_seq: 1_200, oldest_seq: 1_000, has_older: true }]);
      hook.result.current.maintainHistory('c0', 200);
    });
    await waitFor(() => expect(historyBefore).toHaveBeenCalledOnce());
    act(() => {
      hook.result.current.enqueue('c0', 1_201, { id: 'live', kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'me', kind: 'human' }, payload: { text: '实时' } });
      hook.result.current.flush();
    });
    expect(hook.result.current.statesRef.current.get('c0').rows.has(1_201)).toBe(true);
    act(() => resolvePage({ channel_id: 'c0', oldest_seq: 800, has_older: false, rows: [] }));
    hook.unmount();
  });

  it('暂停频道后不再调度新的读取', async () => {
    const historyBefore = vi.fn(() => Promise.resolve({ channel_id: 'c0', oldest_seq: 800, has_older: true, rows: [] }));
    const hook = setup(historyBefore);
    act(() => {
      hook.result.current.setHistoryGrants([{ channel_id: 'c0', head_seq: 1_200, oldest_seq: 1_000, has_older: true }]);
      hook.result.current.maintainHistory('c0', 400);
      hook.result.current.pauseHistory('c0');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(historyBefore).not.toHaveBeenCalled();
    hook.unmount();
  });
});
