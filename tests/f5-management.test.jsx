// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelGovernance } from '../src/ui/ChannelGovernance.jsx';
import { ActivityCenter } from '../src/ui/ActivityCenter.jsx';
import { GlobalSearch } from '../src/ui/GlobalSearch.jsx';

afterEach(cleanup);

const channel = { id: 'c0', qualified_name: 'c0', owner_principal: 'root', open: true };
const state = { turns: new Map() };

describe('F5 成员与全局表面', () => {
  it('Channel Context 默认成员优先并隐藏标准 Actor', async () => {
    render(<ChannelGovernance
      channel={channel}
      channels={[channel]}
      roster={[
        { id: 'root', name: 'Root', kind: 'human', principal: 'root' },
        { id: 'system', name: 'system', kind: 'system' },
        { id: 'registrar', name: 'registrar', kind: 'tool', decl_id: 'atoll-internal:registrar-seat' },
        { id: 'svcactor', name: 'svcactor', kind: 'tool', decl_id: 'atoll-internal:svcactor' },
      ]}
      state={state}
      principals={[]}
      declarations={[]}
      onSubmit={vi.fn()}
      onRefresh={vi.fn()}
      onClose={vi.fn()}
    />);
    expect(screen.getByRole('tab', { name: '成员' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Root')).toBeTruthy();
    expect(screen.queryByText('system')).toBeNull();
    expect(screen.queryByText('registrar')).toBeNull();
    expect(screen.queryByText('svcactor')).toBeNull();
  });

  it('添加流程先选参与者，再按对象类型显示配置', async () => {
    const user = userEvent.setup();
    render(<ChannelGovernance
      channel={channel}
      channels={[channel]}
      roster={[{ id: 'system', kind: 'system' }]}
      state={state}
      principals={[{ declared: { id: 'alice', display_name: 'Alice', status: 'present' } }]}
      declarations={[
        { declared: { id: 'demo:agent', name: 'Analyst', default_class: 'codex', status: 'present' } },
        { declared: { id: 'atoll-internal:svcactor', name: 'svcactor', status: 'present' } },
      ]}
      onSubmit={vi.fn()}
      onRefresh={vi.fn()}
      onClose={vi.fn()}
    />);
    expect(screen.queryByRole('combobox', { name: 'Agent Principal' })).toBeNull();
    await user.click(screen.getByRole('combobox', { name: '选择参与者' }));
    expect(screen.queryByRole('option', { name: /svcactor/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: /Analyst · Agent/ }));
    expect(screen.getByRole('combobox', { name: 'Agent Principal' })).toBeTruthy();
  });

  it('Activity 与搜索都返回规范 SourceRef', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const source = { channelId: 'c0.project', view: 'tasks', objectType: 'work_item', objectId: 'work-1' };
    const { unmount } = render(<ActivityCenter activities={[{ key: 'a1', kind: 'work_item', title: '待审批', channelId: 'c0.project', source }]} operations={[]} onOpen={onOpen} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /待审批/ }));
    expect(onOpen).toHaveBeenCalledWith(source);
    unmount();

    render(<GlobalSearch index={new Map([['s1', { key: 's1', kind: 'artifact', title: '设计报告', channelId: 'c0.project', searchText: '设计报告', updatedAt: 1, source: { channelId: 'c0.project', view: 'artifacts', objectType: 'artifact', objectId: 'artifact-1' } }]])} onOpen={onOpen} onClose={() => {}} />);
    await user.type(screen.getByLabelText('搜索频道、消息、文件、任务或成员'), '设计');
    await user.click(screen.getByRole('button', { name: /设计报告/ }));
    expect(onOpen).toHaveBeenLastCalledWith({ channelId: 'c0.project', view: 'artifacts', objectType: 'artifact', objectId: 'artifact-1' });
  });
});
