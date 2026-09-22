// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const CHANNEL = 'sz210-tail-high-water';
const VIEW_KEY = `${CHANNEL}:all`;
const PRINCIPAL = 'human:sz210:1';
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
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function seedDurableUnseen(storage) {
  const seed = createViewSessionStore({ principalID: PRINCIPAL, storage });
  const activationID = 'seed-sz210';
  const initial = seed.activate(CHANNEL, VIEW_KEY, activationID);
  expect(seed.save(CHANNEL, VIEW_KEY, activationID, initial.revision, {
    mode: 'browsing',
    unseenRecords: [['root-a', 3], ['later', 5]],
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

function tailObservation(viewport, projectionRevision) {
  const status = viewport.status || {};
  const session = viewport.getSession();
  return {
    type: 'reading-authority',
    activationID: viewport.activationID,
    inputEpoch: Number(session.inputEpoch),
    source: 'layout',
    atTail: true,
    settled: true,
    surfaceVisible: true,
    // The later durable arrival is above this observed installed fence and
    // has not yet been admitted to the settled DOM sample.
    installedHighSeq: 4,
    presentationRevision: projectionRevision,
    domPresentationRevision: projectionRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID: 'tail',
    visibleRows: [{ messageID: 'tail' }],
    visibleRowIDs: ['tail'],
    observationIdentity: {
      activationID: viewport.activationID,
      inputEpoch: Number(session.inputEpoch),
      intentRevision: Number(session.intentRevision || 0),
      presentationRevision: projectionRevision,
      tailID: 'tail',
      generation: Number(status.generation || 0),
      authorityRevision: Number(status.notificationAuthorityRevision || 0),
      rootIdentity: 1,
    },
  };
}

describe('SZ-210 tail receipt installed high-water', () => {
  it.skip('does not sweep a durable arrival above the observed installed high-water', async () => {
    const storage = createMemoryStorage();
    seedDurableUnseen(storage);

    const replica = createChannelReplicaStore();
    const state = replica.ensure(CHANNEL).state;
    replica.commit(event('installed-1', 1), PRINCIPAL, (value) => value, { source: 'history' });
    replica.commit(event('root-a', 3), PRINCIPAL, (value) => value, { source: 'history' });
    replica.commit(event('tail', 4), PRINCIPAL, (value) => value, { source: 'history' });

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
      { initialProps: { history: historyFor(4) } },
    );

    expect(rendered.result.current.viewport.unseenNotice).toBe(2);
    act(() => rendered.result.current.viewport.onReadingRootActivation({
      rootNode: ROOT_NODE,
      rootIdentity: 1,
    }));
    act(() => rendered.result.current.viewport.jumpToLatest());
    const projectionRevision = rendered.result.current.projection.presentation.revision;
    act(() => {
      expect(rendered.result.current.viewport.onReadingObservation(
        tailObservation(rendered.result.current.viewport, projectionRevision),
      )).toBe(true);
    });

    expect(rendered.result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      boundary: 4,
      physicalSeq: 4,
    }));
    await waitFor(() => expect(viewSessions.readView(CHANNEL, VIEW_KEY).unseenRecords).toEqual([
      ['later', 5],
    ]));

    // The old record is within the observed fence; the later record is not.
    // Re-entering browsing makes the surviving durable arrival user-visible.
    act(() => rendered.result.current.viewport.beginNavigation({
      direction: 'older',
      gestureID: 'browse-after-high-water',
    }));
    expect(rendered.result.current.viewport.unseenNotice).toBe(1);
  });
});
