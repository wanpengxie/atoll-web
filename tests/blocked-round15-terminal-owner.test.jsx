// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';
import { WorkspaceFeatures } from '../src/ui/features/WorkspaceFeatures.jsx';

afterEach(cleanup);

function session() {
  return { wireState: 'open', me: { id: 'human:root:1', display_name: '我' }, onLogout: vi.fn() };
}

function navigation(activeChannelId = 'c0', { access = 'member_active', terminalVisible = false } = {}) {
  let visible = terminalVisible;
  const channels = [
    { id: 'c0', name: 'c0', access: 'member_active' },
    { id: 'c1', name: 'c1', access: 'member_active' },
    { id: 'c2', name: 'c2', access: 'member_active' },
  ];
  const active = channels.find((channel) => channel.id === activeChannelId) || { id: activeChannelId, name: activeChannelId, access };
  return {
    channels, channel: { ...active, access }, activeChannelId, activeView: 'conversation',
    unread: {}, agentActivity: { byChannel: {} },
    select: vi.fn(), setActiveView: vi.fn(), openSearch: vi.fn(), openSpaceAdministration: vi.fn(), openRoster: vi.fn(),
    get terminalVisible() { return visible; },
    openTerminal: vi.fn(() => { visible = !visible; }),
  };
}

function featuresFor(navigation) {
  return <div data-testid="terminal-features">
    <WorkspaceFeatures
      activeView="conversation"
      channel={{ id: navigation.activeChannelId, name: navigation.activeChannelId }}
      contentVisible
      terminal={{
        mounted: true,
        visible: navigation.terminalVisible,
        channelId: navigation.activeChannelId,
        devices: [],
        deviceId: '',
        canWrite: false,
        transportOpen: true,
        available: true,
        commands: { close: navigation.openTerminal },
      }}
    />
  </div>;
}

function renderWorkspace(navigation, options = {}) {
  return render(<WorkspaceLayout
    session={session()}
    navigation={navigation}
    conversation={{ element: <div data-testid="message-surface">消息</div> }}
    features={featuresFor(navigation)}
    {...options}
  />);
}

