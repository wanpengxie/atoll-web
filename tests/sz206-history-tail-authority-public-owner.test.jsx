// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const CHANNEL = 'sz206-history';
const VIEW_KEY = `${CHANNEL}:filtered`;

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz206:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function message(id, seq) {
  return {
    kind: 'standalone',
    seq,
    envelope: {
      id,
      seq,
      ts: seq * 1_000,
      type: 'project.task',
      sender: { id: 'agent:history' },
      payload: { body: { text: id } },
    },
  };
}

function stateFor(id, seq) {
  const replica = createChannelReplicaStore();
  const base = replica.ensure(CHANNEL).state;
  return {
    ...base,
    channelId: CHANNEL,
    timeline: [message(id, seq)],
    lastSeq: seq,
    // The source already knows the authoritative head; the history coverage
    // below is intentionally the independently advancing fence under test.
    _timelineRevision: 100,
    _timelineProjectionVersion: 100,
  };
}

function historyFor(coverage) {
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'loaded' })),
    refreshLatest: vi.fn(),
    status: {
      channelId: CHANNEL,
      attached: true,
      generation: 1,
      sourceLease: 'sz206-source',
      messageCurrent: true,
      headSeq: 100,
      oldestSeq: 1,
      coverage,
      loaded: true,
      completedPages: 1,
      hasOlder: true,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 100,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 100, error: '' },
      presentationAdmission: {
        evaluate: (_channelID, items) => ({ items, receipt: null }),
        sourceFence: () => 100,
      },
    },
  };
}

describe('SZ-206 history tail authority public owner', () => {
  it('withholds the current-entry receipt until coverage reaches the authoritative head', async () => {
    // 用户能力：历史分页尚未覆盖权威 head 时，当前面不能被误报为已到达最新。
    // 不变量：intermediate batch tail 只保留可读 rows；唯一公开 authority receipt
    // 只有在 coverage 覆盖 candidate→head 后才可签发。
    // 公开 owner：useConversationProjection.viewport.presentationAuthority。
    const viewSessions = {
      readView: () => ({ mode: 'following', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const base = {
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: VIEW_KEY,
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ state, history }) => useConversationProjection({ ...base, state, history }),
      {
        initialProps: {
          state: stateFor('middle', 40),
          history: historyFor([{ lowSeq: 20, highSeq: 40 }]),
        },
      },
    );

    await waitFor(() => expect(result.current.viewport.availability).toBe('readable'));
    expect(result.current.viewport.presentationAuthority).toBeNull();

    // A later intermediate page still cannot sign the same authoritative head.
    rerender({
      state: stateFor('middle-2', 60),
      history: historyFor([{ lowSeq: 20, highSeq: 60 }]),
    });
    await waitFor(() => expect(result.current.projection.presentation.rows[0]?.id).toBe('middle-2'));
    expect(result.current.viewport.presentationAuthority).toBeNull();

    // Once the page fence reaches the authoritative head, the public receipt
    // becomes available for the currently presented candidate.
    rerender({
      state: stateFor('authoritative', 20),
      history: historyFor([{ lowSeq: 20, highSeq: 100 }]),
    });
    await waitFor(() => expect(result.current.viewport.presentationAuthority).toEqual({
      epoch: `${CHANNEL}:1`,
      viewID: VIEW_KEY,
      sourceRevision: 100,
      candidateID: 'authoritative',
    }));
    expect(Object.isFrozen(result.current.viewport.presentationAuthority)).toBe(true);
    unmount();
  });
});
