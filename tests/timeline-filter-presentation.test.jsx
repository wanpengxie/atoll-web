// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Timeline } from '../src/ui/Timeline.jsx';
import { createViewSessionStore } from '../src/model/view-session.js';
import { apply, createChannelState } from '../src/model/fold.js';

vi.mock('../src/ui/timeline/LegendMessageList.jsx', async () => ({
  MessageList: (await import('./helpers/PresentationMessageList.jsx')).PresentationMessageList,
}));

afterEach(cleanup);

function timelineState(standalone = []) {
  return {
    channelId: 'c0',
    rows: new Map(standalone.map((row) => [row.seq, row.envelope])),
    turns: new Map(),
    standalone,
    orphans: [],
    narration: [],
    lastSeq: standalone.at(-1)?.seq || 0,
  };
}

function mixedAgentTurns() {
  const state = createChannelState('c0');
  const selfId = 'human:root:100';
  const append = (seq, envelope) => apply(state, {
    channel_id: 'c0',
    seq,
    envelope: {
      ts: seq,
      channel_id: 'c0',
      visibility: 'public',
      ...envelope,
    },
  }, selfId);
  append(1, {
    id: 'ask-codex', kind: 'request', type: 'agent.ask',
    sender: { id: selfId, kind: 'human' }, audience: ['agent:codex:200'],
    correlation_id: 'ask-codex', payload: { text: 'Codex question' },
  });
  append(2, {
    id: 'done-codex', kind: 'response', type: 'agent.ask',
    sender: { id: 'agent:codex:200', kind: 'agent' }, audience: [selfId],
    parent_id: 'ask-codex', correlation_id: 'ask-codex',
    payload: { status: 'completed', text: 'Codex answer' },
  });
  append(3, {
    id: 'ask-claude', kind: 'request', type: 'agent.ask',
    sender: { id: selfId, kind: 'human' }, audience: ['agent:claude:300'],
    correlation_id: 'ask-claude', payload: { text: 'Claude question' },
  });
  append(4, {
    id: 'done-claude', kind: 'response', type: 'agent.ask',
    sender: { id: 'agent:claude:300', kind: 'agent' }, audience: [selfId],
    parent_id: 'ask-claude', correlation_id: 'ask-claude',
    payload: { status: 'completed', text: 'Claude answer' },
  });
  return { state, selfId };
}

function incarnationAndSystemHeavyState() {
  const state = createChannelState('c0');
  const historicalSelf = 'human:root:1700000000000';
  const claude = 'agent:claude:1800000000000';
  const applyEnvelope = (seq, envelope) => apply(state, {
    channel_id: 'c0',
    seq,
    envelope: {
      ts: seq,
      channel_id: 'c0',
      visibility: 'public',
      ...envelope,
    },
  }, historicalSelf);
  for (let seq = 1; seq <= 24; seq += 1) {
    applyEnvelope(seq, {
      id: `system-${seq}`,
      kind: 'event',
      type: 'system.member.updated',
      visibility: 'system',
      sender: { id: 'system:c0:1', kind: 'system' },
      audience: [],
      payload: { member: `opaque-${seq}` },
    });
  }
  applyEnvelope(25, {
    id: 'opaque-ask-claude', kind: 'request', type: 'agent.ask',
    sender: { id: historicalSelf, kind: 'human' }, audience: [claude],
    correlation_id: 'opaque-ask-claude', payload: { text: '跨 incarnation 的 Claude 问题' },
  });
  applyEnvelope(26, {
    id: 'opaque-done-claude', kind: 'response', type: 'agent.ask',
    sender: { id: claude, kind: 'agent' }, audience: [historicalSelf],
    parent_id: 'opaque-ask-claude', correlation_id: 'opaque-ask-claude',
    payload: { status: 'completed', text: '跨 incarnation 的 Claude 回答' },
  });
  return { state, claude };
}

