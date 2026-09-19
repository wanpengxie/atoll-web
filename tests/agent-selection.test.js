// @vitest-environment jsdom
// 恢复自 master:tests/agent-selection.test.js（RC，2026-09-19）。
// 旧测试全部依赖已删除的 src/model/agent-selection.js（resolveParameterAgent /
// latestInteractedAgentId / latestAgentUsage / latestAgentOptions /
// normalizeAgentOptions / agentSelectionView / contextUsageView）。
// 新结构里这些职责拆到两处：
//   - "@ 优先于手选/唯一 agent" 的收件人判据链 → src/ui/composer/composer-model.js
//     的 resolveComposerDelivery + buildComposerModel
//   - 手选/最近交互的默认目标状态 → src/app/hooks/useAgentProbes.js 的 composerAgent
//     （由 pickAgent/targetChanged 驱动；latestAgentInteraction 是内部私有函数，
//     只用于"手选追平最近交互后自动清除覆盖"的自愈，不导出）
//   - agent.options / agent.context 协议投影 → src/ui/composer/agent-parameters.js
// 判定逐条记在 audit-output/RESTORE-MATRIX.md。
import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildComposerModel, resolveComposerDelivery } from '../src/ui/composer/composer-model.js';
import { projectAgentParameters } from '../src/ui/composer/agent-parameters.js';
import { useAgentProbes } from '../src/app/hooks/useAgentProbes.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const STEWARD = { id: 'steward', kind: 'agent', name: 'Steward' };
const CLAUDE = { id: 'claude', kind: 'agent', name: 'Claude' };
const ME = { id: 'me', kind: 'human', name: '我' };
const PEER = { id: 'peer', kind: 'human', name: '同事' };
const ROSTER = [ME, PEER, STEWARD, CLAUDE];

function completedTurn({ requestId, actorId, type, value }) {
  return {
    requestId,
    request: { id: requestId, type, audience: [actorId] },
    terminal: { kind: 'response', type, parent_id: requestId, sender: { id: actorId }, payload: { body: { status: 'completed', value } } },
  };
}
function timelineState(turns) {
  return { timeline: turns.map((turn) => ({ kind: 'turn', turn })) };
}

describe('参数面板目标判据链（composer-model 承接）', () => {
  it('@ 恰一个 agent 优先于一切', () => {
    const model = buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [CLAUDE] }, roster: ROSTER, access: 'member_active', agentSelection: { selectedAgentId: 'steward' } });
    expect(model.targetAgent).toMatchObject({ id: 'claude' });
    expect(model.delivery).toMatchObject({ kind: 'direct', source: 'mention' });
  });

  it('@ 多个 agent 是多目标态', () => {
    const model = buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [STEWARD, CLAUDE] }, roster: ROSTER, access: 'member_active' });
    expect(model.targetAgent).toBeNull();
    expect(model.delivery.rows.filter((row) => row.kind === 'agent')).toHaveLength(2);
  });

  it('只 @ 人类时收起（不显示最近 agent 误导）', () => {
    const model = buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [PEER] }, roster: ROSTER, access: 'member_active', agentSelection: { selectedAgentId: 'steward' } });
    expect(model.targetAgent).toBeNull();
    expect(model.delivery).toMatchObject({ kind: 'direct', source: 'mention', rows: [expect.objectContaining({ id: 'peer' })] });
  });

  it('多 agent 且无任何判据时为 none（前端拦截手选）', () => {
    const model = buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active' });
    expect(model.targetAgent).toBeNull();
    expect(model.delivery.kind).toBe('none');
  });

  it('唯一 agent 频道恒有目标', () => {
    const model = buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: [ME, STEWARD], access: 'member_active' });
    expect(model.targetAgent).toMatchObject({ id: 'steward' });
  });
});

function stateForOf(rowsByChannel) {
  return (channelId) => rowsByChannel[channelId] || null;
}
function probeHarness(overrides = {}) {
  return {
    activeChannelId: 'dev',
    activeChannelRef: { current: 'dev' },
    accessRef: { current: { state: () => ({ relationship: 'member', unavailable: false }) } },
    stateFor: () => ({ rows: new Map(), timeline: [] }),
    feedVersion: 0,
    handleSend: vi.fn().mockResolvedValue('req-1'),
    pending: [],
    rosterRef: { current: { self: () => 'me' } },
    rosters: new Map([['dev', [STEWARD, CLAUDE]]]),
    wireState: 'connecting', // 避开探测副作用，只观察 composerAgent 状态本身
    ...overrides,
  };
}

