// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useChannelNavigation } from '../src/app/hooks/useWireSession.js';
import { useWaitingEditingController } from '../src/ui/timeline/useWaitingEditingController.jsx';

const SELF = 'human:me:1';
const AGENT = 'agent:worker:1';

function commitRequest(replica, seq, id, overrides = {}) {
  replica.commit({
    channel_id: 'c0',
    seq,
    envelope: {
      id,
      kind: 'request',
      type: 'agent.ask',
      sender: { id: SELF, kind: 'human' },
      audience: [AGENT],
      payload: { body: { text: `text-${id}` } },
      ...overrides,
    },
  });
}

function commitStatus(replica, seq, id, parentId, status) {
  replica.commit({
    channel_id: 'c0',
    seq,
    envelope: {
      id,
      parent_id: parentId,
      kind: 'response',
      type: 'agent.ask',
      sender: { id: AGENT, kind: 'agent' },
      audience: [SELF],
      payload: { body: { status } },
    },
  });
}

function localSubmission(id) {
  return {
    messageId: id,
    state: 'accepted',
    text: `text-${id}`,
    createdAt: 10,
    frame: {
      id,
      kind: 'request',
      msg_type: 'agent.ask',
      audience: [AGENT],
      payload: { text: `text-${id}` },
      visibility: 'public',
    },
  };
}

function renderWaiting(state, pending) {
  // These are this session's own hand-offs, which is what the awaiting set
  // holds; the durable pending list drops them the moment the write is
  // acknowledged.
  return renderHook(({ currentState }) => useWaitingEditingController({
    state: currentState,
    pending,
    awaiting: pending,
    capabilityIndex: { get: () => undefined },
    onRequestCapability: vi.fn(),
    onTaskControl: vi.fn(),
    onComposerEditChange: vi.fn(),
  }), { initialProps: { currentState: state } });
}

function navigation(rowsRef = { current: [
  { id: 'c0', name: 'c0', access: 'member_active' },
  { id: 'c1', name: 'c1', access: 'member_active' },
] }) {
  const accessRef = { current: { rows: () => rowsRef.current } };
  return renderHook(() => useChannelNavigation({
    accessRef,
    rosterRef: { current: null },
  }));
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '#/channels/c0/conversation');
});

describe('S-Z Round 58 public regression contracts', () => {
  it('[SZ-292] keeps one visible Waiting id across local, landed-open, and queued phases', () => {
    const replica = createChannelReplicaStore();
    replica.ensure('c0');
    const pending = [localSubmission('same-id')];
    const { result, rerender } = renderWaiting(replica.state('c0'), pending);
    const ids = () => result.current.queuedTurns.map((turn) => turn.requestId);

    // Public local echo: one visible Waiting turn exists before Replica has a
    // canonical position.
    expect(ids()).toEqual(['same-id']);

    // The canonical request has landed, but no provisional lifecycle fact has
    // arrived yet. The user-visible contract still requires one stable turn;
    // it must not go blank while the local echo is being replaced.
    commitRequest(replica, 20, 'same-id');
    rerender({ currentState: replica.state('c0') });
    expect(ids()).toEqual(['same-id']);
    expect(new Set(ids()).size).toBe(1);

    // Once the explicit queued fact arrives, the same request remains one
    // visible turn rather than reappearing as a duplicate local/canonical pair.
    commitStatus(replica, 21, 'same-id-p', 'same-id', 'queued');
    rerender({ currentState: replica.state('c0') });
    expect(ids()).toEqual(['same-id']);
    expect(new Set(ids()).size).toBe(1);
  });

  it.fails('[SZ-331] opens a context route as one browser history entry', () => {
    const { result } = navigation();
    const historyStart = window.history.length;

    // WorkspaceApp.openTaskItem is the public composition path: ordinary view
    // selection followed by a focused Context panel. A single context open
    // must be one push entry, so Back returns to the prior user route rather
    // than exposing an intermediate panel-less Tasks route.
    act(() => {
      result.current.setActiveView('tasks');
      result.current.setFocus({ type: 'work_item', key: 'task-1' });
    });

    expect(window.location.hash).toBe('#/channels/c0/tasks?focus=work_item%3Atask-1');
    expect(window.history.length).toBe(historyStart + 1);
    expect(window.history.state).toMatchObject({ atollContextEntry: true });
  });
});