it('same-phase Admission authority advance forces a fresh projection after stale receipt rejection', async () => {
  const state = timelineState([{
    seq: 1,
    envelope: {
      id: 'baseline', kind: 'event', type: 'message.posted', ts: 1,
      sender: { id: 'agent:test:1', kind: 'agent' },
      payload: { text: 'baseline' },
    },
  }]);
  const admission = {
    evaluate: vi.fn((_channelID, items) => ({
      items,
      receipt: { authorityRevision: admission.evaluate.mock.calls.length },
    })),
    sourceFence: vi.fn(() => null),
    commitCandidate: vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValue(true),
    snapshot: vi.fn(() => ({ phase: 'pending', token: null, committed: null })),
    reconcileCurrent: vi.fn(() => false),
    reset: vi.fn(),
  };

  render(<Timeline
    state={state}
    history={{ status: {
      attached: true, generation: 1, messageCurrent: true, headSeq: 1,
      localReplicaReady: true, loading: false, hasOlder: false,
      presentationRevision: 1,
      presentationAdmission: admission,
      presentationAdmissionState: { phase: 'pending', token: null },
    } }}
    roster={[]}
    selfId="human:root:1"
    pending={[]}
    approvalStates={{}}
    access="member_active"
  />);

  await waitFor(() => expect(admission.commitCandidate).toHaveBeenCalledTimes(2));
  expect(admission.evaluate).toHaveBeenCalledTimes(2);
});

it('混合 Codex/Claude 已加载回合按精确成员 ID 立即保留完整问答', async () => {
  const { state, selfId } = mixedAgentTurns();
  render(<Timeline
    state={state}
    history={{ status: {
      attached: true,
      generation: 1,
      messageCurrent: true,
      headSeq: 4,
      localReplicaReady: true,
      loading: false,
      hasOlder: false,
      presentationRevision: state._timelineRevision,
    } }}
    roster={[
      { id: selfId, kind: 'human', name: '我' },
      { id: 'agent:codex:200', kind: 'agent', name: 'Codex' },
      { id: 'agent:claude:300', kind: 'agent', name: 'Claude' },
    ]}
    selfId={selfId}
    pending={[]}
    approvalStates={{}}
    access="member_active"
  />);

  fireEvent.click(await screen.findByTitle('只看我与 Claude 的往来'));

  const claudeTurn = document.querySelector('[data-presentation-row-id="ask-claude"]');
  expect(claudeTurn?.textContent).toContain('Claude question');
  expect(claudeTurn?.textContent).toContain('Claude answer');
  expect(document.querySelector('[data-presentation-row-id="ask-codex"]')).toBeNull();
  expect(screen.queryByText('正在确认频道内容…')).toBeNull();
  expect(screen.queryByText('正在恢复上次阅读位置…')).toBeNull();
});

it('零行成员投影用当前 viewSpec 请求可见语义供给而不等待虚拟列表 underfill', async () => {
  const { state, selfId } = mixedAgentTurns();
  // Keep a physically non-empty channel while making Claude absent from the
  // installed projection. The virtual list now has no row from which to emit
  // its geometry-driven under-fill callback.
  state.rows.delete(3);
  state.rows.delete(4);
  state.turns.delete('ask-claude');
  state.lastSeq = 2;
  state._timelineProjectionVersion += 1;
  state._timelineRevision += 1;
  const request = vi.fn(() => new Promise(() => {}));
  render(<Timeline
    state={state}
    history={{
      request,
      status: {
        attached: true, generation: 1, messageCurrent: true, headSeq: 400,
        localReplicaReady: true, loading: false, hasOlder: true, completedPages: 1,
        presentationRevision: state._timelineRevision,
      },
    }}
    roster={[
      { id: selfId, kind: 'human', name: '我' },
      { id: 'agent:codex:200', kind: 'agent', name: 'Codex' },
      { id: 'agent:claude:300', kind: 'agent', name: 'Claude' },
    ]}
    selfId={selfId}
    pending={[]}
    approvalStates={{}}
    access="member_active"
  />);

  fireEvent.click(await screen.findByTitle('只看我与 Claude 的往来'));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({
    intent: 'scroll-history',
    urgency: 'interactive',
    reason: 'projection-underfill',
    anchorSeq: 0,
    viewSpec: expect.objectContaining({ scope: 'mine', selfId }),
  }))); 
  const operation = request.mock.calls.find(([value]) => value.reason === 'projection-underfill')?.[0];
  expect([...operation.viewSpec.actorFilter]).toEqual(['agent:claude:300']);
  expect(screen.getByText('正在确认频道内容…')).toBeTruthy();
  expect(screen.queryByText('正在查找符合筛选的往来…')).toBeNull();
  expect(await screen.findByText('正在查找符合筛选的往来…')).toBeTruthy();
  expect(document.querySelector('.timeline-history-demand')).toBeNull();

  fireEvent.click(screen.getByTitle('只看我与 Codex 的往来'));
  await waitFor(() => expect(operation.signal.aborted).toBe(true));
});

