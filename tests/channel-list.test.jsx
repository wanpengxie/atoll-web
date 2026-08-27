// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelList } from '../src/ui/ChannelList.jsx';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const props = {
  channels: [{ id: 'c0', name: 'c0', access: 'member_active' }],
  activeChannelId: '',
  wireState: 'open',
  me: { id: 'root', display_name: 'Root' },
  onSelect: vi.fn(), onCreate: vi.fn(), onSearch: vi.fn(), onActivity: vi.fn(), onSpaceManage: vi.fn(), onLogout: vi.fn(),
};

describe('channel notification badges', () => {
  it('shows related roots strongly and only the additional unrelated roots weakly', () => {
    render(<ChannelList {...props} unread={{ c0: { related: 2, total: 5 } }} />);
    expect(screen.getByLabelText('2 条与我相关的未读消息').textContent).toBe('2');
    expect(screen.getByLabelText('3 条其他未读消息').textContent).toBe('3');
    expect(screen.queryByLabelText('5 条全部未读消息')).toBeNull();
  });

  it('does not repeat the same count when every unread root is related', () => {
    render(<ChannelList {...props} unread={{ c0: { related: 2, total: 2 } }} />);
    expect(screen.getByLabelText('2 条与我相关的未读消息')).toBeTruthy();
    expect(screen.queryByTitle('其他未读消息')).toBeNull();
  });
});

describe('channel Agent timers', () => {
  it('shows at most two active timers and advances them with one shared clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(66_000);
    const active = [
      { requestId: 'r1', agentId: 'agent:codex:1', startedAt: 1_000 },
      { requestId: 'r2', agentId: 'agent:claude:1', startedAt: 6_000 },
      { requestId: 'r3', agentId: 'agent:research:1', startedAt: 16_000 },
    ];
    render(<ChannelList {...props} unread={{}} agentActivity={{ byChannel: { c0: { active } } }} />);
    expect(screen.getByLabelText('3 项 Agent 正在运行')).toBeTruthy();
    expect(document.querySelectorAll('.channel-agent-timer')).toHaveLength(2);
    expect(document.querySelectorAll('.channel-agent-timer time')[0].textContent).toBe('01:05');
    expect(screen.getByTitle('另有 1 项正在运行').textContent).toBe('+1');
    act(() => vi.advanceTimersByTime(2_000));
    expect(document.querySelectorAll('.channel-agent-timer time')[0].textContent).toBe('01:07');
  });
});

describe('node update action', () => {
  it('shows one bottom-left button only when an update is available and confirms before starting', () => {
    const start = vi.fn().mockResolvedValue({ status: 'starting' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<ChannelList {...props} unread={{}} update={{ value: { current_version: 'v0.06', latest_version: 'v0.07', available: true, status: 'idle' }, start }} />);
    const button = screen.getByRole('button', { name: '升级到 v0.07' });
    fireEvent.click(button);
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(start).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain('暂时中断当前连接');
    expect(confirm.mock.calls[0][0]).toContain('数据会保留');
  });

  it('uses the same disabled button to report progress and shows only the version when current', () => {
    const { rerender } = render(<ChannelList {...props} unread={{}} update={{ value: { latest_version: 'v0.07', available: true, status: 'verifying' }, start: vi.fn() }} />);
    expect(screen.getByRole('button', { name: '正在校验…' }).disabled).toBe(true);
    rerender(<ChannelList {...props} unread={{}} update={{ value: { current_version: 'v0.07', latest_version: 'v0.07', available: false, status: 'succeeded' }, start: vi.fn() }} />);
    expect(screen.queryByText('升级到 v0.07')).toBeNull();
    expect(screen.queryByRole('button', { name: /升级/ })).toBeNull();
    expect(screen.getByTitle('Atoll v0.07').textContent).toBe('v0.07');
  });
});
