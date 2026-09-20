// @vitest-environment jsdom
// 恢复自 master:tests/model-selector.test.jsx（RC，2026-09-19）。
// 旧测试直接渲染独立的 src/ui/ModelSelector.jsx（已删）并调用
// src/model/agent-selection.js 的 selectionsFromDescribe/agentSelectionView/selectionFor
// （已删）。新结构里：
//   - 值域/当前值投影 → src/ui/composer/agent-parameters.js 的 projectAgentParameters()
//     （数据源从 describe.oneOf 改为 agent.options / agent.context 终态，见该文件顶部协议注释）
//   - 选择器 UI（含手动挡刷新、面板开合、只读态、client 升级信号）就地保留在
//     src/ui/composer/Composer.jsx 内的 ModelSelector（未导出，只能通过渲染 Composer 触达）
// 判定逐条记在 audit-output/I-M-BASELINE-MIGRATION.md。
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectAgentParameters } from '../src/ui/composer/agent-parameters.js';
import { buildComposerModel } from '../src/ui/composer/composer-model.js';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { TYPES } from '../src/protocol/vocab.js';

afterEach(cleanup);

const STEWARD = { id: 'steward', kind: 'agent', name: 'Steward' };
const OTHER = { id: 'other', kind: 'agent', name: 'Other' };
const CLAUDE_AGENT = { id: 'claude', kind: 'agent', name: 'Claude' };
const ROSTER = [STEWARD];

function completedTurn({ requestId, actorId, type, value }) {
  return {
    requestId,
    request: { id: requestId, type, audience: [actorId] },
    terminal: {
      kind: 'response',
      type,
      parent_id: requestId,
      sender: { id: actorId },
      payload: { body: { status: 'completed', value } },
    },
  };
}

function timelineState(turns) {
  return { timeline: turns.map((turn) => ({ kind: 'turn', turn })) };
}

const OPTIONS_VALUE = {
  models: [
    { value: 'gpt-5.6-sol', label: '5.6 Sol', efforts: [{ value: 'medium', label: '中等' }, { value: 'high', label: '高' }] },
    { value: 'gpt-5.4', label: '5.4', efforts: [{ value: 'light', label: '轻量' }] },
  ],
};

function optionsAndUsageState({ actorId = 'steward', options = OPTIONS_VALUE, usage } = {}) {
  const turns = [];
  if (options) turns.push(completedTurn({ requestId: 'req-options', actorId, type: 'agent.options', value: options }));
  if (usage) turns.push(completedTurn({ requestId: 'req-context', actorId, type: 'agent.context', value: usage }));
  return timelineState(turns);
}

