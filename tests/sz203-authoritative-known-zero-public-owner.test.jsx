// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const NEVER = new Promise(() => {});

const VIEW_SPEC = Object.freeze({
  scope: 'mine',
  selfId: 'human:sz203:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function emptyState() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('sz203-empty').state;
  return {
    ...base,
    channelId: 'sz203-empty',
    timeline: [],
    lastSeq: 0,
    _timelineRevision: 0,
    _timelineProjectionVersion: 0,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 0,
  };
}

function historyFor(request) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'sz203-empty',
      attached: true,
      generation: 3,
      sourceLease: 'sz203-source',
      messageCurrent: true,
      headSeq: 0,
      oldestSeq: 0,
      coverage: [],
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 0,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 4, fulfilledRevision: 4, targetHead: 0, error: '' },
      presentationAdmission: admission(),
    },
  };
}

describe('SZ-203 authoritative known-zero public owner', () => {
  it('installs empty-known without publishing a same-frame recovery prompt', async () => {
    // 用户能力：当前权威历史已确认频道为空时，用户看到明确空态，而不是恢复中的假提示。
    // 不变量：known-zero 由当前 generation + sync receipt 证明；空呈现不发起 history recovery。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport。
    const request = vi.fn(() => NEVER);
    const viewSessions = {
      readView: () => ({ mode: 'following', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const state = emptyState();
    const base = {
      state,
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'sz203-empty:mine',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ history }) => useConversationProjection({ ...base, history }),
      { initialProps: { history: historyFor(request) } },
    );

    await waitFor(() => expect(result.current.viewport.initializing).toBe(false));
    expect(result.current.viewport.availability).toBe('empty-known');
    expect(result.current.viewport.emptyReason).toBe('channel');
    expect(result.current.viewport.restorePending).toBe(false);
    expect(result.current.projection.presentation.rows).toEqual([]);
    expect(request).not.toHaveBeenCalled();

    // Re-publishing the same authoritative zero facts cannot reopen a recovery
    // obligation or create a second owner for the empty projection.
    rerender({ history: historyFor(request) });
    await waitFor(() => expect(result.current.viewport.availability).toBe('empty-known'));
    expect(result.current.viewport.initializing).toBe(false);
    expect(result.current.viewport.restorePending).toBe(false);
    expect(result.current.projection.presentation.rows).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    unmount();
  });
});
