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
  it('[AD-202] shows one root-gated confirmation action for an available update', () => {
    // 用户能力：后端给出可用版本时，Shell 只有一个确认入口。
    // 不变量：入口消费唯一 session/update port，不从布局自行发 HTTP。
    const nav = navigation();
    const start = vi.fn();
    render(<WorkspaceLayout
      session={session()}
      navigation={{ ...nav, update: {
        value: { current_version: 'v0.06', latest_version: 'v0.07', available: true, status: 'idle' },
        pending: false,
        start,
      } }}
    />);
    expect(screen.getByRole('button', { name: '升级到 v0.07' }).disabled).toBe(false);
    expect(screen.getByLabelText('当前版本（只读）').textContent).toContain('v0.06');
  });

  it('[AD-203] reports active progress through the same disabled action and preserves version', () => {
    // 用户能力：升级执行期间按钮不可重复提交，当前版本仍来自同一后端事实。
    // 不变量：active progress 不伪造完成，也不创建第二 command owner。
    const nav = navigation();
    render(<WorkspaceLayout
      session={session()}
      navigation={{ ...nav, update: {
        value: { current_version: 'v0.06', latest_version: 'v0.07', available: true, status: 'downloading' },
        pending: false,
        start: vi.fn(),
      } }}
    />);
    expect(screen.getByLabelText('当前版本（只读）').textContent).toContain('当前版本：v0.06（只读）');
    expect(screen.getByRole('button', { name: '正在下载…' }).disabled).toBe(true);
  });

  it('[AD-202/203] renders an explicit unavailable terminal from the session port', () => {
    const nav = navigation();
    render(<WorkspaceLayout
      session={session()}
      navigation={{ ...nav, update: {
        value: { current_version: 'dev', available: false, status: 'unsupported', detail: '开发版不执行自动升级' },
        pending: false,
        start: vi.fn(),
      } }}
    />);
    expect(screen.getByRole('button', { name: '开发版不执行自动升级' }).disabled).toBe(true);
    expect(screen.getByLabelText('当前版本（只读）').textContent).toContain('当前版本：dev（只读）');
  });
});
