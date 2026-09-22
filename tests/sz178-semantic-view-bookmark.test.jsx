// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const NEVER = new Promise(() => {});

const VIEW_SPEC_BASE = Object.freeze({
  selfId: 'human:sz178:1',
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
      sourceLease: 'sz178-source',
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

describe('SZ-178 semantic view switch bookmark supply', () => {
  it.skip('reopens one blocking initial-view demand for a saved bookmark absent from the new projection', async () => {
    // 用户能力：同频道切换语义 view 后，已保存但未安装的 bookmark 仍可恢复。
    // 不变量：切换只更换当前 view owner；同一 bookmark 目标只发出一次 blocking 供给。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport。
    const request = vi.fn(() => NEVER);
    const viewSessions = {
      readView: (_channelID, viewKey) => viewKey === 'c0:all'
        ? {
          mode: 'browsing',
          revision: 0,
          bookmark: { messageID: 'saved-all-row', seq: 3, rowViewportOffset: 12 },
        }
        : { mode: 'following', revision: 0 },
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const base = {
      viewSessions,
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const installedState = stateFor([message('mine-row', 9, 'human:sz178:1')]);
    const missingBookmarkState = stateFor([]);
    const initialHistory = historyFor(request);
    const { result, rerender, unmount } = renderHook(
      ({ viewKey, state, history }) => useConversationProjection({
        ...base,
        state,
        history,
        historyViewSpec: { ...VIEW_SPEC_BASE, scope: viewKey.endsWith(':all') ? 'all' : 'mine' },
        messageListKey: viewKey,
      }),
      {
        initialProps: {
          viewKey: 'c0:mine',
          state: installedState,
          history: initialHistory,
        },
      },
    );

    await waitFor(() => expect(result.current.viewport.initializing).toBe(false));
    const firstActivation = result.current.viewport.activationID;
    expect(request).not.toHaveBeenCalled();

    rerender({
      viewKey: 'c0:all',
      state: missingBookmarkState,
      history: historyFor(request),
    });

    await waitFor(() => expect(result.current.viewport.activationID).not.toBe(firstActivation));
    expect(result.current.viewport.initializing).toBe(true);
    expect(result.current.viewport.restorePending).toBe(true);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'initial-view',
      urgency: 'blocking',
      targetSeq: 3,
      requiredVisibleCoverage: { messageID: 'saved-all-row', seq: 3 },
    }));

    // The committed owner is the only observable writer for the missing
    // bookmark; a rerender with unchanged source facts must not duplicate it.
    rerender({
      viewKey: 'c0:all',
      state: missingBookmarkState,
      history: historyFor(request),
    });
    await waitFor(() => expect(result.current.viewport.restorePending).toBe(true));
    expect(request).toHaveBeenCalledOnce();
    unmount();
  });
});
