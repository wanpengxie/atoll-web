// @vitest-environment jsdom
// NR09-02: public mobile process presentation must not mutate the durable row.
// The test deliberately enters through TimelineRowRenderer and the public
// Replica/cache owners. It must stay red until one existing presentation owner
// owns a bounded tool-output copy; no deleted payload helper is reintroduced.
import 'fake-indexeddb/auto';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROFILE_DESKTOP, PROFILE_MOBILE, setDeviceProfile } from '../src/model/device-profile.js';
import { createChannelReplicaCache, createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

const CHANNEL = 'nr09-02-channel';
const REQUEST_ID = 'nr09-02-request';
const PROCESS_ID = 'nr09-02-process';
const HEAD = 'NR09-02-HEAD-';
const TAIL = '-NR09-02-DURABLE-TAIL';
const TOOL_OUTPUT = `${HEAD}${'x'.repeat(200_000)}${TAIL}`;
const PROCESS_TS = '2026-09-21T06:00:02.000Z';

function requestRow() {
  return {
    channel_id: CHANNEL,
    seq: 1,
    envelope: {
      id: REQUEST_ID,
      kind: 'request',
      type: 'agent.ask',
      ts: '2026-09-21T06:00:01.000Z',
      sender: { id: 'human:root:1', kind: 'human' },
      audience: ['agent:worker:1'],
      payload: { body: { text: '运行工具并保留可读结果' } },
    },
  };
}

function toolRow() {
  return {
    channel_id: CHANNEL,
    seq: 2,
    envelope: {
      id: PROCESS_ID,
      kind: 'response',
      parent_id: REQUEST_ID,
      ts: PROCESS_TS,
      sender: { id: 'agent:worker:1', kind: 'agent' },
      payload: {
        body: {
          status: 'processing',
          process: {
            kind: 'tool',
            phase: 'ended',
            tool_call_id: 'call-nr09-02',
            tool: 'Bash',
            outcome: 'completed',
            detail: '工具返回了一份很长的输出。',
            output: TOOL_OUTPUT,
          },
        },
      },
    },
  };
}

function PublicRenderer({ turn }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: CHANNEL, narration: [] },
    names: new Map([['agent:worker:1', 'Worker']]),
    selfId: 'human:root:1',
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
  });
  return renderRow({
    id: turn.requestId,
    contentRevision: 'nr09-02-public-red',
    body: { kind: 'turn', turn, thread: turn.thread },
  });
}

function publicTurn(store) {
  const entry = store.state(CHANNEL)?.timeline?.find((item) => item.kind === 'turn');
  if (!entry?.turn) throw new Error('public Replica turn was not materialized');
  return entry.turn;
}

function createToolFixture() {
  const sourceRequest = requestRow();
  const sourceProcess = toolRow();
  const originalProcess = structuredClone(sourceProcess);
  const replica = createChannelReplicaStore();
  expect(replica.commit(sourceRequest, '', undefined, { source: 'history' }).accepted).toBe(true);
  expect(replica.commit(sourceProcess, '', undefined, { source: 'history' }).accepted).toBe(true);
  return {
    sourceProcess,
    originalProcess,
    replica,
    turn: publicTurn(replica),
  };
}

function openToolDrawer(turn) {
  const view = render(<PublicRenderer turn={turn} />);
  const trail = view.container.querySelector('.progress-trail.running');
  expect(trail).toBeTruthy();
  fireEvent.click(trail.querySelector('.progress-running-header'));
  const row = trail.querySelector('.progress-row button[title="查看完整内容"]');
  expect(row).toBeTruthy();
  fireEvent.click(row);
  return { view, visible: view.container.querySelector('.progress-drawer-body')?.textContent || '' };
}

beforeEach(() => {
  setDeviceProfile(PROFILE_MOBILE);
});

afterEach(() => {
  cleanup();
  setDeviceProfile(PROFILE_DESKTOP);
});

describe('NR09-02 public mobile tool-output presentation owner', () => {
  it('abbreviates only the public presentation on mobile', () => {
    const { turn } = createToolFixture();
    const { visible } = openToolDrawer(turn);
    // User contract: mobile tool output remains readable but bounded and says
    // what was omitted. This is the first expected red at the current owner.
    expect(visible).toContain(HEAD);
    expect(visible).toContain('省略');
    expect(visible.length).toBeLessThan(4_700);
    expect(visible).not.toContain(TAIL);
  });

  it('keeps Replica and IndexedDB source rows exact after public rendering', async () => {
    const { sourceProcess, originalProcess, replica, turn } = createToolFixture();
    const cache = createChannelReplicaCache({ indexedDB });
    try {
      await cache.ensureOwner('nr09-02-test', { world: 'public-red' });
      await cache.clear();
      await cache.saveRows([sourceProcess]);

      openToolDrawer(turn);

      // Safety contract: rendering must never rewrite the canonical Replica row.
      expect(sourceProcess).toEqual(originalProcess);
      expect(replica.state(CHANNEL).rows.get(sourceProcess.seq)).toEqual(originalProcess.envelope);
      expect(replica.state(CHANNEL).rows.get(sourceProcess.seq).payload.body.process.output).toBe(TOOL_OUTPUT);

      const persisted = await cache.readBefore(CHANNEL, 3, 10, 2_000_000);
      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0]).toEqual(originalProcess);
      expect(persisted.rows[0].envelope.payload.body.process.output).toBe(TOOL_OUTPUT);
    } finally {
      await cache.destroy();
    }
  });

  it('leaves non-tool process text unchanged through the same public renderer', () => {
    const text = `NR09-02-NON-TOOL-HEAD-${'n'.repeat(8_000)}-NR09-02-NON-TOOL-TAIL`;
    const request = {
      requestId: 'nr09-02-non-tool',
      request: {
        id: 'nr09-02-non-tool',
        kind: 'request',
        type: 'agent.ask',
        ts: '2026-09-21T06:10:01.000Z',
        sender: { id: 'human:root:1', kind: 'human' },
        audience: ['agent:worker:1'],
        payload: { body: { text: '读取非工具正文' } },
      },
      status: 'processing',
      terminal: null,
      provisional: [{
        seq: 1,
        envelope: {
          id: 'nr09-02-non-tool-process',
          sender: { id: 'agent:worker:1', kind: 'agent' },
          ts: '2026-09-21T06:10:02.000Z',
          payload: { body: { status: 'processing', process: { kind: 'stage', stage: 'text', text } } },
        },
      }],
      thread: [],
    };
    const view = render(<PublicRenderer turn={request} />);
    const body = view.container.querySelector('.agent-progress-text')?.textContent || '';
    expect(body).toContain('NR09-02-NON-TOOL-HEAD-');
    expect(body).toContain('NR09-02-NON-TOOL-TAIL');
    expect(body).not.toContain('省略');
  });
});
