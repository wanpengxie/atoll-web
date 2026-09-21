// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const CHANNEL = 'sz209-jump-latest';
const VIEW_KEY = `${CHANNEL}:all`;
const PRINCIPAL = 'human:sz209:1';
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
  const activationID = 'seed-sz209';
  const initial = seed.activate(CHANNEL, VIEW_KEY, activationID);
  expect(seed.save(CHANNEL, VIEW_KEY, activationID, initial.revision, {
    mode: 'browsing',
    unseenRecords: [['arrival-a', 3], ['arrival-b', 4]],
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

function observationFor(viewport, projection, {
  atTail,
  surfaceVisible,
  visibleRowID,
}) {
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
    atTail,
    settled: true,
    surfaceVisible,
    installedHighSeq: 4,
    presentationRevision,
    domPresentationRevision: presentationRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID,
    visibleRows: [{ messageID: visibleRowID }],
    visibleRowIDs: [visibleRowID],
    observationIdentity: identity,
    geometryRevision: 0,
  };
}

describe('SZ-209 jump-to-latest pre-tail public owner', () => {
  it('keeps unseen pending through intent, non-tail paint, and hidden tail paint', async () => {
    const storage = createMemoryStorage();
    seedDurableUnseenBacklog(storage);

    const replica = createChannelReplicaStore();
    const state = replica.ensure(CHANNEL).state;
    for (const [id, seq] of [
      ['installed-1', 1],
      ['installed-2', 2],
      ['arrival-a', 3],
      ['arrival-b', 4],
    ]) {
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
      ({ history }) => useConversationProjection({ ...args, history }),
      { initialProps: { history: historyFor(4) } },
    );
    const readUnseen = () => viewSessions.readView(CHANNEL, VIEW_KEY).unseenRecords;

    expect(readUnseen()).toEqual([
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

    // The explicit latest intent changes semantic mode, but is not a read
    // receipt and must not clear the durable installed identities.
    expect(rendered.result.current.viewport.session.mode).toBe('following');
    expect(readUnseen()).toHaveLength(2);

    const projection = rendered.result.current.projection;
    act(() => {
      expect(rendered.result.current.viewport.onReadingObservation(
        observationFor(rendered.result.current.viewport, projection, {
          atTail: false,
          surfaceVisible: true,
          visibleRowID: 'installed-2',
        }),
      )).toBe(true);
    });
    expect(rendered.result.current.viewport.tailCaughtUp.caughtUp).toBe(false);
    expect(readUnseen()).toHaveLength(2);

    act(() => {
      expect(rendered.result.current.viewport.onReadingObservation(
        observationFor(rendered.result.current.viewport, projection, {
          atTail: true,
          surfaceVisible: false,
          visibleRowID: 'arrival-b',
        }),
      )).toBe(false);
    });
    expect(readUnseen()).toHaveLength(2);

    act(() => {
      expect(rendered.result.current.viewport.onReadingObservation(
        observationFor(rendered.result.current.viewport, projection, {
          atTail: true,
          surfaceVisible: true,
          visibleRowID: 'arrival-b',
        }),
      )).toBe(true);
    });
    await waitFor(() => expect(readUnseen()).toEqual([]));
    expect(rendered.result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      boundary: 4,
      physicalSeq: 4,
      captured: expect.objectContaining({ visibleRowIDs: ['arrival-b'] }),
    }));
  });
});
