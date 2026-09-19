// @vitest-environment jsdom
// Independent public-owner composition for e7078a8 + f6b6c24:
// ChannelFeedRuntime current-tail authority + roster target authority must
// jointly decide whether a canonical Waiting combination is actionable.
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { selectFeatureWaitingFacts, FEATURE_COMMAND_STATE, FEATURE_WAITING_CONTROL } from '../src/model/feature-tasks.js';
import { TasksFeature } from '../src/ui/features/tasks/TasksFeature.jsx';
import { TYPES } from '../src/protocol/vocab.js';

afterEach(cleanup);

const CHANNEL_ID = 'c0';
const HUMAN_ID = 'human:root:1';
const AGENT_ID = 'agent:worker:1';
const runtimes = new Set();

function runtimeOptions() {
  return {
    wireRef: { current: null },
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: CHANNEL_ID },
    onRoster: vi.fn(),
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onTimerFired: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
    onAgentActivity: vi.fn(),
  };
}

function requestEnvelope(id = 'request-1') {
  return {
    id,
    channel_id: CHANNEL_ID,
    kind: 'request',
    type: TYPES.agentAsk,
    sender: { id: HUMAN_ID, kind: 'human' },
    audience: [AGENT_ID],
    visibility: 'public',
    payload: { body: { text: '继续工作' } },
  };
}

function waitingEnvelope(id = 'queued-1', parentId = 'request-1') {
  return {
    id,
    channel_id: CHANNEL_ID,
    kind: 'response',
    type: TYPES.agentAsk,
    parent_id: parentId,
    sender: { id: AGENT_ID, kind: 'agent' },
    audience: [HUMAN_ID],
    visibility: 'public',
    payload: {
      body: {
        status: 'processing',
        controls: [
          { word: FEATURE_WAITING_CONTROL.steer },
          { word: FEATURE_WAITING_CONTROL.interrupt },
        ],
      },
    },
  };
}

async function createRuntime(headSeq = 2) {
  const runtime = createChannelFeedRuntime(runtimeOptions());
  runtimes.add(runtime);
  await runtime.getSnapshot().setHistoryGrants([
    { channel_id: CHANNEL_ID, head_seq: headSeq, has_rows: true },
  ], { generation: 1, boot: 'boot-a', focus: CHANNEL_ID });
  return runtime;
}

function enqueue(runtime, seq, envelope, source = 'live') {
  expect(runtime.getSnapshot().enqueue({
    channel_id: CHANNEL_ID,
    seq,
    generation: 1,
    source,
    envelope,
  })).toBe(true);
}

function targetAuthority(runtime, rosterCurrent = true) {
  const status = runtime.getSnapshot().historyFor(CHANNEL_ID);
  return {
    rosterCurrent,
    controlCurrent: status.controlCurrent === true,
    current: rosterCurrent && status.controlCurrent === true,
    actorIDs: new Set([AGENT_ID]),
  };
}

function waitingItem(runtime, authority) {
  const [item] = selectFeatureWaitingFacts({
    state: runtime.getSnapshot().stateFor(CHANNEL_ID),
    channelId: CHANNEL_ID,
    targetAuthority: authority,
  });
  expect(item).toBeTruthy();
  return item;
}

function renderWaiting(item, controlWaiting = vi.fn()) {
  render(<TasksFeature port={{
    waiting: [item],
    waitingState: FEATURE_COMMAND_STATE.ready,
    supportedWaitingControls: new Set(Object.values(FEATURE_WAITING_CONTROL)),
    commandStates: new Map(),
    commands: { controlWaiting },
  }} />);
  return controlWaiting;
}

afterEach(() => {
  for (const runtime of runtimes) runtime.destroy();
  runtimes.clear();
});

describe('公开 Waiting currentness composition', () => {
  it('does not publish a cache-only Waiting combination before current-tail proof', async () => {
    const runtime = await createRuntime();
    // Cache rows are readable facts, but they do not prove the current tail.
    enqueue(runtime, 1, requestEnvelope(), 'cache');
    enqueue(runtime, 2, waitingEnvelope(), 'cache');
    const authority = targetAuthority(runtime, true);
    expect(authority).toMatchObject({ rosterCurrent: true, controlCurrent: false, current: false });

    const item = waitingItem(runtime, authority);
    const user = userEvent.setup();
    renderWaiting(item);
    await user.click(screen.getByRole('tab', { name: /等待区/ }));

    expect(screen.queryByText('继续工作', { exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '插入指令' })).toBeNull();
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
  });

  it('publishes usable Waiting controls only with current tail and current Roster authority', async () => {
    const runtime = await createRuntime();
    enqueue(runtime, 1, requestEnvelope());
    enqueue(runtime, 2, waitingEnvelope());
    const authority = targetAuthority(runtime, true);
    expect(authority).toMatchObject({ rosterCurrent: true, controlCurrent: true, current: true });

    const item = waitingItem(runtime, authority);
    const user = userEvent.setup();
    const controlWaiting = renderWaiting(item);
    await user.click(screen.getByRole('tab', { name: /等待区/ }));
    const steer = screen.getByRole('button', { name: '插入指令' });
    const interrupt = screen.getByRole('button', { name: '停止' });
    expect(steer.disabled).toBe(false);
    expect(interrupt.disabled).toBe(false);

    await user.click(steer);
    expect(controlWaiting).toHaveBeenCalledWith({
      item: expect.objectContaining({ requestId: 'request-1', targetAuthority: authority }),
      type: FEATURE_WAITING_CONTROL.steer,
    });
  });

  it('revokes Waiting controls after disconnect and after a higher current head', async () => {
    for (const revoke of ['disconnect', 'higher-head']) {
      const runtime = await createRuntime();
      enqueue(runtime, 1, requestEnvelope());
      enqueue(runtime, 2, waitingEnvelope());
      expect(runtime.getSnapshot().historyFor(CHANNEL_ID).controlCurrent).toBe(true);

      if (revoke === 'disconnect') runtime.getSnapshot().disconnectHistory(1);
      else await runtime.getSnapshot().setHistoryGrants([
        { channel_id: CHANNEL_ID, head_seq: 3, has_rows: true },
      ], { generation: 1, boot: 'boot-a', focus: CHANNEL_ID });

      const authority = targetAuthority(runtime, true);
      expect(authority.current).toBe(false);
      const item = waitingItem(runtime, authority);
      const user = userEvent.setup();
      const controlWaiting = renderWaiting(item);
      await user.click(screen.getByRole('tab', { name: /等待区/ }));
      const steer = screen.getByRole('button', { name: '插入指令' });
      const interrupt = screen.getByRole('button', { name: '停止' });
      expect(steer.disabled).toBe(true);
      expect(interrupt.disabled).toBe(true);
      await user.click(steer);
      expect(controlWaiting).not.toHaveBeenCalled();
      cleanup();
    }
  });
});
