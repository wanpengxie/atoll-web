// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const CHANNEL = 'sz212-browsing-visible-row';
const VIEW_KEY = `${CHANNEL}:all`;
const PRINCIPAL = 'human:sz212:1';
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

function seedDurableUnseen(storage, unseenRecords = [['visible-arrival', 33], ['hidden-arrival', 35]]) {
  const seed = createViewSessionStore({ principalID: PRINCIPAL, storage });
  const activationID = 'seed-sz212';
  const initial = seed.activate(CHANNEL, VIEW_KEY, activationID);
  expect(seed.save(CHANNEL, VIEW_KEY, activationID, initial.revision, {
    mode: 'browsing',
    unseenRecords,
  })).toBe(true);
  expect(seed.deactivate(CHANNEL, VIEW_KEY, activationID)).toBe(true);
}

function historyFor() {
  const presentationAdmission = {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 40,
  };
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'exhausted', localOnly: true })),
    refreshLatest: vi.fn(),
    status: {
      attached: true,
      generation: 1,
      messageCurrent: true,
      headSeq: 40,
      coverage: [{ lowSeq: 1, highSeq: 40 }],
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 40,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 40 },
      presentationAdmission,
    },
  };
}

function visibleRowObservation(viewport, projection, visibleRowID = 'visible-arrival') {
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
    source: 'user',
    atTail: false,
    settled: true,
    surfaceVisible: true,
    installedHighSeq: 40,
    presentationRevision,
    domPresentationRevision: presentationRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID,
    visibleRows: [{ messageID: visibleRowID }],
    visibleRowIDs: [visibleRowID],
    observationIdentity: identity,
    geometryRevision: 1,
  };
}

describe('SZ-212 browsing visible-row receipt public owner', () => {
  it.skip('does not clear a durable row without an exact current Replica event', () => {
    const storage = createMemoryStorage();
    seedDurableUnseen(storage);

    const replica = createChannelReplicaStore();
    const state = replica.ensure(CHANNEL).state;
    for (const [id, seq] of [['visible-arrival', 33], ['hidden-arrival', 35], ['tail', 40]]) {
      replica.commit(event(id, seq), PRINCIPAL, (value) => value, { source: 'history' });
    }

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
      () => useConversationProjection({ ...args, history: historyFor() }),
    );
    const readUnseen = () => viewSessions.readView(CHANNEL, VIEW_KEY).unseenRecords;

    expect(rendered.result.current.viewport.session.mode).toBe('browsing');
    expect(rendered.result.current.viewport.unseenNotice).toBe(2);
    expect(readUnseen()).toEqual([
      ['visible-arrival', 33],
      ['hidden-arrival', 35],
    ]);

    act(() => rendered.result.current.viewport.onReadingRootActivation({
      rootNode: ROOT_NODE,
      rootIdentity: 1,
    }));
    act(() => {
      expect(rendered.result.current.viewport.onReadingObservation(
        visibleRowObservation(
          rendered.result.current.viewport,
          rendered.result.current.projection,
        ),
      )).toBe(true);
    });

    // A visible DOM row is not authority to clear an old durable obligation;
    // only the exact current Replica event may be acknowledged below.
    expect(readUnseen()).toEqual([
      ['visible-arrival', 33],
      ['hidden-arrival', 35],
    ]);
    expect(rendered.result.current.viewport.unseenNotice).toBe(2);
  });
});

describe('SZ-212 live-journal exact row handoff', () => {
  it.skip('removes the matching Replica journal event before clearing its ViewSession identity', () => {
    const storage = createMemoryStorage();
    seedDurableUnseen(storage, [['live-visible', 33], ['live-hidden', 35]]);

    const replica = createChannelReplicaStore();
    const state = replica.ensure(CHANNEL).state;
    replica.commit(event('base', 1), PRINCIPAL, (value) => value, { source: 'history' });
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
      () => useConversationProjection({ ...args, history: historyFor() }),
    );

    replica.commit(event('live-visible', 33), PRINCIPAL, (value) => value, { source: 'live' });
    replica.commit(event('live-hidden', 35), PRINCIPAL, (value) => value, { source: 'live' });
    rendered.rerender();
    expect(state.arrivalReceipts.timeline().events.map((item) => item.rowID)).toEqual([
      'live-visible', 'live-hidden',
    ]);

    act(() => rendered.result.current.viewport.onReadingRootActivation({
      rootNode: ROOT_NODE,
      rootIdentity: 1,
    }));
    act(() => {
      expect(rendered.result.current.viewport.onReadingObservation(
        visibleRowObservation(
          rendered.result.current.viewport,
          rendered.result.current.projection,
          'live-visible',
        ),
      )).toBe(true);
    });

    expect(state.arrivalReceipts.timeline().events.map((item) => item.rowID)).toEqual(['live-hidden']);
    expect(viewSessions.readView(CHANNEL, VIEW_KEY).unseenRecords).toEqual([['live-hidden', 35]]);
  });
});
