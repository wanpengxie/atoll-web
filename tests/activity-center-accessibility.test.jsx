// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';
import { WorkspaceRightPanel } from '../src/ui/features/WorkspaceFeatures.jsx';

afterEach(cleanup);

function session() {
  return {
    wireState: 'open',
    me: { id: 'human:root:1', display_name: 'Root' },
    onLogout: vi.fn(),
  };
}

function navigation(overrides = {}) {
  return {
    channels: [{ id: 'c0', name: 'c0', qualified_name: 'c0', access: 'member_active' }],
    activeChannelId: 'c0',
    activeView: 'conversation',
    channel: { id: 'c0', name: 'c0', qualified_name: 'c0', access: 'member_active' },
    select: vi.fn(),
    setActiveView: vi.fn(),
    openSearch: vi.fn(),
    openSpaceAdministration: vi.fn(),
    ...overrides,
  };
}

function ActivityHarness({ activity = {}, children = null }) {
  const [open, setOpen] = useState(false);
  const openActivity = () => setOpen(true);
  return <>
    <button type="button" onClick={openActivity}>打开活动中心</button>
    {children}
    {open && <WorkspaceRightPanel
      panel="activity"
      channel={{ id: 'c0', name: 'c0', access: 'member_active' }}
      activity={activity}
      onClose={() => setOpen(false)}
    />}
  </>;
}

describe('Activity Center public accessibility contract', () => {
  it('exposes the rail entry under its exact accessible name and delegates opening', async () => {
    const user = userEvent.setup();
    const openActivity = vi.fn();
    render(<WorkspaceLayout
      session={session()}
      navigation={navigation({ openActivity })}
    />);

    const entry = screen.getByRole('button', { name: '打开活动中心' });
    expect(entry.getAttribute('title')).toBe('活动中心');
    await user.click(entry);
    expect(openActivity).toHaveBeenCalledTimes(1);
  });

  it('focuses the panel close control, closes on Escape, and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<ActivityHarness activity={{ activities: [], operations: [], operationsUnavailable: false }} />);

    const opener = screen.getByRole('button', { name: '打开活动中心' });
    await user.click(opener);
    const close = screen.getByRole('button', { name: '关闭活动中心' });
    expect(document.activeElement).toBe(close);
    expect(screen.getByRole('complementary', { name: '全局活动' })).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: '全局活动' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('returns an activity row to its canonical source callback', async () => {
    const user = userEvent.setup();
    const openSource = vi.fn();
    const source = {
      channelId: 'c0',
      view: 'dynamic',
      objectType: 'turn',
      objectId: 'request-1',
      requestId: 'request-1',
    };
    render(<ActivityHarness activity={{
      activities: [{
        key: 'activity:request-1',
        kindLabel: 'Agent 回合',
        title: '整理预算',
        channelId: 'c0',
        channelName: 'c0',
        detail: '进行中',
        source,
      }],
      operations: [],
      operationsUnavailable: false,
      commands: { open: openSource },
    }} />);

    await user.click(screen.getByRole('button', { name: '打开活动中心' }));
    await user.click(screen.getByRole('button', { name: /整理预算/ }));
    expect(openSource).toHaveBeenCalledTimes(1);
    expect(openSource).toHaveBeenCalledWith({ source });
  });

  it('states operation facts are unavailable and exposes no fabricated operation row', async () => {
    const user = userEvent.setup();
    const openSource = vi.fn();
    render(<ActivityHarness activity={{
      activities: [],
      operations: [{
        key: 'operation:c0:request-2',
        kindLabel: '操作',
        title: '不应显示的缓存操作',
        channelId: 'c0',
        source: { channelId: 'c0', requestId: 'request-2' },
      }],
      operationsUnavailable: true,
      commands: { open: openSource },
    }} />);

    await user.click(screen.getByRole('button', { name: '打开活动中心' }));
    await user.click(screen.getByRole('tab', { name: '操作' }));
    expect(screen.getByText('当前没有可用的进行中操作快照')).toBeTruthy();
    expect(screen.getByText('当前后端没有可验证的操作事实；这里不会伪造历史记录。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /返回来源/ })).toBeNull();
    expect(screen.queryByText('不应显示的缓存操作')).toBeNull();
    expect(openSource).not.toHaveBeenCalled();
  });
});
