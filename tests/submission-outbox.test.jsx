// @vitest-environment jsdom
// 恢复自 master:tests/submission-outbox.test.jsx（RC，2026-09-19）。
// 旧测试全部依赖已删除的 src/app/hooks/useSubmissions.js（channelStatesRef/
// membershipsObserved/retire() 等旧 access 门面）+ src/model/submissions.js 的
// diagnosticsSnapshot() 埋点 + localStorage 迁移路径（saveSubmissions）。
// 新结构里同一套职责收敛进 src/ui/composer/useComposerSubmissionRuntime.js +
// src/model/outbox-store.js（IndexedDB），已有 tests/submission-outbox-current.test.jsx
// （8 例，全绿，2026 年早前提交，非本轮新增）覆盖了其中 5 条旧用例的对应事实：
//   - reads transport authority at execution time through a stable Composer callback
//   - does not durably queue unknown access, then accepts after membership is confirmed
//   - keeps a retryable unavailable refusal queued and reuses its stable id once service recovers
//   - keeps a definitive rejection visible without self-retrying it
//   - atomically accepts immutable frames without consuming a newer draft
// 本文件补齐其余未覆盖的 6 条：竞态相关的 4 条（access 变化不降级在途提交/退频道拒绝新
// 提交/开放连接反复重连不热循环同一 durable id/feed 抢跑 receipt 与 receipt 抢跑 feed 各一
// 攻防）+ 1 条 ledger-confirmed id 抢跑 principal hydration。legacy 迁移那条（用旧
// localStorage saveSubmissions 模拟"迁移前遗留记录"）判定为正当消失：新架构只有 IndexedDB
// 一个持久层，没有 localStorage→IndexedDB 的迁移路径需要保护。
// 判定逐条记在 audit-output/RESTORE-MATRIX.md。
import 'fake-indexeddb/auto';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerSubmissionRuntime } from '../src/ui/composer/useComposerSubmissionRuntime.js';
import { createOutboxStore } from '../src/model/outbox-store.js';

let databaseSerial = 0;
const databaseName = () => `submission-race-${++databaseSerial}-${Date.now()}`;

function memberAccess(overrides = {}) {
  return { relationship: 'member', existence: 'present', runtime: 'open', unavailable: false, ...overrides };
}