describe('Composer 默认目标状态（useAgentProbes.composerAgent，承接旧 resolveParameterAgent 的手选/最近交互两支）', () => {
  it('无 @ 时手选压最近交互：显式 selectAgent 命令（pickAgent+targetChanged）决定目标，且不依赖最近互动史', () => {
    // 频道里我刚跟 claude 说过话（最近交互 = claude），但用户显式选择了 steward；
    // 手选必须生效，不能被"最近互动"悄悄纠偏回 claude。
    const askRow = { kind: 'request', type: 'agent.ask', sender: { id: 'me' }, audience: ['claude'] };
    const { result } = renderHook(() => useAgentProbes(probeHarness({
      stateFor: () => ({ rows: new Map([[1, askRow]]), timeline: [] }),
    })));
    act(() => {
      result.current.pickAgent('steward');
      result.current.targetChanged('steward');
    });
    expect(result.current.composerAgent).toMatchObject({ channelId: 'dev', actorId: 'steward' });
    const model = buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active', agentSelection: { selectedAgentId: result.current.composerAgent.actorId } });
    expect(model.targetAgent).toMatchObject({ id: 'steward' });
  });

  it('【缺陷】最近交互取我发的最后一条 agent.ask——新结构里这条默认目标来源已经不存在', () => {
    // 旧 resolveParameterAgent：无 @、无手选时，默认目标落到"我最近发 agent.ask 的那个 agent"
    // （latestInteractedAgentId）。新 useAgentProbes.composerAgent 只由显式 pickAgent/
    // targetChanged 驱动（见 selectAgent 命令），没有任何路径会在挂载时或收到新 agent.ask
    // 后自动把 composerAgent 设成"最近互动的 agent"——它的内部 latestAgentInteraction()
        // 只用来判断"是否可以清除一个手选覆盖"，从未被用作默认值来源。
    const askRow = { kind: 'request', type: 'agent.ask', sender: { id: 'me' }, audience: ['claude'] };
    const { result } = renderHook(() => useAgentProbes(probeHarness({
      stateFor: () => ({ rows: new Map([[1, askRow]]), timeline: [] }),
    })));
    // 旧行为：composerAgent 应该自动挂到 claude；新行为：什么都没做，仍是初始空值。
    expect(result.current.composerAgent).toMatchObject({ channelId: '', actorId: '' });
    const model = buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active', agentSelection: { selectedAgentId: result.current.composerAgent.actorId } });
    // 期望是 claude（旧行为），实际是 null——这就是回归的用户可见后果：多 agent 频道里，
    // 没有 @、没手选时composer 显示"选择 Agent"而不是自动跟随最近对话的 agent。
    expect(model.targetAgent).toMatchObject({ id: 'claude' });
  });
});

describe('默认目标抗污染（useAgentProbes 公共 owner）', () => {
  function assertManualTargetSurvives(rows) {
    let currentRows = rows;
    const props = probeHarness({
      stateFor: () => ({
        rows: new Map(currentRows.map((row, index) => [index + 1, row])),
        timeline: [],
      }),
    });
    const { result, rerender } = renderHook((nextProps) => useAgentProbes(nextProps), { initialProps: props });
    act(() => {
      result.current.pickAgent('steward');
      result.current.targetChanged('steward');
    });
    currentRows = [...currentRows];
    act(() => { rerender({ ...props, feedVersion: 1 }); });
    const model = buildComposerModel({
      activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER,
      access: 'member_active', agentSelection: { selectedAgentId: result.current.composerAgent.actorId },
    });
    expect(model.targetAgent).toMatchObject({ id: 'steward' });
  }

  it('[AD-057] describe/context/select 控制词不改变用户已选目标', () => {
    // 用户能力：查看另一个 Agent 的自省能力时，Composer 仍指向用户已选 Agent。
    // 不变量：只有本人发出的单一 agent.ask 才是最近互动证据；控制词不能污染该证据。
    // 公共 owner：useAgentProbes().pickAgent/targetChanged → buildComposerModel。
    // 结果：公开 Composer model 保留 steward 目标，无私有 tracker 导入。
    assertManualTargetSurvives([
      { kind: 'request', type: 'agent.ask', sender: { id: 'me' }, audience: ['steward'] },
      { kind: 'request', type: 'actor.describe', sender: { id: 'me' }, audience: ['claude'] },
      { kind: 'request', type: 'agent.context', sender: { id: 'me' }, audience: ['claude'] },
      { kind: 'request', type: 'agent.select', sender: { id: 'me' }, audience: ['claude'] },
    ]);
  });

  it('[AD-058] 其他用户的 Agent 交互不改变我的已选目标', () => {
    // 用户能力：同频道其他人的对话不会把我的 Composer 目标切到别的 Agent。
    // 不变量：最近互动过滤必须绑定当前 principal，不能跨用户借用 audience。
    // 公共 owner：useAgentProbes().pickAgent/targetChanged → buildComposerModel。
    // 结果：公开 Composer model 仍指向 steward；未读取私有 latestAgentInteraction。
    assertManualTargetSurvives([
      { kind: 'request', type: 'agent.ask', sender: { id: 'me' }, audience: ['steward'] },
      { kind: 'request', type: 'agent.ask', sender: { id: 'peer' }, audience: ['claude'] },
    ]);
  });
});