it('无 self 身份的全部视图仍会静默补齐被协议事实遮住的语义供给', async () => {
  const state = timelineState([{
    seq: 9,
    envelope: {
      id: 'hidden-session-tail', kind: 'event', type: 'terminal.session', visibility: 'public',
      sender: { id: 'system:channel:1', kind: 'system' }, audience: [], payload: { event: 'closed' },
    },
  }]);
  const request = vi.fn(() => new Promise(() => {}));
  render(<Timeline
    state={state}
    history={{
      request,
      status: {
        attached: true, generation: 4, messageCurrent: true, headSeq: 90,
        localReplicaReady: true, loading: false, hasOlder: true,
        presentationRevision: state._timelineRevision,
      },
    }}
    roster={[]}
    selfId=""
    pending={[]}
    approvalStates={{}}
    access="member_active"
  />);

  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({
    intent: 'scroll-history',
    urgency: 'anticipatory',
    reason: 'projection-underfill',
    viewSpec: expect.objectContaining({ scope: 'all', selfId: '' }),
  })));
  expect(document.querySelector('.timeline-history-demand')).toBeNull();
});

it('断线本地首批无匹配行时继续读取更深 IndexedDB 语义供给', async () => {
  const state = timelineState([{
    seq: 90,
    envelope: {
      id: 'cached-other-tail', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'other', kind: 'human' }, audience: ['other'], payload: { text: 'not mine' },
    },
  }]);
  const request = vi.fn(() => new Promise(() => {}));
  render(<Timeline
    state={state}
    history={{
      request,
      status: {
        attached: false, generation: 0, messageCurrent: false, headSeq: 90,
        localReplicaReady: true, loading: false, hasOlder: true, completedPages: 1,
        presentationRevision: state._timelineRevision,
      },
    }}
    roster={[]}
    selfId="me"
    pending={[]}
    approvalStates={{}}
    access="member_active"
  />);

  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({
    intent: 'scroll-history',
    urgency: 'interactive',
    reason: 'projection-underfill',
    viewSpec: expect.objectContaining({ scope: 'mine', selfId: 'me' }),
  })));
  expect(await screen.findByText('正在查找符合筛选的往来…')).toBeTruthy();
});

it('频道新鲜度失败显示其真实错误并由重试按钮续同一 sync obligation', async () => {
  const state = timelineState([]);
  const request = vi.fn();
  const refreshLatest = vi.fn(async () => true);
  render(<Timeline
    state={state}
    history={{
      request,
      refreshLatest,
      status: {
        attached: true, generation: 8, messageCurrent: false, headSeq: 90,
        localReplicaReady: true, loading: false, hasOlder: true, completedPages: 1,
        presentationRevision: state._timelineRevision,
        sync: {
          interestRevision: 2, fulfilledRevision: 1, targetHead: 90,
          error: '频道新鲜度响应超时', retryAt: Date.now() + 400,
        },
      },
    }}
    roster={[]}
    selfId="me"
    pending={[]}
    approvalStates={{}}
    access="member_active"
  />);

  expect((await screen.findByRole('alert')).textContent).toContain('频道新鲜度响应超时');
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(refreshLatest).toHaveBeenCalledOnce());
  expect(request).not.toHaveBeenCalled();
});

