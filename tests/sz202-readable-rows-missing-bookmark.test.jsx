// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const NEVER = new Promise(() => {});

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz202:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function message(id, seq, senderId = 'human:other:1') {
  return {
    kind: 'standalone',
    seq,
    envelope: {
      id,
      seq,
      ts: seq * 1_000,
      type: 'human.note',
      sender: { id: senderId, kind: 'human' },
      payload: { body: { text: id } },
    },
  };
}

function stateFor(rows, revision = 9) {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('c0').state;
  const envelopes = new Map(rows.map((row) => [row.seq, row.envelope]));
  const envelopesById = new Map(rows.map((row) => [row.envelope.id, row.envelope]));
  return {
    ...base,
    channelId: 'c0',
    rows: envelopes,
    _envelopesById: envelopesById,
    timeline: rows,
    lastSeq: revision,
    _timelineRevision: revision,
    _timelineProjectionVersion: revision,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 9,
  };
}

function historyFor(request) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'c0',
      attached: true,
      generation: 1,
      sourceLease: 'sz202-source',
      messageCurrent: true,
      headSeq: 9,
      oldestSeq: 1,
      coverage: [{ lowSeq: 1, highSeq: 9 }],
      loaded: true,
      completedPages: 1,
      hasOlder: true,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 9,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 9, error: '' },
      presentationAdmission: admission(),
    },
  };
}

describe('SZ-202 readable rows with missing bookmark', () => {
  it('keeps readable projection while recovering a missing browsing bookmark', async () => {
    // 用户能力：恢复保存位置时，已经可读的内容继续可用，不被恢复提示阻塞。
    // 不变量：缺失 bookmark 只维持一个 typed blocking supply request；不把已有 rows 变成初始化遮罩。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport。
    const request = vi.fn(() => NEVER);
    const viewSessions = {
      readView: () => ({
        mode: 'browsing',
        revision: 0,
        bookmark: { messageID: 'missing-bookmark', seq: 3, rowViewportOffset: 12 },
      }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const state = stateFor([message('readable-row', 9)]);
    const { result, rerender, unmount } = renderHook(
      ({ history }) => useConversationProjection({
        state,
        history,
        viewSessions,
        historyViewSpec: VIEW_SPEC,
        messageListKey: 'c0:all',
        timelineLocalEchoes: [],
        identityPending: false,
        surfaceVisible: true,
        onTailCaughtUp: vi.fn(),
      }),
      { initialProps: { history: historyFor(request) } },
    );

    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.viewport.availability).toBe('readable'));
    expect(result.current.projection.presentation.rows.map((row) => row.id)).toEqual(['readable-row']);
    expect(result.current.viewport.initializing).toBe(false);
    expect(result.current.viewport.restorePending).toBe(true);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'restore-reading',
      intent: 'initial-view',
      urgency: 'blocking',
      targetSeq: 3,
      requiredVisibleCoverage: { messageID: 'missing-bookmark', seq: 3 },
    }));

    // Re-publishing the same readable Replica facts keeps one public owner and
    // must not turn the in-flight recovery into a duplicate request.
    rerender({ history: historyFor(request) });
    await waitFor(() => expect(result.current.viewport.initializing).toBe(false));
    expect(result.current.projection.presentation.rows.map((row) => row.id)).toEqual(['readable-row']);
    expect(request).toHaveBeenCalledOnce();
    unmount();
  });
});
