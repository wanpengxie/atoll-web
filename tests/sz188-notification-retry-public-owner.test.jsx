// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

afterEach(cleanup);

const CHANNEL = 'c0';
const SELF = 'human:sz188:1';
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
  return { evaluate: (_channelID, items) => ({ items, receipt: null }) };
}

function historyFor(headSeq, overrides = {}) {
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'exhausted', localOnly: true })),
    refreshLatest: vi.fn(),
    status: {
      channelId: CHANNEL,
      attached: true,
      generation: 7,
      sourceLease: 'sz188-lease',
      authority: {
        channelId: CHANNEL,
        principalId: 'sz188-principal',
        serverBoot: 'sz188-world',
      },
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
      presentationRevision: 10,
      notificationAuthorityRevision: 3,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: headSeq, error: '' },
      presentationAdmission: admission(),
      ...overrides,
    },
  };
}

function observationFor(viewport, projection) {
  const status = viewport.status || {};
  const presentation = projection.projection.presentation;
  const presentationRevision = Number(presentation.revision || 0);
  const tailID = String(presentation.rows.at(-1)?.id || '');
  const session = viewport.getSession();
  const installedHighSeq = 100;
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
    installedHighSeq,
    presentationRevision,
    domPresentationRevision: presentationRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID,
    visibleRows: [{ messageID: tailID, seqHigh: installedHighSeq }],
    visibleRowIDs: [tailID],
    observationIdentity: identity,
  };
}

function projectionProps(onTailCaughtUp, overrides = {}) {
  return {
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
    ...overrides,
  };
}

