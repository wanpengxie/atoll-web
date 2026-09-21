// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useChannelNavigation } from '../src/app/hooks/useWireSession.js';

afterEach(() => {
  cleanup();
  globalThis.location.hash = '';
});

function accessRefWith(rows) {
  return { current: { rows: () => rows, state: () => null } };
}

describe('TC-1500 workspace route restore through the public navigation owner', () => {
  it('encodes and restores the channel, current Files view, and stable artifact focus', () => {
    // Baseline: fae8b70:tests/workspace-route.test.js:6 encoded a channel,
    // the old artifacts view, and an artifact focus, then parsed the result.
    // The current public route names that same artifact surface `files`; the
    // deleted workspace-route helper is not reintroduced for this assertion.
    globalThis.location.hash = '#/channels/team%2F%E7%A0%94%E5%8F%91/files?focus=artifact%3Aartifact%3Ateam%2F%E7%A0%94%E5%8F%91%3Ares%201';
    const accessRef = accessRefWith([
      { id: 'c0', name: 'home', access: 'member_active' },
      { id: 'team/研发', name: '研发', access: 'member_active' },
    ]);
    const rosterRef = { current: { self: () => '' } };

    const { result } = renderHook(() => useChannelNavigation({ accessRef, rosterRef }));

    // User capability: reopening the deep link presents the requested channel
    // and artifact/file surface with the same typed focus identity.
    expect(result.current.activeChannelId).toBe('team/研发');
    expect(result.current.activeView).toBe('files');
    expect(result.current.focus).toEqual({
      type: 'artifact',
      key: 'artifact:team/研发:res 1',
    });

    // Invariant: one navigation owner projects the validated request back to
    // the encoded URL and typed history state without guessing another view.
    expect(globalThis.location.hash).toBe(
      '#/channels/team%2F%E7%A0%94%E5%8F%91/files?focus=artifact%3Aartifact%3Ateam%2F%E7%A0%94%E5%8F%91%3Ares%201',
    );
    expect(globalThis.history.state).toMatchObject({
      atollContextEntry: false,
      atollRoute: {
        channelId: 'team/研发',
        view: 'files',
        focus: { type: 'artifact', key: 'artifact:team/研发:res 1' },
      },
    });
  });
});
