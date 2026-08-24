// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../src/ui/ChannelList.jsx', () => ({ ChannelList: () => null }));
vi.mock('../src/ui/ArtifactsView.jsx', () => ({ ArtifactsView: () => null }));
vi.mock('../src/ui/TasksView.jsx', () => ({ TasksView: () => null }));
vi.mock('../src/ui/Composer.jsx', () => ({ Composer: () => <div data-testid="composer" /> }));
vi.mock('../src/ui/Timeline.jsx', () => ({ Timeline: () => <section id="workspace-panel-dynamic" role="tabpanel" aria-labelledby="workspace-tab-dynamic">消息</section> }));
vi.mock('../src/ui/TerminalView.jsx', () => ({ TerminalView: ({ visible }) => <section id="workspace-panel-terminal" aria-labelledby="workspace-terminal-toggle" hidden={!visible}>终端内容</section> }));
vi.mock('../src/app/RightPanelHost.jsx', () => ({ RightPanelHost: () => null }));

import { AppShell } from '../src/app/AppShell.jsx';

function props(view = 'dynamic') {
  return {
    session: { wireState: 'open', me: { id: 'root' }, onLogout: vi.fn() },
    navigation: {
      channels: [{ id: 'c0', access: 'member_active' }],
      activeChannelId: 'c0', unread: {}, onSelect: vi.fn(), onCreate: vi.fn(),
      onSearch: vi.fn(), onActivity: vi.fn(), onSpaceManage: vi.fn(),
    },
    workspace: {
      channel: { id: 'c0', name: 'c0' }, view, onViewChange: vi.fn(), access: 'member_active',
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
