// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createChannelState, apply } from '../src/model/fold.js';
import { Timeline } from '../src/ui/Timeline.jsx';

afterEach(cleanup);

function ledger() {
  const state = createChannelState('c0');
  apply(state, { channel_id: 'c0', seq: 1, envelope: {
    id: 'note-1', kind: 'event', type: 'human.note', ts: 1,
    sender: { id: 'human:root:1', kind: 'human' }, payload: { text: 'hello' }, audience: [],
  } });
  return state;
}

const roster = [
  { id: 'human:root:1', kind: 'human', name: '我' },
  { id: 'agent:codex:1', kind: 'agent', name: 'Codex' },
  { id: 'agent:claude:1', kind: 'agent', name: 'Claude' },
];

it('marks running Agent green, settled Agent red, and acknowledges red on click', () => {
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
  fireEvent.click(claude);
  expect(acknowledge).toHaveBeenCalledWith('agent:claude:1');

  view.rerender(<Timeline {...base} agentActivity={{ agents: {
    'agent:codex:1': { active: 1, settled: 0, state: 'active' },
  } }} />);
  expect(screen.getByRole('button', { name: 'Claude' }).querySelector('.agent-activity-dot')).toBeNull();
});
