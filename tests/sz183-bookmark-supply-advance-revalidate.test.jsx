// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz183:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('restore-supply').state;
  return {
    ...base,
    channelId: 'restore-supply',
    timeline: [],
    lastSeq: 0,
    _timelineRevision: 1,
    _timelineProjectionVersion: 1,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 1,
  };
}

function historyFor(request, completedPages) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'restore-supply',
      attached: true,
      generation: 1,
      messageCurrent: true,
      headSeq: 90,
      oldestSeq: completedPages === 1 ? 61 : 41,
      coverage: [],
      loaded: true,
      completedPages,
      revealVersion: completedPages,
      buffered: completedPages === 1 ? 0 : 8,
      hasOlder: true,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 1,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 90, error: '' },
      sourceLease: '1:3:10',
      presentationAdmission: admission(),
    },
  };
}

describe('SZ-183 immutable bookmark target after same-source supply progress', () => {
  it.skip('revalidates the same initial-view target after a late old attempt', async () => {
    // 用户能力：同一 source 供给推进期间，保存 bookmark 恢复仍指向同一目标。
    // 不变量：supply progress 可重开 obligation，但不能重写 immutable target。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport。
    let settleFirst;
    const first = new Promise((resolve) => { settleFirst = resolve; });
    let initialViewCalls = 0;
    const request = vi.fn((options) => {
      if (options.intent !== 'initial-view') return new Promise(() => {});
      initialViewCalls += 1;
      return initialViewCalls === 1 ? first : new Promise(() => {});
    });
    const viewSessions = {
      readView: () => ({
        mode: 'browsing',
        revision: 1,
        bookmark: { messageID: 'saved-target', seq: 3, rowViewportOffset: 8 },
      }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const base = {
      state: stateFor(),
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'restore-supply:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ completedPages }) => useConversationProjection({
        ...base,
        history: historyFor(request, completedPages),
      }),
      { initialProps: { completedPages: 1 } },
    );

    await waitFor(() => expect(initialViewCalls).toBe(1));
    expect(request.mock.calls[0][0]).toMatchObject({
      intent: 'initial-view',
      urgency: 'blocking',
      targetSeq: 3,
      requiredVisibleCoverage: { messageID: 'saved-target', seq: 3 },
    });

    // The same source advances while the first operation is still pending.
    // The current owner records progress but cannot start a second writer yet.
    rerender({ completedPages: 2 });
    expect(initialViewCalls).toBe(1);
    expect(result.current.viewport.status).toMatchObject({
      generation: 1,
      sourceLease: '1:3:10',
      completedPages: 2,
      oldestSeq: 41,
      buffered: 8,
    });

    await act(async () => {
      settleFirst({ kind: 'exhausted' });
      await first;
    });
    await waitFor(() => expect(initialViewCalls).toBe(2));
    for (const [options] of request.mock.calls.filter(([value]) => value.intent === 'initial-view')) {
      expect(options).toMatchObject({
        intent: 'initial-view',
        targetSeq: 3,
        requiredVisibleCoverage: { messageID: 'saved-target', seq: 3 },
      });
    }
    expect(result.current.viewport.session.bookmark).toMatchObject({
      messageID: 'saved-target',
      seq: 3,
    });
    unmount();
  });
});
