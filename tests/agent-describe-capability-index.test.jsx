// @vitest-environment jsdom
// 恢复对应：tests/capabilities.test.js（master，已删除）里的 describe('actor capabilities')
// 部分。旧结构 src/model/capabilities.js（normalizeDescribe/capabilityIndexFromState/
// supportsType/capabilityRisk）已整体删除；同一条"从账本 actor.describe 回合投影出
// Describe 归一化结构，并按 requestId 精确查找、不扫全部 turn"的行为现在内联在
// src/app/hooks/useAgentProbes.js 里的 describeOf/capabilityIndex/turnIndex（均未导出），
// 经 useAgentProbes(...).capabilitiesFor(channelId) 暴露。用 RC 在
// tests/app-agent-probe-lifecycle.test.jsx 里已经建立的 probeHarness 夹具驱动真实
// renderHook，而不是重新导出内部函数。
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAgentProbes } from '../src/app/hooks/useAgentProbes.js';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { TYPES } from '../src/protocol/vocab.js';

function probeHarness(overrides = {}) {
  return {
    activeChannelId: 'c0',
    activeChannelRef: { current: 'c0' },
    accessRef: { current: { state: () => ({ relationship: 'member', unavailable: false }) } },
    stateFor: () => ({ rows: new Map(), timeline: [] }),
    feedVersion: 0,
    handleSend: vi.fn().mockResolvedValue('req-1'),
    pending: [],
    rosterRef: { current: { self: () => 'me' } },
    rosters: new Map([['c0', [{ id: 'agent', kind: 'agent', name: 'Agent' }]]]),
    wireState: 'open',
    ...overrides,
  };
}

function describeRequest(id, type = '') {
  return {
    id, channel_id: 'c0', kind: 'request', type: TYPES.describe,
    sender: { id: 'human:root:1', kind: 'human' }, audience: ['agent'], ts: 100,
    payload: { body: type ? { type } : {} },
  };
}

function describeTerminal(id, parentId, words) {
  return {
    id, channel_id: 'c0', kind: 'response', type: TYPES.describe, parent_id: parentId,
    sender: { id: 'agent', kind: 'agent' }, audience: ['human:root:1'], ts: 200,
    payload: { body: { status: 'completed', class: 'codex', interfaces: ['actor', 'agent'], capabilities: { steer: true }, words } },
  };
}

