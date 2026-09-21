// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const CHANNEL = 'sz216-following-count';
const VIEW_KEY = `${CHANNEL}:all`;
const PRINCIPAL = 'human:sz216:1';
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
  const activationID = 'seed-sz216';
  const initial = seed.activate(CHANNEL, VIEW_KEY, activationID);
  expect(seed.save(CHANNEL, VIEW_KEY, activationID, initial.revision, {
    mode: 'browsing',
    unseenRecords: [['future-arrival', 41]],
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
    installedHighSeq: 40,
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

describe('SZ-216 following viewport count public owner', () => {
  it('derives a zero visible notice at the settled tail without clearing a future durable record', async () => {
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
      () => useConversationProjection({ ...args, history: historyFor() }),
    );
    const readUnseen = () => viewSessions.readView(CHANNEL, VIEW_KEY).unseenRecords;

    expect(rendered.result.current.viewport.unseenNotice).toBe(1);
    expect(readUnseen()).toEqual([['future-arrival', 41]]);

    act(() => rendered.result.current.viewport.onReadingRootActivation({
      rootNode: ROOT_NODE,
      rootIdentity: 1,
    }));
    act(() => rendered.result.current.viewport.jumpToLatest());
    expect(rendered.result.current.viewport.session.mode).toBe('following');
    expect(readUnseen()).toEqual([['future-arrival', 41]]);

    const projectionRevision = rendered.result.current.projection.presentation.revision;
    act(() => {
      expect(rendered.result.current.viewport.onReadingObservation(
        tailObservation(rendered.result.current.viewport, projectionRevision),
      )).toBe(true);
    });

    expect(rendered.result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      boundary: 40,
    }));
    // User-facing count is a derived projection of settled following state;
    // the durable record above the installed tail remains the receipt truth.
    expect(rendered.result.current.viewport.unseenNotice).toBe(0);
    await waitFor(() => expect(readUnseen()).toEqual([['future-arrival', 41]]));

    // Leaving the tail exposes the still-pending durable obligation again.
    act(() => rendered.result.current.viewport.beginNavigation({
      direction: 'older',
      gestureID: 'sz216-leave-tail',
    }));
    expect(rendered.result.current.viewport.unseenNotice).toBe(1);
    expect(readUnseen()).toEqual([['future-arrival', 41]]);
  });
});
