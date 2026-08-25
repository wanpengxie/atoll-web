// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../src/ui/ChannelList.jsx', () => ({ ChannelList: () => null }));
vi.mock('../src/ui/ArtifactsView.jsx', () => ({ ArtifactsView: () => null }));
vi.mock('../src/ui/TasksView.jsx', () => ({ TasksView: () => null }));
vi.mock('../src/ui/Composer.jsx', () => ({ Composer: () => <div data-testid="composer" /> }));
vi.mock('../src/ui/Timeline.jsx', () => ({ Timeline: () => <section id="workspace-panel-dynamic" role="tabpanel" aria-labelledby="workspace-tab-dynamic">消息</section> }));
vi.mock('../src/ui/TerminalView.jsx', () => ({ TerminalView: ({ channelId, visible }) => <section id="workspace-panel-terminal" data-channel={channelId} aria-labelledby="workspace-terminal-toggle" hidden={!visible}>终端内容</section> }));
vi.mock('../src/app/RightPanelHost.jsx', () => ({ RightPanelHost: () => null }));

import { AppShell } from '../src/app/AppShell.jsx';

function props(view = 'dynamic', channelId = 'c0') {
  return {
    session: { wireState: 'open', me: { id: 'root' }, onLogout: vi.fn() },
    navigation: {
      channels: [{ id: 'c0', access: 'member_active' }, { id: 'c1', access: 'member_active' }],
      activeChannelId: channelId, unread: {}, onSelect: vi.fn(), onCreate: vi.fn(),
      onSearch: vi.fn(), onActivity: vi.fn(), onSpaceManage: vi.fn(),
    },
    workspace: {
      channel: { id: channelId, name: channelId }, view, onViewChange: vi.fn(), access: 'member_active',
      state: { turns: new Map(), lastSeq: 0 }, roster: [], selfId: 'root', pending: [],
      approvalStates: {}, controlStates: {}, capabilityIndex: new Map(), attachments: [],
      resources: {}, tasks: { items: [] }, agentSelection: {},
    },
    notices: {},
    panel: { value: '', open: vi.fn(), host: {} },
  };
}

afterEach(cleanup);

describe('终端分屏开关', () => {
  it('终端不属于主视图 tab，按钮按下时与消息同时显示，再按只收起终端', () => {
    render(<AppShell {...props()} />);
    expect(screen.queryByRole('tab', { name: '终端' })).toBeNull();

    const toggle = screen.getByRole('button', { name: /终端/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.dynamic-workspace').classList.contains('terminal-split-open')).toBe(true);
    expect(screen.getByRole('tabpanel', { name: '动态' })).toBeTruthy();
    expect(document.getElementById('workspace-panel-terminal').hidden).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('workspace-panel-terminal').hidden).toBe(true);
  });

  it('Ctrl+F12 使用同一个开关并阻止浏览器默认动作', () => {
    render(<AppShell {...props()} />);
    const dispatched = fireEvent.keyDown(document, { key: 'F12', ctrlKey: true });
    expect(dispatched).toBe(false);
    expect(screen.getByRole('button', { name: /终端/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.keyDown(document, { key: 'F12', ctrlKey: true });
    expect(screen.getByRole('button', { name: /终端/ }).getAttribute('aria-pressed')).toBe('false');
  });
});

// 切频道时终端必须原地留着。上一版把「开过终端」记在一个单槽 ref 上，并在
// 切频道时连同展开状态一起清空：切走 → TerminalView 被卸载 → 切回来是黑屏
//（实时流恒不回放，卸了就真没了），布局也恒不保留。两个频道各开一个终端时
// 单槽根本装不下，来回切等于把两边轮流拆掉。
describe('终端分屏按频道各记各的', () => {
  const terminals = () => [...document.querySelectorAll('#workspace-panel-terminal')]
    .map((node) => ({ channel: node.dataset.channel, visible: !node.hidden }));

  it('切走再切回来，同一块终端恒不被卸载，展开状态也留着', () => {
    const view = render(<AppShell {...props('dynamic', 'c0')} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(terminals()).toEqual([{ channel: 'c0', visible: true }]);

    view.rerender(<AppShell {...props('dynamic', 'c1')} />);
    expect(terminals(), 'c0 的终端被卸载了——切回来只会是黑屏').toEqual([{ channel: 'c0', visible: false }]);

    view.rerender(<AppShell {...props('dynamic', 'c0')} />);
    expect(terminals(), '切回来没有恢复分屏布局').toEqual([{ channel: 'c0', visible: true }]);
  });

  it('两个频道各开一个终端，互不干扰', () => {
    const view = render(<AppShell {...props('dynamic', 'c0')} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    view.rerender(<AppShell {...props('dynamic', 'c1')} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(terminals()).toEqual([
      { channel: 'c0', visible: false },
      { channel: 'c1', visible: true },
    ]);

    view.rerender(<AppShell {...props('dynamic', 'c0')} />);
    expect(terminals()).toEqual([
      { channel: 'c0', visible: true },
      { channel: 'c1', visible: false },
    ]);
  });

  it('在一个频道收起分屏，恒不影响另一个频道', () => {
    const view = render(<AppShell {...props('dynamic', 'c0')} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    view.rerender(<AppShell {...props('dynamic', 'c1')} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    fireEvent.click(screen.getByRole('button', { name: /终端/ })); // c1 收起
    view.rerender(<AppShell {...props('dynamic', 'c0')} />);
    expect(terminals().find((row) => row.channel === 'c0').visible, 'c0 的分屏被 c1 的收起带走了').toBe(true);
  });
});