it('Meta 已知但 Replica 零行且 tail 未 current 时由 Scheduler 推进并显示获取反馈', async () => {
  const request = vi.fn(() => new Promise(() => {}));
  render(<Timeline
    state={timelineState([])}
    history={{
      request,
      status: {
        attached: true,
        generation: 1,
        messageCurrent: false,
        headSeq: 1101,
        localReplicaReady: true,
        loading: false,
        hasOlder: true,
        completedPages: 0,
        sourceLease: '1:2:9',
        presentationRevision: 0,
        historyDemand: { revision: 0, phase: 'idle', error: '' },
      },
    }}
    roster={[]}
    selfId="me"
    pending={[]}
    approvalStates={{}}
    access="member_active"
  />);

  expect((await screen.findByRole('status')).textContent).toContain('正在确认频道内容…');
  // messageCurrent=false means the physical initial-tail Scheduler lane is
  // still the sole acquisition owner. Reading must not open a second semantic
  // under-fill operation until that tail has established currentness.
  expect(request).not.toHaveBeenCalled();
});

it('缓存正文保持可读并正交显示 freshness pending、error 与同 owner 重试', async () => {
  const { state, selfId } = mixedAgentTurns();
  const refreshLatest = vi.fn(async () => true);
  const base = {
    state,
    roster: [
      { id: selfId, kind: 'human', name: '我' },
      { id: 'agent:codex:200', kind: 'agent', name: 'Codex' },
      { id: 'agent:claude:300', kind: 'agent', name: 'Claude' },
    ],
    selfId,
    pending: [],
    approvalStates: {},
    access: 'member_active',
  };
  const status = {
    attached: true, generation: 8, messageCurrent: false, headSeq: 4,
    localReplicaReady: true, loading: false, hasOlder: false, completedPages: 1,
    presentationRevision: state._timelineRevision,
    sync: { interestRevision: 2, fulfilledRevision: 1, targetHead: 4, error: '' },
  };
  const view = render(<Timeline {...base} history={{ refreshLatest, status }} />);

  expect(await screen.findByText('Codex question')).toBeTruthy();
  expect(screen.getByText('正在确认频道最新内容…')).toBeTruthy();

  view.rerender(<Timeline {...base} history={{
    refreshLatest,
    status: {
      ...status,
      sync: { ...status.sync, error: '频道新鲜度响应超时' },
    },
  }} />);
  expect(screen.getByText('Codex question')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('频道新鲜度响应超时');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(refreshLatest).toHaveBeenCalledOnce());
  expect(screen.getByText('Codex question')).toBeTruthy();
});

it('零行筛选供给失败后由 scheduler 状态推进恢复并保留前台重试语义', async () => {
  const state = timelineState([{
    seq: 9,
    envelope: {
      id: 'unrelated-tail', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'other', kind: 'human' }, audience: ['other'], payload: { text: 'not mine' },
    },
  }]);
  const request = vi.fn()
    .mockResolvedValueOnce({ kind: 'failed', error: new Error('temporary') })
    .mockImplementationOnce(() => new Promise(() => {}));
  const base = {
    state,
    roster: [],
    selfId: 'me',
    pending: [],
    approvalStates: {},
    access: 'member_active',
  };
  const status = {
    attached: true, generation: 5, messageCurrent: true, headSeq: 90,
    localReplicaReady: true, loading: false, hasOlder: true, completedPages: 1,
    presentationRevision: state._timelineRevision,
  };
  const view = render(<Timeline {...base} history={{ request, status }} />);

  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  view.rerender(<Timeline {...base} history={{
    request,
    status: {
      ...status,
      error: 'temporary',
      historyDemand: { revision: 1, phase: 'error', error: 'temporary' },
    },
  }} />);

  expect((await screen.findByRole('alert')).textContent).toContain('temporary');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls[1][0]).toMatchObject({
    intent: 'scroll-history', urgency: 'interactive', reason: 'retry',
  });
});

