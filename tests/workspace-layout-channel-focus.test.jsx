// @vitest-environment jsdom
// 恢复对应：tests/app-shell-terminal-split.test.jsx（master，已删除）里的
// describe('用户频道导航的焦点交接')。旧结构 AppShell.jsx 已被 WorkspaceLayout.jsx 取代。
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';

afterEach(cleanup);

function session() {
  return { wireState: 'open', me: { id: 'human:root:1', display_name: '我' }, onLogout: vi.fn() };
}

function navigation(channelId, overrides = {}) {
  return {
    channels: [
      { id: 'c0', name: 'c0', access: 'member_active' },
      { id: 'c1', name: 'c1', access: 'member_active' },
    ],
    channel: { id: channelId, name: channelId },
    unread: {}, agentActivity: { byChannel: {} },
    activeChannelId: channelId, activeView: 'conversation',
    select: vi.fn(), setActiveView: vi.fn(), openSearch: vi.fn(), openSpaceAdministration: vi.fn(),
    openRoster: vi.fn(),
    ...overrides,
  };
}

describe('WorkspaceLayout 频道导航焦点交接（恢复自 app-shell-terminal-split.test.jsx）', () => {
  it('[AD-103] focuses the committed target title after a user channel selection', () => {
    const nav = navigation('c0');
    const view = render(<WorkspaceLayout session={session()} navigation={nav} />);
    // 用户能力：从频道列表选择 c1 后，提交到 c1 才把焦点交给 c1 标题；
    // 不变量：切换未 commit 前不能把焦点抢给候选频道，且 focus 不滚动内容。
    fireEvent.click(screen.getByText('c1'));
    expect(nav.select).toHaveBeenCalledWith('c1');
    view.rerender(<WorkspaceLayout session={session()} navigation={navigation('c1')} />);
    const heading = screen.getByRole('heading', { name: 'c1' });
    expect(document.activeElement).toBe(heading);
  });
});
