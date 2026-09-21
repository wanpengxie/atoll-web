// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const CHANNEL = 'sz208-installed-tail';
const VIEW_KEY = `${CHANNEL}:all`;
const PRINCIPAL = 'human:sz208:1';
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

function seedDurableUnseenBacklog(storage) {
  const seed = createViewSessionStore({ principalID: PRINCIPAL, storage });
  const activationID = 'seed-sz208';
  const initial = seed.activate(CHANNEL, VIEW_KEY, activationID);
  expect(seed.save(CHANNEL, VIEW_KEY, activationID, initial.revision, {
    mode: 'browsing',
    unseenRecords: [['arrival-a', 3], ['arrival-b', 4]],
  })).toBe(true);
  expect(seed.readView(CHANNEL, VIEW_KEY).unseenRecords).toEqual([
    ['arrival-a', 3],
    ['arrival-b', 4],
  ]);
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

function tailObservation(viewport, projectionRevision, tailID) {
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
    installedHighSeq: 4,
    presentationRevision: projectionRevision,
    domPresentationRevision: projectionRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID,
    // The durable backlog contains arrival-a and arrival-b, but this settled
    // physical sample only hit-tests the final tail row.
    visibleRows: [{ messageID: tailID }],
    visibleRowIDs: [tailID],
    observationIdentity: {
      activationID: viewport.activationID,
      inputEpoch: Number(session.inputEpoch),
      intentRevision: Number(session.intentRevision || 0),
      presentationRevision: projectionRevision,
      tailID,
      generation: Number(status.generation || 0),
      authorityRevision: Number(status.notificationAuthorityRevision || 0),
      rootIdentity: 1,
    },
  };
}

describe('SZ-208 installed-tail durable backlog acknowledgement', () => {
  it('clears the durable scope backlog when only the final tail row is visible', async () => {
    const storage = createMemoryStorage();
    seedDurableUnseenBacklog(storage);

    const replica = createChannelReplicaStore();
    const state = replica.ensure(CHANNEL).state;
    // These rows are already installed history. There are no post-mount live
    // commits here; unlike SZ-205, the input debt is the durable View Session
    // backlog restored before the Reading owner mounts.
    replica.commit(event('installed-1', 1), PRINCIPAL, (value) => value, { source: 'history' });
    replica.commit(event('installed-2', 2), PRINCIPAL, (value) => value, { source: 'history' });
    replica.commit(event('arrival-a', 3), PRINCIPAL, (value) => value, { source: 'history' });
    replica.commit(event('arrival-b', 4), PRINCIPAL, (value) => value, { source: 'history' });

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

    expect(viewSessions.readView(CHANNEL, VIEW_KEY).unseenRecords).toEqual([
      ['arrival-a', 3],
      ['arrival-b', 4],
    ]);
    expect(rendered.result.current.viewport.unseenNotice).toBe(2);
    expect(rendered.result.current.projection.presentation.rows.at(-1)?.id).toBe('arrival-b');

    act(() => rendered.result.current.viewport.onReadingRootActivation({
      rootNode: ROOT_NODE,
      rootIdentity: 1,
    }));
    act(() => rendered.result.current.viewport.jumpToLatest());
    const projectionRevision = rendered.result.current.projection.presentation.revision;
    act(() => {
      expect(rendered.result.current.viewport.onReadingObservation(
        tailObservation(rendered.result.current.viewport, projectionRevision, 'arrival-b'),
      )).toBe(true);
    });

    expect(rendered.result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      boundary: 4,
      physicalSeq: 4,
      captured: expect.objectContaining({ visibleRowIDs: ['arrival-b'] }),
    }));
    await waitFor(() => expect(viewSessions.readView(CHANNEL, VIEW_KEY).unseenRecords).toEqual([]));

    // Re-enter browsing only after the settled receipt. If the owner cleared
    // only the visible row, arrival-a would reappear from durable storage.
    act(() => rendered.result.current.viewport.beginNavigation({
      direction: 'older',
      gestureID: 'browse-after-tail',
    }));
    expect(rendered.result.current.viewport.unseenNotice).toBe(0);
    expect(viewSessions.readView(CHANNEL, VIEW_KEY).unseenRecords).toEqual([]);
  });
});
