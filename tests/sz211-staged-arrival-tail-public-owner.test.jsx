// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const CHANNEL = 'sz211-staged-arrival';
const VIEW_KEY = `${CHANNEL}:all`;
const PRINCIPAL = 'human:sz211:1';
const ROOT_NODE = {};

function event(id, seq) {
  return {
    channel_id: CHANNEL,
    seq,
    envelope: {
      id,
      seq,
      kind: 'event',
      type: 'project.task',
      ts: seq * 1_000,
      sender: { id: 'agent:remote', kind: 'agent' },
      audience: [PRINCIPAL],
      visibility: 'public',
      payload: { body: { text: id } },
    },
  };
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function seedDurableUnseen(storage) {
  const seed = createViewSessionStore({ principalID: PRINCIPAL, storage });
  const activationID = 'seed-sz211';
  const initial = seed.activate(CHANNEL, VIEW_KEY, activationID);
  expect(seed.save(CHANNEL, VIEW_KEY, activationID, initial.revision, {
    mode: 'browsing',
    unseenRecords: [['prior-arrival', 33]],
  })).toBe(true);
  expect(seed.deactivate(CHANNEL, VIEW_KEY, activationID)).toBe(true);
}

function historyFor(headSeq) {
  const presentationAdmission = {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => headSeq,
  };
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'exhausted', localOnly: true })),
    refreshLatest: vi.fn(),
    status: {
      attached: true,
      generation: 1,
      messageCurrent: true,
      headSeq,
      coverage: [{ lowSeq: 1, highSeq: headSeq }],
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: headSeq,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: headSeq },
      presentationAdmission,
    },
  };
}

function observationFor(viewport, projection, installedHighSeq) {
  const status = viewport.status || {};
  const session = viewport.getSession();
  const presentationRevision = Number(projection.presentation.revision || 0);
  const tailID = String(projection.presentation.rows.at(-1)?.id || '');
  const identity = {
    activationID: viewport.activationID,
    inputEpoch: Number(session.inputEpoch),
    intentRevision: Number(session.intentRevision || 0),
    presentationRevision,
    tailID,
    generation: Number(status.generation || 0),
    authorityRevision: Number(status.notificationAuthorityRevision || 0),
    rootIdentity: 1,
  };
  return {
    type: 'reading-authority',
    activationID: viewport.activationID,
    inputEpoch: Number(session.inputEpoch),
    source: 'layout',
    atTail: true,
    settled: true,
    surfaceVisible: true,
    installedHighSeq,
    presentationRevision,
    domPresentationRevision: presentationRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID,
    visibleRows: [{ messageID: tailID }],
    visibleRowIDs: [tailID],
    observationIdentity: identity,
  };
}

describe('SZ-211 staged arrival above reached tail public owner', () => {
  it.skip('keeps an arrival above the observed installed high-water pending', async () => {
    const storage = createMemoryStorage();
    seedDurableUnseen(storage);

    const replica = createChannelReplicaStore();
    const state = replica.ensure(CHANNEL).state;
    replica.commit(event('installed-1', 1), PRINCIPAL, (value) => value, { source: 'history' });
    replica.commit(event('tail', 40), PRINCIPAL, (value) => value, { source: 'history' });

    const viewSessions = createViewSessionStore({ principalID: PRINCIPAL, storage });
    const args = {
      state,
      viewSessions,
      historyViewSpec: {
        scope: 'all',
        selfId: PRINCIPAL,
        actorFilter: new Set(),
        editingTargetId: '',
        editingReplacementId: '',
        showNarration: false,
      },
      messageListKey: VIEW_KEY,
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const rendered = renderHook(
      ({ history }) => useConversationProjection({ ...args, history }),
      { initialProps: { history: historyFor(40) } },
    );

    act(() => rendered.result.current.viewport.onReadingRootActivation({
      rootNode: ROOT_NODE,
      rootIdentity: 1,
    }));

    // The row has arrived in the Replica and projection, but the DOM has only
    // installed through seq 40. The public arrival journal is the receipt
    // truth; no private Replica map is consulted.
    replica.commit(event('incoming', 44), PRINCIPAL, (value) => value, { source: 'live' });
    rendered.rerender({ history: historyFor(44) });
    expect(state.arrivalReceipts.timeline().events).toEqual([
      expect.objectContaining({ key: 'incoming', rowID: 'incoming', seq: 44 }),
    ]);
    expect(rendered.result.current.viewport.unseenNotice).toBe(2);

    act(() => rendered.result.current.viewport.jumpToLatest());
    expect(rendered.result.current.viewport.session.mode).toBe('following');

    const currentProjection = rendered.result.current.projection;
    act(() => {
      expect(rendered.result.current.viewport.onReadingObservation(
        observationFor(rendered.result.current.viewport, currentProjection, 40),
      )).toBe(true);
    });

    // Reaching the old installed tail can acknowledge only <= 40. The staged
    // seq-44 arrival remains in the public journal for the next paint.
    expect(rendered.result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      boundary: 40,
    }));
    expect(state.arrivalReceipts.timeline().events).toEqual([
      expect.objectContaining({ key: 'incoming', rowID: 'incoming', seq: 44 }),
    ]);

    act(() => {
      expect(rendered.result.current.viewport.onReadingObservation(
        observationFor(rendered.result.current.viewport, currentProjection, 44),
      )).toBe(true);
    });
    await waitFor(() => expect(state.arrivalReceipts.timeline().events).toEqual([]));
  });
});
