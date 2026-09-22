// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz182:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('restore-lease').state;
  return {
    ...base,
    channelId: 'restore-lease',
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

function historyFor(request, overrides = {}) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'restore-lease',
      attached: false,
      generation: 0,
      messageCurrent: false,
      headSeq: 90,
      oldestSeq: 1,
      coverage: [],
      loaded: true,
      completedPages: 1,
      hasOlder: true,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 1,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 90, error: '' },
      sourceLease: '1:2:9',
      presentationAdmission: admission(),
      ...overrides,
    },
  };
}

describe('SZ-182 saved bookmark gen0-to-gen1 reacquisition', () => {
  it.skip('reacquires the same immutable initial-view target after the old result settles', async () => {
    // 用户能力：重连/换代期间继续恢复同一保存 bookmark，而不是漂移到新目标。
    // 不变量：source lease 改变只替换供给 authority，不改变 immutable target。
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
      messageListKey: 'restore-lease:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ history }) => useConversationProjection({ ...base, history }),
      { initialProps: { history: historyFor(request) } },
    );

    await waitFor(() => expect(initialViewCalls).toBe(1));
    expect(request.mock.calls[0][0]).toMatchObject({
      intent: 'initial-view',
      urgency: 'blocking',
      targetSeq: 3,
      requiredVisibleCoverage: { messageID: 'saved-target', seq: 3 },
    });
    expect(result.current.viewport.session.bookmark).toMatchObject({
      messageID: 'saved-target',
      seq: 3,
    });

    const attachedHistory = historyFor(request, {
      attached: true,
      generation: 1,
      messageCurrent: true,
      sourceLease: '1:3:10',
    });
    rerender({ history: attachedHistory });
    expect(initialViewCalls).toBe(1);
    expect(result.current.viewport.status).toMatchObject({
      generation: 1,
      attached: true,
      sourceLease: '1:3:10',
    });

    // Gen0 completion is intentionally late; only after it settles may the
    // current gen1 owner reacquire the exact same saved target.
    await act(async () => {
      settleFirst({ kind: 'exhausted', localOnly: true });
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