it('零行且已扫描过页面时仍展示当前 source 失败并由 Retry 重开 exact block', async () => {
  const state = timelineState([{
    seq: 9,
    envelope: {
      id: 'unrelated-before-source-failure', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'other', kind: 'human' }, audience: ['other'], payload: { text: 'not mine' },
    },
  }]);
  const request = vi.fn(() => new Promise(() => {}));
  render(<Timeline
    state={state}
    roster={[]}
    selfId="me"
    pending={[]}
    approvalStates={{}}
    access="member_active"
    history={{
      request,
      status: {
        attached: true, generation: 5, messageCurrent: false, headSeq: 90,
        localReplicaReady: true, loading: false, loaded: false,
        hasOlder: true, completedPages: 1,
        presentationRevision: state._timelineRevision,
        sourceLease: '1:2:9',
        error: '历史请求回执超时，请重试',
        errorCode: 'history_receipt_timeout',
        historyDemand: { revision: 0, phase: 'idle', error: '' },
      },
    }}
  />);

  expect((await screen.findByRole('alert')).textContent).toContain('历史请求回执超时');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(request.mock.calls[0][0]).toMatchObject({
    reason: 'retry', urgency: 'interactive', explicitRetry: true,
  });
});

it('已缓存正文在前台历史失败时保持可读并显示同一 Retry 入口', async () => {
  const state = timelineState([{
    seq: 9,
    envelope: {
      id: 'cached-visible', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'me', kind: 'human' }, audience: ['me'], payload: { text: 'Cached body stays' },
    },
  }]);
  const request = vi.fn(() => new Promise(() => {}));
  render(<Timeline
    state={state}
    roster={[]}
    selfId="me"
    pending={[]}
    approvalStates={{}}
    access="member_active"
    history={{
      request,
      status: {
        attached: true, generation: 5, messageCurrent: true, headSeq: 90,
        localReplicaReady: true, loading: false, hasOlder: true, completedPages: 1,
        presentationRevision: state._timelineRevision,
        error: 'background source unavailable',
        historyDemand: { revision: 2, phase: 'error', error: 'background source unavailable' },
      },
    }}
  />);

  expect(await screen.findByText('Cached body stays')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('background source unavailable');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(screen.getByText('Cached body stays')).toBeTruthy();
});

it('已缓存正文不被纯后台 source 错误覆盖', async () => {
  const state = timelineState([{
    seq: 9,
    envelope: {
      id: 'cached-visible-background-error', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'me', kind: 'human' }, audience: ['me'], payload: { text: 'Readable cached body' },
    },
  }]);
  render(<Timeline
    state={state}
    roster={[]}
    selfId="me"
    pending={[]}
    approvalStates={{}}
    access="member_active"
    history={{
      request: vi.fn(() => new Promise(() => {})),
      status: {
        attached: true, generation: 5, messageCurrent: true, headSeq: 90,
        localReplicaReady: true, loading: false, hasOlder: true, completedPages: 1,
        presentationRevision: state._timelineRevision,
        error: 'background source unavailable',
        historyDemand: { revision: 2, phase: 'idle', error: '' },
      },
    }}
  />);

  expect(await screen.findByText('Readable cached body')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
});

