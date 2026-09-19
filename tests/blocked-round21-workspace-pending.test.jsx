// @vitest-environment jsdom
// Round 21 extends the public Workspace pending-selection regression packet
// through the keyboard and terminal-toggle paths.  These are expected-fail
// product probes; they are not skipped, deleted, or counted as recovered.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function session() {
  return {
    wireState: 'open',
    me: { id: 'human:root:1', display_name: 'Root' },
    onLogout: vi.fn(),
  };
}

function navigation(activeChannelId = 'c0', overrides = {}) {
  const channels = [
    { id: 'c0', name: 'c0', qualified_name: 'c0', access: 'member_active' },
    { id: 'c1', name: 'c1', qualified_name: 'c1', access: 'member_active' },
    { id: 'c2', name: 'c2', qualified_name: 'c2', access: 'member_active' },
  ];
  const active = channels.find((channel) => channel.id === activeChannelId) || null;
  return {
    channels,
    activeChannelId,
    activeChannel: active,
    channel: active,
    activeView: 'conversation',
    terminalVisible: false,
    select: vi.fn(),
    setActiveView: vi.fn(),
    openSearch: vi.fn(),
    openSpaceAdministration: vi.fn(),
    openRoster: vi.fn(),
    openTerminal: vi.fn(),
    ...overrides,
  };
}

function renderShell(nav) {
  return render(<WorkspaceLayout
    session={session()}
    navigation={nav}
    conversation={{ element: <div data-testid="message-surface">消息</div> }}
  />);
}

describe('Workspace pending selection public regression packet', () => {
  it.fails('[AD-097-K] keyboard A-to-B-to-A clears the old pending target', () => {
    const nav = navigation();
    renderShell(nav);

    // Ctrl+2 selects c1, then Ctrl+1 is the user’s immediate reselect of the
    // committed c0 identity before the navigation owner commits c1.  The
    // keyboard route returns before the shared selectChannel cancellation
    // gate, leaving the old presentation pending.
    fireEvent.keyDown(document, { key: '2', ctrlKey: true });
    fireEvent.keyDown(document, { key: '1', ctrlKey: true });

    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1', 'c0']);
  });

  it.fails('[AD-105-T] rapid A-to-B-to-A releases terminal transition lock', () => {
    const nav = navigation();
    renderShell(nav);

    fireEvent.keyDown(document, { key: '2', ctrlKey: true });
    fireEvent.keyDown(document, { key: '1', ctrlKey: true });

    // The final user target is the already committed c0.  A stale c1 pending
    // selection must not keep the terminal command path disabled.
    expect(document.getElementById('workspace-terminal-toggle')?.disabled).toBe(false);
  });
});
