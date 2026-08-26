// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelFeed } from '../src/app/hooks/useChannelFeed.js';
import { createHistoryScheduler } from '../src/model/history-scheduler.js';

function accepted(ref) {
  const promise = Promise.resolve({ accepted: true });
  promise.ref = ref;
  return promise;
}

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

function attach(hook, grant = { channel_id: 'c0', head_seq: 1_200, oldest_seq: 1_000, has_older: true }) {
  act(() => {
    hook.result.current.setHistoryGrants([grant], { attach_ref: 'attach-1', generation: 1, focus: 'c0' });
    hook.result.current.pageEnd({ source: 'attach', ref: 'attach-1', generation: 1, channel_id: 'c0', head_seq: 1_200, oldest_seq: 1_000, has_older: true });
  });
}

function streamPage(hook, { ref, before, oldest, hasOlder = true }) {
  act(() => {
    for (let seq = oldest; seq < before; seq += 1) {
      hook.result.current.enqueue('c0', seq, {
        id: `history-${seq}`, kind: 'event', type: 'human.note', visibility: 'public',
        sender: { id: 'me', kind: 'human' }, payload: { text: `历史 ${seq}` },
      });
    }
    hook.result.current.pageEnd({ source: 'page', ref, generation: 1, channel_id: 'c0', head_seq: 1_200, oldest_seq: oldest, newest_seq: before - 1, has_older: hasOlder });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('global history scheduler', () => {
  it('串行预取到不可见水库，reveal 后才进入 fold', async () => {
    let requestIndex = 0;
    const historyBefore = vi.fn(() => accepted(`history-${++requestIndex}`));
    const hook = setup(historyBefore);
    attach(hook);
    await waitFor(() => expect(historyBefore).toHaveBeenCalledOnce());
    streamPage(hook, { ref: 'history-1', before: 1_000, oldest: 800 });
    await waitFor(() => expect(historyBefore).toHaveBeenCalledTimes(2));
    streamPage(hook, { ref: 'history-2', before: 800, oldest: 600, hasOlder: false });

    expect(hook.result.current.statesRef.current.get('c0')).toBeUndefined();
    expect(hook.result.current.historyFor('c0').buffered).toBe(400);
    act(() => expect(hook.result.current.revealHistory('c0', 32)).toBe(32));
    expect(hook.result.current.statesRef.current.get('c0').rows.size).toBe(32);
    hook.unmount();
  });

  it('历史页在途时实时消息仍同步进入主状态', async () => {
    const historyBefore = vi.fn(() => accepted('history-live'));
    const hook = setup(historyBefore);
    attach(hook);
    await waitFor(() => expect(historyBefore).toHaveBeenCalledOnce());
    act(() => hook.result.current.enqueue('c0', 1_201, { id: 'live', kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'me', kind: 'human' }, payload: { text: '实时' } }));
    expect(hook.result.current.statesRef.current.get('c0').rows.has(1_201)).toBe(true);
    hook.unmount();
  });

  it('accepted 后断线会终结旧页，重连可从同一游标继续', async () => {
    let requestIndex = 0;
    const historyBefore = vi.fn(() => accepted(`history-${++requestIndex}`));
    const hook = setup(historyBefore);
    attach(hook);
    await waitFor(() => expect(historyBefore).toHaveBeenCalledOnce());
    act(() => hook.result.current.disconnectHistory(1));
    act(() => {
      hook.result.current.setHistoryGrants([{ channel_id: 'c0', head_seq: 1_200, oldest_seq: 1_000, has_older: true }], { attach_ref: 'attach-2', generation: 2, focus: 'c0' });
      hook.result.current.pageEnd({ source: 'attach', ref: 'attach-2', generation: 2, channel_id: 'c0', head_seq: 1_200, oldest_seq: 1_000, has_older: true });
    });
    await waitFor(() => expect(historyBefore).toHaveBeenCalledTimes(2));
    expect(historyBefore.mock.calls[1].slice(0, 2)).toEqual(['c0', 1_000]);
    hook.unmount();
  });

  it('切换焦点后，当前页结束时由新焦点拿到下一页', () => {
    let index = 0;
    const requestPage = vi.fn(() => accepted(`page-${++index}`));
    const scheduler = createHistoryScheduler({ requestPage, revealRows: () => {} });
    scheduler.attach([
      { channel_id: 'a', head_seq: 900, oldest_seq: 700, has_older: true },
      { channel_id: 'b', head_seq: 800, oldest_seq: 600, has_older: true },
    ], { attachRef: 'attach', generation: 1, focus: 'b' });
    scheduler.pageEnd({ source: 'attach', ref: 'attach', generation: 1, channel_id: 'b', head_seq: 800, oldest_seq: 600, has_older: true });
    expect(requestPage.mock.calls[0].slice(0, 2)).toEqual(['b', 600]);
    scheduler.pageEnd({ source: 'attach', ref: 'attach', generation: 1, channel_id: 'a', head_seq: 900, oldest_seq: 700, has_older: true });
    scheduler.focus('a');
    scheduler.pageEnd({ source: 'page', ref: 'page-1', generation: 1, channel_id: 'b', head_seq: 800, oldest_seq: 400, has_older: true });
    expect(requestPage.mock.calls[1].slice(0, 2)).toEqual(['a', 700]);
    scheduler.destroy();
  });

  it('attach 失败不靠外部事件也会由唯一 wake timer 自动重试', () => {
    vi.useFakeTimers();
    const requestPage = vi.fn(() => accepted('retry-1'));
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage, revealRows });
    scheduler.attach([{
      channel_id: 'c0', error_code: 'unavailable', error_detail: '暂不可用',
    }], { attachRef: 'attach', generation: 1, focus: 'c0' });
    expect(requestPage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(requestPage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestPage).toHaveBeenCalledWith('c0', 0, 200);
    scheduler.classifyRow('c0', 9, { id: 'tail-9' });
    scheduler.classifyRow('c0', 10, { id: 'tail-10' });
    scheduler.pageEnd({ source: 'page', ref: 'retry-1', generation: 1, channel_id: 'c0', head_seq: 10, oldest_seq: 9, newest_seq: 10, has_older: false });
    expect(revealRows).toHaveBeenCalledWith('c0', [[9, { id: 'tail-9' }], [10, { id: 'tail-10' }]]);
    scheduler.destroy();
  });

  it('旧连接迟到的 page_end 不能关闭新连接的在途页', () => {
    let index = 0;
    const requestPage = vi.fn(() => accepted(`page-${++index}`));
    const scheduler = createHistoryScheduler({ requestPage, revealRows: () => {} });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, oldest_seq: 80, has_older: true }], { attachRef: 'attach-1', generation: 1, focus: 'c0' });
    scheduler.pageEnd({ source: 'attach', ref: 'attach-1', generation: 1, channel_id: 'c0', oldest_seq: 80, has_older: true });
    scheduler.disconnected(1);
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, oldest_seq: 80, has_older: true }], { attachRef: 'attach-2', generation: 2, focus: 'c0' });
    scheduler.pageEnd({ source: 'attach', ref: 'attach-2', generation: 2, channel_id: 'c0', oldest_seq: 80, has_older: true });
    expect(requestPage).toHaveBeenCalledTimes(2);
    expect(scheduler.pageEnd({ source: 'page', ref: 'page-1', generation: 1, channel_id: 'c0', oldest_seq: 60, has_older: true })).toBe(false);
    expect(scheduler.snapshot('c0').loading).toBe(true);
    scheduler.pageEnd({ source: 'page', ref: 'page-2', generation: 2, channel_id: 'c0', oldest_seq: 60, has_older: false });
    expect(scheduler.snapshot('c0').loading).toBe(false);
    scheduler.destroy();
  });

  it('预取与磁盘恢复的可见行重叠时只在水库保留缺口行', () => {
    const visible = new Set([61, 62]);
    const scheduler = createHistoryScheduler({
      requestPage: () => accepted('page-overlap'),
      revealRows: () => {},
      hasVisibleRow: (_channelId, seq) => visible.has(seq),
    });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, oldest_seq: 80, has_older: true }], { attachRef: 'attach', generation: 1, focus: 'c0' });
    scheduler.pageEnd({ source: 'attach', ref: 'attach', generation: 1, channel_id: 'c0', oldest_seq: 80, has_older: true });
    scheduler.classifyRow('c0', 60, { id: 'gap-60' });
    scheduler.classifyRow('c0', 61, { id: 'cached-61' });
    scheduler.classifyRow('c0', 62, { id: 'cached-62' });
    scheduler.pageEnd({ source: 'page', ref: 'page-overlap', generation: 1, channel_id: 'c0', oldest_seq: 60, newest_seq: 79, has_older: false });
    expect(scheduler.snapshot('c0')).toMatchObject({ buffered: 1, bufferedNewest: 60 });
    scheduler.destroy();
  });

  it('水库接近 5000 时只请求缺少的行数，不跨页丢历史', () => {
    let index = 0;
    const requestPage = vi.fn(() => accepted(`page-${++index}`));
    const scheduler = createHistoryScheduler({ requestPage, revealRows: () => {} });
    scheduler.attach([{ channel_id: 'c0', head_seq: 12_000, oldest_seq: 10_000, has_older: true }], { attachRef: 'attach', generation: 1, focus: 'c0' });
    scheduler.pageEnd({ source: 'attach', ref: 'attach', generation: 1, channel_id: 'c0', oldest_seq: 10_000, has_older: true });
    let before = 10_000;
    for (let page = 1; page <= 25; page += 1) {
      const oldest = before - 200;
      for (let seq = oldest; seq < before; seq += 1) scheduler.classifyRow('c0', seq, { id: `m-${seq}` });
      scheduler.pageEnd({ source: 'page', ref: `page-${page}`, generation: 1, channel_id: 'c0', oldest_seq: oldest, newest_seq: before - 1, has_older: true });
      before = oldest;
    }
    expect(scheduler.snapshot('c0').buffered).toBe(5_000);
    expect(requestPage).toHaveBeenCalledTimes(25);
    scheduler.take('c0', 32);
    expect(requestPage).toHaveBeenCalledTimes(26);
    expect(requestPage.mock.calls[25]).toEqual(['c0', 5_000, 32]);
    scheduler.destroy();
  });

  it('旧 attach page_end 不会把新连接尚未完成的尾巴提交到 fold', () => {
    const hook = setup(() => accepted('unused'));
    act(() => {
      hook.result.current.setHistoryGrants([{ channel_id: 'c0', head_seq: 20, oldest_seq: 10, has_older: false }], { attach_ref: 'attach-2', generation: 2, focus: 'c0' });
      hook.result.current.enqueue('c0', 10, { id: 'tail-10', kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'me', kind: 'human' }, payload: { text: '尾巴' } });
      hook.result.current.pageEnd({ source: 'attach', ref: 'attach-1', generation: 1, channel_id: 'c0', oldest_seq: 10, has_older: false });
    });
    expect(hook.result.current.statesRef.current.get('c0')).toBeUndefined();
    act(() => hook.result.current.pageEnd({ source: 'attach', ref: 'attach-2', generation: 2, channel_id: 'c0', oldest_seq: 10, has_older: false }));
    expect(hook.result.current.statesRef.current.get('c0').rows.has(10)).toBe(true);
    hook.unmount();
  });
});