function harness({ wireState = 'open', submit = vi.fn(), access = memberAccess(), principalId = `root-${++databaseSerial}` } = {}) {
  const store = createOutboxStore({ databaseName: databaseName() });
  return {
    activeChannelId: 'c0', principalId, producerOwnerToken: `owner-${principalId}`,
    wireState, wireRef: { current: wireState === 'open' ? { submit } : null },
    accessRef: { current: { state: () => access } },
    rosterRef: { current: { recordSubmission: vi.fn(), forgetSubmission: vi.fn() } },
    onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    outboxFactory: () => store,
    store,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

function StrictModeWrapper({ children }) {
  return <React.StrictMode>{children}</React.StrictMode>;
}

describe('提交生命周期竞态（useComposerSubmissionRuntime，与 tests/submission-outbox-current.test.jsx 同一 owner）', () => {
  it('keeps the durable send queue live through the StrictMode effect probe', async () => {
    const submit = vi.fn().mockResolvedValue({ message_id: 'm-strict-mode' });
    const config = harness({ wireState: 'open', submit });
    const { result, unmount } = renderHook((props) => useComposerSubmissionRuntime(props), {
      initialProps: config,
      wrapper: StrictModeWrapper,
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await result.current.send({ messageId: 'm-strict-mode', text: 'strict mode', msgType: 'agent.ask', audience: ['agent:a'] });
    });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
    expect(submit).toHaveBeenCalledOnce();

    unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    config.store.close();
  });

  it('fences an accepted-patch already in flight when the runtime really unmounts', async () => {
    let resolveReceipt;
    const receipt = new Promise((resolve) => { resolveReceipt = resolve; });
    const submit = vi.fn(() => receipt);
    const config = harness({ wireState: 'open', submit });
    let acceptedPatchStarted = false;
    let finishAcceptedPatch;
    let acceptedWrite = false;
    const store = config.store;
    const gatedStore = {
      ...store,
      patch(...args) {
        if (args[3]?.state !== 'accepted') return store.patch(...args);
        acceptedPatchStarted = true;
        const authorize = args[4]?.authorize;
        return new Promise((resolve, reject) => {
          finishAcceptedPatch = () => {
            if (authorize && authorize() !== true) {
              reject(new Error('lifecycle fence')); return;
            }
            acceptedWrite = true;
            resolve({ state: 'accepted', messageId: args[1] });
          };
        });
      },
    };
    config.outboxFactory = () => gatedStore;
    const { result, unmount } = renderHook((props) => useComposerSubmissionRuntime(props), { initialProps: config });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    let sendPromise;
    act(() => { sendPromise = result.current.send({ messageId: 'm-unmount-flight', text: 'in flight', msgType: 'agent.ask', audience: ['agent:a'] }); });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('transmitting'));
    resolveReceipt({ message_id: 'm-unmount-flight' });
    await waitFor(() => expect(acceptedPatchStarted).toBe(true));

    // The accepted patch has already entered its persistence step. A real
    // unmount must fence its authorize callback before it can commit; the
    // physical close is deliberately allowed to remain deferred for the
    // StrictMode probe contract.
    unmount();
    finishAcceptedPatch();
    await act(async () => { await sendPromise; });
    expect(acceptedWrite).toBe(false);
    store.close();
  });

  it('does not downgrade an in-flight submission when access changes before its accepted receipt', async () => {
    let resolveReceipt;
    const receipt = new Promise((resolve) => { resolveReceipt = resolve; });
    const submit = vi.fn(() => receipt);
    let access = memberAccess();
    const config = harness({ wireState: 'open', submit, access });
    config.accessRef.current.state = () => access;
    const { result, rerender, unmount } = renderHook((props) => useComposerSubmissionRuntime(props), { initialProps: config });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    let sendPromise;
    act(() => { sendPromise = result.current.send({ messageId: 'm-flight', text: 'already in flight', msgType: 'agent.ask', audience: ['agent:a'] }); });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('transmitting'));

    // 结算前 access 撤销（settle 阶段 requireAccess:false，不该把在途提交打回去）。
    access = memberAccess({ relationship: 'observer' });
    rerender(config);
    expect(result.current.pending[0]?.state).toBe('transmitting');

    resolveReceipt({ message_id: 'm-flight' });
    await act(async () => { await sendPromise; });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
    unmount();
  });

  it('does not durably accept a new submission for a retired channel even if its old relationship was member', async () => {
    const submit = vi.fn();
    const config = harness({ wireState: 'open', submit, access: memberAccess({ existence: 'retired' }) });
    const { result, unmount } = renderHook((props) => useComposerSubmissionRuntime(props), { initialProps: config });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await expect(act(async () => result.current.send({ messageId: 'm-retired', text: 'must not queue', msgType: 'agent.ask', audience: ['agent:a'] })))
      .rejects.toThrow();
    expect(result.current.pending).toEqual([]);
    expect(submit).not.toHaveBeenCalled();
    unmount();
  });

  it('does not hot-loop the same durable id while an open wire keeps returning uncertain across reconnects', async () => {
    const submit = vi.fn().mockRejectedValue(Object.assign(new Error('connection closed'), { code: 'closed' }));
    const config = harness({ wireState: 'open', submit });
    const { result, rerender, unmount } = renderHook((props) => useComposerSubmissionRuntime(props), { initialProps: config });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => { await result.current.send({ messageId: 'm-uncertain', text: 'one intent', msgType: 'agent.ask', audience: ['agent:a'] }); });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('uncertain'));
    expect(submit).toHaveBeenCalledTimes(1);

    // 反复断线重连（wireState 在 open 之间抖动），不该对同一条 durable id 重复发起传输。
    rerender({ ...config, wireState: 'reconnecting' });
    rerender({ ...config, wireState: 'open' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    const callsAfterFirstReconnect = submit.mock.calls.length;
    rerender({ ...config, wireState: 'reconnecting' });
    rerender({ ...config, wireState: 'open' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    // 第二次抖动不该再叠加——因为此刻这条记录的状态已经是本轮已经处理过的 uncertain，
    // 只有显式 retry() 才能再发一次。
    const callsAfterSecondReconnect = submit.mock.calls.length;
    // Let the last attempted patch/release settle before the test teardown
    // unmount closes IndexedDB. The count remains a snapshot of this input
    // transaction; the extra wait only prevents a teardown false-positive.
    rerender({ ...config, wireState: 'closed' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    unmount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(callsAfterFirstReconnect).toBe(2); // wireState 回到 open 的自动重试算一次，属预期内的"追回一次"，不是热循环
    expect(callsAfterSecondReconnect).toBe(2);
  });

  it('treats feed-before-receipt as landed without retransmitting or emitting another send phase', async () => {
    let resolveReceipt;
    const receipt = new Promise((resolve) => { resolveReceipt = resolve; });
    const submit = vi.fn(() => receipt);
    const config = harness({ wireState: 'open', submit });
    const { result, unmount } = renderHook((props) => useComposerSubmissionRuntime(props), { initialProps: config });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    let sendPromise;
    act(() => { sendPromise = result.current.send({ messageId: 'm-feed-first', text: 'race', msgType: 'agent.ask', audience: ['agent:a'] }); });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    // 账本 feed 先于回执落地；即便重复调用两次 reconcileFeed，也只应清空一次。
    act(() => {
      result.current.reconcileFeed(new Set(['m-feed-first']), new Set(), config.producerOwnerToken);
      result.current.reconcileFeed(new Set(['m-feed-first']), new Set(), config.producerOwnerToken);
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    resolveReceipt({ message_id: 'm-feed-first' });
    await act(async () => { await sendPromise; });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(submit).toHaveBeenCalledOnce();
    expect(result.current.pending).toEqual([]);
    unmount(); config.store.close();
  });

  it('treats receipt-before-feed as one attempt and leaves rejection/retry decisions to the user', async () => {
    const submit = vi.fn().mockResolvedValue({ message_id: 'm-receipt-first' });
    const config = harness({ wireState: 'open', submit });
    const { result, unmount } = renderHook((props) => useComposerSubmissionRuntime(props), { initialProps: config });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await act(async () => { await result.current.send({ messageId: 'm-receipt-first', text: 'receipt first', msgType: 'agent.ask', audience: ['agent:a'] }); });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
    act(() => result.current.reconcileFeed(new Set(['m-receipt-first']), new Set(), config.producerOwnerToken));
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(submit).toHaveBeenCalledOnce();
    unmount(); config.store.close();
  });

  it('does not resurrect a ledger-confirmed id when feed races principal hydration', async () => {
    const messageId = 'already-landed-message';
    const preseedStore = createOutboxStore({ databaseName: databaseName() });
    const principalId = `hydrate-race-${crypto.randomUUID()}`;
    await preseedStore.putMany(principalId, [{
      key: messageId, messageId, channelId: 'c0', state: 'queued',
      frame: { id: messageId, channel_id: 'c0', msg_type: 'agent.ask', payload: { text: 'once' } },
      createdAt: 1, updatedAt: 1, error: null,
    }]);
    const submit = vi.fn().mockResolvedValue({ message_id: messageId });
    const config = harness({ wireState: 'reconnecting', submit, principalId });
    config.outboxFactory = () => preseedStore;
    const { result, rerender, unmount } = renderHook((props) => useComposerSubmissionRuntime(props), { initialProps: config });
    // feed 先一步汇报这条已经落地——挂载水合（hydration）还没跑完就抢跑。
    act(() => result.current.reconcileFeed(new Set([messageId]), new Set(), config.producerOwnerToken));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    rerender({ ...config, wireState: 'open' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
    const submitCount = submit.mock.calls.length;
    const stillPresent = (await preseedStore.restore(principalId)).some((item) => item.messageId === messageId);
    rerender({ ...config, wireState: 'closed' });
    unmount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(submitCount).toBe(0);
    expect(stillPresent).toBe(false);
  });
});

describe('离线送达后自动传输（accepts locally while disconnected and automatically transmits after reconnect）', () => {
  it('accepts locally while disconnected and automatically transmits after reconnect', async () => {
    const submit = vi.fn().mockResolvedValue({ message_id: 'm-offline' });
    const config = harness({ wireState: 'reconnecting', submit });
    const { result, rerender, unmount } = renderHook((props) => useComposerSubmissionRuntime(props), { initialProps: config });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => { await result.current.send({ messageId: 'm-offline', text: 'offline first', msgType: 'agent.ask', audience: ['agent:a'] }); });
    expect(result.current.pending[0]).toMatchObject({ messageId: 'm-offline', state: 'queued' });
    expect(submit).not.toHaveBeenCalled();

    config.wireRef.current = { submit };
    rerender({ ...config, wireState: 'open' });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
    unmount(); config.store.close();
  });
});
