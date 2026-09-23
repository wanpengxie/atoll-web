// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useChannelNavigation } from '../src/app/hooks/useWireSession.js';

afterEach(() => {
  cleanup();
  globalThis.location.hash = '';
  globalThis.localStorage.removeItem('atoll.web.last-channel');
});

function accessRefWith(rows) {
  return { current: { rows: () => rows, state: () => null } };
}

describe('TC-1501 workspace route validation through the public navigation owner', () => {
  it('rejects unknown view/focus and malformed hashes without guessing a target', () => {
    // Baseline: fae8b70:tests/workspace-route.test.js:20 rejected an unknown
    // view/focus and a malformed hash through the old parser. The current
    // navigation owner exposes the same safety boundary with its current
    // default view, conversation, rather than the deleted dynamic name.
    const accessRef = accessRefWith([
      { id: 'c0', name: 'home', access: 'member_active' },
      { id: 'c1', name: 'research', access: 'member_active' },
    ]);
    const rosterRef = { current: { self: () => '' } };

    globalThis.location.hash = '#/channels/c1/debug?focus=resource:secret';
    const first = renderHook(() => useChannelNavigation({ accessRef, rosterRef }));

    // User capability: an invalid deep link cannot select an unsupported view
    // or smuggle an unsupported focus kind into the visible workspace.
    expect(first.result.current.activeChannelId).toBe('c1');
    expect(first.result.current.activeView).toBe('conversation');
    expect(first.result.current.focus).toBeNull();
    expect(globalThis.location.hash).toBe('#/channels/c1/conversation');
    expect(globalThis.history.state).toMatchObject({
      atollRoute: { channelId: 'c1', view: 'conversation', focus: null },
    });

    first.unmount();
    // With no remembered channel on this browser, a malformed hash has
    // nothing to request (see the remembered case below).
    globalThis.localStorage.removeItem('atoll.web.last-channel');
    globalThis.location.hash = '#/broken';
    const second = renderHook(() => useChannelNavigation({ accessRef, rosterRef }));

    // Invariant: malformed input falls back to the access owner’s first usable
    // channel and the current default route; it never invents a channel or
    // carries focus from the rejected request.
    expect(second.result.current.activeChannelId).toBe('c0');
    expect(second.result.current.activeView).toBe('conversation');
    expect(second.result.current.focus).toBeNull();
    expect(globalThis.location.hash).toBe('#/channels/c0/conversation');
    expect(globalThis.history.state).toMatchObject({
      atollRoute: { channelId: 'c0', view: 'conversation', focus: null },
    });
  });

  it('an address without a channel opens the channel this browser was last on', () => {
    const accessRef = accessRefWith([
      { id: 'c0', name: 'home', access: 'member_active' },
      { id: 'c1', name: 'research', access: 'member_active' },
    ]);
    const rosterRef = { current: { self: () => '' } };
    globalThis.location.hash = '#/channels/c1/conversation';
    const first = renderHook(() => useChannelNavigation({ accessRef, rosterRef }));
    expect(first.result.current.activeChannelId).toBe('c1');
    first.unmount();

    globalThis.location.hash = '';
    const reopened = renderHook(() => useChannelNavigation({ accessRef, rosterRef }));
    expect(reopened.result.current.activeChannelId).toBe('c1');
    expect(globalThis.location.hash).toBe('#/channels/c1/conversation');
  });
});