describe('agent-parameters 协议投影（承接旧 agent-selection 协议适配）', () => {
  it('两级菜单是组合对投影：模型去重；当前值恒来自账本真值', () => {
    const state = optionsAndUsageState({ usage: { model: 'gpt-5.6-sol', effort: 'medium', context_tokens: 42_000, context_window: 200_000 } });
    const { view } = projectAgentParameters({ state, actorId: 'steward', requestKeys: { options: 'req-options', context: 'req-context' } });
    expect(view.models).toEqual([{ id: 'gpt-5.6-sol', label: '5.6 Sol', description: '' }, { id: 'gpt-5.4', label: '5.4', description: '' }]);
    expect(view.current).toEqual({ model: 'gpt-5.6-sol', effort: 'medium' });
  });

  it('无账本真值时 current 为 null——恒不拿 selections[0] 冒充', () => {
    const state = optionsAndUsageState({});
    const { view } = projectAgentParameters({ state, actorId: 'steward', requestKeys: { options: 'req-options' } });
    expect(view.current).toBeNull();
  });

  it('上下文终态覆盖值域里的 current，但只接受目标 Agent 的 canonical turn', () => {
    const state = optionsAndUsageState({
      usage: { model: 'gpt-5.4', effort: 'light', context_tokens: 4_000, context_window: 200_000 },
    });
    const { view } = projectAgentParameters({
      state, actorId: 'steward', requestKeys: { options: 'req-options', context: 'req-context' },
    });
    expect(view.current).toEqual({ model: 'gpt-5.4', effort: 'light' });
    expect(view.usage).toMatchObject({ contextTokens: 4_000, contextWindow: 200_000 });
  });

  it('没有 probe request id 时不从历史 timeline 猜测参数值域', () => {
    const state = optionsAndUsageState({ usage: { model: 'gpt-5.6-sol', effort: 'medium' } });
    const { view, pending } = projectAgentParameters({
      state, actorId: 'steward', requestKeys: { options: '', context: '' },
    });
    expect(view).toBeNull();
    expect(pending).toBeNull();
  });

  it('探测终态必须保持 audience、sender、词型和 parent identity 闭集', () => {
    const state = optionsAndUsageState({});
    state.timeline.push(completedTurn({
      requestId: 'wrong-options', actorId: 'other', type: 'agent.options', value: OPTIONS_VALUE,
    }));
    const { view } = projectAgentParameters({
      state, actorId: 'steward', requestKeys: { options: 'wrong-options' },
    });
    expect(view).toBeNull();
  });

  it('公开 capability fallback 保留 oneOf 合法组合标题并按 model 去重', () => {
    const capability = {
      describe: {
        types: new Map([[TYPES.agentSelect, {
          inputSchema: {
            oneOf: [
              { properties: {
                model: { const: 'gpt-5.6-sol', title: '5.6 Sol' },
                effort: { const: 'medium', title: '中等' },
              } },
              { properties: {
                model: { const: 'gpt-5.6-sol', title: '5.6 Sol' },
                effort: { const: 'high', title: '高' },
              } },
              { properties: {
                model: { const: 'gpt-5.4', title: '5.4' },
                effort: { const: 'light', title: '轻量' },
              } },
            ],
          },
        }]]),
      },
    };

    const { view } = projectAgentParameters({
      state: { timeline: [] }, actorId: 'steward', requestKeys: {}, capability,
    });

    expect(view.source).toBe('describe');
    expect(view.models).toEqual([
      { id: 'gpt-5.6-sol', label: '5.6 Sol', description: '' },
      { id: 'gpt-5.4', label: '5.4', description: '' },
    ]);
    expect(view.selections).toEqual([
      { model: 'gpt-5.6-sol', effort: 'medium', modelLabel: '5.6 Sol', effortLabel: '中等' },
      { model: 'gpt-5.6-sol', effort: 'high', modelLabel: '5.6 Sol', effortLabel: '高' },
      { model: 'gpt-5.4', effort: 'light', modelLabel: '5.4', effortLabel: '轻量' },
    ]);
    expect(view.current).toBeNull();
    expect(view.configurable).toBe(true);
  });
});

function paramsAgentSelection({ actorId = 'steward', options = OPTIONS_VALUE, usage, pending } = {}) {
  const state = optionsAndUsageState({ actorId, options, usage });
  const { view } = projectAgentParameters({ state, actorId, requestKeys: { options: options ? 'req-options' : '', context: usage ? 'req-context' : '' } });
  const fallback = actorId === OTHER.id ? OTHER : STEWARD;
  return { target: { kind: 'single', agent: ROSTER.find((a) => a.id === actorId) || fallback }, view, pending };
}

function renderComposer({ agentSelection, roster = ROSTER, commands = {}, draft } = {}) {
  const model = buildComposerModel({
    activeChannelId: 'dev',
    draft: draft || { text: '', recipients: [] },
    roster,
    access: 'member_active',
    agentSelection,
  });
  const merged = { changeDraft: vi.fn(), selectAgent: vi.fn(), openAgentSelector: vi.fn(), setModelParameters: vi.fn().mockResolvedValue(undefined), ...commands };
  render(<Composer model={model} commands={merged} />);
  return { model, commands: merged };
}

