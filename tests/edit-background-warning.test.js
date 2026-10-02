import { describe, expect, it } from 'vitest';
import { runningBackgroundTasks } from '../src/ui/timeline/useWaitingEditingController.jsx';

const CLAUDE = 'agent:claude:1';
const task = (seq, call, phase, extra = {}) => [seq, {
  id: `t${seq}`, type: 'agent.task', sender: { id: extra.sender || CLAUDE, kind: 'agent' },
  parent_id: extra.parent,
  ts: seq * 1000,
  payload: { body: { call_id: call, phase, ...extra.body } },
}];

describe('editing warns about background work the interrupt would stop', () => {
  it('lists the agent\'s sub agents and commands that have not ended', () => {
    const state = { rows: new Map([
      task(1, 'a', 'started', { body: { kind: 'agent', title: 'Finish the spec' } }),
      task(2, 'a', 'progress'),
      task(3, 'b', 'started', { body: { kind: 'shell', title: 'wait for tests' } }),
      task(4, 'c', 'started', { body: { kind: 'agent', title: 'done one' } }),
      task(5, 'c', 'completed'),
      task(6, 'd', 'started', { body: { kind: 'agent', title: 'failed one' } }),
      task(7, 'd', 'failed'),
      task(8, 'e', 'started', { sender: 'agent:codex:1', body: { kind: 'agent', title: 'another agent' } }),
    ]) };
    expect(runningBackgroundTasks(state, CLAUDE).map(({ title, kind, phase }) => ({ title, kind, phase }))).toEqual([
      { title: 'wait for tests', kind: 'shell', phase: 'started' },
      { title: 'Finish the spec', kind: 'agent', phase: 'progress' },
    ]);
    // Every agent's running work, newest first, for the channel's running drawer.
    expect(runningBackgroundTasks(state).map((task) => task.title)).toEqual(['another agent', 'wait for tests', 'Finish the spec']);
  });

  it('finds nothing when every task has ended', () => {
    const state = { rows: new Map([task(1, 'a', 'started', { body: { kind: 'agent' } }), task(2, 'a', 'completed')]) };
    expect(runningBackgroundTasks(state, CLAUDE)).toEqual([]);
  });

  it('keeps the request each task was set off for and its latest words', () => {
    const state = { rows: new Map([
      task(1, 'a', 'started', { parent: 'req-1', body: { kind: 'agent', title: 'Research' } }),
      task(2, 'a', 'progress', { parent: 'req-1', body: { text: 'Reading the ledger' } }),
    ]) };
    const [running] = runningBackgroundTasks(state);
    expect(running).toMatchObject({ requestId: 'req-1', lastText: 'Reading the ledger', startedAt: 1000, sender: CLAUDE });
  });

  it('follows a resumed sub agent to the end it reports under another call', () => {
    const state = { rows: new Map([
      task(1, 'toolu_first', 'started', { body: { task_id: 'a42', kind: 'agent', title: 'Build the spec' } }),
      task(2, 'toolu_first', 'message', { body: { text: 'reading' } }),
      task(3, 'toolu_resume', 'progress', { body: { task_id: 'a42', text: 'fixing' } }),
      task(4, 'toolu_resume', 'failed', { body: { task_id: 'a42', text: 'stopped' } }),
    ]) };
    expect(runningBackgroundTasks(state)).toEqual([]);
  });

  it('does not count fragments with no start on record as running', () => {
    const state = { rows: new Map([task(1, 'toolu_lost', 'message', { body: { text: 'a late report' } })]) };
    expect(runningBackgroundTasks(state)).toEqual([]);
  });
});
