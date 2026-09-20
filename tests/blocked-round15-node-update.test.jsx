// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';

afterEach(cleanup);

function session() {
  return { wireState: 'open', me: { id: 'human:root:1', display_name: '我' }, onLogout: vi.fn() };
}

function navigation() {
  return {
    channels: [{ id: 'c0', name: 'c0', access: 'member_active' }],
    channel: { id: 'c0', name: 'c0' },
    activeChannelId: 'c0', activeView: 'conversation',
    unread: {}, agentActivity: { byChannel: {} },
    select: vi.fn(), setActiveView: vi.fn(), openSearch: vi.fn(), openSpaceAdministration: vi.fn(),
  };
}

describe('A-D round 15 node-update blocked evidence', () => {
  it('[AD-202] shows a stable unavailable update action without a command owner', () => {
    // 用户能力：当前版本不支持安全升级时，用户看到明确的有界失败态。
    // 不变量：无真实 command port 时不得伪造可升级、确认或网络副作用。
    const nav = navigation();
    render(<WorkspaceLayout
      session={session()}
      navigation={{ ...nav, update: { status: 'unsupported', currentVersion: null, detail: '当前版本不支持安全升级，请刷新或联系管理员/手动升级' } }}
    />);
    const action = screen.getByRole('button', { name: '当前版本不支持安全升级，请刷新或联系管理员/手动升级' });
    expect(action.disabled).toBe(true);
  });

  it('[AD-203] keeps the current version read-only beside the unavailable action', () => {
    // 用户能力：版本事实仍可只读查看，但没有升级进度或重试假象。
    // 不变量：unsupported 终态没有 start/POST/polling owner。
    const nav = navigation();
    render(<WorkspaceLayout
      session={session()}
      navigation={{ ...nav, update: { status: 'unsupported', currentVersion: 'v0.06', detail: '当前版本不支持安全升级，请刷新或联系管理员/手动升级' } }}
    />);
    expect(screen.getByLabelText('当前版本（只读）').textContent).toContain('当前版本：v0.06（只读）');
    expect(screen.getByRole('button', { name: '当前版本不支持安全升级，请刷新或联系管理员/手动升级' }).disabled).toBe(true);
  });
});
