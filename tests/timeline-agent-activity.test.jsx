// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { createChannelState, apply } from '../src/model/fold.js';
import { recordLiveTimelineArrival } from '../src/model/live-arrivals.js';
import { Timeline } from '../src/ui/Timeline.jsx';

const readingProbe = vi.hoisted(() => ({ current: null, observations: [] }));
// FollowingTailList is the canonical renderer while ReadingSession is in
// following mode. Mock that public role boundary rather than the browsing-only
// Virtuoso adapter: otherwise the probe silently observes no mounted owner.
vi.mock('../src/ui/timeline/FollowingTailList.jsx', async () => {
  const { PresentationMessageList } = await import('./helpers/PresentationMessageList.jsx');
  return {
    FollowingTailList(props) {
      readingProbe.current = props.reading;
      React.useLayoutEffect(() => {
        if (props.surfaceVisible !== true || !props.snapshot.rows.length) return;
        const observation = {
          activationID: props.reading.activationID,
          source: 'semantic-test-boundary',
          atTail: true,
          surfaceVisible: true,
          installedHighSeq: Math.max(...props.snapshot.rows.map((row) => Number(row.seqHigh || 0))),
          visibleRows: props.snapshot.rows.map((row) => ({
            messageID: row.id,
            seqHigh: Number(row.seqHigh || 0),
          })),
        };
        readingProbe.observations.push(observation);
        props.reading.onReadingObservation(observation);
      }, [props.reading.activationID, props.snapshot.revision, props.surfaceVisible]);
      return <PresentationMessageList {...props} />;
    },
  };
});

afterEach(() => {
  cleanup();
  readingProbe.current = null;
  readingProbe.observations = [];
});

function ledger() {
  const state = createChannelState('c0');
  apply(state, { channel_id: 'c0', seq: 1, envelope: {
    id: 'note-1', kind: 'event', type: 'human.note', ts: 1,
    sender: { id: 'human:root:1', kind: 'human' }, payload: { body: { text: 'hello' } }, audience: [],
  } });
  return state;
}

const roster = [
  { id: 'human:root:1', kind: 'human', name: '我' },
  { id: 'agent:codex:1', kind: 'agent', name: 'Codex' },
  { id: 'agent:claude:1', kind: 'agent', name: 'Claude' },
];

