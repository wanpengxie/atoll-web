// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply, createChannelState } from '../src/model/fold.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { Timeline } from '../src/ui/Timeline.jsx';

vi.mock('../src/ui/timeline/LegendMessageList.jsx', async () => {
  const ReactModule = await import('react');
  const { MessageLayoutScope } = await import('../src/ui/timeline/MessageLayoutState.jsx');
  return {
    MessageList({ snapshot, renderRow }) {
      return <div className="timeline-message-list" role="region" aria-label="频道动态">
        {snapshot.rows.map((row) => (
          <MessageLayoutScope key={row.id} rowID={row.id}>
            {ReactModule.cloneElement(renderRow(row), { 'data-presentation-row-id': row.id })}
          </MessageLayoutScope>
        ))}
      </div>;
    },
  };
});

afterEach(() => {
  window.localStorage.clear();
});

const request = (id, text) => ({
  id,
  kind: 'request',
  type: 'agent.ask',
  ts: 100,
  sender: { kind: 'human', id: 'me' },
  audience: ['agent'],
  visibility: 'public',
  payload: { body: { text } },
});

const response = (id, parentId, payload, ts = 110) => ({
  id,
  parent_id: parentId,
  kind: 'response',
  type: 'agent.ask',
  ts,
  sender: { kind: 'agent', id: 'agent' },
  audience: ['me'],
  visibility: 'public',
  payload: { body: payload },
});

function add(state, seq, envelope) {
  apply(state, { channel_id: state.channelId, seq, envelope });
}

function processingState(channelId) {
  const state = createChannelState(channelId);
  add(state, 1, request('work', 'committed work'));
  add(state, 2, response('work-p', 'work', {
    status: 'processing',
    controls: [{ word: 'agent.interrupt', payload: { target: 'work' } }],
  }));
  add(state, 3, response('work-tool', 'work', {
    status: 'processing',
    controls: [{ word: 'agent.interrupt', payload: { target: 'work' } }],
    process: {
      kind: 'tool', phase: 'started', tool_call_id: 'read-1', tool: 'read_file',
    },
  }, 120));
  return state;
}

const roster = [
  { id: 'me', kind: 'human', name: '我' },
  { id: 'agent', kind: 'agent', name: 'Agent' },
];

describe('Timeline render authority', () => {
  it('keeps a committed presentation choice on its committed channel without taking reading control', async () => {
    const stateA = processingState('c0');
    const stateB = createChannelState('c1');
    const store = createViewSessionStore({ principalID: 'render-authority' });
    const save = vi.fn((...args) => store.save(...args));
    const writeConversation = vi.fn((...args) => store.writeConversation(...args));
    const viewSessions = { ...store, save, writeConversation };
    const never = new Promise(() => {});
    let candidateRendered = false;

    function Suspender({ active }) {
      if (active) {
        candidateRendered = true;
        throw never;
      }
      return null;
    }

    function Harness() {
      const [candidate, setCandidate] = React.useState(false);
      return <>
        <button type="button" onClick={() => React.startTransition(() => setCandidate(true))}>start candidate</button>
        <React.Suspense fallback={<div>candidate fallback</div>}>
          <Timeline
            state={candidate ? stateB : stateA}
            viewSessions={viewSessions}
            roster={roster}
            selfId="me"
            pending={[]}
            approvalStates={{}}
            access="member_active"
          />
          <Suspender active={candidate} />
        </React.Suspense>
      </>;
    }

    render(<Harness />);
    const committedToggle = await screen.findByRole('button', { name: /展开过程详情/ });
    const committedScroller = committedToggle.closest('[data-reading-container="following-tail"]');
    expect(committedScroller).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'start candidate' }));
    await waitFor(() => expect(candidateRendered).toBe(true));
    expect(screen.queryByText('candidate fallback')).toBeNull();
    expect(committedToggle.isConnected).toBe(true);

    fireEvent.click(committedToggle);
    await waitFor(() => expect(writeConversation).toHaveBeenCalled());
    expect(committedScroller.isConnected).toBe(true);
    expect(committedToggle.closest('[data-reading-container="following-tail"]')).toBe(committedScroller);
    expect(document.querySelector('.timeline')?.dataset.viewportMode).toBe('following');
    expect(save).not.toHaveBeenCalled();
    expect(writeConversation.mock.calls.some(([channelID]) => channelID === 'c0')).toBe(true);
    expect(writeConversation.mock.calls.some(([channelID]) => channelID === 'c1')).toBe(false);
  });
});