it('opaque actor ID 与系统事实尾下，名册迟到后显示唯一 agent chip 且保留同 principal 旧回合', async () => {
  const { state, claude } = incarnationAndSystemHeavyState();
  const currentSelf = 'human:root:1900000000000';
  const history = { status: {
    attached: true,
    generation: 7,
    messageCurrent: true,
    headSeq: 26,
    localReplicaReady: true,
    loading: false,
    hasOlder: false,
    presentationRevision: state._timelineRevision,
  } };
  const base = {
    state,
    history,
    selfId: currentSelf,
    pending: [],
    approvalStates: {},
    access: 'member_active',
  };
  const view = render(<Timeline
    {...base}
    roster={[{ id: currentSelf, kind: 'human', name: '我', principal: 'root' }]}
  />);

  expect(await screen.findByText('跨 incarnation 的 Claude 问题')).toBeTruthy();
  expect(screen.getByText('跨 incarnation 的 Claude 回答')).toBeTruthy();

  view.rerender(<Timeline
    {...base}
    roster={[
      { id: currentSelf, kind: 'human', name: '我', principal: 'root' },
      { id: claude, kind: 'agent', name: 'Claude' },
    ]}
  />);

  const chip = await screen.findByTitle('只看我与 Claude 的往来');
  expect(chip.getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('group', { name: '动态范围' }).textContent).not.toContain('0');
  fireEvent.click(chip);
  expect(document.querySelector('[data-presentation-row-id="opaque-ask-claude"]')?.textContent)
    .toContain('跨 incarnation 的 Claude 回答');
  expect(screen.queryByText('正在确认频道内容…')).toBeNull();
});

it('成员过滤按钮收窄呈现条目', async () => {
  const standalone = ['agent-a', 'agent-b'].map((agentId, index) => ({
    seq: index + 1,
    envelope: {
      id: `from-${agentId}`,
      kind: 'event',
      type: 'human.note',
      visibility: 'public',
      sender: { id: agentId, kind: 'agent' },
      audience: ['me'],
      payload: { text: `来自 ${agentId}` },
    },
  }));
  const state = timelineState(standalone);
  render(<Timeline state={state} history={{ attached: true, hasOlder: false }} roster={[{ id: 'agent-a', kind: 'agent' }, { id: 'agent-b', kind: 'agent' }]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);

  fireEvent.click(await screen.findByTitle('只看我与 agent-a 的往来'));
  expect(screen.getByTitle('取消只看 agent-a').getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('来自 agent-a')).toBeTruthy();
  expect(screen.queryByText('来自 agent-b')).toBeNull();
});

it('旧incarnation的持久筛选始终可见可移除，不装作未过滤空态', async () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
  };
  const viewSessions = createViewSessionStore({ principalID: 'root-stale-filter', storage });
  viewSessions.writeConversation('c0', {
    scope: 'mine',
    actorFilter: ['agent:codex:old'],
  });
  const state = timelineState([{
    seq: 1,
    envelope: {
      id: 'new-incarnation-message', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'agent:codex:new', kind: 'agent' }, audience: ['me'],
      payload: { text: '新 incarnation 的真实动态' },
    },
  }]);
  render(<Timeline
    state={state}
    history={{ attached: true, hasOlder: false }}
    roster={[{ id: 'human:root:1', kind: 'human', name: '我' }, { id: 'agent:codex:new', kind: 'agent', name: 'Codex' }]}
    selfId="me"
    viewSessions={viewSessions}
    pending={[]}
    approvalStates={{}}
    access="member_active"
  />);

  expect(screen.queryByText('新 incarnation 的真实动态')).toBeNull();
  expect(screen.getByText('当前应用了已失效的成员筛选。')).toBeTruthy();
  const stale = screen.getByRole('button', { name: '移除已失效成员筛选 agent:codex:old' });
  expect(stale.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(stale);
  expect(await screen.findByText('新 incarnation 的真实动态')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /agent:codex:old/ })).toBeNull();
});

