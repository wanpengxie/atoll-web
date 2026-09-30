// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelAdministrationPanel, ChannelAutomationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(cleanup);

describe('workspace governance feature ports', () => {
  it('opens the settings tab (the old overview) with the on-demand channel state card', () => {
    render(<ChannelAdministrationPanel
      channel={{ id: 'c1' }}
      initialTab="overview"
      port={{ commands: { readChannel: vi.fn() }, children: [] }}
      onClose={() => {}}
    />);

    expect(screen.getByRole('tab', { name: '设置' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: '概览' })).toBeNull();
    const heading = screen.getByRole('heading', { name: '频道状态' });
    expect(heading.closest('[hidden]')).toBeNull();
    // 新建频道是 Workspace 的弹窗，不在频道详情里。
    expect(screen.queryByRole('heading', { name: '创建子频道' })).toBeNull();
  });

  it('reports a queued profile command and requests a directory refresh', async () => {
    const submit = vi.fn().mockResolvedValue('message-1');
    const refresh = vi.fn().mockResolvedValue(undefined);
    const readChannel = vi.fn().mockResolvedValue({ description: { revision: 1, body: { members: [], description: 'old', serving: 0 } } });
    render(<ChannelAdministrationPanel
      channel={{ id: 'c1' }}
      port={{ commands: { submit, refresh, readChannel }, children: [] }}
      onClose={() => {}}
    />);

    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    fireEvent.change(await screen.findByLabelText('频道说明'), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'channel',
      action: 'update_profile',
      payload: { channelId: 'c1', description: 'new', serving: false },
    }));
    expect(refresh).toHaveBeenCalledWith('directory');
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('频道描述已写入'));
    // 频道状态不再有构建结果，回执也不再指向它。
    expect(screen.getByRole('status').textContent).not.toContain('构建结果');
  });

  it('reports a partial result when the directory refresh after a write fails', async () => {
    const submit = vi.fn().mockResolvedValue('message-1');
    const refresh = vi.fn().mockRejectedValue(new Error('obs offline'));
    const readChannel = vi.fn().mockResolvedValue({ description: { revision: 1, body: { members: [], serving: 0 } } });
    render(<ChannelAdministrationPanel
      channel={{ id: 'c1' }}
      initialTab="overview"
      port={{ commands: { submit, refresh, readChannel }, children: [] }}
      onClose={() => {}}
    />);
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await screen.findByLabelText('频道说明');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('目录刷新失败：obs offline'));
    expect(screen.getByRole('status').className).toContain('state-partial');
  });

  it('uses after/list/cancel ports without claiming a server timer inventory', async () => {
    const after = vi.fn().mockResolvedValue({ timer_id: 'timer-2' });
    const list = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn().mockResolvedValue({ timer_id: 'timer-1' });
    render(<ChannelAutomationPanel
      channel={{ id: 'c1' }}
      port={{
        records: [{ timerId: 'timer-1', channelId: 'c1', msgType: 'agent.ask', state: 'scheduled' }],
        commands: { after, list, cancel },
      }}
      onClose={() => {}}
    />);

    expect(screen.getByText(/timer list\/OBS/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '创建定时动作' }));
    await waitFor(() => expect(after).toHaveBeenCalledWith({
      channelId: 'c1', durationMs: 5000, msgType: 'agent.ask', payload: { text: '定时提醒' },
    }));
    expect(screen.getByRole('status').textContent).toContain('timer-2');
    expect(screen.getByLabelText('待取消 timer ID').value).toBe('timer-2');

    fireEvent.click(screen.getByRole('button', { name: '取消定时动作' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ channelId: 'c1', timerId: 'timer-2' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(list).toHaveBeenCalledWith({ channelId: 'c1' }));
  });
});
