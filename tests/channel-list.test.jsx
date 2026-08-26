// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
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
