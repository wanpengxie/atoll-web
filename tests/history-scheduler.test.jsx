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
    const historyBefore = vi.fn((_channelId, beforeSeq, limit) => Promise.resolve({
      channel_id: 'c0', head_seq: 1_200, oldest_seq: beforeSeq - limit,
      newest_seq: beforeSeq - 1, has_older: true, rows: [],
    }));
    const hook = setup(historyBefore);
    act(() => {
      hook.result.current.setHistoryGrants([{ channel_id: 'c0', head_seq: 1_200, oldest_seq: 1_000, has_older: true }]);
      hook.result.current.maintainHistory('c0', 400);
    });
    await waitFor(() => expect(historyBefore).toHaveBeenCalledTimes(2));
    expect(historyBefore.mock.calls.map((call) => call.slice(1))).toEqual([[1_000, 200], [800, 200]]);

    act(() => hook.result.current.consumeHistory('c0', 32));
    await waitFor(() => expect(historyBefore).toHaveBeenCalledTimes(3));
    expect(historyBefore.mock.calls[2].slice(1)).toEqual([600, 200]);
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