describe('A-D round 15 terminal/channel-restart blocked evidence', () => {
  it.fails('[AD-093] provides a recent-reading drawer at the right edge', () => {
    // 用户能力：从终端/频道边缘打开最近阅读；不变量：Reading owner 负责来源和返回焦点。
    renderWorkspace(navigation());
    expect(screen.queryByRole('button', { name: '打开最近阅读' })).toBeTruthy();
  });

  it('[AD-094] keeps terminal out of the main tabs while message and terminal surfaces coexist', async () => {
    // 用户能力：终端开关不会替代 Dynamic；不变量：WorkspaceLayout 只交接 terminal owner。
    const nav = navigation();
    const view = renderWorkspace(nav);
    expect(screen.queryByRole('tab', { name: '终端' })).toBeNull();
    const toggle = screen.getByRole('button', { name: /终端/ });
    fireEvent.click(toggle);
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={nav}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
      features={featuresFor(nav)}
    />);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('message-surface')).toBeTruthy();
    await waitFor(() => expect(document.getElementById('workspace-panel-terminal')?.hidden).toBe(false));
    fireEvent.click(toggle);
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={nav}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
      features={featuresFor(nav)}
    />);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('[AD-095] uses Ctrl+F12 as the same terminal toggle and prevents browser default', () => {
    // 用户能力：键盘快捷键与按钮共享同一公开 command；不变量：浏览器 F12 默认动作被阻止。
    const nav = navigation();
    renderWorkspace(nav);
    const event = new KeyboardEvent('keydown', { key: 'F12', ctrlKey: true, bubbles: true, cancelable: true });
    expect(document.dispatchEvent(event)).toBe(false);
    expect(nav.openTerminal).toHaveBeenCalledTimes(1);
  });

  it('[AD-096] disables the old terminal entry as soon as a channel selection is pending', () => {
    // 用户能力：目标尚未 commit 时不能再次打开旧频道终端；不变量：terminal 绑定 committed channel。
    const nav = navigation();
    const view = renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    expect(nav.select).toHaveBeenCalledWith('c1');
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    const event = new KeyboardEvent('keydown', { key: 'F12', ctrlKey: true, bubbles: true, cancelable: true });
    expect(document.dispatchEvent(event)).toBe(false);
    expect(nav.openTerminal).not.toHaveBeenCalled();
    view.unmount();
  });

  it('[AD-096] leaves the current terminal entry enabled without a pending selection', () => {
    renderWorkspace(navigation());
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(false);
  });

  it('[AD-096] clears the terminal gate after the navigation owner commits the target', () => {
    const nav = navigation();
    const view = renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(true);
    const committed = navigation('c1');
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={committed}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
      features={featuresFor(committed)}
    />);
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(false);
  });

  it('[AD-096] clears the terminal gate when the navigation owner explicitly rejects the target', () => {
    const nav = navigation();
    nav.select.mockReturnValue(false);
    renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    expect(nav.select).toHaveBeenCalledWith('c1');
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(false);
  });

  it.fails('[AD-097] lets a fast reselect of the committed channel cancel the pending target', () => {
    // 用户能力：A→B 未 commit 时可立即反选 A；不变量：只保留最新用户选择。
    const nav = navigation();
    renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    fireEvent.click(screen.getByText('c0'));
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1', 'c0']);
  });

  it.fails('[AD-098] lets a committed third-channel directory fallback supersede the old target', () => {
    // 用户能力：路由/目录把选择交给第三频道时，旧 pending 不再控制终端。
    // 不变量：directory fallback 与 Workspace committed identity 必须是同一 handoff。
    const nav = navigation();
    const view = renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    const c2 = navigation('c2');
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={c2}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
      features={featuresFor(c2)}
    />);
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(true);
  });

  it.fails('[AD-099] returns from an invalid target to the original channel and ends the old pending handoff', () => {
    // 用户能力：失效目标先经过目录拒绝，再回到原频道；不变量：失效 commit 不能留下 terminal pending。
    const nav = navigation();
    const view = renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    const invalid = navigation('c1');
    invalid.channel = null;
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={invalid}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
      features={featuresFor(invalid)}
    />);
    expect(screen.getByRole('heading', { name: 'c0' })).toBeTruthy();
  });

  it('[AD-100] keeps the terminal entry usable to close after content access is revoked', () => {
    // 用户能力：访问撤销后仍能从原入口安全收起；不变量：close 不再依赖内容写权限。
    const open = navigation('c0', { terminalVisible: true });
    const view = renderWorkspace(open);
    const revoked = navigation('c0', { access: 'access_denied', terminalVisible: true });
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={revoked}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
      features={featuresFor(revoked)}
    />);
    // WorkspaceLayout's public toggle and WorkspaceFeatures' public close action
    // intentionally share the terminal label; target the documented layout id
    // so this assertion proves the original entry remains usable.
    const close = document.getElementById('workspace-terminal-toggle');
    expect(close.disabled).toBe(false);
    fireEvent.click(close);
    expect(revoked.openTerminal).toHaveBeenCalledTimes(1);
  });

  it('[AD-101] publishes an explicit false message-surface state when mobile terminal covers it', () => {
    // 用户能力：窄屏终端覆盖消息面时屏幕阅读/布局能知道 surface 已离开；不变量：visible 事实显式发布。
    vi.stubGlobal('matchMedia', (query) => ({ matches: query === '(max-width: 640px)', addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const nav = navigation('c0', { terminalVisible: true });
    const view = renderWorkspace(nav);
    expect(screen.getByTestId('message-surface').getAttribute('data-surface-visible')).toBe('false');

    const returned = navigation('c0', { terminalVisible: false });
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={returned}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
      features={featuresFor(returned)}
    />);
    expect(screen.getByTestId('message-surface').getAttribute('data-surface-visible')).toBe('true');
  });

  it('[AD-102] keeps the message surface mounted during a desktop terminal split', async () => {
    // 用户能力：桌面分屏仍可读消息；不变量：terminal 是并列 surface，不是 tab 替换。
    const nav = navigation('c0', { terminalVisible: true });
    renderWorkspace(nav);
    expect(screen.getByTestId('message-surface')).toBeTruthy();
    await waitFor(() => expect(document.getElementById('workspace-panel-terminal')?.hidden).toBe(false));
  });

  it('[AD-104] does not steal focus on initial render, background rerender, or supersede', () => {
    // 用户能力：只有用户选择且目标 commit 才转移焦点；不变量：后台/被 supersede 不抢焦点。
    const nav = navigation();
    const view = renderWorkspace(nav);
    const member = screen.getByRole('button', { name: '成员' });
    member.focus();
    view.rerender(<WorkspaceLayout session={session()} navigation={nav} conversation={{ element: <div data-testid="message-surface">消息</div> }} features={featuresFor(nav)} />);
    expect(document.activeElement).toBe(member);
    fireEvent.click(screen.getByText('c1'));
    member.focus();
    const c2 = navigation('c2');
    view.rerender(<WorkspaceLayout session={session()} navigation={c2} conversation={{ element: <div data-testid="message-surface">消息</div> }} features={featuresFor(c2)} />);
    expect(document.activeElement).toBe(member);
  });

  it.fails('[AD-105] hands focus only to the latest target in a rapid A-to-B-to-A selection', () => {
    // 用户能力：快速反选最终落在 A；不变量：旧 pending 不能覆盖最新选择。
    const nav = navigation();
    renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    fireEvent.click(screen.getByText('c0'));
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1', 'c0']);
  });

  it.fails('[AD-106] retains a channel terminal split when leaving and returning to that channel', () => {
    // 用户能力：切频道不会丢已打开终端的布局；不变量：终端 session/布局按 channel 隔离。
    const first = navigation('c0', { terminalVisible: true });
    const view = renderWorkspace(first);
    const second = navigation('c1', { terminalVisible: false });
    view.rerender(<WorkspaceLayout session={session()} navigation={second} conversation={{ element: <div data-testid="message-surface">消息</div> }} features={featuresFor(second)} />);
    const returned = navigation('c0', { terminalVisible: false });
    view.rerender(<WorkspaceLayout session={session()} navigation={returned} conversation={{ element: <div data-testid="message-surface">消息</div> }} features={featuresFor(returned)} />);
    expect(document.getElementById('workspace-panel-terminal').hidden).toBe(false);
  });

  it('[AD-107] renders at most one live terminal feature for the committed channel', async () => {
    // 用户能力：十个频道不会同时挂十个终端；不变量：Workspace 只消费当前 channel 的 terminal port。
    const nav = navigation('c0', { terminalVisible: true });
    renderWorkspace(nav);
    await waitFor(() => expect(document.querySelectorAll('#workspace-panel-terminal')).toHaveLength(1));
    expect(document.getElementById('workspace-panel-terminal').getAttribute('aria-labelledby')).toBe('workspace-terminal-toggle');
  });

  it.fails('[AD-108] closing one channel split does not close another channel split', () => {
    // 用户能力：每频道的收起互不影响；不变量：terminal visibility 按 channel 保持独立。
    const first = navigation('c0', { terminalVisible: true });
    const view = renderWorkspace(first);
    const second = navigation('c1', { terminalVisible: true });
    view.rerender(<WorkspaceLayout session={session()} navigation={second} conversation={{ element: <div data-testid="message-surface">消息</div> }} features={featuresFor(second)} />);
    second.openTerminal();
    const returned = navigation('c0', { terminalVisible: false });
    view.rerender(<WorkspaceLayout session={session()} navigation={returned} conversation={{ element: <div data-testid="message-surface">消息</div> }} features={featuresFor(returned)} />);
    expect(document.getElementById('workspace-panel-terminal').hidden).toBe(false);
  });
});
