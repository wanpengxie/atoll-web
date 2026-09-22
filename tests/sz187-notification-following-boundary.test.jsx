// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

afterEach(cleanup);

const CHANNEL = 'c0';
const SELF = 'human:sz187:1';
const ROOT_NODE = {};

function message(id, seq) {
  return {
    kind: 'standalone',
    seq,
    envelope: {
      id,
      seq,
      ts: seq * 1_000,
      type: 'human.note',
      sender: { id: 'human:other:1', kind: 'human' },
      audience: [SELF],
      payload: { body: { text: id } },
    },
  };
}

function stateFor(rows, revision) {
  const replica = createChannelReplicaStore();
  const base = replica.ensure(CHANNEL).state;
  const envelopes = new Map(rows.map((row) => [row.seq, row.envelope]));
  const envelopesByID = new Map(rows.map((row) => [row.envelope.id, row.envelope]));
  return {
    ...base,
    channelId: CHANNEL,
    rows: envelopes,
    _envelopesById: envelopesByID,
    timeline: rows,
    lastSeq: rows.at(-1)?.seq || 0,
    _timelineRevision: revision,
    _timelineProjectionVersion: revision,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
  };
}

function historyFor({ headSeq, presentationRevision = 10 }) {
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'exhausted', localOnly: true })),
    refreshLatest: vi.fn(),
    status: {
      channelId: CHANNEL,
      attached: true,
      generation: 7,
      sourceLease: 'sz187-lease',
      messageCurrent: true,
      headSeq,
      oldestSeq: 1,
      coverage: [{ lowSeq: 1, highSeq: headSeq }],
      loaded: true,
      completedPages: 1,
      hasOlder: true,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision,
      notificationAuthorityRevision: 3,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: headSeq, error: '' },
      presentationAdmission: admission(),
    },
  };
}

function observationFor(viewport, projection, overrides = {}) {
  const status = viewport.status || {};
  const session = viewport.getSession();
  const presentation = projection.projection.presentation;
  const presentationRevision = Number(presentation.revision || 0);
  const tailID = String(presentation.rows.at(-1)?.id || '');
  const inputEpoch = Number(session.inputEpoch || 0);
  const identity = {
    activationID: viewport.activationID,
    inputEpoch,
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
    inputEpoch,
    source: 'layout',
    atTail: true,
    settled: true,
    surfaceVisible: true,
    installedHighSeq: Number(overrides.installedHighSeq || 100),
    presentationRevision,
    domPresentationRevision: presentationRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID,
    visibleRows: [{ messageID: tailID, seqHigh: Number(overrides.installedHighSeq || 100) }],
    visibleRowIDs: [tailID],
    observationIdentity: identity,
    ...overrides,
  };
}

function validReceipts(calls) {
  return calls
    .map(([receipt]) => receipt)
    .filter((receipt) => (
      (receipt?.cause === 'tail-backlog' || receipt?.cause === 'presented-follow')
      && Number(receipt?.boundary || 0) > 0
    ));
}

describe('SZ-187 notification following boundary', () => {
  it.skip('freezes one backlog boundary until a newly presented tail advances it', async () => {
    // 用户能力：已在尾部但尚未呈现的新动态不提前清零；Meta-only head
    // 推进不重放旧 receipt；新 row 真正安装并由 Reading 观测后才推进。
    // 不变量：Feed 是唯一 high-water owner，Presentation 只提交冻结 receipt。
    // 公开 owner：useConversationProjection → onTailCaughtUp → Feed ack port。
    const row100 = message('row-100', 100);
    const initialState = stateFor([row100], 10);
    const acceptedReceipts = [];
    const onTailCaughtUp = vi.fn((receipt) => {
      // Workspace's existing port rejects an incomplete receipt in Feed. Keep
      // only the public, typed acknowledgements as the product evidence.
      if ((receipt?.cause === 'tail-backlog' || receipt?.cause === 'presented-follow')
        && Number(receipt?.boundary || 0) > 0) acceptedReceipts.push(receipt);
    });
    const base = {
      viewSessions: {
        readView: () => ({ mode: 'following', revision: 0 }),
        activate: vi.fn(),
        save: vi.fn(() => true),
        deactivate: vi.fn(),
      },
      historyViewSpec: {
        scope: 'all',
        selfId: SELF,
        actorFilter: new Set(),
        editingTargetId: '',
        editingReplacementId: '',
        showNarration: false,
      },
      messageListKey: `${CHANNEL}:all`,
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp,
    };
    const { result, rerender, unmount } = renderHook(
      ({ state, history }) => useConversationProjection({ ...base, state, history }),
      {
        initialProps: {
          state: initialState,
          history: historyFor({ headSeq: 100 }),
        },
      },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());

    // Meta learns about seq 101 before a new DOM paint. The first legal
    // observation freezes the backlog boundary at 101, not the installed row
    // 100 and not a future mutable head.
    rerender({ state: initialState, history: historyFor({ headSeq: 101 }) });
    act(() => {
      expect(result.current.viewport.onReadingObservation(
        observationFor(result.current.viewport, result.current, { installedHighSeq: 100 }),
      )).toBe(true);
    });
    await waitFor(() => expect(validReceipts(onTailCaughtUp.mock.calls)).toHaveLength(1));
    expect(validReceipts(onTailCaughtUp.mock.calls)[0]).toMatchObject({
      cause: 'tail-backlog',
      boundary: 101,
      installedHighSeq: 101,
      captured: { installedHighSeq: 101 },
      generation: 7,
    });

    // A mutable Meta/head advance alone does not advance or replay the frozen
    // acknowledgement. The public callback may receive an incomplete status
    // update, but Feed's typed ack port must see no second valid receipt.
    rerender({ state: initialState, history: historyFor({ headSeq: 102 }) });
    await act(async () => {});
    expect(validReceipts(onTailCaughtUp.mock.calls)).toHaveLength(1);
    expect(acceptedReceipts).toHaveLength(1);

    // Only after seq 102 is materialized and the new settled tail is observed
    // may the current following evidence advance the same owner to 102.
    const row102 = message('row-102', 102);
    const nextState = stateFor([row100, row102], 11);
    rerender({
      state: nextState,
      history: historyFor({ headSeq: 102, presentationRevision: 11 }),
    });
    act(() => {
      expect(result.current.viewport.onReadingObservation(
        observationFor(result.current.viewport, result.current, { installedHighSeq: 102 }),
      )).toBe(true);
    });
    await waitFor(() => expect(validReceipts(onTailCaughtUp.mock.calls)).toHaveLength(2));
    const presentedReceipt = validReceipts(onTailCaughtUp.mock.calls)[1];
    expect(['tail-backlog', 'presented-follow']).toContain(presentedReceipt.cause);
    expect(presentedReceipt).toMatchObject({
      boundary: 102,
      installedHighSeq: 102,
      captured: { installedHighSeq: 102 },
      generation: 7,
    });
    expect(presentedReceipt.visibleRowIDs).toContain('row-102');
    expect(acceptedReceipts).toHaveLength(2);
    unmount();
  });
});
