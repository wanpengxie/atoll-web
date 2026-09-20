// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelAdministrationPanel, ChannelAutomationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(cleanup);

describe('workspace governance feature ports', () => {
  it('reports a queued profile command and requests a directory refresh', async () => {
    const submit = vi.fn().mockResolvedValue('message-1');
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<ChannelAdministrationPanel
      channel={{ id: 'c1', description: 'old' }}
      port={{ commands: { submit, refresh }, children: [] }}
      onClose={() => {}}
    />);

    fireEvent.click(screen.getByRole('tab', { name: '概览' }));
    fireEvent.change(screen.getByLabelText('说明'), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: '保存频道资料' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'channel',
      action: 'update_profile',
      payload: { channelId: 'c1', description: 'new' },
    }));
    expect(refresh).toHaveBeenCalledWith('directory');
    expect(screen.getByRole('status').textContent).toContain('已进入提交队列');
    expect(screen.getByRole('status').textContent).toContain('最终以账本与目录投影为准');
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