describe('actor capabilities（恢复自 tests/capabilities.test.js）', () => {
  it('routes Agent options/context probes through control owner while Describe stays on send', async () => {
    const store = createChannelReplicaStore();
    store.commit({ channel_id: 'c0', seq: 1, envelope: describeRequest('d1') });
    const stateFor = () => store.state('c0');
    const handleSend = vi.fn().mockResolvedValue('d1');
    const handleControl = vi.fn((request) => `${request.msgType}-1`);
    const { result } = renderHook((props) => useAgentProbes(props), {
      initialProps: probeHarness({ handleSend, handleControl, stateFor }),
    });

    await act(async () => { await result.current.requestCapability('agent', 'c0'); });
    store.commit({
      channel_id: 'c0', seq: 2,
      envelope: describeTerminal('d1-done', 'd1', {
        [TYPES.agentOptions]: {},
        [TYPES.agentContext]: {},
      }),
    });
    await waitFor(() => expect(result.current.capabilitiesFor('c0').get('agent')?.describe).toBeTruthy());

    act(() => {
      result.current.pickAgent('agent');
      result.current.targetChanged('agent');
    });
    await waitFor(() => expect(handleControl).toHaveBeenCalledTimes(2));

    expect(handleSend).toHaveBeenCalledTimes(1);
    expect(handleSend).toHaveBeenCalledWith(expect.objectContaining({ msgType: TYPES.describe }));
    expect(handleControl.mock.calls.map(([request]) => request.msgType)).toEqual([
      TYPES.agentOptions,
      TYPES.agentContext,
    ]);
    for (const [request] of handleControl.mock.calls) {
      expect(request).toMatchObject({
        channelId: 'c0',
        audience: ['agent'],
        payload: {},
      });
    }
  });

  it('[AD-138] 从账本 actor.describe 回合归一化出 Describe 结构（class/interfaces/capabilities/words）', async () => {
    // 用户能力：打开 Agent 详情时能看到 class、接口、能力和公开命令。
    // 不变量：Describe 只从本连接 request 的公开 terminal 投影，不能猜测旧账本。
    // 公共 owner：useAgentProbes().requestCapability/capabilitiesFor。
    const store = createChannelReplicaStore();
    store.commit({ channel_id: 'c0', seq: 1, envelope: describeRequest('d1') });
    const stateFor = () => store.state('c0');
    const handleSend = vi.fn().mockResolvedValue('d1');
    const { result } = renderHook((props) => useAgentProbes(props), {
      initialProps: probeHarness({ handleSend, stateFor }),
    });

    let response;
    await act(async () => { response = await result.current.requestCapability('agent', 'c0'); });
    expect(response.requested).toBe(true);
    expect(response.requestId).toBe('d1');

    store.commit({
      channel_id: 'c0', seq: 2,
      envelope: describeTerminal('d1-done', 'd1', { run: { description: '跑一次', input_schema: { type: 'object', properties: { text: { type: 'string' } } } } }),
    });

    await waitFor(() => {
      const entry = result.current.capabilitiesFor('c0').get('agent');
      expect(entry?.describe).toBeTruthy();
    });
    const entry = result.current.capabilitiesFor('c0').get('agent');
    expect(entry.describe.className).toBe('codex');
    expect(entry.describe.interfaces).toEqual(['actor', 'agent']);
    expect(entry.describe.capabilities.steer).toBe(true);
    expect(entry.describe.types.get('run')).toMatchObject({ description: '跑一次' });
    expect(entry.loading).toBe(false);
  });

  it('[AD-139] 合并同一连接的完整与单词 Describe 结果', async () => {
    // 用户能力：全量能力返回后，补充单词 Describe 不会抹掉既有命令。
    // 不变量：同一 public owner 按 request id 合并，只保留公开能力事实。
    // 公共 owner：useAgentProbes().requestCapability/capabilitiesFor。
    const store = createChannelReplicaStore();
    store.commit({ channel_id: 'c0', seq: 1, envelope: describeRequest('d1') });
    const stateFor = () => store.state('c0');
    const handleSend = vi.fn()
      .mockResolvedValueOnce('d1')
      .mockResolvedValueOnce('d2');
    const { result } = renderHook((props) => useAgentProbes(props), {
      initialProps: probeHarness({ handleSend, stateFor }),
    });

    await act(async () => { await result.current.requestCapability('agent', 'c0'); });
    store.commit({
      channel_id: 'c0', seq: 2,
      envelope: describeTerminal('d1-done', 'd1', { 'agent.ask': {} }),
    });
    await waitFor(() => expect(result.current.capabilitiesFor('c0').get('agent')?.describe).toBeTruthy());

    // requestCapability 是公开的刷新入口；pickAgent 是用户动作，会清理本 actor
    // 的自动探测槽，但不会绕过 ledger request/terminal 关联。
    act(() => { result.current.pickAgent('agent'); });
    await act(async () => {
      const response = await result.current.requestCapability('agent', 'c0');
      expect(response).toMatchObject({ requested: true, requestId: 'd2' });
    });
    store.commit({ channel_id: 'c0', seq: 3, envelope: describeRequest('d2', 'agent.ask') });
    store.commit({
      channel_id: 'c0', seq: 4,
      envelope: describeTerminal('d2-done', 'd2', { 'agent.steer': {} }),
    });

    await waitFor(() => {
      const entry = result.current.capabilitiesFor('c0').get('agent');
      expect([...entry.describe.types.keys()]).toEqual(['agent.ask', 'agent.steer']);
    });
    expect(result.current.capabilitiesFor('c0').get('agent').loading).toBe(false);
  });

  it('[AD-140] 有本连接 request id 时直接查对应 turn，不扫描频道全部 turn（timeline 里混入无关 turn 也不受影响）', async () => {
    // 用户能力：当前连接的能力面板只显示当前 request 的结果。
    // 不变量：request id 是公开 ledger 关联边界，不能因频道里有无关 turn 而串值。
    // 公共 owner：useAgentProbes().requestCapability/capabilitiesFor。
    const store = createChannelReplicaStore();
    // 混入一条毫不相干的 turn：如果实现退化成"扫全部 turn"，这条不该干扰结果，
    // 但也不该被误当成 describe 的 requestId 命中。
    store.commit({ channel_id: 'c0', seq: 1, envelope: describeRequest('unrelated-1') });
    store.commit({ channel_id: 'c0', seq: 2, envelope: describeRequest('d1') });
    const stateFor = () => store.state('c0');
    const handleSend = vi.fn().mockResolvedValue('d1');
    const { result } = renderHook((props) => useAgentProbes(props), {
      initialProps: probeHarness({ handleSend, stateFor }),
    });
    await act(async () => { await result.current.requestCapability('agent', 'c0'); });
    store.commit({ channel_id: 'c0', seq: 3, envelope: describeTerminal('d1-done', 'd1', { 'agent.ask': {} }) });

    await waitFor(() => expect(result.current.capabilitiesFor('c0').get('agent')?.describe).toBeTruthy());
    expect([...result.current.capabilitiesFor('c0').get('agent').describe.types.keys()]).toEqual(['agent.ask']);
  });

  it('[AD-141] compact closure 只表示 describe 已关闭，不把它讲成一个具体的 invalid_describe 结构错误', async () => {
    // 用户能力：能力详情缺少终态正文时得到可操作的“不可用”反馈。
    // 不变量：compact closure 不是 invalid_describe，也不能伪造能力结构。
    // 公共 owner：useAgentProbes().capabilitiesFor。
    const store = createChannelReplicaStore();
    store.commit({ channel_id: 'c0', seq: 1, envelope: describeRequest('d1') });
    const stateFor = () => store.state('c0');
    const handleSend = vi.fn().mockResolvedValue('d1');
    const { result } = renderHook((props) => useAgentProbes(props), {
      initialProps: probeHarness({ handleSend, stateFor }),
    });
    await act(async () => { await result.current.requestCapability('agent', 'c0'); });
    store.commit({ channel_id: 'c0', seq: 2, envelope: describeTerminal('d1-done', 'd1', { 'agent.ask': {} }) });
    await waitFor(() => expect(store.state('c0').timeline[0]?.turn?.terminal).toBeTruthy());
    // compact closure：终态信封还在，但内容已经不可读——不是"描述结构解析失败"。
    store.state('c0').timeline[0].turn.terminalClosureOnly = true;

    await waitFor(() => expect(result.current.capabilitiesFor('c0').get('agent')?.error).toBeTruthy());
    const entry = result.current.capabilitiesFor('c0').get('agent');
    expect(entry.describe).toBeNull();
    // 断言 detail 而不是断言旧的 code 字面量：新实现把 code 收窄成通用的
    // describe_failed，但 detail 沿用同一个 TERMINAL_RESULT_UNAVAILABLE 常量，
    // 用户看到的文案没有被"伪造"成结构解析失败。
    expect(entry.error.detail).toBe('终态详情不可用，请刷新或重新进入频道');
    expect(entry.error.code).not.toBe('invalid_describe');
  });
});