it('acknowledges settled activity through the existing member filter interaction', async () => {
  const user = userEvent.setup();
  const acknowledge = vi.fn();
  const base = { state: ledger(), roster, selfId: 'human:root:1', pending: [], approvalStates: {}, access: 'member_active', onAcknowledgeAgentActivity: acknowledge };
  const view = render(<Timeline {...base} agentActivity={{ agents: {
    'agent:codex:1': { active: 1, settled: 0, state: 'active' },
    'agent:claude:1': { active: 0, settled: 1, state: 'settled' },
  } }} />);

  const codex = screen.getByRole('button', { name: 'Codex' });
  const claude = screen.getByRole('button', { name: 'Claude' });
  expect(codex.classList.contains('activity-active')).toBe(true);
  expect(codex.querySelector('.agent-activity-dot')).toBeTruthy();
  expect(claude.classList.contains('activity-settled')).toBe(true);
  fireEvent.click(codex);
  expect(acknowledge).not.toHaveBeenCalled();
  expect(codex.getAttribute('aria-pressed')).toBe('true');
  const listBefore = document.querySelector('.timeline-message-list');

  expect(screen.queryByRole('button', { name: '确认 Claude 已完成' })).toBeNull();
  claude.focus();
  await user.keyboard('{Enter}');
  expect(acknowledge).toHaveBeenCalledWith('agent:claude:1');
  expect(claude.getAttribute('aria-pressed')).toBe('true');
  expect(codex.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('.timeline-message-list')).toBe(listBefore);

  view.rerender(<Timeline {...base} agentActivity={{ agents: {
    'agent:codex:1': { active: 1, settled: 0, state: 'active' },
  } }} />);
  const clearedClaude = screen.getByRole('button', { name: 'Claude' });
  expect(clearedClaude.classList.contains('activity-settled')).toBe(false);
  expect(clearedClaude.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(clearedClaude);
  expect(clearedClaude.getAttribute('aria-pressed')).toBe('false');
  expect(acknowledge).toHaveBeenCalledTimes(1);
});

it('balances consumers without treating A→B→A replacement as visible-arrival acknowledgement', () => {
  const stateA = ledger();
  const stateB = createChannelState('c1');
  const props = {
    roster: [], selfId: 'human:root:1', pending: [], approvalStates: {},
    access: 'member_active', surfaceVisible: true,
  };
  const view = render(<StrictMode><Timeline {...props} state={stateA} /></StrictMode>);
  expect(stateA._liveArrivalConsumers).toBe(1);

  const arrivalA = {
    id: 'a-live', kind: 'event', type: 'human.note', visibility: 'public',
    sender: { id: 'other', kind: 'human' }, audience: ['human:root:1'],
    payload: { body: { text: 'A live' } },
  };
  apply(stateA, { channel_id: 'c0', seq: 2, envelope: arrivalA });
  recordLiveTimelineArrival(stateA, arrivalA, 2, 'human:root:1');
  expect(stateA._liveArrivalLog).toHaveLength(1);

  view.rerender(<StrictMode><Timeline {...props} state={stateB} /></StrictMode>);
  expect(stateA._liveArrivalConsumers).toBe(0);
  // Losing the consumer is lifecycle bookkeeping, not evidence that the row
  // was installed, topmost and visible. Preserve it for the successor view.
  expect(stateA._liveArrivalLog).toHaveLength(1);
  expect(stateA._liveArrivalAckRevision).toBe(0);
  expect(stateB._liveArrivalConsumers).toBe(1);

  const arrivalB = {
    id: 'b-live', kind: 'event', type: 'human.note', visibility: 'public',
    sender: { id: 'other', kind: 'human' }, audience: ['human:root:1'],
    payload: { body: { text: 'B live' } },
  };
  apply(stateB, { channel_id: 'c1', seq: 1, envelope: arrivalB });
  recordLiveTimelineArrival(stateB, arrivalB, 1, 'human:root:1');
  view.rerender(<StrictMode><Timeline {...props} state={stateA} /></StrictMode>);
  expect(stateB._liveArrivalConsumers).toBe(0);
  expect(stateB._liveArrivalLog).toHaveLength(1);
  expect(stateB._liveArrivalAckRevision).toBe(0);
  expect(stateA._liveArrivalConsumers).toBe(1);
  // Returning to A is not itself the authority. The semantic adapter reports
  // the exact committed row identities through ReadingSession's public port;
  // that receipt, and only that receipt, may dispose the preserved arrival.
  expect(screen.getByText('A live')).toBeTruthy();
  expect(readingProbe.observations.at(-1)).toMatchObject({
    activationID: readingProbe.current.activationID,
    surfaceVisible: true,
    installedHighSeq: 2,
    visibleRows: expect.arrayContaining([{ messageID: 'a-live', seqHigh: 2 }]),
  });
  expect(stateA._liveArrivalLog).toHaveLength(0);
  expect(stateA._liveArrivalAckRevision).toBe(1);

  view.unmount();
  expect(stateA._liveArrivalConsumers).toBe(0);
  const unrelatedBackground = {
    id: 'a-background', kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'other' },
    payload: { body: { text: 'background message' } },
  };
  apply(stateA, { channel_id: 'c0', seq: 3, envelope: unrelatedBackground });
  expect(recordLiveTimelineArrival(stateA, unrelatedBackground, 3, 'human:root:1')).toBeNull();
  expect(stateA._liveArrivalRevision).toBe(1);
  expect(stateA._liveArrivalAckRevision).toBe(1);
  expect(stateA._liveArrivalLog).toHaveLength(0);
});
