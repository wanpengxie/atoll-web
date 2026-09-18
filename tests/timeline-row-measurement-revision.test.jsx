// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { apply, createChannelState } from '../src/model/fold.js';
import { TYPES } from '../src/protocol/vocab.js';
import { Timeline } from '../src/ui/Timeline.jsx';

const listProbe = vi.hoisted(() => ({ props: null }));

vi.mock('../src/ui/timeline/LegendMessageList.jsx', () => ({
  MessageList(props) {
    listProbe.props = props;
    return <div data-testid="measurement-list" />;
  },
}));

afterEach(() => {
  cleanup();
  listProbe.props = null;
});

function append(state, seq, envelope) {
  apply(state, { channel_id: state.channelId, seq, envelope });
}

function request(id, type = TYPES.agentAsk) {
  return {
    id,
    kind: 'request',
    type,
    ts: 100,
    sender: { kind: 'human', id: 'me' },
    audience: ['agent'],
    visibility: 'public',
    payload: type === TYPES.agentSelect ? { model: 'model-a', effort: 'low' } : { text: 'work' },
  };
}

function response(id, parentId, type, payload) {
  return {
    id,
    parent_id: parentId,
    kind: 'response',
    type,
    ts: 110,
    sender: { kind: 'agent', id: 'agent' },
    audience: ['me'],
    visibility: 'public',
    payload,
  };
}

const baseRoster = [
  { id: 'me', kind: 'human', name: '我' },
  { id: 'agent', kind: 'agent', name: 'Agent' },
];

function common(state, overrides = {}) {
  return {
    state,
    roster: baseRoster,
    selfId: 'me',
    pending: [],
    approvalStates: {},
    access: 'member_active',
    ...overrides,
  };
}

function capturedRow() {
  expect(listProbe.props).toBeTruthy();
  expect(listProbe.props.snapshot.rows).toHaveLength(1);
  return listProbe.props.snapshot.rows[0];
}

function revisionOf(row) {
  return listProbe.props.rowRevision(null, row);
}

it('changes the per-row measurement signature when target authority or roster kind changes without changing row data', () => {
  const state = createChannelState('c0');
  append(state, 1, request('work'));
  append(state, 2, response('work-progress', 'work', TYPES.agentAsk, {
    status: 'processing',
    controls: [{ word: TYPES.agentInterrupt }],
  }));

  const view = render(<Timeline {...common(state, { waitingRosterAuthority: null })} />);
  const row = capturedRow();
  const unknownTarget = revisionOf(row);

  view.rerender(<Timeline {...common(state, {
    waitingRosterAuthority: { current: true, actorIDs: new Set(['agent']) },
  })} />);
  expect(capturedRow()).toBe(row);
  const currentTarget = revisionOf(row);
  expect(currentTarget).not.toBe(unknownTarget);

  view.rerender(<Timeline {...common(state, {
    roster: [baseRoster[0], { ...baseRoster[1], kind: 'human' }],
    waitingRosterAuthority: { current: true, actorIDs: new Set(['agent']) },
  })} />);
  expect(capturedRow()).toBe(row);
  expect(revisionOf(row)).not.toBe(currentTarget);
});

it('keys an agent.select row by the rendered describe labels, not only by capability word names', () => {
  const state = createChannelState('c0');
  append(state, 1, request('select', TYPES.agentSelect));
  append(state, 2, response('select-done', 'select', TYPES.agentSelect, {
    status: 'completed',
    usage: { model: 'model-a', effort: 'low' },
  }));
  const capability = (modelTitle) => new Map([['agent', {
    describe: {
      types: new Map([[TYPES.agentSelect, {
        inputSchema: {
          oneOf: [{ properties: {
            model: { const: 'model-a', title: modelTitle },
            effort: { const: 'low', title: '低' },
          } }],
        },
      }]]),
    },
  }]]);

  const view = render(<Timeline {...common(state, { capabilityIndex: capability('短名') })} />);
  const row = capturedRow();
  const shortLabel = revisionOf(row);

  view.rerender(<Timeline {...common(state, { capabilityIndex: capability('会改变行宽和高度的长模型名称') })} />);
  expect(capturedRow()).toBe(row);
  expect(revisionOf(row)).not.toBe(shortLabel);
});

it('includes the presentation content revision used to reset a failed row boundary', () => {
  const state = createChannelState('c0');
  append(state, 1, request('done'));
  append(state, 2, response('done-response', 'done', TYPES.agentAsk, {
    status: 'completed',
    text: 'answer',
  }));

  render(<Timeline {...common(state)} />);
  const row = capturedRow();
  expect(revisionOf({ ...row, contentRevision: `${row.contentRevision}:next` }))
    .not.toBe(revisionOf(row));
});