it('只有已完成同步的已知空频道才显示空账邀请', async () => {
  const state = timelineState();
  const base = { state, roster: [], selfId: 'me', pending: [], approvalStates: {}, access: 'member_active' };
  const loadOlder = vi.fn(async () => ({ kind: 'failed' }));
  const view = render(<Timeline {...base} history={{ status: { attached: false, generation: 0, messageCurrent: false, headSeq: 0, localReplicaReady: false, loading: true }, loadOlder }} />);

  expect(await screen.findByText('正在确认频道内容…')).toBeTruthy();
  expect(screen.queryByText('这本账还没有可见条目')).toBeNull();

  view.rerender(<Timeline {...base} history={{ status: { attached: true, generation: 1, messageCurrent: false, headSeq: 0, localReplicaReady: true, loading: false, error: '读取失败' }, loadOlder }} />);
  expect((await screen.findByRole('alert')).textContent).toContain('读取失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(loadOlder).toHaveBeenCalledWith(expect.objectContaining({
    intent: 'scroll-history', reason: 'retry', urgency: 'interactive',
  }));
  expect(screen.queryByText('这本账还没有可见条目')).toBeNull();
  expect(screen.queryByText('正在确认频道内容…')).toBeNull();

  view.rerender(<Timeline {...base} history={{ status: { attached: true, generation: 1, messageCurrent: true, headSeq: 0, localReplicaReady: true, loading: false, error: '' }, loadOlder }} />);
  expect(await screen.findByText('这本账还没有可见条目')).toBeTruthy();
  expect(screen.queryByText('正在确认频道内容…')).toBeNull();
});

it('重连的零头占位在前台probe完成前不是权威空频道', async () => {
  const state = timelineState();
  const base = { state, roster: [], selfId: 'me', pending: [], approvalStates: {}, access: 'member_active' };
  const view = render(<Timeline {...base} history={{ status: {
    attached: true, generation: 2, messageCurrent: true, headSeq: 0,
    localReplicaReady: true, loading: false,
    sync: { interestRevision: 1, fulfilledRevision: 0, targetHead: 0 },
  } }} />);

  expect(await screen.findByText('正在确认频道内容…')).toBeTruthy();
  expect(screen.queryByText('这本账还没有可见条目')).toBeNull();

  view.rerender(<Timeline {...base} history={{ status: {
    attached: true, generation: 2, messageCurrent: false, headSeq: 0,
    localReplicaReady: true, loading: false,
    sync: { interestRevision: 1, fulfilledRevision: 0, targetHead: 9 },
  } }} />);
  expect(screen.getByText('正在确认频道内容…')).toBeTruthy();
  expect(screen.queryByText('这本账还没有可见条目')).toBeNull();

  view.rerender(<Timeline {...base} history={{ status: {
    attached: true, generation: 2, messageCurrent: true, headSeq: 0,
    localReplicaReady: true, loading: false,
    sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 0 },
  } }} />);
  expect(await screen.findByText('这本账还没有可见条目')).toBeTruthy();
  expect(screen.queryByText('正在确认频道内容…')).toBeNull();
});

it('过滤后的首个物理批次显示稳定查找说明并保持同一前台供给', async () => {
  const state = timelineState([{
    seq: 9,
    envelope: {
      id: 'unrelated-first-page', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'other', kind: 'human' }, audience: ['other'],
      payload: { text: '首批仅有不相关事实' },
    },
  }]);
  const base = {
    state,
    roster: [{ id: 'agent-a', kind: 'agent' }],
    selfId: 'me',
    pending: [],
    approvalStates: {},
    access: 'member_active',
  };
  const view = render(<Timeline {...base} history={{ status: {
    attached: true, generation: 2, messageCurrent: true, headSeq: 9,
    localReplicaReady: true, loading: false, hasOlder: true, completedPages: 0,
    sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 9 },
  } }} />);

  expect(await screen.findByText('正在确认频道内容…')).toBeTruthy();
  expect(screen.queryByText('正在查找符合筛选的往来…')).toBeNull();
  expect(screen.queryByText('这个频道里还没有与你相关的往来')).toBeNull();

  view.rerender(<Timeline {...base} history={{ status: {
    attached: true, generation: 2, messageCurrent: true, headSeq: 9,
    localReplicaReady: true, loading: false, hasOlder: true, completedPages: 1,
    sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 9 },
  } }} />);
  // Raw-head currentness and one physical page do not make an empty semantic
  // projection ready. The bounded activation feedback remains stable while
  // its existing runway is still finding the first matching row.
  expect(screen.getByText('正在确认频道内容…')).toBeTruthy();
  expect(screen.queryByText('正在查找符合筛选的往来…')).toBeNull();
  expect(await screen.findByText('正在查找符合筛选的往来…')).toBeTruthy();
  expect(screen.queryByText('正在确认频道内容…')).toBeNull();

  view.rerender(<Timeline {...base} history={{ status: {
    attached: true, generation: 2, messageCurrent: true, headSeq: 9,
    localReplicaReady: true, loading: false, hasOlder: false, completedPages: 1,
    sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 9 },
  } }} />);
  expect(await screen.findByText('这个频道里还没有与你相关的往来')).toBeTruthy();
  expect(screen.queryByText('正在查找符合筛选的往来…')).toBeNull();
  expect(screen.queryByText('正在确认频道内容…')).toBeNull();
});

