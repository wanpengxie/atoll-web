// 恢复对应：tests/agent-activity.test.js（master，已删除）。
// 旧结构 createAgentActivityTracker（src/model/agent-activity.js，独立模块）已被吸收进
// src/model/channel-feed-runtime.js 内部状态机（observeAgentActivity/attachAgentActivity/
// disconnectAgentActivity/acknowledgeAgentActivity + agentActivitySnapshot），经
// runtime.getSnapshot().agentActivity / setHistoryGrants / disconnectHistory 暴露。
// 注意：owner().enqueue() 的返回值只表示"信封是否被 Replica 接受"，不表示"是否生成了 Agent
// 活动"——这与旧 tracker.observe() 的返回值语义不同，本文件断言一律看 agentActivity 快照本身。
// 旧 agentActivityDuration() 格式化函数的等效实现是 src/app/WorkspaceLayout.jsx 内部未导出的
// activityDuration()，见 tests/workspace-layout-agent-timer.test.jsx（真实渲染覆盖）。
import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { TYPES } from '../src/protocol/vocab.js';

function runtimeOptions() {
  return {
    wireRef: { current: null },
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onRoster: vi.fn(), onError: vi.fn(), onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(), onTimerFired: vi.fn(),
    onSubmissionFeed: vi.fn(), onAccessChanged: vi.fn(), onAgentActivity: vi.fn(),
  };
}

function setup() {
  const options = runtimeOptions();
  const ownerToken = Object.freeze({ principalId: 'root' });
  const runtime = createChannelFeedRuntime(options);
  runtime.bind({ ...options, ownerToken });
  return { runtime, owner: () => runtime.getOwnerSnapshot(ownerToken) };
}

function processingRow({ seq, generation = 1, channelId = 'c0', requestId = 'req-1', agentId = 'agent:codex:1', ts, source = 'live' }) {
  const at = ts ?? seq;
  return {
    source, generation, channel_id: channelId, seq,
    envelope: {
      id: `${requestId}-processing-${seq}`, channel_id: channelId, kind: 'response', type: TYPES.agentAsk,
      parent_id: requestId, sender: { id: agentId, kind: 'agent' }, ts: at,
      payload: { body: { status: 'processing', process: { kind: 'turn', phase: 'started' } } },
    },
  };
}

function terminalRow({ seq, generation = 1, channelId = 'c0', requestId = 'req-1', agentId = 'agent:codex:1', ts, status = 'completed', source = 'live' }) {
  const at = ts ?? seq;
  return {
    source, generation, channel_id: channelId, seq,
    envelope: {
      id: `${requestId}-${status}-${seq}`, channel_id: channelId, kind: 'response', type: TYPES.agentAsk,
      parent_id: requestId, sender: { id: agentId, kind: 'agent' }, ts: at,
      payload: { body: { status } },
    },
  };
}