describe('当前值恒只认本连接证据（projectAgentParameters 承接）', () => {
  it('账本历史 usage 是旧生命期读数，无本连接探测恒返回 null', () => {
    const state = timelineState([
      completedTurn({ requestId: 'a', actorId: 'steward', type: 'agent.ask', value: { usage: { model: 'm1', effort: 'low', context_tokens: 10 } } }),
    ]);
    expect(projectAgentParameters({ state, actorId: 'steward', requestKeys: { context: '' } }).view).toBeNull();
    expect(projectAgentParameters({ state, actorId: 'steward', requestKeys: { context: 'probe-never-sent' } }).view).toBeNull();
  });

  it('本连接 context 探测响应是当前值的起点', () => {
    const state = timelineState([
      completedTurn({ requestId: 'probe-1', actorId: 'steward', type: 'agent.context', value: { model: 'm3', effort: 'medium', context_tokens: 5, context_window: 100 } }),
    ]);
    const { view } = projectAgentParameters({ state, actorId: 'steward', requestKeys: { context: 'probe-1' } });
    expect(view.usage).toMatchObject({ model: 'm3', effort: 'medium', contextWindow: 100 });
  });

  it('【缺陷】探测之后新完成的 terminal 逐步覆盖；缺字段的帧跳过不清空显示——新结构不再扫描探测之后的 agent.ask 终态', () => {
    // 旧 latestAgentUsageFor：agent.context 探测响应只是起点，其后账本里 steward 发出的
    // 每个 agent.ask 终态（带 usage）都会逐步覆盖显示；没有 usage 字段的帧跳过，不清空。
    // 新 agent-parameters.js 的 usageView 只读一次 agent.context 探测终态，完全不看
    // 探测之后的普通 agent.ask 终态——上下文用量条会冻结在探测那一刻，用户继续对话后
    // token 计数不再更新，除非再次手动刷新。
    const state = timelineState([
      completedTurn({ requestId: 'probe-1', actorId: 'steward', type: 'agent.context', value: { model: 'm3', effort: 'medium' } }),
      completedTurn({ requestId: 'ask-b', actorId: 'steward', type: 'agent.ask', value: { usage: { model: 'm4', effort: 'high', context_tokens: 20 } } }),
    ]);
    const { view } = projectAgentParameters({ state, actorId: 'steward', requestKeys: { context: 'probe-1' } });
    // 期望（旧行为）：探测后的 ask-b 覆盖到 m4/high/20；实际：仍停在探测响应的 m3/medium，
    // 且没有 context_tokens。
    expect(view.usage).toMatchObject({ model: 'm4', effort: 'high', contextTokens: 20 });
  });

  it('provider 只报告 model、没有 effort 时仍保留当前配置', () => {
    const state = timelineState([
      completedTurn({ requestId: 'probe-1', actorId: 'claude', type: 'agent.context', value: { model: 'claude-opus-5', effort: '' } }),
    ]);
    const { view } = projectAgentParameters({ state, actorId: 'claude', requestKeys: { context: 'probe-1' } });
    expect(view).toMatchObject({ actorId: 'claude', current: { model: 'claude-opus-5', effort: '' }, configurable: false });
  });

  it('别的 agent 的 usage 恒不串值', () => {
    const state = timelineState([
      completedTurn({ requestId: 'probe-1', actorId: 'steward', type: 'agent.context', value: { model: 'm3', effort: 'medium' } }),
      completedTurn({ requestId: 'ask-x', actorId: 'claude', type: 'agent.ask', value: { usage: { model: 'mx', effort: 'high' } } }),
    ]);
    const { view } = projectAgentParameters({ state, actorId: 'steward', requestKeys: { context: 'probe-1' } });
    expect(view.usage).toMatchObject({ model: 'm3', effort: 'medium' });
  });

  it('live context compact closure 不提供当前配置快照', () => {
    const turn = { ...completedTurn({ requestId: 'probe-1', actorId: 'steward', type: 'agent.context', value: { model: 'm3', effort: 'medium' } }), terminalClosureOnly: true };
    const state = timelineState([turn]);
    expect(projectAgentParameters({ state, actorId: 'steward', requestKeys: { context: 'probe-1' } }).view).toBeNull();
  });
});