it('身份迟到前临时显示全部但保留 Mine 偏好，身份到达后原地恢复 Mine', async () => {
  const standalone = [
    { seq: 1, envelope: { id: 'mine', kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'me', kind: 'human' }, payload: { text: '我的动态' } } },
    { seq: 2, envelope: { id: 'other', kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'other', kind: 'human' }, payload: { text: '其他动态' } } },
  ];
  const state = timelineState(standalone);
  const viewSessions = createViewSessionStore();
  viewSessions.writeConversation('c0', { scope: 'mine' });
  const base = { state, history: { attached: true, hasOlder: false }, viewSessions, roster: [], pending: [], approvalStates: {}, access: 'member_active' };
  const view = render(<Timeline {...base} selfId="" />);

  expect(await screen.findByText('正在确认你的频道身份，当前显示全部动态。')).toBeTruthy();
  expect(screen.getByText('我的动态')).toBeTruthy();
  expect(screen.getByText('其他动态')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '@我' })).toBeNull();
  await waitFor(() => expect(viewSessions.read('c0').scope).toBe('mine'));
  const listBeforeIdentity = view.container.querySelector('.timeline-message-list');

  view.rerender(<Timeline {...base} selfId="me" />);
  const scopeButton = await screen.findByRole('button', { name: '@我' });
  expect(view.container.querySelector('.timeline-message-list')).toBe(listBeforeIdentity);
  expect(screen.queryByText('正在确认你的频道身份，当前显示全部动态。')).toBeNull();
  expect(screen.getByText('我的动态')).toBeTruthy();
  expect(screen.queryByText('其他动态')).toBeNull();
  expect(viewSessions.read('c0').scope).toBe('mine');

  fireEvent.click(scopeButton);
  expect(await screen.findByRole('button', { name: '全部' })).toBeTruthy();
  expect(screen.getByText('其他动态')).toBeTruthy();
  await waitFor(() => expect(viewSessions.read('c0').scope).toBe('all'));
});

it('身份迟到不覆盖用户明确保存的 All 偏好', async () => {
  const standalone = [
    { seq: 1, envelope: { id: 'mine-all', kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'me', kind: 'human' }, payload: { text: '我的 All 动态' } } },
    { seq: 2, envelope: { id: 'other-all', kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'other', kind: 'human' }, payload: { text: '其他 All 动态' } } },
  ];
  const viewSessions = createViewSessionStore();
  viewSessions.writeConversation('c0', { scope: 'all' });
  const base = {
    state: timelineState(standalone), history: { attached: true, hasOlder: false }, viewSessions,
    roster: [], pending: [], approvalStates: {}, access: 'member_active',
  };
  const view = render(<Timeline {...base} selfId="" />);
  expect(await screen.findByText('其他 All 动态')).toBeTruthy();

  view.rerender(<Timeline {...base} selfId="me" />);
  expect(await screen.findByRole('button', { name: '全部' })).toBeTruthy();
  expect(screen.getByText('其他 All 动态')).toBeTruthy();
  expect(viewSessions.read('c0').scope).toBe('all');
});
