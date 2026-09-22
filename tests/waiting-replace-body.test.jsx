// @vitest-environment jsdom
//
// Protocol §4.6: an accepted replace is itself the new row — the original
// leaves on `replaced_by` and the successor carries `new_text`. Waiting reads
// the body through its own helper, which must state the same thing the
// timeline does. A type name is a display label, never a body, and it must
// never reach the compare-and-swap that edits perform.
import React from 'react';
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useWaitingEditingController, WaitingLayer } from '../src/ui/timeline/useWaitingEditingController.jsx';

const SELF = 'human:me:1';
const AGENT = 'agent:worker:1';

function queuedReplace() {
  const replica = createChannelReplicaStore();
  replica.commit({
    channel_id: 'c0',
    seq: 1,
    envelope: {
      id: 'r1', kind: 'request', type: 'agent.replace',
      sender: { id: SELF, kind: 'human' }, audience: [AGENT],
      payload: { body: { target: 'old-1', old_text: '旧内容', new_text: '编辑后的内容' } },
    },
  });
  replica.commit({
    channel_id: 'c0',
    seq: 2,
    envelope: {
      id: 'p1', parent_id: 'r1', kind: 'response', type: 'agent.replace',
      sender: { id: AGENT, kind: 'agent' }, audience: [SELF],
      payload: { body: { status: 'queued' } },
    },
  });
  return replica.state('c0');
}

function waiting(state) {
  const { result } = renderHook(() => useWaitingEditingController({
    state, pending: [], awaiting: [], capabilityIndex: { get: () => undefined },
    onRequestCapability: vi.fn(), onTaskControl: vi.fn(), onComposerEditChange: vi.fn(),
  }));
  return result;
}

describe('a replace request in Waiting', () => {
  it('is shown as its replacement text, not as the type name', () => {
    const state = queuedReplace();
    const turn = waiting(state).current.queuedTurns.find((row) => row.requestId === 'r1');
    expect(turn).toBeTruthy();
    render(React.createElement(WaitingLayer, {
      turns: [turn], state, names: new Map(), selfId: SELF, access: 'member_active',
      capabilityIndex: { get: () => undefined }, editing: null,
      onCancel: vi.fn(), onControl: vi.fn(), onEdit: vi.fn(),
    }));
    expect(screen.getByText('编辑后的内容')).toBeTruthy();
    expect(screen.queryByText('agent.replace')).toBeNull();
  });
});
