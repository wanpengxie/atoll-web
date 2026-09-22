// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';
import { resolveComposerAgentSelection } from '../src/ui/composer/composer-model.js';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
});

function session() {
  return { wireState: 'open', me: { id: 'human:root:1', display_name: 'Root' }, onLogout: vi.fn() };
}

function channelNavigation(activeChannelId = 'c0') {
  const channels = [
    { id: 'c0', qualified_name: 'c0', access: 'member_active' },
    { id: 'c1', qualified_name: 'c1', access: 'member_active' },
  ];
  return {
    channels,
    channel: channels.find((row) => row.id === activeChannelId) || null,
    activeChannelId,
    activeView: 'conversation',
    terminalVisible: false,
    unread: {},
    agentActivity: { byChannel: {} },
    select: vi.fn(),
    setActiveView: vi.fn(),
    openSearch: vi.fn(),
    openSpaceAdministration: vi.fn(),
  };
}

describe('N-R round 35 public shell/composer/notification contracts', () => {
  it('projects related and other unread badges only from settled shell facts', () => {
    const nav = channelNavigation();
    nav.unread = {
      c0: { related: 2, other: 3, pending: false, unknown: false },
      c1: { related: 4, other: 5, pending: true, unknown: false },
    };
    const view = render(<WorkspaceLayout
      session={session()}
      navigation={nav}
      conversation={{ element: <div>消息</div> }}
    />);

    const channelItems = [...view.container.querySelectorAll('.channel-item')];
    const c0 = channelItems.find((item) => item.querySelector('.channel-name')?.textContent === 'c0');
    const c1 = channelItems.find((item) => item.querySelector('.channel-name')?.textContent === 'c1');
    expect(c0?.querySelector('.unread-related')?.textContent).toBe('2');
    expect(c0?.querySelector('.unread-total:not(.unread-pending)')?.textContent).toBe('3');
    expect(c1?.querySelector('.unread-related')).toBeNull();
    expect(c1?.querySelector('.unread-total:not(.unread-pending)')).toBeNull();
    expect(c1?.querySelector('.unread-pending')?.textContent).toBe('…');

    nav.unread.c0 = { related: 2, other: 3, pending: false, unknown: true };
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={nav}
      conversation={{ element: <div>消息</div> }}
    />);
    const updatedC0 = [...view.container.querySelectorAll('.channel-item')]
      .find((item) => item.querySelector('.channel-name')?.textContent === 'c0');
    expect(updatedC0?.querySelector('.unread-related')).toBeNull();
    expect(updatedC0?.querySelector('.unread-total:not(.unread-pending)')).toBeNull();
    expect(updatedC0?.querySelector('.unread-pending')?.textContent).toBe('?');
  });

  it('keeps the mobile channel drawer focus inside its public shell surface while open', () => {
    vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    render(<WorkspaceLayout
      session={session()}
      navigation={channelNavigation()}
      conversation={{ element: <div>消息</div> }}
    />);

    const opener = screen.getByRole('button', { name: '打开频道列表' });
    fireEvent.click(opener);
    const close = screen.getByRole('button', { name: '关闭频道列表' });
    expect(document.activeElement).toBe(close);
    const rail = screen.getByRole('navigation', { name: '频道' });
    const drawer = rail.closest('.channel-rail');
    expect(drawer?.getAttribute('data-modal-layer')).not.toBeNull();
    expect(document.querySelector('main')?.inert).toBe(true);
    const focusable = [...drawer.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )];
    expect(focusable.length).toBeGreaterThan(2);
    const first = focusable[0];
    const last = focusable.at(-1);

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes the mobile drawer with Escape and restores the public opener', () => {
    vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    render(<WorkspaceLayout
      session={session()}
      navigation={channelNavigation()}
      conversation={{ element: <div>消息</div> }}
    />);

    const opener = screen.getByRole('button', { name: '打开频道列表' });
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '关闭频道列表' })).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector('main')?.inert).toBe(false);
  });

  it('keeps an explicit manual Agent ahead of a filter fallback in the public Composer selection model', () => {
    const roster = [
      { id: 'agent:manual', kind: 'agent', name: 'Manual' },
      { id: 'agent:filtered', kind: 'agent', name: 'Filtered' },
    ];
    const selection = resolveComposerAgentSelection({
      roster,
      manualAgentId: 'agent:manual',
      selectedAgentId: 'agent:filtered',
      selectedSource: 'filter',
    });
    expect(selection).toMatchObject({ actorId: 'agent:manual', source: 'manual' });
  });

  // Old notification contract (receipts/leases/identities); see read-position-unread.test.jsx.
  it.skip('revokes a following notification lease when the real surface leaves, even at the physical tail', async () => {
    const selfId = 'human:nr-round35:1';
    const channelId = 'c0.project';
    const runtime = createChannelFeedRuntime({
      wireRef: { current: null },
      rosterRef: { current: { self: () => selfId, observeFeed: () => {}, handleEnvelope: () => {} } },
      accessRef: { current: { live: () => false } },
      activeChannelRef: { current: channelId },
      onRoster: vi.fn(),
      onError: vi.fn(),
      onChannelsDiscovered: vi.fn(),
      onDirectoryInvalidated: vi.fn(),
      onSubmissionFeed: vi.fn(),
      onAccessChanged: vi.fn(),
    });
    runtime.mount();
    try {
      await runtime.getSnapshot().prepareLocalReplica(selfId, { focus: channelId });
      await runtime.getSnapshot().setHistoryGrants(
        [{ channel_id: channelId, head_seq: 0 }],
        { generation: 1, boot: 'nr-round35-notification' },
      );
      const feed = runtime.getSnapshot();
      const related = (id) => ({
        channel_id: channelId,
        source: 'live',
        envelope: {
          id,
          channel_id: channelId,
          kind: 'request',
          type: 'human.approve',
          sender: { kind: 'agent', id: 'agent:reviewer:1' },
          audience: [selfId],
          payload: { body: { text: 'approval required' } },
        },
      });

      feed.enqueue({ ...related('leave-1'), seq: 1 });
      const status = feed.historyFor(channelId);
      const lease = {
        authority: status.authority,
        owner: {
          channelId,
          viewKey: `${channelId}:conversation`,
          activationID: 'round35-activation',
          generation: status.generation,
          authorityRevision: status.notificationAuthorityRevision,
        },
        captured: {
          presentationRevision: Number(status.presentationRevision || 0),
          sourceRevision: Number(status.presentationRevision || 0),
          installedHighSeq: 1,
        },
        generation: status.generation,
        authorityRevision: status.notificationAuthorityRevision,
        caughtUp: true,
        atTail: true,
        following: true,
        surfaceVisible: true,
        cause: 'presented-follow',
        boundary: 1,
      };
      expect(feed.acknowledgeNotifications(lease)).toBe(1);
      feed.enqueue({ ...related('leave-2'), seq: 2 });
      expect(feed.unreadFor(channelId, selfId)).toEqual({ related: 0, other: 0, pending: false, unknown: false });

      expect(feed.acknowledgeNotifications({
        ...lease,
        caughtUp: false,
        following: false,
        atTail: true,
        surfaceVisible: false,
        cause: '',
        boundary: 0,
        captured: { ...lease.captured, installedHighSeq: 1 },
      })).toBe(false);
      feed.enqueue({ ...related('leave-3'), seq: 3 });
      expect(feed.unreadFor(channelId, selfId)).toEqual({ related: 2, other: 0, pending: false, unknown: false });
    } finally {
      runtime.destroy();
    }
  });
});
