// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let capturedComposerProps = null;
vi.mock('../src/ui/ChannelList.jsx', () => ({ ChannelList: () => null }));
vi.mock('../src/ui/ArtifactsView.jsx', () => ({ ArtifactsView: () => null }));
vi.mock('../src/ui/TasksView.jsx', () => ({ TasksView: () => null }));
vi.mock('../src/ui/Composer.jsx', () => ({
  Composer: (props) => { capturedComposerProps = props; return <div data-testid="composer-capabilities" />; },
}));
vi.mock('../src/ui/Timeline.jsx', () => ({ Timeline: ({ composer }) => <section id="workspace-panel-dynamic">{composer}</section> }));
vi.mock('../src/ui/TerminalView.jsx', () => ({ TerminalView: () => null }));
vi.mock('../src/app/RightPanelHost.jsx', () => ({ RightPanelHost: () => null }));

import { AppShell } from '../src/app/AppShell.jsx';

function shellProps({ access = 'member_active', wireState = 'reconnecting', principal = 'root' } = {}) {
  return {
    session: { wireState, me: principal ? { id: principal } : null, onLogout: vi.fn() },
    navigation: {
      channels: [{ id: 'c0', access }], activeChannelId: 'c0', unread: {},
      onSelect: vi.fn(), onCreate: vi.fn(), onSearch: vi.fn(), onActivity: vi.fn(), onSpaceManage: vi.fn(),
    },
    workspace: {
      channel: { id: 'c0', name: 'c0' }, view: 'dynamic', onViewChange: vi.fn(), access,
      state: { turns: new Map(), lastSeq: 0 }, roster: [], selfId: principal ? 'human:root:1' : '', pending: [],
      approvalStates: {}, controlStates: {}, capabilityIndex: new Map(), attachments: [], resources: {},
      tasks: { items: [] }, agentSelection: {},
    },
    notices: {},
    panel: { value: '', open: vi.fn(), host: {} },
  };
}

afterEach(() => {
  cleanup();
  capturedComposerProps = null;
});

describe('AppShell offline composer authority', () => {
  it('separates known-member durable acceptance from transport availability', async () => {
    render(<AppShell {...shellProps()} />);
    await waitFor(() => expect(capturedComposerProps).toBeTruthy());
    expect(capturedComposerProps).toMatchObject({
      canEditDraft: true,
      canDurablyAccept: true,
      canTransmit: false,
      disabled: false,
    });
  });

  it.each([
    ['observer_active', 'root'],
    ['access_denied', 'root'],
    ['loading', 'root'],
    ['member_active', ''],
  ])('does not grant durable acceptance for access=%s principal=%s', async (access, principal) => {
    render(<AppShell {...shellProps({ access, principal })} />);
    await waitFor(() => expect(capturedComposerProps).toBeTruthy());
    expect(capturedComposerProps).toMatchObject({
      canEditDraft: false,
      canDurablyAccept: false,
      canTransmit: false,
      disabled: true,
    });
  });

  it('撤权文案明确说明缓存内容已隐藏，不暗示仍可本地查看', () => {
    render(<AppShell {...shellProps({ access: 'access_denied' })} />);
    expect(screen.getByRole('status').textContent).toContain('缓存内容已隐藏');
    expect(screen.queryByText(/历史缓存仅供本地查看/)).toBeNull();
    expect(screen.getByText('当前页面不会展示或搜索此前缓存的消息、产物、任务和成员。')).toBeTruthy();
    expect(capturedComposerProps).toMatchObject({ disabled: true, canDurablyAccept: false, canTransmit: false });
  });
});