describe('SZ-188 notification retry after Meta advance', () => {
  it('retries the same rejected frozen boundary without a new DOM observation', async () => {
    const row = message('row-100', 100);
    const initialState = stateFor([row], 10);
    const receipts = [];
    const onTailCaughtUp = vi.fn((receipt) => {
      receipts.push(receipt);
      // Model the existing Feed/Cursors acknowledgement rejecting the frozen
      // event; the Reading owner must retry that same immutable receipt.
      return receipts.length > 1;
    });
    const base = projectionProps(onTailCaughtUp);
    const { result, rerender } = renderHook(
      ({ state, history }) => useConversationProjection({ ...base, state, history }),
      { initialProps: { state: initialState, history: historyFor(100) } },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    act(() => {
      expect(result.current.viewport.onReadingObservation(
        observationFor(result.current.viewport, result.current),
      )).toBe(true);
    });
    await waitFor(() => expect(receipts).toHaveLength(1));
    expect(receipts[0]).toMatchObject({
      cause: 'tail-backlog',
      boundary: 100,
      activationID: result.current.viewport.activationID,
      inputEpoch: 0,
      generation: 7,
      authorityRevision: 3,
      authority: {
        channelId: CHANNEL,
        principalId: 'sz188-principal',
        serverBoot: 'sz188-world',
      },
      owner: {
        channelId: CHANNEL,
        viewKey: `${CHANNEL}:all`,
        activationID: result.current.viewport.activationID,
        generation: 7,
      },
      captured: {
        presentationRevision: 10,
        sourceRevision: 10,
        installedHighSeq: 100,
        visibleRowIDs: ['row-100'],
      },
      rootIdentity: 1,
      rootNode: ROOT_NODE,
      intentRevision: 0,
      visibilityEpoch: 0,
      settled: true,
      caughtUp: true,
    });

    // The notification owner rejects the receipt, while Meta learns about seq
    // 101.  SZ-188 requires retrying the same frozen boundary without asking
    // the DOM owner for another observation.
    rerender({ state: initialState, history: historyFor(101) });
    await act(async () => {});
    await waitFor(() => expect(receipts).toHaveLength(2));
    expect(receipts[1]).toMatchObject({ cause: 'tail-backlog', boundary: 100 });
    expect(receipts[1]).toBe(receipts[0]);
    expect(Object.isFrozen(receipts[0])).toBe(true);

    // An accepted retry consumes the ephemeral receipt. A later head advance
    // must not replay the old boundary again.
    rerender({ state: initialState, history: historyFor(102) });
    await act(async () => {});
    expect(receipts).toHaveLength(2);
  });

  it('drops a rejected receipt when the Feed authority is replaced', async () => {
    const row = message('row-100', 100);
    const initialState = stateFor([row], 10);
    const receipts = [];
    const onTailCaughtUp = vi.fn((receipt) => {
      receipts.push(receipt);
      return false;
    });
    const base = projectionProps(onTailCaughtUp);
    const { result, rerender } = renderHook(
      ({ state, history }) => useConversationProjection({ ...base, state, history }),
      { initialProps: { state: initialState, history: historyFor(100) } },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    act(() => {
      expect(result.current.viewport.onReadingObservation(
        observationFor(result.current.viewport, result.current),
      )).toBe(true);
    });
    await waitFor(() => expect(receipts.filter((receipt) => receipt.cause === 'tail-backlog')).toHaveLength(1));

    rerender({
      state: initialState,
      history: historyFor(101, {
        generation: 8,
        notificationAuthorityRevision: 4,
        authority: {
          channelId: CHANNEL,
          principalId: 'sz188-replacement-principal',
          serverBoot: 'sz188-replacement-world',
        },
      }),
    });
    await act(async () => {});
    rerender({
      state: initialState,
      history: historyFor(102, {
        generation: 8,
        notificationAuthorityRevision: 4,
        authority: {
          channelId: CHANNEL,
          principalId: 'sz188-replacement-principal',
          serverBoot: 'sz188-replacement-world',
        },
      }),
    });
    await act(async () => {});

    expect(receipts.filter((receipt) => receipt.cause === 'tail-backlog')).toHaveLength(1);
  });

  it('drops a pending receipt immediately while the current Feed is detached', async () => {
    const row = message('row-100', 100);
    const initialState = stateFor([row], 10);
    const receipts = [];
    const onTailCaughtUp = vi.fn((receipt) => {
      receipts.push(receipt);
      return false;
    });
    const base = projectionProps(onTailCaughtUp);
    const { result, rerender } = renderHook(
      ({ state, history }) => useConversationProjection({ ...base, state, history }),
      { initialProps: { state: initialState, history: historyFor(100) } },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    act(() => {
      expect(result.current.viewport.onReadingObservation(
        observationFor(result.current.viewport, result.current),
      )).toBe(true);
    });
    await waitFor(() => expect(receipts).toHaveLength(1));

    // A rejected receipt cannot survive a Feed detach/message-current loss;
    // later Meta/head publications must not replay the old boundary.
    rerender({
      state: initialState,
      history: historyFor(101, { attached: false, messageCurrent: false }),
    });
    await act(async () => {});
    rerender({
      state: initialState,
      history: historyFor(102, { attached: false, messageCurrent: false }),
    });
    await act(async () => {});
    rerender({ state: initialState, history: historyFor(103) });
    await act(async () => {});

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ cause: 'tail-backlog', boundary: 100 });
  });

  it('attempts one retry per authority and does not revive a rejected receipt on every head', async () => {
    const row = message('row-100', 100);
    const initialState = stateFor([row], 10);
    const receipts = [];
    const onTailCaughtUp = vi.fn((receipt) => {
      receipts.push(receipt);
      return false;
    });
    const base = projectionProps(onTailCaughtUp);
    const { result, rerender } = renderHook(
      ({ state, history }) => useConversationProjection({ ...base, state, history }),
      { initialProps: { state: initialState, history: historyFor(100) } },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    act(() => {
      expect(result.current.viewport.onReadingObservation(
        observationFor(result.current.viewport, result.current),
      )).toBe(true);
    });
    await waitFor(() => expect(receipts).toHaveLength(1));

    // One forward Meta/head publication may trigger the bounded retry.
    rerender({ state: initialState, history: historyFor(101) });
    await waitFor(() => expect(receipts).toHaveLength(2));
    expect(receipts[1]).toBe(receipts[0]);

    // A rejected retry is terminal for this ephemeral authority. Further
    // head advances do not turn the same frozen event into a retry loop.
    rerender({ state: initialState, history: historyFor(102) });
    await act(async () => {});
    rerender({ state: initialState, history: historyFor(103) });
    await act(async () => {});
    expect(receipts).toHaveLength(2);
  });

  it('drops a rejected receipt when an explicit latest intent advances intentRevision', async () => {
    const row = message('row-100', 100);
    const initialState = stateFor([row], 10);
    const receipts = [];
    const onTailCaughtUp = vi.fn((receipt) => {
      receipts.push(receipt);
      return false;
    });
    const base = projectionProps(onTailCaughtUp);
    const { result, rerender } = renderHook(
      ({ state, history }) => useConversationProjection({ ...base, state, history }),
      { initialProps: { state: initialState, history: historyFor(100) } },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    act(() => {
      expect(result.current.viewport.onReadingObservation(
        observationFor(result.current.viewport, result.current),
      )).toBe(true);
    });
    await waitFor(() => expect(receipts).toHaveLength(1));

    // requestLatest changes only the semantic intent revision while the same
    // physical tail remains painted. That is still a new authority lineage;
    // a rejected receipt from the old intent must not retry on Meta advance.
    const previousIntentRevision = result.current.viewport.getSession().intentRevision;
    act(() => expect(result.current.viewport.requestBottom('latest')).toBe(true));
    expect(result.current.viewport.getSession().intentRevision).toBeGreaterThan(previousIntentRevision);
    rerender({ state: initialState, history: historyFor(101) });
    await act(async () => {});

    expect(receipts).toHaveLength(1);
  });
});
