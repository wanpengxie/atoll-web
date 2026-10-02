// @vitest-environment jsdom
// 旧 src/ui/ChannelGovernance.jsx、ActivityCenter.jsx、GlobalSearch.jsx 均已删除。
// ChannelGovernance → src/ui/features/governance/GovernanceFeature.jsx 的
// ChannelAdministrationPanel（成员 tab = ChannelMembers）。
// GlobalSearch → src/ui/features/search/SearchFeature.jsx，行为基本保留。
// ActivityCenter（全局活动去重 + Operation Center 操作追踪）在新结构里彻底
// 消失，grep 全 src 找不到"活动中心/Operation Center"任何字样，见 RM 账本缺陷记录，
// 这里不重建一个不存在的功能。
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(cleanup);

describe('F5 成员与全局表面', () => {
  it('Channel Context 默认成员优先并隐藏标准 Actor', async () => {
    const user = userEvent.setup();
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0', qualified_name: 'c0' }}
      port={{
        roster: [
          { id: 'root', name: 'Root', kind: 'human', principal: 'root' },
          { id: 'system', name: 'system', kind: 'system', body: 'generated' },
          { id: 'registrar', name: 'registrar', kind: 'system', body: 'generated' },
          { id: 'svcactor', name: 'svcactor', kind: 'peer', body: 'generated' },
          // 运行时生成的 handle：kind 是 agent，但 body 说它不在频道描述里。
          { id: 'agent:c0-child:2', name: 'child-handle', kind: 'agent', body: 'generated' },
        ],
        commands: {},
      }}
      onClose={vi.fn()}
    />);
    // Baseline action: no tab navigation. The public panel must open on Members.
    expect(screen.getByRole('tab', { name: '成员' }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('tab', { name: '成员' }));
    expect(screen.getByText('Root')).toBeTruthy();
    expect(screen.queryByText('system')).toBeNull();
    expect(screen.queryByText('registrar')).toBeNull();
    expect(screen.queryByText('svcactor')).toBeNull();
    expect(screen.queryByText('child-handle')).toBeNull();
  });

  it('添加流程：从 Actor 描述或 Class 写成员条目，人直接邀请', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue({ accepted: true });
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0.project' }}
      port={{
        roster: [{ id: 'system', kind: 'system' }],
        principals: [{ id: 'alice', display_name: 'Alice' }],
        actorDescriptions: [{ id: 'd-analyst', name: 'analyst', version: 2, class: 'codex-agent', description: '分析资料' }],
        commands: { submit },
      }}
      onClose={vi.fn()}
    />);
    // Baseline action: the member admission selector is available immediately.
    expect(screen.getByRole('tab', { name: '成员' }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('combobox', { name: '选择参与者' }));
    await user.click(screen.getByRole('option', { name: 'analyst @2 · Actor 描述（class codex-agent）' }));
    const selection = screen.getByRole('status');
    // 引用 Actor 描述用 描述id@版本。
    expect(selection.getAttribute('data-participant-id')).toBe('d-analyst@2');
    expect(selection.textContent).toContain('class codex-agent · 分析资料');
    // 成员名默认取描述的名字；它只是显示，任何写法都行，也可以和别人重名。
    const name = screen.getByLabelText('成员名（只显示，可留空）');
    expect(name.value).toBe('analyst');
    await user.clear(name);
    await user.type(name, 'Analyst 2');
    expect(screen.getByRole('button', { name: '添加到频道' }).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: '添加到频道' }));
    expect(submit).toHaveBeenLastCalledWith({
      scope: 'channel', action: 'introduce_actor',
      payload: { channelId: 'c0.project', candidateType: 'description', candidateId: 'd-analyst@2', name: 'Analyst 2' },
    });

    // 直接按 Class：要填 Class；成员名可留空。
    await user.click(screen.getByRole('combobox', { name: '选择参与者' }));
    await user.click(screen.getByRole('option', { name: '直接按 Class 新建…' }));
    expect(screen.getByLabelText('成员名（只显示，可留空）').value).toBe('');
    expect(screen.getByRole('button', { name: '添加到频道' }).disabled).toBe(true);
    await user.type(screen.getByLabelText('成员 Class'), 'codex');
    expect(screen.getByRole('button', { name: '添加到频道' }).disabled).toBe(false);
    await user.type(screen.getByLabelText('成员名（只显示，可留空）'), 'helper');
    await user.click(screen.getByRole('button', { name: '添加到频道' }));
    expect(submit).toHaveBeenLastCalledWith({
      scope: 'channel', action: 'introduce_actor',
      payload: { channelId: 'c0.project', candidateType: 'class', candidateId: 'codex', name: 'helper' },
    });

    // 人：不要成员名，发 principal。
    await user.click(screen.getByRole('combobox', { name: '选择参与者' }));
    await user.click(screen.getByRole('option', { name: 'Alice · 用户' }));
    expect(screen.queryByLabelText('成员名（只显示，可留空）')).toBeNull();
    await user.click(screen.getByRole('button', { name: '添加到频道' }));
    expect(submit).toHaveBeenLastCalledWith({
      scope: 'channel', action: 'introduce_actor',
      payload: { channelId: 'c0.project', candidateType: 'principal', candidateId: 'alice' },
    });
  });

  it('候选目录按显示名排序，并用稳定 ID 打破同名而不依赖到达顺序', async () => {
    const user = userEvent.setup();
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0' }}
      port={{
        principals: [
          { id: 'principal-z', display_name: 'Same' },
          { id: 'alice', display_name: 'Alice' },
          { id: 'principal-a', display_name: 'Same' },
        ],
        // 两条同名的 Actor 描述：名字只显示，按描述 id 打破同名。
        actorDescriptions: [
          { id: 'd-z', name: 'same', version: 2, class: 'mcp-tool' },
          { id: 'd-a', name: 'same', version: 1, class: 'mcp-tool' },
        ],
        commands: {},
      }}
      onClose={vi.fn()}
    />);

    const select = screen.getByRole('combobox', { name: '选择参与者' });
    await user.click(select);
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent.trim())).toEqual([
      '搜索用户或 Actor 描述',
      'Alice · 用户',
      'Same · 用户',
      'Same · 用户',
      'same @1 · Actor 描述（class mcp-tool）',
      'same @2 · Actor 描述（class mcp-tool）',
      '直接按 Class 新建…',
    ]);
    await user.click(options[2]);
    expect(screen.getByRole('status').getAttribute('data-participant-id')).toBe('principal-a');
    await user.click(select);
    await user.click(screen.getAllByRole('option')[4]);
    expect(screen.getByRole('status').getAttribute('data-participant-id')).toBe('d-a@1');
  });

});
