// @vitest-environment jsdom
// NR07 successor coverage through the public WorkspaceLayout owner. The old
// private primitive and its callbacks are intentionally absent.
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';

const RAIL_KEY = 'atoll.web.pane.rail';

afterEach(() => {
  cleanup();
  localStorage.removeItem(RAIL_KEY);
});

beforeEach(() => {
  localStorage.removeItem(RAIL_KEY);
});

function session() {
  return {
    wireState: 'open',
    me: { id: 'human:root:1', display_name: '我' },
    onLogout: vi.fn(),
  };
}

function navigation(overrides = {}) {
  return {
    channels: [
      { id: 'c0', name: 'c0', access: 'member_active' },
      { id: 'c1', name: 'c1', access: 'member_active' },
    ],
    channel: { id: 'c0', name: 'c0', access: 'member_active' },
    unread: {},
    agentActivity: { byChannel: {} },
    activeChannelId: 'c0',
    activeView: 'conversation',
    select: vi.fn(),
    setActiveView: vi.fn(),
    openSearch: vi.fn(),
    openSpaceAdministration: vi.fn(),
    openRoster: vi.fn(),
    ...overrides,
  };
}

function renderLayout() {
  const view = render(<WorkspaceLayout session={session()} navigation={navigation()} />);
  return {
    ...view,
    shell: () => view.container.querySelector('.shell'),
    handle: () => screen.getByRole('separator', { name: '调整频道栏宽度' }),
  };
}

describe('NR07 rail resize public owner', () => {
  it('reports each pointer frame and persists only on pointer-up', () => {
    const view = renderLayout();
    const handle = view.handle();

    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe('200');
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 264 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });
    expect(view.shell().style.getPropertyValue('--rail-width')).toBe('300px');
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 340 });
    expect(view.shell().style.getPropertyValue('--rail-width')).toBe('340px');
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 340 });
    expect(handle.getAttribute('aria-valuenow')).toBe('340');
    expect(localStorage.getItem(RAIL_KEY)).toBe('340');
  });

  it('fences another pointer and supports keyboard nudges plus reset gestures', () => {
    const view = renderLayout();
    const handle = view.handle();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 264 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 500 });
    fireEvent.pointerUp(handle, { pointerId: 8, clientX: 500 });
    expect(view.shell().style.getPropertyValue('--rail-width')).toBe('');
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 280 });
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 280 });
    expect(localStorage.getItem(RAIL_KEY)).toBe('280');

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(view.shell().style.getPropertyValue('--rail-width')).toBe('296px');
    expect(localStorage.getItem(RAIL_KEY)).toBe('296');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(view.shell().style.getPropertyValue('--rail-width')).toBe('280px');
    expect(localStorage.getItem(RAIL_KEY)).toBe('280');

    fireEvent.doubleClick(handle);
    expect(view.shell().style.getPropertyValue('--rail-width')).toBe('');
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(localStorage.getItem(RAIL_KEY)).toBe('280');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(view.shell().style.getPropertyValue('--rail-width')).toBe('');
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();
  });

  it('hydrates the old rail preference and clamps it to the public bounds', () => {
    localStorage.setItem(RAIL_KEY, '9999');
    const view = renderLayout();
    expect(view.shell().style.getPropertyValue('--rail-width')).toBe('520px');

    view.unmount();
    localStorage.setItem(RAIL_KEY, '100');
    const remounted = renderLayout();
    expect(remounted.shell().style.getPropertyValue('--rail-width')).toBe('200px');
  });
});
