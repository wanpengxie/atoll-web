// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const SELF = 'human:sz200:1';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: SELF,
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function message(id = 'cold-row', seq = 7) {
  return {
    kind: 'standalone',
    seq,
    envelope: {
      id,
      seq,
      ts: seq * 1_000,
      type: 'human.note',
      sender: { id: SELF, kind: 'human' },
      payload: { body: { text: id } },
    },
  };
}

function stateFor(timeline = []) {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('cold-materialization').state;
  return {
    ...base,
    channelId: 'cold-materialization',
    timeline,
    lastSeq: timeline.at(-1)?.seq || 0,
    _timelineRevision: timeline.length ? 4 : 1,
    _timelineProjectionVersion: timeline.length ? 4 : 1,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 7,
  };
}

function historyFor(presentationRevision) {
  return {
    request: vi.fn(() => new Promise(() => {})),
    refreshLatest: vi.fn(),
    status: {
      channelId: 'cold-materialization',
      attached: true,
      generation: 1,
      messageCurrent: true,
      headSeq: 7,
      oldestSeq: 1,
      coverage: [{ lowSeq: 1, highSeq: 7 }],
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 7, error: '' },
      sourceLease: '1:7:1',
      presentationAdmission: admission(),
    },
  };
}

describe('SZ-200 cold-entry materialization public owner', () => {
  it('leaves materializing only after the current activation publishes its first range', async () => {
    // 用户能力：冷入口已有可读 Presentation rows 时，首个物理 range 到达前
    // 仍显示有界 materializing；range receipt 到达后才报告 readable。
    // 不变量：range 必须绑定当前 activation + Presentation revision，旧 receipt
    // 和非法范围不能结束当前 materialization。
    // 公开 owner：useConversationProjection → Reading viewport → VendorListExecutor。
    const viewSessions = {
      readView: () => ({ mode: 'following', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const args = {
      state: stateFor(),
      history: historyFor(0),
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'cold-materialization:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ state, history }) => useConversationProjection({ ...args, state, history }),
      { initialProps: args },
    );

    expect(result.current.viewport.availability).toBe('syncing');

    const rowState = stateFor([message()]);
    rerender({ state: rowState, history: historyFor(4) });
    await waitFor(() => expect(result.current.projection.presentation.rows).toHaveLength(1));
    await waitFor(() => expect(result.current.viewport.availability).toBe('materializing'));
    expect(result.current.viewport.initializing).toBe(false);
    expect(result.current.viewport.presentationPending).toBe(true);
    const presentationRevision = result.current.projection.presentation.revision;

    expect(result.current.viewport.onPresentationMaterialized({
      activationID: 'stale-activation',
      presentationRevision,
      startIndex: 0,
      endIndex: 0,
    })).toBe(false);
    expect(result.current.viewport.onPresentationMaterialized({
      activationID: result.current.viewport.activationID,
      presentationRevision: presentationRevision - 1,
      startIndex: 0,
      endIndex: 0,
    })).toBe(false);
    expect(result.current.viewport.onPresentationMaterialized({
      activationID: result.current.viewport.activationID,
      presentationRevision,
      startIndex: -1,
      endIndex: 0,
    })).toBe(false);
    expect(result.current.viewport.availability).toBe('materializing');

    act(() => {
      expect(result.current.viewport.onPresentationMaterialized({
        activationID: result.current.viewport.activationID,
        presentationRevision,
        startIndex: 0,
        endIndex: 0,
      })).toBe(true);
    });
    await waitFor(() => expect(result.current.viewport.availability).toBe('readable'));
    expect(result.current.viewport.presentationPending).toBe(false);
    unmount();
  });
});
