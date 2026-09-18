// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../src/ui/ChannelList.jsx', () => ({
  ChannelList: ({ onSelect }) => <div>
    <button type="button" onClick={() => onSelect('c0')}>切换到 c0</button>
    <button type="button" onClick={() => onSelect('c1')}>切换到 c1</button>
  </div>,
}));
vi.mock('../src/ui/ArtifactsView.jsx', () => ({ ArtifactsView: () => null }));
vi.mock('../src/ui/TasksView.jsx', () => ({ TasksView: () => null }));
vi.mock('../src/ui/Composer.jsx', () => ({ Composer: () => <div data-testid="composer" /> }));
vi.mock('../src/ui/Timeline.jsx', () => ({ Timeline: ({ surfaceVisible }) => <section id="workspace-panel-dynamic" role="tabpanel" aria-labelledby="workspace-tab-dynamic" data-surface-visible={String(surfaceVisible)}>消息</section> }));
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('终端分屏开关', () => {
  it('右侧边缘提供最近阅读抽屉入口', () => {
    const input = props();
    render(<AppShell {...input} />);
    fireEvent.click(screen.getByRole('button', { name: '打开最近阅读' }));
    expect(input.panel.open).toHaveBeenCalledWith('reading-history');
  });

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

  it('频道选择已发出但目标workspace尚未commit时，旧频道终端入口立即不可用', async () => {
    const initial = props('dynamic', 'c0');
    const view = render(<AppShell {...initial} />);
    const toggle = screen.getByRole('button', { name: /终端/ });
    expect(toggle.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '切换到 c1' }));
    expect(initial.navigation.onSelect).toHaveBeenCalledWith('c1');
    // The parent has deliberately not committed c1 yet. Before the handoff
    // gate this old DOM stayed enabled and a second input opened c0 instead.
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(document.getElementById('workspace-panel-terminal')).toBeNull();

    view.rerender(<AppShell {...props('dynamic', 'c1')} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(document.getElementById('workspace-panel-terminal')?.dataset.channel).toBe('c1');
  });

  it('目标尚未commit时快速反选已提交频道，以最新选择结束旧pending', async () => {
    const initial = props('dynamic', 'c0');
    render(<AppShell {...initial} />);
    const toggle = screen.getByRole('button', { name: /终端/ });

    fireEvent.click(screen.getByRole('button', { name: '切换到 c1' }));
    expect(toggle.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '切换到 c0' }));
    expect(initial.navigation.onSelect.mock.calls.map(([channelId]) => channelId)).toEqual(['c1', 'c0']);
    await waitFor(() => expect(toggle.disabled).toBe(false));
    fireEvent.click(toggle);
    expect(document.getElementById('workspace-panel-terminal')?.dataset.channel).toBe('c0');
  });

  it('稳定commit到第三频道时，路由或directory fallback会supersede旧pending', async () => {
    const initial = props('dynamic', 'c0');
    const view = render(<AppShell {...initial} />);
    fireEvent.click(screen.getByRole('button', { name: '切换到 c1' }));
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(true);

    const superseded = props('dynamic', 'c2');
    superseded.navigation.channels.push({ id: 'c2', access: 'member_active' });
    view.rerender(<AppShell {...superseded} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(document.getElementById('workspace-panel-terminal')?.dataset.channel).toBe('c2');
  });

  it('目标失效时directory先发布目标再退回原频道，退回后结束旧pending', async () => {
    const initial = props('dynamic', 'c0');
    const view = render(<AppShell {...initial} />);
    fireEvent.click(screen.getByRole('button', { name: '切换到 c1' }));
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(true);

    // useChannelDirectory first commits the requested id. Until its directory
    // effect rejects a missing/retired id, the workspace has no matching row.
    const missing = props('dynamic', 'c1');
    missing.workspace.channel = null;
    view.rerender(<AppShell {...missing} />);
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(true);

    // The directory fallback returns to c0. This is not an indefinitely slow
    // c1 commit: the intervening active id proves the old request was rejected.
    view.rerender(<AppShell {...props('dynamic', 'c0')} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(document.getElementById('workspace-panel-terminal')?.dataset.channel).toBe('c0');
  });

  it('已打开终端在内容访问被撤销后仍可从同一入口安全收起', () => {
    const input = props('dynamic', 'c0');
    const view = render(<AppShell {...input} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(screen.getByRole('button', { name: /终端/ }).getAttribute('aria-pressed')).toBe('true');

    view.rerender(<AppShell {...{
      ...input,
      workspace: { ...input.workspace, access: 'access_denied' },
    }} />);
    const close = screen.getByRole('button', { name: /终端/ });
    expect(close.disabled).toBe(false);
    expect(document.getElementById('workspace-panel-terminal')).toBeNull();
    fireEvent.click(close);
    expect(close.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('消息Surface可见性', () => {
  const compactMedia = (query) => ({
    matches: query === '(max-width: 900px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  it('窄屏被文件或终端覆盖时显式发布false，回到消息面后恢复true', () => {
    vi.stubGlobal('matchMedia', compactMedia);
    const view = render(<AppShell {...props()} />);
    const surface = () => document.getElementById('workspace-panel-dynamic');
    expect(surface().dataset.surfaceVisible).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(surface().dataset.surfaceVisible).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(surface().dataset.surfaceVisible).toBe('true');

    view.rerender(<AppShell {...props('artifacts')} />);
    expect(surface().dataset.surfaceVisible).toBe('false');
  });

  it('桌面分屏仍保留可见消息Surface', () => {
    render(<AppShell {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(document.getElementById('workspace-panel-dynamic').dataset.surfaceVisible).toBe('true');
  });
});

describe('用户频道导航的焦点交接', () => {
  it('仅在用户选择已commit时聚焦新频道标题，且不改变滚动位置', async () => {
    const initial = props('dynamic', 'c0');
    const view = render(<AppShell {...initial} />);
    const focusHeading = vi.spyOn(screen.getByRole('heading', { name: 'c0' }), 'focus');
    const selectC1 = screen.getByRole('button', { name: '切换到 c1' });
    selectC1.focus();
    fireEvent.click(selectC1);

    view.rerender(<AppShell {...props('dynamic', 'c1')} />);
    const heading = screen.getByRole('heading', { name: 'c1' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(focusHeading).toHaveBeenCalledWith({ preventScroll: true });
    expect(heading.tabIndex).toBe(-1);
  });

  it('初次显示、后台rerender和被第三频道supersede都不抢焦点', async () => {
    const initial = props('dynamic', 'c0');
    const view = render(<AppShell {...initial} />);
    const member = screen.getByRole('button', { name: '成员' });
    member.focus();
    view.rerender(<AppShell {...props('dynamic', 'c0')} />);
    expect(document.activeElement).toBe(member);

    fireEvent.click(screen.getByRole('button', { name: '切换到 c1' }));
    member.focus();
    const superseded = props('dynamic', 'c2');
    superseded.navigation.channels.push({ id: 'c2', access: 'member_active' });
    view.rerender(<AppShell {...superseded} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(false));
    expect(document.activeElement).toBe(member);
  });

  it('快速A→B→A只交接最新的用户选择', async () => {
    const initial = props('dynamic', 'c0');
    render(<AppShell {...initial} />);
    const selectC1 = screen.getByRole('button', { name: '切换到 c1' });
    selectC1.focus();
    fireEvent.click(selectC1);
    const selectC0 = screen.getByRole('button', { name: '切换到 c0' });
    selectC0.focus();
    fireEvent.click(selectC0);

    const heading = screen.getByRole('heading', { name: 'c0' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(initial.navigation.onSelect.mock.calls.map(([id]) => id)).toEqual(['c1', 'c0']);
  });
});

// 切频道时终端必须原地留着。上一版把「开过终端」记在一个单槽 ref 上，并在
// 切频道时连同展开状态一起清空：切走 → TerminalView 被卸载 → 切回来是黑屏
//（实时流恒不回放，卸了就真没了），布局也恒不保留。两个频道各开一个终端时
// 单槽根本装不下，来回切等于把两边轮流拆掉。
// 终端的真相恒在服务端（会话的回放环 + 宽限期），所以切走频道就卸载是安全的，
// 切回来由服务端回放。这一组锁住的是**前端这一侧的账**：分屏开合按频道各记各的，
// 恒不再像上一版那样切一次频道就把所有终端一起清掉。
describe('终端分屏按频道各记各的', () => {
  const terminals = () => [...document.querySelectorAll('#workspace-panel-terminal')]
    .map((node) => ({ channel: node.dataset.channel, visible: !node.hidden }));

  it('切走时只卸载当前这块，切回来分屏布局还在', () => {
    const view = render(<AppShell {...props('dynamic', 'c0')} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(terminals()).toEqual([{ channel: 'c0', visible: true }]);

    // 切到没开过终端的频道：恒不该凭空给它起一个 shell。
    view.rerender(<AppShell {...props('dynamic', 'c1')} />);
    expect(terminals()).toEqual([]);

    // 切回来：分屏状态是记着的，终端重新挂上（屏幕由服务端回放）。
    view.rerender(<AppShell {...props('dynamic', 'c0')} />);
    expect(terminals(), '切回来没有恢复分屏布局').toEqual([{ channel: 'c0', visible: true }]);
  });

  it('恒只有当前频道那一块终端活着——十个频道恒不是十块', () => {
    const view = render(<AppShell {...props('dynamic', 'c0')} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    view.rerender(<AppShell {...props('dynamic', 'c1')} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(terminals()).toEqual([{ channel: 'c1', visible: true }]);

    view.rerender(<AppShell {...props('dynamic', 'c0')} />);
    expect(terminals()).toEqual([{ channel: 'c0', visible: true }]);
  });

  it('在一个频道收起分屏，恒不影响另一个频道', () => {
    const view = render(<AppShell {...props('dynamic', 'c0')} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    view.rerender(<AppShell {...props('dynamic', 'c1')} />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    fireEvent.click(screen.getByRole('button', { name: /终端/ })); // c1 收起
    expect(terminals(), '收起恒只是隐藏，恒不是卸载').toEqual([{ channel: 'c1', visible: false }]);
    view.rerender(<AppShell {...props('dynamic', 'c0')} />);
    expect(terminals().find((row) => row.channel === 'c0').visible, 'c0 的分屏被 c1 的收起带走了').toBe(true);
  });
});
