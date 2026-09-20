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
import { SearchFeature } from '../src/ui/features/search/SearchFeature.jsx';

afterEach(cleanup);

describe('F5 成员与全局表面', () => {
  it('Channel Context 默认成员优先并隐藏标准 Actor', async () => {
    const user = userEvent.setup();
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0', qualified_name: 'c0' }}
      port={{
        roster: [
          { id: 'root', name: 'Root', kind: 'human', principal: 'root' },
          { id: 'system', name: 'system', kind: 'system' },
          { id: 'registrar', name: 'registrar', kind: 'system', decl_id: 'registrar' },
          { id: 'svcactor', name: 'svcactor', kind: 'peer', decl_id: 'svcactor' },
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
  });

  it('添加流程的候选人不包含 genesis 铸出的系统声明', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue({ accepted: true });
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0' }}
      port={{
        roster: [{ id: 'system', kind: 'system' }],
        principals: [{ id: 'alice', display_name: 'Alice' }],
        declarations: [
          { id: 'demo:agent', name: 'Analyst' },
          { id: 'svcactor', name: 'svcactor' },
        ],
        commands: { submit },
      }}
      onClose={vi.fn()}
    />);
    // Baseline action: the member admission selector is available immediately.
    expect(screen.getByRole('tab', { name: '成员' }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('combobox', { name: '选择参与者' }));
    // genesis 铸出的系统声明不该出现在候选里。
    expect(screen.queryByRole('option', { name: /svcactor/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: /Analyst · Agent/ }));
    expect(screen.getByText('demo:agent')).toBeTruthy();
    expect(screen.getByText(/归属 principal 由声明本身决定/)).toBeTruthy();
  });

  it('全局搜索返回规范 SourceRef 并可用其打开结果', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<SearchFeature port={{
      index: [{ key: 's1', kind: 'artifact', objectType: 'artifact', title: '设计报告', channelId: 'c0.project', source: { channelId: 'c0.project', view: 'artifacts', objectType: 'artifact', objectId: 'artifact-1' } }],
      commands: { open: onOpen, close: vi.fn() },
    }} />);
    await user.type(screen.getByLabelText('搜索频道、消息、文件、任务或成员'), '设计');
    await user.click(screen.getByRole('button', { name: /设计报告/ }));
    expect(onOpen).toHaveBeenCalledWith({
      source: { channelId: 'c0.project', view: 'artifacts', objectType: 'artifact', objectId: 'artifact-1' },
    });
  });
});
