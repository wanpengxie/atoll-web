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
  it.fails('[AD-202] shows one confirmation-gated update action only when a node update is available', () => {
    // 用户能力：节点有新版本时，用户看到唯一的升级入口并在真正中断连接前确认。
    // 不变量：VersionIncompatible 终态不能冒充 node-update owner；当前公开入口是 WorkspaceLayout。
    const nav = navigation();
    render(<WorkspaceLayout
      session={session()}
      navigation={{ ...nav, update: { value: { current_version: 'v0.06', latest_version: 'v0.07', available: true, status: 'idle' }, start: vi.fn() } }}
    />);
    expect(screen.getByRole('button', { name: '升级到 v0.07' })).toBeTruthy();
  });

  it.fails('[AD-203] reports node-update progress through the same disabled action and shows the current version', () => {
    // 用户能力：升级校验/执行期间按钮不可重复提交，完成后只显示当前版本。
    // 不变量：进度、成功和版本事实必须来自同一公开 node-update owner。
    const nav = navigation();
    render(<WorkspaceLayout
      session={session()}
      navigation={{ ...nav, update: { value: { current_version: 'v0.07', latest_version: 'v0.07', available: false, status: 'succeeded' }, start: vi.fn() } }}
    />);
    expect(screen.getByTitle('Atoll v0.07')).toBeTruthy();
  });
});