describe('agent.options incarnation 快照（projectAgentParameters 承接）', () => {
  const OPTIONS_PAYLOAD = {
    provider: 'codex', source: 'native', generated_at: '2026-09-06T00:00:00Z',
    models: [
      { value: 'gpt-new', label: 'GPT New', efforts: [{ value: 'low', label: '轻量' }, { value: 'high', label: '高' }] },
      { value: 'fast', label: 'Fast' },
    ],
    current: { model: 'gpt-new', effort: 'high' },
    client: { name: 'codex', current: '0.153.4', latest: '0.154.0', update_status: 'available' },
  };

  it('只认本连接发出的 options request 对应终态', () => {
    const state = timelineState([
      completedTurn({ requestId: 'old-probe', actorId: 'steward', type: 'agent.options', value: OPTIONS_PAYLOAD }),
      completedTurn({ requestId: 'live-probe', actorId: 'steward', type: 'agent.options', value: OPTIONS_PAYLOAD }),
    ]);
    expect(projectAgentParameters({ state, actorId: 'steward', requestKeys: { options: 'old-never' } }).view).toBeNull();
    const { view } = projectAgentParameters({ state, actorId: 'steward', requestKeys: { options: 'live-probe' } });
    expect(view).toMatchObject({ source: 'native', current: { model: 'gpt-new', effort: 'high' } });
  });

  it('按"新在前"的 id 列表取第一份完成的 options', () => {
    const state = timelineState([
      completedTurn({ requestId: 'live-probe', actorId: 'steward', type: 'agent.options', value: OPTIONS_PAYLOAD }),
    ]);
    expect(projectAgentParameters({ state, actorId: 'steward', requestKeys: { options: 'newer-still-in-flight|live-probe' } }).view)
      .toMatchObject({ current: { model: 'gpt-new', effort: 'high' } });
    expect(projectAgentParameters({ state, actorId: 'steward', requestKeys: { options: '|live-probe' } }).view).not.toBeNull();
    expect(projectAgentParameters({ state, actorId: 'steward', requestKeys: { options: '' } }).view).toBeNull();
  });

  it('live options compact closure 不提供目录或 current', () => {
    const turn = { ...completedTurn({ requestId: 'live-probe', actorId: 'steward', type: 'agent.options', value: OPTIONS_PAYLOAD }), terminalClosureOnly: true };
    const state = timelineState([turn]);
    expect(projectAgentParameters({ state, actorId: 'steward', requestKeys: { options: 'live-probe' } }).view).toBeNull();
  });

  it('按模型保留各自 effort，无码 effort 的模型仍可选择', () => {
    const state = timelineState([
      completedTurn({ requestId: 'live-probe', actorId: 'steward', type: 'agent.options', value: OPTIONS_PAYLOAD }),
    ]);
    const { view } = projectAgentParameters({ state, actorId: 'steward', requestKeys: { options: 'live-probe' } });
    expect(view.selections).toEqual([
      { model: 'gpt-new', effort: 'low', modelLabel: 'GPT New', effortLabel: '轻量', description: '' },
      { model: 'gpt-new', effort: 'high', modelLabel: 'GPT New', effortLabel: '高', description: '' },
      { model: 'fast', effort: '', modelLabel: 'Fast', effortLabel: '' },
    ]);
    expect(view.current).toEqual({ model: 'gpt-new', effort: 'high' });
    expect(view.client.update_status).toBe('available');
  });

  it('usage 报目录外的 resolved id 时如实显示，不退回过期的 options current', () => {
    const state = timelineState([
      completedTurn({
        requestId: 'live-probe', actorId: 'claude', type: 'agent.options',
        value: { models: [{ value: 'claude-fable-5[1m]', label: 'Fable', efforts: [{ value: 'high' }] }, { value: 'haiku', label: 'Haiku', efforts: [] }], current: { model: 'haiku', effort: '' } },
      }),
      completedTurn({ requestId: 'probe-1', actorId: 'claude', type: 'agent.context', value: { model: 'claude-fable-5', effort: 'high' } }),
    ]);
    const { view } = projectAgentParameters({ state, actorId: 'claude', requestKeys: { options: 'live-probe', context: 'probe-1' } });
    expect(view.current).toEqual({ model: 'claude-fable-5', effort: 'high' });
  });

  it('成功 select 的 catalog value 立即覆盖 options 旧 current', () => {
    const state = timelineState([
      completedTurn({
        requestId: 'live-probe', actorId: 'codex', type: 'agent.options',
        value: { models: [{ value: 'm1', efforts: [{ value: 'low' }] }, { value: 'm2', efforts: [{ value: 'high' }] }], current: { model: 'm1', effort: 'low' } },
      }),
      completedTurn({ requestId: 'probe-1', actorId: 'codex', type: 'agent.context', value: { model: 'm2', effort: 'high' } }),
    ]);
    const { view } = projectAgentParameters({ state, actorId: 'codex', requestKeys: { options: 'live-probe', context: 'probe-1' } });
    expect(view.current).toEqual({ model: 'm2', effort: 'high' });
  });
});
