// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: '',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

class MemoryStorage {
  #data = new Map();

  getItem(key) { return this.#data.get(key) ?? null; }

  setItem(key, value) { this.#data.set(key, String(value)); }
}

function viewKey(channelID) {
  return `${channelID}:all`;
}

function stateFor(channelID) {
  const replica = createChannelReplicaStore();
  const state = replica.ensure(channelID).state;
  return {
    ...state,
    channelId: channelID,
    timeline: [],
    lastSeq: 0,
    _timelineRevision: 0,
    _timelineProjectionVersion: 0,
  };
}

function historyFor(channelID) {
  return {
    request: () => Promise.resolve({ kind: 'cancelled' }),
    refreshLatest: () => Promise.resolve(false),
    status: {
      channelId: channelID,
      attached: false,
      generation: 0,
      messageCurrent: false,
      headSeq: 0,
      oldestSeq: 0,
      coverage: [],
      loaded: false,
      completedPages: 0,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 0,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 0, error: '' },
      presentationAdmission: {
        evaluate: (_channelID, items) => ({ items, receipt: null }),
        sourceFence: () => 0,
      },
    },
  };
}

function persistBookmarkThroughViewport(viewport, bookmark, gestureID) {
  let inputGeneration;
  act(() => {
    ({ inputGeneration } = viewport.beginNavigation({
      direction: 'older',
      gestureID,
      source: 'test',
    }));
  });
  let accepted;
  act(() => {
    accepted = viewport.onReadingSample({
      type: 'reading-sample',
      activationID: viewport.activationID,
      inputEpoch: inputGeneration,
      bookmark,
    });
  });
  expect(accepted).toBe(true);
  return viewport.getSession();
}

describe('SZ-177 channel replacement bottom-intent CAS', () => {
  it.skip('keeps A2 durable state when A1 save and deactivate arrive late after A→B→A', async () => {
    // 用户能力：频道替换后，旧 Reading owner 不能覆盖或停用当前 A2 view。
    // 不变量：同一 channel/scope/viewKey 的 active activation 与 revision 共同构成 CAS。
    // 公开 owner：useConversationProjection viewport + createViewSessionStore public API。
    const storage = new MemoryStorage();
    const viewSessions = createViewSessionStore({ principalID: 'sz177-cas', storage });
    const base = {
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: () => {},
    };
    const { result, rerender, unmount } = renderHook(
      ({ channelID }) => useConversationProjection({
        ...base,
        state: stateFor(channelID),
        history: historyFor(channelID),
        messageListKey: viewKey(channelID),
      }),
      { initialProps: { channelID: 'channel-a' } },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    const a1 = result.current.viewport;
    const a1ActivationID = a1.activationID;
    const a1RevisionBeforePersist = a1.session.revision;
    const a1Bookmark = { messageID: 'a1-row', seq: 11, rowViewportOffset: 8 };
    const a1Session = persistBookmarkThroughViewport(a1, a1Bookmark, 'a1-gesture');
    expect(a1Session.bookmark).toMatchObject(a1Bookmark);
    const a1Persisted = viewSessions.readView('channel-a', viewKey('channel-a'));
    expect(a1Persisted).toMatchObject({ revision: a1Session.revision, mode: 'browsing', bookmark: a1Bookmark });

    // Explicit source replacement: B gets its own canonical key, then A2
    // returns to the exact A scope/view key and activates a new owner.
    rerender({ channelID: 'channel-b' });
    await waitFor(() => expect(result.current.viewport.activationID).not.toBe(a1ActivationID));
    const bActivationID = result.current.viewport.activationID;
    expect(viewSessions.readView('channel-b', viewKey('channel-b'))).toMatchObject({
      revision: 0,
      mode: 'following',
      bookmark: null,
    });

    rerender({ channelID: 'channel-a' });
    await waitFor(() => expect(result.current.viewport.activationID).not.toBe(bActivationID));
    const a2 = result.current.viewport;
    expect(a2.activationID).not.toBe(a1ActivationID);
    expect(a2.session.revision).toBe(a1Session.revision);
    expect(a2.session.bookmark).toMatchObject(a1Bookmark);

    const a2Bookmark = { messageID: 'a2-row', seq: 22, rowViewportOffset: 16 };
    const a2Session = persistBookmarkThroughViewport(a2, a2Bookmark, 'a2-gesture');
    const a2Persisted = viewSessions.readView('channel-a', viewKey('channel-a'));
    expect(a2Session.bookmark).toMatchObject(a2Bookmark);
    expect(a2Persisted).toMatchObject({
      revision: a2Session.revision,
      mode: 'browsing',
      bookmark: a2Bookmark,
    });

    // A1's late persistence and cleanup are both stale against the active A2
    // lease. They must not mutate the public durable state established by A2.
    expect(viewSessions.save(
      'channel-a',
      viewKey('channel-a'),
      a1ActivationID,
      a1RevisionBeforePersist,
      { mode: 'browsing', bookmark: { messageID: 'late-a1-row', seq: 99 } },
    )).toBe(false);
    expect(viewSessions.deactivate('channel-a', viewKey('channel-a'), a1ActivationID)).toBe(false);
    expect(a1.captureBottomIntent()).toBeNull();
    expect(a1.requestBottom('late-a1')).toBe(false);

    const finalA = viewSessions.readView('channel-a', viewKey('channel-a'));
    expect(finalA).toMatchObject({
      revision: a2Persisted.revision,
      mode: 'browsing',
      bookmark: a2Bookmark,
    });
    expect(finalA.bookmark.messageID).not.toBe('late-a1-row');
    unmount();
  });
});