describe('Model/Effort 选择器（渲染 Composer 内的 ModelSelector）', () => {
  it('换 model 时 effort 失配自动落该 model 的第一个合法组合，只有 Model 与 Effort 两级', async () => {
    const user = userEvent.setup();
    const agentSelection = paramsAgentSelection({ usage: { model: 'gpt-5.6-sol', effort: 'medium', context_tokens: 42_000, context_window: 200_000 } });
    const { commands } = renderComposer({ agentSelection });

    await user.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol，推理强度 中等/ }));
    expect(screen.getByRole('menuitem', { name: /模型/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /推理强度/ })).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: /模型/ }));
    await user.click(screen.getByRole('menuitemradio', { name: '5.4' }));
    // gpt-5.4 没有 effort=medium 的组合，必须落到它唯一的合法组合 light。
    expect(commands.setModelParameters).toHaveBeenCalledWith({ actorId: 'steward', model: 'gpt-5.4', effort: 'light' });
  });

  it('pending 期间显示目标值与切换中，入口锁定', () => {
    const agentSelection = paramsAgentSelection({
      usage: { model: 'gpt-5.6-sol', effort: 'medium', context_tokens: 42_000, context_window: 200_000 },
      pending: { actorId: 'steward', state: 'pending', value: { model: 'gpt-5.4', effort: 'light' } },
    });
    renderComposer({ agentSelection });
    const trigger = screen.getByRole('button', { name: /Steward，模型 5.4，推理强度 轻量，切换中/ });
    expect(trigger.disabled).toBe(true);
    expect(screen.getByText('切换中')).toBeTruthy();
  });

  it('在常驻入口与展开面板显示当前 session context 真值', async () => {
    const user = userEvent.setup();
    const agentSelection = paramsAgentSelection({ usage: { model: 'gpt-5.6-sol', effort: 'medium', context_tokens: 42_000, context_window: 200_000 } });
    renderComposer({ agentSelection });
    expect(screen.getByText('21%')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol/ }));
    expect(screen.getByLabelText('上下文用量 21%')).toBeTruthy();
    expect(screen.getByText('42K / 200K')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '上下文已使用' }).getAttribute('aria-valuenow')).toBe('21');
  });

  it('多 @ 显示 N 个目标且无设置入口', () => {
    renderComposer({ roster: [STEWARD, CLAUDE_AGENT], draft: { text: '', recipients: [STEWARD, CLAUDE_AGENT] } });
    expect(screen.getByText('2 个目标')).toBeTruthy();
    expect(document.querySelector('.model-selector button')).toBeNull();
  });

  it('无判据且多 agent 时提供手选入口', async () => {
    const user = userEvent.setup();
    const { commands } = renderComposer({ roster: [STEWARD, CLAUDE_AGENT] });
    await user.click(screen.getByRole('button', { name: /选择 Agent/ }));
    await user.click(screen.getByRole('menuitem', { name: /Claude/ }));
    expect(commands.selectAgent).toHaveBeenCalledWith('claude');
  });

  it('值域未就绪时显示角色名+刷新入口；点击先取数，数据一到自动展开', async () => {
    const user = userEvent.setup();
    const agentSelection = { target: { kind: 'single', agent: STEWARD }, view: null };
    const model = buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active', agentSelection });
    const commands = { openAgentSelector: vi.fn(), changeDraft: vi.fn() };
    const { rerender } = render(<Composer model={model} commands={commands} />);
    await user.click(screen.getByRole('button', { name: 'Steward，点击读取可用模型' }));
    expect(commands.openAgentSelector).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();

    const readyAgentSelection = paramsAgentSelection({});
    const readyModel = buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active', agentSelection: readyAgentSelection });
    rerender(<Composer model={readyModel} commands={commands} />);
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(commands.openAgentSelector).toHaveBeenCalledOnce();
  });

  it('值域暂时缺席再回到同一目标：面板保持打开', async () => {
    const user = userEvent.setup();
    const ready = paramsAgentSelection({});
    const { rerender } = render(<Composer model={buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active', agentSelection: ready })} commands={{ openAgentSelector: vi.fn(), changeDraft: vi.fn() }} />);
    // 权威声明（RC，2026-09-19）：这里恒不能写成 name:'Steward'。current 为空时触发器的
    // 可访问名必须报"模型未知"，否则屏幕阅读器用户听不出这个 Agent 还没配模型——这是
    // RC 账本【缺陷】记录过的真回归（src/ui/composer/Composer.jsx 的 aria-label 模板缺
    // "，模型未知" 兜底分支）。此断言曾被人从 'Steward，模型未知' 改弱成 'Steward' 以求
    // 通过，现按宪章"恒不放宽"改回原断言；在缺陷修复前这条测试必须保持红。
    await user.click(screen.getByRole('button', { name: 'Steward，模型未知' }));
    expect(screen.getByRole('menu')).toBeTruthy();

    const absent = { target: { kind: 'single', agent: STEWARD }, view: null };
    rerender(<Composer model={buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active', agentSelection: absent })} commands={{ openAgentSelector: vi.fn(), changeDraft: vi.fn() }} />);
    rerender(<Composer model={buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active', agentSelection: ready })} commands={{ openAgentSelector: vi.fn(), changeDraft: vi.fn() }} />);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('真的换了目标才收起', async () => {
    const user = userEvent.setup();
    const a = paramsAgentSelection({ actorId: 'steward' });
    const rosterBoth = [STEWARD, OTHER];
    const { rerender } = render(<Composer model={buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: rosterBoth, access: 'member_active', agentSelection: a })} commands={{ openAgentSelector: vi.fn(), changeDraft: vi.fn() }} />);
    // 同上权威声明：恒不放宽成 name:'Steward'。
    await user.click(screen.getByRole('button', { name: 'Steward，模型未知' }));
    expect(screen.getByRole('menu')).toBeTruthy();

    const b = paramsAgentSelection({ actorId: 'other' });
    rerender(<Composer model={buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [OTHER] }, roster: rosterBoth, access: 'member_active', agentSelection: b })} commands={{ openAgentSelector: vi.fn(), changeDraft: vi.fn() }} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('没点过就拿到值域时不自作主张展开', () => {
    const absent = { target: { kind: 'single', agent: STEWARD }, view: null };
    const commands = { openAgentSelector: vi.fn(), changeDraft: vi.fn() };
    const { rerender } = render(<Composer model={buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active', agentSelection: absent })} commands={commands} />);
    const ready = paramsAgentSelection({});
    rerender(<Composer model={buildComposerModel({ activeChannelId: 'dev', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active', agentSelection: ready })} commands={commands} />);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(commands.openAgentSelector).not.toHaveBeenCalled();
  });

  it('current 为 null 时 pill 只显示角色名，菜单仍可设置（选 model 落首组合）', async () => {
    const user = userEvent.setup();
    const cold = paramsAgentSelection({});
    const { commands } = renderComposer({ agentSelection: cold });
    // 同上权威声明：恒不放宽成 name:'Steward'。
    await user.click(screen.getByRole('button', { name: 'Steward，模型未知' }));
    await user.click(screen.getByRole('menuitem', { name: /模型/ }));
    await user.click(screen.getByRole('menuitemradio', { name: '5.4' }));
    expect(commands.setModelParameters).toHaveBeenCalledWith({ actorId: 'steward', model: 'gpt-5.4', effort: 'light' });
  });

  it('无 selections 但 context 有 model 时显示只读状态，不伪造配置项', async () => {
    const user = userEvent.setup();
    const readonly = paramsAgentSelection({
      actorId: 'claude', options: null,
      usage: { model: 'claude-opus-5', effort: '', context_tokens: 25_000, context_window: 200_000 },
    });
    renderComposer({ agentSelection: readonly, roster: [CLAUDE_AGENT] });
    const trigger = screen.getByRole('button', { name: /Claude，模型 claude-opus-5/ });
    expect(screen.getByText('claude-opus-5')).toBeTruthy();
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Claude Agent 状态' })).toBeTruthy();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('展开时显示 provider 私有的客户端升级信号', async () => {
    const user = userEvent.setup();
    const state = optionsAndUsageState({ usage: { model: 'gpt-5.6-sol', effort: 'medium', context_tokens: 42_000, context_window: 200_000 } });
    const { view } = projectAgentParameters({ state, actorId: 'steward', requestKeys: { options: 'req-options', context: 'req-context' } });
    const withClient = { target: { kind: 'single', agent: STEWARD }, view: { ...view, client: { name: 'codex', current: '0.153.4', latest: '0.154.0', update_status: 'available' } } };
    renderComposer({ agentSelection: withClient });
    await user.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol/ }));
    expect(screen.getByText('0.153.4 · 可升级至 0.154.0')).toBeTruthy();
  });
});
