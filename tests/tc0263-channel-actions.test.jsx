// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';
import { WorkspaceRightPanel } from '../src/ui/features/WorkspaceFeatures.jsx';

afterEach(cleanup);

function session() {
  return { wireState: 'open', me: { id: 'human:root:1', display_name: '我' }, onLogout: vi.fn() };
}

function navigation(overrides = {}) {
  return {
    channels: [{ id: 'c0', name: 'c0', access: 'member_active' }],
    channel: { id: 'c0', name: 'c0', access: 'member_active' },
    unread: {},
    agentActivity: { byChannel: {} },
    activeChannelId: 'c0',
    activeView: 'conversation',
    terminalVisible: false,
    select: vi.fn(),
    setActiveView: vi.fn(),
    openSearch: vi.fn(),
    openSpaceAdministration: vi.fn(),
    openResources: vi.fn(),
    openChannelCreate: vi.fn(),
    openChannelAdministration: vi.fn(),
    openTerminal: vi.fn(),
    channelRestart: {
      available: false,
      reason: '当前会话没有频道级 system.member.restart_all 命令端口',
      invoke: vi.fn(),
    },
    ...overrides,
  };
}

describe('TC-0263 频道操作入口', () => {
  it('保留资源、创建子频道和频道重启入口，并把 unsupported 重启交给明确反馈 owner', async () => {
    const user = userEvent.setup();
    const nav = navigation();
    render(<WorkspaceLayout session={session()} navigation={nav} />);

    await user.click(screen.getByRole('button', { name: '频道操作' }));
    const menu = screen.getByRole('menu', { name: '频道操作菜单' });
    expect(within(menu).getByRole('menuitem', { name: '高级资源工具' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: '新建子频道' })).toBeTruthy();
    const restart = within(menu).getByRole('menuitem', { name: '重启频道' });
    expect(restart.getAttribute('data-capability-state')).toBe('unsupported');
    expect(restart.getAttribute('title')).toContain('system.member.restart_all');
    expect(restart.hasAttribute('disabled')).toBe(false);

    await user.click(restart);
    expect(nav.channelRestart.invoke).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: '频道操作' }));
    await user.click(screen.getByRole('menuitem', { name: '高级资源工具' }));
    expect(nav.openResources).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: '频道操作' }));
    await user.click(screen.getByRole('menuitem', { name: '新建子频道' }));
    expect(nav.openChannelCreate).toHaveBeenCalledWith();
  });

  it('KV 面板只通过 Files owner 暴露的 typed resource command', async () => {
    const user = userEvent.setup();
    const resource = vi.fn(async (payload) => ({ status: 'ok', value: payload }));
    render(<WorkspaceRightPanel
      panel="resources"
      channel={{ id: 'c0', name: 'c0' }}
      files={{
        resourceAvailable: true,
        resourceWriteDisabled: false,
        commands: { resource },
      }}
      onClose={vi.fn()}
    />);

    const panel = screen.getByRole('complementary', { name: '频道资源' });
    await user.click(within(panel).getByRole('tab', { name: 'KV' }));
    await user.click(within(panel).getByRole('button', { name: '创建' }));
    expect(resource).toHaveBeenCalledWith({
      channel_id: 'c0',
      op: 'create',
      resource_id: 'kv:demo',
      args: { value: 'hello' },
    });
  });

  it('没有 resource port 时保留面板但明确不可用，不伪造结果', async () => {
    render(<WorkspaceRightPanel
      panel="resources"
      channel={{ id: 'c0', name: 'c0' }}
      files={{ commands: {} }}
      onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('tab', { name: 'KV' }));
    expect(screen.getByRole('status').textContent).toContain('没有可用的资源操作端口');
    expect(screen.getByRole('button', { name: '创建' }).disabled).toBe(true);
  });
});
