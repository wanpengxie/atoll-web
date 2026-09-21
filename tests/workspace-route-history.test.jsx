// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useChannelNavigation } from '../src/app/hooks/useWireSession.js';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '#/channels/c0/conversation');
});

function navigation() {
  const accessRef = { current: { rows: () => [
    { id: 'c0', name: 'home', access: 'member_active' },
    { id: 'c1', name: 'research', access: 'member_active' },
  ] } };
  return renderHook(() => useChannelNavigation({
    accessRef,
    rosterRef: { current: null },
  }));
}

describe('TC-1502 workspace route history through the public navigation owner', () => {
  it('uses replace for ordinary navigation and one push for a channel Context entry', () => {
    // Baseline: fae8b70:tests/workspace-route.test.js:28 wrote an ordinary
    // tasks route with replaceState, then a channel focus Context with one
    // pushState. Keep the exact channel-focus fixture while observing the
    // current public hook and browser history, not the deleted helper.
    window.location.hash = '#/channels/c1/conversation';
    const { result } = navigation();
    const historyStart = window.history.length;

    // User capability: ordinary view navigation does not add a Back step.
    act(() => result.current.setActiveView('tasks'));
    expect(window.history.length).toBe(historyStart);
    expect(window.location.hash).toBe('#/channels/c1/tasks');
    expect(window.history.state).toMatchObject({
      atollContextEntry: false,
      atollRoute: { channelId: 'c1', view: 'tasks', focus: null },
    });

    // Invariant: opening a typed Context is the single new history entry and
    // preserves the exact channel focus identity.
    act(() => result.current.setFocus({ type: 'channel', key: 'c1' }));
    expect(window.history.length).toBe(historyStart + 1);
    expect(window.location.hash).toBe('#/channels/c1/tasks?focus=channel%3Ac1');
    expect(window.history.state).toMatchObject({
      atollContextEntry: true,
      atollRoute: {
        channelId: 'c1',
        view: 'tasks',
        focus: { type: 'channel', key: 'c1' },
      },
    });
  });
});
