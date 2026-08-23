// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { agentSelectionView, selectionsFromDescribe, selectionFor } from '../src/model/agent-selection.js';
import { ModelSelector } from '../src/ui/ModelSelector.jsx';

afterEach(cleanup);

// describe 的 agent.select 词条（协议 §4.2）：oneOf 组合对 + title。
const DESCRIBE = {
  words: {
    'agent.select': {
      input_schema: {
        type: 'object',
        properties: { model: { type: 'string' }, effort: { type: 'string' } },
        oneOf: [
          { required: ['model', 'effort'], properties: { model: { const: 'gpt-5.6-sol', title: '5.6 Sol' }, effort: { const: 'medium', title: '中等' } } },
          { required: ['model', 'effort'], properties: { model: { const: 'gpt-5.6-sol', title: '5.6 Sol' }, effort: { const: 'high', title: '高' } } },
          { required: ['model', 'effort'], properties: { model: { const: 'gpt-5.4', title: '5.4' }, effort: { const: 'light', title: '轻量' } } },
        ],
      },
    },
  },
};

const view = agentSelectionView({ actorId: 'steward', describe: DESCRIBE, usage: { model: 'gpt-5.6-sol', effort: 'medium' } });
const single = { kind: 'single', agent: { id: 'steward', kind: 'agent', name: 'Steward' } };

describe('agent-selection 协议适配', () => {
  it('从 describe 的 oneOf 提取组合对与 title', () => {
    expect(selectionsFromDescribe(DESCRIBE)).toEqual([
      { model: 'gpt-5.6-sol', effort: 'medium', modelLabel: '5.6 Sol', effortLabel: '中等' },
      { model: 'gpt-5.6-sol', effort: 'high', modelLabel: '5.6 Sol', effortLabel: '高' },
      { model: 'gpt-5.4', effort: 'light', modelLabel: '5.4', effortLabel: '轻量' },
    ]);
  });

  it('两级菜单是组合对投影：模型去重；当前值恒来自账本真值', () => {
    expect(view.models).toEqual([{ id: 'gpt-5.6-sol', label: '5.6 Sol' }, { id: 'gpt-5.4', label: '5.4' }]);
    expect(view.current).toEqual({ model: 'gpt-5.6-sol', effort: 'medium' });
    expect(view.confirmed).toBe(true);
  });

  it('无账本真值时 current 为 null——恒不拿 selections[0] 冒充（default 可以不是第一条）', () => {
    const cold = agentSelectionView({ actorId: 'steward', describe: DESCRIBE, usage: null });
    expect(cold.current).toBeNull();
    expect(cold.confirmed).toBe(false);
  });

  it('兼容 capabilities.js 归一形（types Map + inputSchema）', () => {
    const normalized = { types: new Map([[ 'agent.select', { inputSchema: DESCRIBE.words['agent.select'].input_schema } ]]) };
    expect(selectionsFromDescribe(normalized)).toEqual(selectionsFromDescribe(DESCRIBE));
  });

  it('换 model 时 effort 失配自动落该 model 的第一个合法组合', () => {
    const selections = selectionsFromDescribe(DESCRIBE);
    expect(selectionFor(selections, 'gpt-5.4', 'medium')).toEqual({ model: 'gpt-5.4', effort: 'light' });
    expect(selectionFor(selections, 'gpt-5.6-sol', 'high')).toEqual({ model: 'gpt-5.6-sol', effort: 'high' });
  });
});

describe('Model/Effort 选择器', () => {
  it('只有 Model 与 Effort 两级，选择提交完整组合对', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<ModelSelector target={single} actorName="Steward" view={view} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol，推理强度 中等/ }));
    expect(screen.getByRole('menuitem', { name: /模型/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /推理强度/ })).toBeTruthy();
    expect(screen.queryByText('Speed')).toBeNull();

    await user.click(screen.getByRole('menuitem', { name: /模型/ }));
    await user.click(screen.getByRole('menuitemradio', { name: '5.4' }));
    expect(onChange).toHaveBeenCalledWith({ actorId: 'steward', model: 'gpt-5.4', effort: 'light' });
  });

  it('pending 期间显示目标值与切换中，入口锁定', () => {
    render(<ModelSelector target={single} actorName="Steward" view={view} pending={{ actorId: 'steward', value: { model: 'gpt-5.4', effort: 'light' } }} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /Steward，模型 5.4，推理强度 轻量，切换中/ });
    expect(trigger.disabled).toBe(true);
    expect(screen.getByText('切换中')).toBeTruthy();
  });

  it('多 @ 显示 N 个目标且无设置入口', () => {
    render(<ModelSelector target={{ kind: 'multi', count: 2 }} />);
    expect(screen.getByText('2 个目标')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('无判据且多 agent 时提供手选入口', async () => {
    const user = userEvent.setup();
    const onPickAgent = vi.fn();
    const candidates = [{ id: 'steward', kind: 'agent', name: 'Steward' }, { id: 'claude', kind: 'agent', name: 'Claude' }];
    render(<ModelSelector target={{ kind: 'none' }} candidates={candidates} onPickAgent={onPickAgent} />);
    await user.click(screen.getByRole('button', { name: /选择 Agent/ }));
    await user.click(screen.getByRole('menuitem', { name: /Claude/ }));
    expect(onPickAgent).toHaveBeenCalledWith('claude');
  });

  it('值域未就绪时只显示角色名；点击是探测重试通道，不开菜单', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ModelSelector target={single} actorName="Steward" view={null} onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Steward' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('current 为 null 时 pill 只显示角色名，菜单仍可设置（选 model 落首组合）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(undefined);
    const cold = agentSelectionView({ actorId: 'steward', describe: DESCRIBE, usage: null });
    render(<ModelSelector target={single} actorName="Steward" view={cold} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Steward，模型未知' }));
    await user.click(screen.getByRole('menuitem', { name: /模型/ }));
    await user.click(screen.getByRole('menuitemradio', { name: '5.4' }));
    expect(onChange).toHaveBeenCalledWith({ actorId: 'steward', model: 'gpt-5.4', effort: 'light' });
  });

  it('无 selections 但 context 有 model 时显示只读配置，不伪造菜单', () => {
    const readonly = agentSelectionView({
      actorId: 'claude',
      describe: { words: { 'agent.select': { description: 'standard agent request' } } },
      usage: { model: 'claude-opus-5', effort: '' },
    });
    render(<ModelSelector target={{ kind: 'single', agent: { id: 'claude', kind: 'agent', name: 'Claude' } }} actorName="Claude" view={readonly} />);
    expect(screen.getByLabelText('Claude，模型 claude-opus-5')).toBeTruthy();
    expect(screen.getByText('claude-opus-5')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