describe('connection-scoped Agent activity（ChannelFeedRuntime）', () => {
  it('只由当前连接代次的 live 处理生成，终态时收敛', async () => {
    const { runtime, owner } = setup();
    await runtime.getSnapshot().setHistoryGrants([], { generation: 1, boot: 'boot-a' });

    owner().enqueue(processingRow({ seq: 1, source: 'history' }));
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});
    owner().enqueue(processingRow({ seq: 2, generation: 0 }));
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});

    owner().enqueue(processingRow({ seq: 3, ts: 1_000 }));
    expect(runtime.getSnapshot().agentActivity.byChannel.c0.active).toEqual([
      expect.objectContaining({ requestId: 'req-1', agentId: 'agent:codex:1', startedAt: 1_000 }),
    ]);

    owner().enqueue(terminalRow({ seq: 4, ts: 4_000 }));
    const settled = runtime.getSnapshot().agentActivity.byChannel.c0;
    expect(settled.active).toEqual([]);
    expect(settled.agents['agent:codex:1']).toEqual({ active: 0, settled: 1, state: 'settled' });
    expect(runtime.getSnapshot().acknowledgeAgentActivity('c0', 'agent:codex:1')).toBe(true);
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});
    runtime.destroy();
  });

  it('重连后旧代次的工作被隐藏，直到 live 进度确认', async () => {
    const { runtime, owner } = setup();
    await runtime.getSnapshot().setHistoryGrants([], { generation: 1, boot: 'boot-a' });
    owner().enqueue(processingRow({ seq: 1, generation: 1, ts: 1_000 }));
    runtime.getSnapshot().disconnectHistory();
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});

    await runtime.getSnapshot().setHistoryGrants([], { generation: 2, boot: 'boot-a' });
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});
    // 历史里的过程态不是活性证据。
    owner().enqueue(processingRow({ seq: 2, generation: 2, ts: 2_000, source: 'history' }));
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});
    owner().enqueue(processingRow({ seq: 3, generation: 2, ts: 3_000 }));
    expect(runtime.getSnapshot().agentActivity.byChannel.c0.active).toHaveLength(1);
    runtime.destroy();
  });

  it('[AD-011] 历史可以收敛保留的工作但恒不复活，boot 变化时清空', async () => {
    const { runtime, owner } = setup();
    await runtime.getSnapshot().setHistoryGrants([], { generation: 1, boot: 'boot-a' });
    owner().enqueue(processingRow({ seq: 1, generation: 1, ts: 1_000 }));
    runtime.getSnapshot().disconnectHistory();
    await runtime.getSnapshot().setHistoryGrants([], { generation: 2, boot: 'boot-a' });
    owner().enqueue(terminalRow({ seq: 2, generation: 2, status: 'failed', ts: 2_000, source: 'history' }));
    // 用户能力：同 boot 重连后，历史 terminal 可以结算断线前保留的工作；
    // 不变量：boot 改变会清空它，history-only processing 不能重新制造活性。
    // 公开 owner：只通过 ChannelFeedRuntime 的 agentActivity 快照观察结果。
    const settled = runtime.getSnapshot().agentActivity.byChannel.c0;
    expect(settled).toBeDefined();
    expect(settled.agents['agent:codex:1'].state).toBe('settled');

    await runtime.getSnapshot().setHistoryGrants([], { generation: 3, boot: 'boot-b' });
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});
    owner().enqueue(processingRow({ seq: 3, generation: 3, ts: 3_000, source: 'history' }));
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});
    runtime.destroy();
  });

  it('同 boot 重连保留 exact live work，允许 history terminal settle，不允许 history-only revive', async () => {
    const { runtime, owner } = setup();
    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 1 }], {
      generation: 1, boot: 'boot-a', focus: 'c0',
    });
    owner().enqueue(processingRow({ seq: 1, generation: 1, ts: 1_000 }));
    runtime.getSnapshot().disconnectHistory(1);
    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 2 }], {
      generation: 2, boot: 'boot-a', focus: 'c0',
    });
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});

    owner().enqueue(terminalRow({ seq: 2, generation: 2, status: 'failed', ts: 2_000, source: 'history' }));
    expect(runtime.getSnapshot().agentActivity.byChannel.c0.agents['agent:codex:1'])
      .toEqual({ active: 0, settled: 1, state: 'settled' });

    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 3 }], {
      generation: 3, boot: 'boot-b', focus: 'c0',
    });
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});
    owner().enqueue(processingRow({ seq: 3, generation: 3, ts: 3_000, source: 'history' }));
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});
    runtime.destroy();
  });

  it('忽略连接管理类信封（非 ACTIVITY_TYPES）', async () => {
    const { runtime, owner } = setup();
    await runtime.getSnapshot().setHistoryGrants([], { generation: 1, boot: 'boot-a' });
    owner().enqueue({
      source: 'live', generation: 1, channel_id: 'c0', seq: 1,
      envelope: {
        id: 'housekeeping-1', channel_id: 'c0', kind: 'response', type: TYPES.agentContext,
        parent_id: 'req-1', sender: { id: 'agent:codex:1', kind: 'agent' }, ts: 1_000,
        payload: { body: { status: 'processing', process: { kind: 'turn' } } },
      },
    });
    expect(runtime.getSnapshot().agentActivity.byChannel).toEqual({});
    runtime.destroy();
  });

  it('同一 Agent 的重复进度只推进 revision，不改变可见的 active 身份；收敛才结算', async () => {
    const { runtime, owner } = setup();
    await runtime.getSnapshot().setHistoryGrants([], { generation: 1, boot: 'boot-a' });
    owner().enqueue(processingRow({ seq: 1, ts: 1_000 }));
    const firstActive = runtime.getSnapshot().agentActivity.byChannel.c0.active[0];
    expect(firstActive).toMatchObject({ requestId: 'req-1', agentId: 'agent:codex:1', startedAt: 1_000 });

    owner().enqueue(processingRow({ seq: 2, ts: 2_000 }));
    const stillOneAgent = runtime.getSnapshot().agentActivity.byChannel.c0;
    expect(stillOneAgent.active).toHaveLength(1);
    expect(stillOneAgent.agents['agent:codex:1']).toEqual({ active: 1, settled: 0, state: 'active' });

    owner().enqueue(terminalRow({ seq: 3, ts: 3_000 }));
    expect(runtime.getSnapshot().agentActivity.byChannel.c0.agents['agent:codex:1'].state).toBe('settled');
    runtime.destroy();
  });
});
