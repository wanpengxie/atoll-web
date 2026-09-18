// @vitest-environment jsdom
import React, { Suspense, startTransition, useLayoutEffect, useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Timeline } from '../src/ui/Timeline.jsx';
import { createHistoryDemandPort } from '../src/model/history-demand.js';
import { currentEntryAuthority, installedTailReadRows, pendingArrivalEvents, useReadingSession } from '../src/ui/timeline/useReadingSession.js';

vi.mock('../src/ui/timeline/LegendMessageList.jsx', async () => {
  const { PresentationMessageList } = await import('./helpers/PresentationMessageList.jsx');
  return {
    MessageList(props) {
      const { reading, snapshot, surfaceVisible } = props;
      useLayoutEffect(() => {
        if (!snapshot.rows.length) return;
        reading.onReadingObservation({
          activationID: reading.activationID,
          source: 'semantic-test-boundary',
          atTail: true,
          surfaceVisible: surfaceVisible === true,
          installedHighSeq: Math.max(...snapshot.rows.map((row) => Number(row.seqHigh || 0))),
          visibleRows: snapshot.rows.map((row) => ({ messageID: row.id, seqHigh: Number(row.seqHigh || 0) })),
        });
      }, [reading, snapshot.revision, snapshot.rows, surfaceVisible]);
      return <PresentationMessageList {...props} />;
    },
  };
});

vi.mock('../src/ui/timeline/FollowingTailList.jsx', async () => {
  const { PresentationMessageList } = await import('./helpers/PresentationMessageList.jsx');
  return {
    FollowingTailList(props) {
      const { reading, snapshot, surfaceVisible } = props;
      useLayoutEffect(() => {
        if (!snapshot.rows.length) return;
        reading.onReadingObservation({
          activationID: reading.activationID,
          source: 'semantic-test-boundary',
          atTail: true,
          surfaceVisible: surfaceVisible === true,
          installedHighSeq: Math.max(...snapshot.rows.map((row) => Number(row.seqHigh || 0))),
          visibleRows: snapshot.rows.map((row) => ({ messageID: row.id, seqHigh: Number(row.seqHigh || 0) })),
        });
      }, [reading, snapshot.revision, snapshot.rows, surfaceVisible]);
      return <PresentationMessageList {...props} />;
    },
  };
});

afterEach(cleanup);

function expectLastReadReceipt(mock, installedHighSeq) {
  const [receipt, authority] = mock.mock.calls.at(-1) || [];
  expect(receipt).toEqual(expect.objectContaining({
    installedHighSeq,
    activationID: expect.any(String),
    viewKey: expect.any(String),
  }));
  expect(authority).toEqual({
    activationID: receipt.activationID,
    viewKey: receipt.viewKey,
  });
}

it('selects every newer event from a sparse, stable-key-collapsed arrival prefix', () => {
  const events = [
    { revision: 76, key: 'stable-root', rowIDs: ['terminal-1', 'terminal-76'] },
    ...Array.from({ length: 1_024 }, (_, index) => ({
      revision: index + 77, key: 'stable-root', rowID: `terminal-${index + 77}`,
    })),
  ];
  expect(pendingArrivalEvents({ revision: 1_100, events }, 50).at(0)?.revision).toBe(76);
  expect(pendingArrivalEvents({ revision: 1_100, events }, 1_000).map((event) => event.revision))
    .toEqual(Array.from({ length: 100 }, (_, index) => index + 1_001));
});

// The local adapter reports a semantic installed-tail observation without
// inventing layout. Production visibility/materialization geometry is gated in
// Chromium by ux-reading-evidence.spec.js.
it('只有生产时间线确认位于最新端后才回报已读序号', async () => {
  const envelope = { id: 'latest-1', kind: 'event', type: 'human.note', ts: 1_000, sender: { id: 'other', kind: 'human' }, audience: ['me'], payload: { text: '最新消息' } };
  const state = { channelId: 'c0', rows: new Map([[7, envelope]]), turns: new Map(), standalone: [{ seq: 7, envelope }], orphans: [], narration: [], lastSeq: 7 };
  const onReadLatest = vi.fn();
  render(<Timeline state={state} history={{ onReadLatest }} roster={[{ id: 'me', name: '我' }]} selfId="me" pending={[]} approvalStates={{}} surfaceVisible />);
  await waitFor(() => expect(onReadLatest).toHaveBeenCalled());
  expectLastReadReceipt(onReadLatest, 7);
});

it('filtered tail clears its exact visible notice without advancing the physical channel cursor', async () => {
  let port;
  const physicalMarkRead = vi.fn();
  const row = { id: 'mine-visible', seqLow: 8, seqHigh: 8 };
  const snapshot = {
    revision: 3,
    sourceRevision: 12,
    rows: [row],
    entities: new Map([[row.id, row]]),
  };
  const history = createHistoryDemandPort({
    channelId: 'c0',
    status: {
      attached: true, messageCurrent: true, generation: 4,
      presentationRevision: 12,
    },
    markRead: physicalMarkRead,
  });
  const viewSessions = {
    readView: () => ({
      mode: 'following', revision: 0, unseenTail: 1,
      unseenRecords: [[row.id, row.seqHigh]],
    }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot, history, viewSessions,
      historyViewSpec: { scope: 'mine', actorFilter: new Set() },
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  render(<Harness />);
  await waitFor(() => expect(port?.unseen).toBe(1));
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 8,
    visibleRows: [{ messageID: row.id, seqHigh: 8 }],
  }));
  expect(port.unseen).toBe(0);
  expect(physicalMarkRead).toHaveBeenCalledWith(expect.objectContaining({
    physicalSeq: 0,
    identities: [{ messageID: row.id, seqHigh: 8 }],
  }));
});

it('retries one fenced receipt when HistoryDemand becomes current without new geometry', async () => {
  let port;
  const physicalMarkRead = vi.fn((acknowledgement) => acknowledgement.identities.length > 0);
  const row = { id: 'demand-current-late', seqLow: 12, seqHigh: 12 };
  const snapshot = {
    revision: 4,
    sourceRevision: 12,
    rows: [row],
    entities: new Map([[row.id, row]]),
  };
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness({ presentationRevision }) {
    const history = createHistoryDemandPort({
      channelId: 'c0',
      status: {
        attached: true, messageCurrent: true, generation: 4,
        presentationRevision,
      },
      markRead: physicalMarkRead,
    });
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine:steward', snapshot, history, viewSessions,
      historyViewSpec: { scope: 'mine', actorFilter: new Set(['steward']) },
      surfaceVisible: true,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness presentationRevision={11} />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 12,
    visibleRows: [{ messageID: row.id, seqHigh: 12 }],
  }));
  expect(physicalMarkRead).not.toHaveBeenCalled();

  view.rerender(<Harness presentationRevision={12} />);
  await waitFor(() => expect(physicalMarkRead).toHaveBeenCalledOnce());
  expect(physicalMarkRead).toHaveBeenCalledWith(expect.objectContaining({
    physicalSeq: 0,
    identities: [{ messageID: row.id, seqHigh: 12 }],
  }));
});

it('keeps the rejected receipt in ReadingSession until Cursors accepts it exactly once', async () => {
  let port;
  const accepted = { current: false };
  const physicalMarkRead = vi.fn((acknowledgement) => (
    accepted.current ? acknowledgement.identities.length > 0 : false
  ));
  const row = { id: 'cursor-authority-late', seqLow: 13, seqHigh: 13 };
  const snapshot = {
    revision: 5,
    sourceRevision: 13,
    rows: [row],
    entities: new Map([[row.id, row]]),
  };
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness({ authorityRevision }) {
    const history = createHistoryDemandPort({
      channelId: 'c0',
      status: {
        attached: true, messageCurrent: true, generation: 5,
        presentationRevision: 13, authorityRevision,
      },
      markRead: physicalMarkRead,
    });
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine:steward', snapshot, history, viewSessions,
      historyViewSpec: { scope: 'mine', actorFilter: new Set(['steward']) },
      surfaceVisible: true,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness authorityRevision={0} />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 13,
    visibleRows: [{ messageID: row.id, seqHigh: 13 }],
  }));
  expect(physicalMarkRead).toHaveBeenCalledTimes(2);

  accepted.current = true;
  view.rerender(<Harness authorityRevision={1} />);
  await waitFor(() => expect(physicalMarkRead).toHaveBeenCalledTimes(3));
  await act(async () => { await Promise.resolve(); });
  expect(physicalMarkRead).toHaveBeenCalledTimes(3);
  expect(physicalMarkRead.mock.calls[2][0]).toMatchObject({
    physicalSeq: 0,
    identities: [{ messageID: row.id, seqHigh: 13 }],
  });
});

it('does not carry a rejected receipt across a generation or semantic-scope replacement', async () => {
  let port;
  const physicalMarkRead = vi.fn(() => false);
  const row = { id: 'stale-retry', seqLow: 14, seqHigh: 14 };
  const snapshot = {
    revision: 6,
    sourceRevision: 14,
    rows: [row],
    entities: new Map([[row.id, row]]),
  };
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness({ generation, viewKey }) {
    const history = createHistoryDemandPort({
      channelId: 'c0',
      status: {
        attached: true, messageCurrent: true, generation,
        presentationRevision: 14,
      },
      markRead: physicalMarkRead,
    });
    const reading = useReadingSession({
      channelID: 'c0', viewKey, snapshot, history, viewSessions,
      historyViewSpec: { scope: 'mine', actorFilter: new Set([viewKey]) },
      surfaceVisible: true,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness generation={6} viewKey="steward" />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 14,
    visibleRows: [{ messageID: row.id, seqHigh: 14 }],
  }));
  expect(physicalMarkRead).toHaveBeenCalledTimes(2);

  view.rerender(<Harness generation={7} viewKey="steward" />);
  view.rerender(<Harness generation={7} viewKey="claude" />);
  await act(async () => { await Promise.resolve(); });
  expect(physicalMarkRead).toHaveBeenCalledTimes(2);
});

it('unfiltered all advances physical read and acknowledges the exact current identity', async () => {
  let port;
  const physicalMarkRead = vi.fn((acknowledgement) => acknowledgement.physicalSeq);
  const row = { id: 'all-visible', seqLow: 9, seqHigh: 9 };
  const snapshot = {
    revision: 5,
    sourceRevision: 14,
    rows: [row],
    entities: new Map([[row.id, row]]),
  };
  const history = createHistoryDemandPort({
    channelId: 'c0',
    status: {
      attached: true, messageCurrent: true, generation: 6,
      presentationRevision: 14,
    },
    markRead: physicalMarkRead,
  });
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:all', snapshot, history, viewSessions,
      historyViewSpec: { scope: 'all', actorFilter: new Set() },
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  render(<Harness />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 9,
    visibleRows: [{ messageID: row.id, seqHigh: 9 }],
  }));
  expect(physicalMarkRead).toHaveBeenCalledOnce();
  expect(physicalMarkRead).toHaveBeenCalledWith(expect.objectContaining({
    physicalSeq: 9,
    identities: [{ messageID: row.id, seqHigh: 9 }],
    receipt: expect.objectContaining({
      channelId: 'c0', viewKey: 'c0:all', generation: 6,
      sourceRevision: 14, scope: 'all', installedHighSeq: 9,
    }),
  }));
});

it('does not reuse an older generation DOM observation to advance a reattached cursor', async () => {
  let port;
  const physicalMarkRead = vi.fn((seq) => seq);
  const row = { id: 'generation-row', seqLow: 11, seqHigh: 11 };
  const snapshot = {
    revision: 7,
    sourceRevision: 18,
    rows: [row],
    entities: new Map([[row.id, row]]),
  };
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const historyFor = (generation) => createHistoryDemandPort({
    channelId: 'c0',
    status: {
      attached: true, messageCurrent: true, generation,
      presentationRevision: 18,
    },
    markRead: physicalMarkRead,
  });
  function Harness({ generation }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:all', snapshot,
      history: historyFor(generation), viewSessions,
      historyViewSpec: { scope: 'all', actorFilter: new Set() },
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness generation={1} />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 11,
    visibleRows: [{ messageID: row.id, seqHigh: 11 }],
  }));
  expect(physicalMarkRead).toHaveBeenCalledOnce();
  physicalMarkRead.mockClear();

  view.rerender(<Harness generation={2} />);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(physicalMarkRead).not.toHaveBeenCalled();
});

it('旧activation的迟到观察不会被hook改写为当前activation', async () => {
  let port;
  const markRead = vi.fn();
  const viewSessions = {
    readView: () => ({
      mode: 'following', revision: 0, unseenTail: 1,
      unseenKeys: ['current-row'], unseenRecords: [['current-row', 1]],
    }),
    activate: vi.fn(),
    save: vi.fn(() => true),
    deactivate: vi.fn(),
  };
  const snapshot = {
    rows: [{ id: 'current-row', seqLow: 1, seqHigh: 1 }],
    entities: new Map(),
  };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0',
      viewKey: 'c0:mine',
      snapshot,
      history: { status: { headSeq: 99 }, markRead },
      viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  render(<Harness />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());
  const before = port.getSession();
  act(() => port.onReadingObservation({
    activationID: 'stale-activation',
    source: 'layout',
    geometryRevision: 99,
    atTail: true,
    bookmark: { messageID: 'stale-row', rowViewportOffset: -20 },
  }));
  expect(port.getSession()).toBe(before);
  expect(port.unseen).toBe(1);
  expect(viewSessions.save).not.toHaveBeenCalled();
  expect(markRead).not.toHaveBeenCalled();

  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout',
    geometryRevision: 1,
    atTail: true,
    surfaceVisible: true,
    installedHighSeq: 1,
    visibleRows: [{ messageID: 'current-row', seqHigh: 1 }],
  }));
  expect(markRead).toHaveBeenCalledOnce();
  expectLastReadReceipt(markRead, 1);
  expect(port.unseen).toBe(0);
});

it('aborted render cannot publish candidate snapshot or markRead authority to the committed DOM', async () => {
  let committedPort;
  const never = new Promise(() => {});
  const markReadA = vi.fn();
  const markReadB = vi.fn();
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const candidate = (id, revision, generation, markRead) => ({
    snapshot: {
      revision,
      sourceRevision: revision,
      rows: [{ id, seqLow: revision, seqHigh: revision }],
      entities: new Map([[id, { id, seqLow: revision, seqHigh: revision }]]),
    },
    history: {
      status: { attached: true, messageCurrent: true, generation, presentationRevision: revision },
      markRead,
    },
  });
  function Harness({ value, suspend = false }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:all',
      snapshot: value.snapshot, history: value.history, viewSessions,
      historyViewSpec: { scope: 'all', actorFilter: new Set() },
      surfaceVisible: true,
    });
    useLayoutEffect(() => { committedPort = reading; }, [reading]);
    if (suspend) throw never;
    return null;
  }
  const a = candidate('row-a', 1, 1, markReadA);
  const b = candidate('row-b', 2, 2, markReadB);
  const view = render(<Suspense fallback={<p>candidate</p>}><Harness value={a} /></Suspense>);
  await waitFor(() => expect(committedPort?.activationID).toBeTruthy());
  const ownerA = committedPort;

  view.rerender(<Suspense fallback={<p>candidate</p>}><Harness value={b} suspend /></Suspense>);
  act(() => ownerA.onReadingObservation({
    activationID: ownerA.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 1,
    visibleRows: [{ messageID: 'row-a', seqHigh: 1 }],
  }));

  expect(markReadA).toHaveBeenCalledOnce();
  expect(markReadA).toHaveBeenCalledWith(expect.objectContaining({
    generation: 1,
    sourceRevision: 1,
    installedHighSeq: 1,
  }), expect.anything());
  expect(markReadB).not.toHaveBeenCalled();
});

it('aborted render cannot lend candidate history status to a committed request promise', async () => {
  let committedPort;
  let settle;
  const never = new Promise(() => {});
  const first = new Promise((resolve) => { settle = resolve; });
  const requestA = vi.fn()
    .mockImplementationOnce(() => first)
    .mockResolvedValue({ kind: 'loaded' });
  const requestAReplacement = vi.fn().mockResolvedValue({ kind: 'loaded' });
  const requestB = vi.fn();
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const snapshot = {
    revision: 1, sourceRevision: 1,
    rows: [{ id: 'row-a', seqLow: 1, seqHigh: 1 }],
    entities: new Map([['row-a', { id: 'row-a', seqLow: 1, seqHigh: 1 }]]),
  };
  function Harness({ request, hasOlder, suspend = false }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:all', snapshot,
      history: {
        status: { attached: true, messageCurrent: true, generation: 1, hasOlder },
        request,
      },
      viewSessions,
    });
    useLayoutEffect(() => { committedPort = reading; }, [reading]);
    if (suspend) throw never;
    return null;
  }
  const view = render(<Suspense fallback={<p>candidate</p>}>
    <Harness request={requestA} hasOlder />
  </Suspense>);
  await waitFor(() => expect(committedPort?.activationID).toBeTruthy());
  const ownerA = committedPort;
  const pending = ownerA.onNearTop();
  expect(requestA).toHaveBeenCalledOnce();

  view.rerender(<Suspense fallback={<p>candidate</p>}>
    <Harness request={requestB} hasOlder={false} suspend />
  </Suspense>);
  // Recommit the still-stale hasOlder=true snapshot through a freshly bound
  // request port, as Timeline does when Scheduler status publishes. Function
  // identity is not operation authority: the activation/view/generation still
  // own the receipt, and this frame must neither erase nor bypass it.
  view.rerender(<Suspense fallback={<p>candidate</p>}>
    <Harness request={requestAReplacement} hasOlder />
  </Suspense>);
  await waitFor(() => expect(committedPort).not.toBe(ownerA));
  await act(async () => {
    settle({ kind: 'exhausted' });
    await pending;
  });
  await act(async () => { await committedPort.onNearTop(); });

  // A current attached operation's non-local exhausted result is itself the
  // Scheduler's EOF authority. It must not wait for a later React snapshot of
  // hasOlder=false before suppressing the duplicate request.
  expect(requestA).toHaveBeenCalledTimes(1);
  expect(requestAReplacement).not.toHaveBeenCalled();
  expect(requestB).not.toHaveBeenCalled();
});

it('late history completion cannot cache exhaustion for a newer committed generation', async () => {
  let committedPort;
  let settle;
  const pendingResult = new Promise((resolve) => { settle = resolve; });
  const requestA = vi.fn(() => pendingResult);
  const requestB = vi.fn(async () => ({ kind: 'loaded' }));
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const snapshot = {
    revision: 1, sourceRevision: 1,
    rows: [{ id: 'stable-anchor', seqLow: 1, seqHigh: 1 }],
    entities: new Map([['stable-anchor', { id: 'stable-anchor', seqLow: 1, seqHigh: 1 }]]),
  };
  function Harness({ generation, hasOlder, request }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:all', snapshot,
      history: {
        status: { attached: true, messageCurrent: true, generation, hasOlder },
        request,
      },
      viewSessions,
    });
    useLayoutEffect(() => { committedPort = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness generation={1} hasOlder request={requestA} />);
  await waitFor(() => expect(committedPort?.activationID).toBeTruthy());
  const pending = committedPort.onNearTop();
  expect(requestA).toHaveBeenCalledOnce();

  const ownerA = committedPort;
  view.rerender(<Harness generation={2} hasOlder={false} request={requestB} />);
  await waitFor(() => expect(committedPort).not.toBe(ownerA));
  await act(async () => {
    settle({ kind: 'exhausted' });
    await pending;
  });
  await act(async () => { await committedPort.onNearTop(); });

  expect(requestB).toHaveBeenCalledOnce();
});

it('旧generation的失败operation不能封锁当前generation的anticipatory恢复', async () => {
  let committedPort;
  let rejectOld;
  const oldResult = new Promise((_resolve, reject) => { rejectOld = reject; });
  const requestA = vi.fn(() => oldResult);
  const requestB = vi.fn(async () => ({ kind: 'loaded' }));
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const snapshot = {
    revision: 1, sourceRevision: 1,
    rows: [{ id: 'stable-anchor', seqLow: 1, seqHigh: 1 }],
    entities: new Map([['stable-anchor', { id: 'stable-anchor', seqLow: 1, seqHigh: 1 }]]),
  };
  function Harness({ generation, request }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:all', snapshot,
      history: {
        status: {
          attached: true, messageCurrent: true, generation, hasOlder: true,
          completedPages: 0, revealVersion: 0, presentationRevision: 1,
        },
        request,
      },
      viewSessions,
    });
    useLayoutEffect(() => { committedPort = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness generation={1} request={requestA} />);
  await waitFor(() => expect(committedPort?.activationID).toBeTruthy());
  const oldOwner = committedPort;
  const pending = oldOwner.onUnderfill();
  expect(requestA).toHaveBeenCalledOnce();

  view.rerender(<Harness generation={2} request={requestB} />);
  await waitFor(() => expect(committedPort).not.toBe(oldOwner));
  await act(async () => {
    rejectOld(new Error('old generation failed'));
    await pending;
  });
  await act(async () => { await committedPort.onUnderfill(); });

  expect(requestB).toHaveBeenCalledOnce();
});

it('aborted render cannot redirect a committed arrival disposition to its candidate port', async () => {
  let committedPort;
  let setCandidate;
  const never = new Promise(() => {});
  const acknowledgeA = vi.fn();
  const acknowledgeB = vi.fn();
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const row = { id: 'root-a', seqLow: 1, seqHigh: 1 };
  const snapshot = (revision) => ({
    revision, sourceRevision: revision,
    rows: [row], entities: new Map([[row.id, row]]),
  });
  function Harness({ revision, arrivals, suspend = false }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot: snapshot(revision),
      arrivals, history: { status: {} }, viewSessions, surfaceVisible: true,
    });
    useLayoutEffect(() => { committedPort = reading; }, [reading]);
    if (suspend) throw never;
    return null;
  }
  const initial = {
    revision: 1,
    arrivals: { revision: 0, acknowledgedRevision: 0, events: [], acknowledge: acknowledgeA },
  };
  function Root() {
    const [candidate, updateCandidate] = useState(initial);
    setCandidate = updateCandidate;
    return <Suspense fallback={<p>candidate</p>}><Harness {...candidate} /></Suspense>;
  }
  render(<Root />);
  await waitFor(() => expect(committedPort?.activationID).toBeTruthy());
  act(() => committedPort.onReadingObservation({
    activationID: committedPort.activationID,
    source: 'layout', geometryRevision: 1, atTail: false,
    surfaceVisible: true, installedHighSeq: 1,
    visibleRows: [{ messageID: row.id, seqHigh: 1 }],
  }));

  const beforeArrivalCommit = committedPort;
  act(() => setCandidate({
    revision: 2,
    arrivals: {
      revision: 1, acknowledgedRevision: 0,
      events: [{ revision: 1, key: row.id, rowID: row.id, seq: 1 }],
      acknowledge: acknowledgeA,
    },
  }));
  await waitFor(() => expect(committedPort).not.toBe(beforeArrivalCommit));
  const ownerA = committedPort;
  expect(acknowledgeA).not.toHaveBeenCalled();

  act(() => startTransition(() => setCandidate({
    revision: 3,
    arrivals: {
      revision: 2, acknowledgedRevision: 0,
      events: [{ revision: 2, key: 'candidate-b', rowID: 'candidate-b', seq: 2 }],
      acknowledge: acknowledgeB,
    },
    suspend: true,
  })));
  act(() => ownerA.onReadingObservation({
    activationID: ownerA.activationID,
    source: 'layout', geometryRevision: 2, atTail: false,
    surfaceVisible: true, installedHighSeq: 1,
    visibleRows: [{ messageID: row.id, seqHigh: 1 }],
  }));

  expect(acknowledgeA).toHaveBeenCalledWith(1);
  expect(acknowledgeB).not.toHaveBeenCalled();
});

it('隐藏期间不冒充已读，Surface隐藏会显式废弃旧尾部证据', async () => {
  let port;
  const markRead = vi.fn();
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const snapshot = {
    rows: [{ id: 'visible-tail', seqLow: 7, seqHigh: 9 }],
    entities: new Map(),
  };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot,
      history: { status: { headSeq: 9 }, markRead }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    render(<Harness />);
    await waitFor(() => expect(port?.activationID).toBeTruthy());
    act(() => port.onReadingObservation({
      activationID: port.activationID,
      source: 'layout',
      geometryRevision: 1,
      atTail: true,
      surfaceVisible: true,
      installedHighSeq: 9,
    }));
    expect(markRead).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(markRead).toHaveBeenCalledOnce();
    expectLastReadReceipt(markRead, 9);

    markRead.mockClear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => port.onReadingObservation({
      activationID: port.activationID,
      source: 'layout',
      geometryRevision: 2,
      atTail: true,
      surfaceVisible: true,
      installedHighSeq: 9,
    }));
    act(() => port.onSurfaceVisibilityChange(false));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(markRead).not.toHaveBeenCalled();
  } finally {
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
    else delete document.visibilityState;
  }
});

it('缺少显式Surface可见性或仍是旧DOM high-water时不读新seq', async () => {
  let port;
  const markRead = vi.fn();
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const snapshot = {
    rows: [
      { id: 'installed', seqLow: 1, seqHigh: 1 },
      { id: 'not-installed-yet', seqLow: 2, seqHigh: 2 },
    ],
    entities: new Map(),
  };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot,
      history: { status: { headSeq: 2 }, markRead }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  render(<Harness />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());

  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    installedHighSeq: 2,
  }));
  expect(markRead).not.toHaveBeenCalled();

  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 2, atTail: true,
    surfaceVisible: true,
    installedHighSeq: 1,
  }));
  expectLastReadReceipt(markRead, 1);
  expect(markRead.mock.calls.some(([receipt]) => receipt?.installedHighSeq === 2)).toBe(false);
});

it('隐藏期间arrival保留未读，回前台不复用旧DOM证据全清', async () => {
  let port;
  const markRead = vi.fn();
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0, unseenTail: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const row = (id, seq) => ({ id, seqLow: seq, seqHigh: seq });
  const old = row('old', 1);
  const incoming = row('incoming', 2);
  const makeSnapshot = (rows) => ({ rows, entities: new Map(rows.map((item) => [item.id, item])) });
  function Harness({ current, arrivals }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot: current, arrivals,
      history: { status: { headSeq: 2 }, markRead }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const view = render(<Harness current={makeSnapshot([old])} arrivals={{ revision: 0, events: [] }} />);
    view.rerender(<Harness
      current={makeSnapshot([old, incoming])}
      arrivals={{ revision: 1, events: [{ revision: 1, key: 'incoming', rowID: 'incoming', seq: 2 }] }}
    />);
    await waitFor(() => expect(port.unseen).toBe(1));
    act(() => port.onSurfaceVisibilityChange(false));

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(port.unseen).toBe(1);
    expect(markRead).not.toHaveBeenCalled();

    act(() => port.onReadingObservation({
      activationID: port.activationID,
      source: 'layout', geometryRevision: 1, atTail: true,
      surfaceVisible: true, installedHighSeq: 1,
      visibleRows: [{ messageID: 'old', seqHigh: 1 }],
    }));
    expect(port.unseen).toBe(1);
    expectLastReadReceipt(markRead, 1);

    act(() => port.onReadingObservation({
      activationID: port.activationID,
      source: 'layout', geometryRevision: 2, atTail: true,
      surfaceVisible: true, installedHighSeq: 2,
      visibleRows: [{ messageID: 'incoming', seqHigh: 2 }],
    }));
    expect(port.unseen).toBe(0);
    expectLastReadReceipt(markRead, 2);
  } finally {
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
    else delete document.visibilityState;
  }
});

it('joins a passive same-row arrival with the already committed visible-tail evidence', async () => {
  let port;
  const markRead = vi.fn();
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0, unseenTail: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const current = { id: 'live-turn', seqLow: 1, seqHigh: 2 };
  const snapshot = {
    revision: 2, rows: [current],
    entities: new Map([[current.id, current]]),
  };
  function Harness({ arrivals }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot, arrivals,
      history: { status: { headSeq: 2 }, markRead }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness arrivals={{ revision: 0, events: [], acknowledge: vi.fn() }} />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 2, atTail: true,
    surfaceVisible: true, installedHighSeq: 2,
    visibleRows: [{ messageID: 'live-turn', seqHigh: 2 }],
  }));

  view.rerender(<Harness arrivals={{
    revision: 1,
    events: [{ revision: 1, key: 'live-turn', rowID: 'live-turn', seq: 2 }],
    acknowledge: vi.fn(),
  }} />);
  await waitFor(() => expect(port.unseen).toBe(0));
  expectLastReadReceipt(markRead, 2);
});

it('does not publish a transient unseen count before the matching visible row revision commits', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const makeSnapshot = (seqHigh, revision) => {
    const current = { id: 'same-turn', seqLow: 1, seqHigh };
    return { revision, rows: [current], entities: new Map([[current.id, current]]) };
  };
  function Harness({ snapshot, arrivals }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot, arrivals,
      history: { status: {} }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness
    snapshot={makeSnapshot(1, 1)}
    arrivals={{ revision: 0, events: [], acknowledge: vi.fn() }}
  />);
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 1,
    visibleRows: [{ messageID: 'same-turn', seqHigh: 1 }],
  }));

  view.rerender(<Harness
    snapshot={makeSnapshot(1, 1)}
    arrivals={{
      revision: 1,
      events: [{ revision: 1, key: 'same-turn', rowID: 'same-turn', seq: 2 }],
      acknowledge: vi.fn(),
    }}
  />);
  await waitFor(() => expect(port.unseen).toBe(0));

  view.rerender(<Harness
    snapshot={makeSnapshot(2, 2)}
    arrivals={{
      revision: 1,
      events: [{ revision: 1, key: 'same-turn', rowID: 'same-turn', seq: 2 }],
      acknowledge: vi.fn(),
    }}
  />);
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 2, atTail: true,
    surfaceVisible: true, installedHighSeq: 2,
    visibleRows: [{ messageID: 'same-turn', seqHigh: 2 }],
  }));
  expect(port.unseen).toBe(0);
  expect(viewSessions.save.mock.calls.some((call) => call[4]?.unseenRecords?.length)).toBe(false);
});

it('hands an undisposed arrival to the successor activation before acknowledging Replica', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const acknowledge = vi.fn();
  const before = { id: 'handoff-root', seqLow: 1, seqHigh: 1 };
  const after = { ...before, seqHigh: 2 };
  const event = { revision: 1, key: before.id, rowID: before.id, seq: 2 };
  function Harness({ viewKey, snapshot }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey, snapshot,
      arrivals: { revision: 1, acknowledgedRevision: 0, events: [event], acknowledge },
      history: { status: {} }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness
    viewKey="c0:mine:a"
    snapshot={{ revision: 1, rows: [before], entities: new Map([[before.id, before]]) }}
  />);
  await waitFor(() => expect(port?.unseen).toBe(0));
  expect(acknowledge).not.toHaveBeenCalled();

  view.rerender(<Harness
    viewKey="c0:mine:b"
    snapshot={{ revision: 2, rows: [after], entities: new Map([[after.id, after]]) }}
  />);
  await waitFor(() => expect(port.unseen).toBe(1));
  expect(viewSessions.save.mock.calls.at(-1)?.[4]?.unseenRecords).toEqual([['handoff-root', 2]]);
  expect(acknowledge).toHaveBeenCalledTimes(1);
  expect(acknowledge).toHaveBeenCalledWith(1);
});

it('publishes a committed arrival only after observation proves its exact row was not visible', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const makeSnapshot = (seqHigh, revision) => {
    const current = { id: 'hidden-turn', seqLow: 1, seqHigh };
    return { revision, rows: [current], entities: new Map([[current.id, current]]) };
  };
  function Harness({ snapshot, arrivals }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot, arrivals,
      history: { status: {} }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const event = { revision: 1, key: 'hidden-turn', rowID: 'hidden-turn', seq: 2 };
  const view = render(<Harness
    snapshot={makeSnapshot(1, 1)}
    arrivals={{ revision: 0, events: [], acknowledge: vi.fn() }}
  />);
  view.rerender(<Harness
    snapshot={makeSnapshot(1, 1)}
    arrivals={{ revision: 1, events: [event], acknowledge: vi.fn() }}
  />);
  await waitFor(() => expect(port.unseen).toBe(0));

  view.rerender(<Harness
    snapshot={makeSnapshot(2, 2)}
    arrivals={{ revision: 1, events: [event], acknowledge: vi.fn() }}
  />);
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 2, atTail: false,
    surfaceVisible: true, installedHighSeq: 2,
    visibleRows: [],
  }));
  expect(port.unseen).toBe(1);
  expect(viewSessions.save.mock.calls.at(-1)?.[4]?.unseenRecords).toEqual([['hidden-turn', 2]]);
});

it('drops a staged arrival when a later filter commit removes every row identity', async () => {
  let port;
  const acknowledge = vi.fn();
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const row = { id: 'other-member-turn', seqLow: 1, seqHigh: 1 };
  const populated = { revision: 1, rows: [row], entities: new Map([[row.id, row]]) };
  const filtered = { revision: 2, rows: [], entities: new Map() };
  const event = {
    revision: 1, key: row.id, rowID: row.id, seq: 2,
  };
  function Harness({ snapshot, arrivals }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot, arrivals,
      history: { status: {} }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness
    snapshot={populated}
    arrivals={{ revision: 0, acknowledgedRevision: 0, events: [], acknowledge }}
  />);
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: false,
    surfaceVisible: true, installedHighSeq: 1,
    visibleRows: [{ messageID: row.id, seqHigh: 1 }],
  }));
  view.rerender(<Harness
    snapshot={populated}
    arrivals={{ revision: 1, acknowledgedRevision: 0, events: [event], acknowledge }}
  />);
  await waitFor(() => expect(port.unseen).toBe(0));
  expect(acknowledge).not.toHaveBeenCalled();

  view.rerender(<Harness
    snapshot={filtered}
    arrivals={{ revision: 1, acknowledgedRevision: 0, events: [event], acknowledge }}
  />);
  await waitFor(() => expect(port.unseen).toBe(0));
  expect(acknowledge).toHaveBeenCalledWith(1);
  const returned = { ...row, seqHigh: 2 };
  view.rerender(<Harness
    snapshot={{ revision: 3, rows: [returned], entities: new Map([[returned.id, returned]]) }}
    arrivals={{ revision: 1, acknowledgedRevision: 0, events: [event], acknowledge }}
  />);
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 3, atTail: false,
    surfaceVisible: true, installedHighSeq: 2, visibleRows: [],
  }));
  expect(port.unseen).toBe(0);
  expect(viewSessions.save.mock.calls.some((call) => call[4]?.unseenRecords?.length)).toBe(false);
});

it('retains the stable root identity when an orphan terminal row is rekeyed', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const orphan = { id: 'terminal-envelope', seqLow: 5, seqHigh: 5 };
  const root = { id: 'request-root', seqLow: 4, seqHigh: 6 };
  const event = {
    revision: 1, key: root.id, rowID: orphan.id, seq: 6,
  };
  function Harness({ snapshot, arrivals }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot, arrivals,
      history: { status: {} }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness
    snapshot={{ revision: 1, rows: [orphan], entities: new Map([[orphan.id, orphan]]) }}
    arrivals={{ revision: 0, events: [], acknowledge: vi.fn() }}
  />);
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: false,
    surfaceVisible: true, installedHighSeq: 5,
    visibleRows: [{ messageID: orphan.id, seqHigh: 5 }],
  }));
  view.rerender(<Harness
    snapshot={{ revision: 1, rows: [orphan], entities: new Map([[orphan.id, orphan]]) }}
    arrivals={{ revision: 1, events: [event], acknowledge: vi.fn() }}
  />);
  await waitFor(() => expect(port.unseen).toBe(0));

  view.rerender(<Harness
    snapshot={{ revision: 2, rows: [root], entities: new Map([[root.id, root]]) }}
    arrivals={{ revision: 1, events: [event], acknowledge: vi.fn() }}
  />);
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 2, atTail: false,
    surfaceVisible: true, installedHighSeq: 6, visibleRows: [],
  }));
  expect(port.unseen).toBe(1);
  expect(viewSessions.save.mock.calls.at(-1)?.[4]?.unseenRecords).toEqual([[root.id, 6]]);
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'user', geometryRevision: 3, atTail: false,
    surfaceVisible: true, installedHighSeq: 6,
    visibleRows: [{ messageID: root.id, seqHigh: 6 }],
  }));
  expect(port.unseen).toBe(0);
});

it('acknowledges only the exact visible arrival identity while browsing', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const root = { id: 'root-turn', seqLow: 3, seqHigh: 3 };
  const hidden = { id: 'filtered-out', seqLow: 4, seqHigh: 4 };
  const snapshot = {
    revision: 2,
    rows: [root, hidden],
    entities: new Map([[root.id, root], [hidden.id, hidden]]),
  };
  function Harness({ arrivals }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot, arrivals,
      history: { status: {} }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const arrivals = {
    revision: 2,
    events: [
      { revision: 1, key: 'root-key', rowIDs: ['orphan-envelope', 'root-turn'], seq: 3 },
      { revision: 2, key: 'filtered-out', rowID: 'filtered-out', seq: 4 },
    ],
  };
  const view = render(<Harness arrivals={{ revision: 0, events: [] }} />);
  view.rerender(<Harness arrivals={arrivals} />);
  await waitFor(() => expect(port?.unseen).toBe(2));

  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'user', geometryRevision: 1, atTail: false,
    surfaceVisible: true, installedHighSeq: 999,
    visibleRows: [{ messageID: 'unrelated-visible', seqHigh: 999 }],
  }));
  expect(port.unseen).toBe(2);
  expect(port.getSession().mode).toBe('browsing');

  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'user', geometryRevision: 2, atTail: false,
    surfaceVisible: true, installedHighSeq: 3,
    visibleRows: [{ messageID: 'root-turn', seqHigh: 3 }],
  }));
  expect(port.unseen).toBe(1);
  expect(viewSessions.save.mock.calls.at(-1)?.[4]?.unseenRecords).toEqual([['filtered-out', 4]]);
  expect(port.getSession().mode).toBe('browsing');
});

it('durable acceptance resolves after user-up without minting a fresh bottom intent', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(),
    save: vi.fn(() => true),
    deactivate: vi.fn(),
  };
  const snapshot = { rows: [], entities: new Map() };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot,
      history: { status: {} }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  render(<Harness />);
  await waitFor(() => expect(port?.captureBottomIntent()).toBeTruthy());
  const sendStarted = port.captureBottomIntent();

  act(() => port.onUserControl({ direction: 'older', gestureID: 'wheel-up', geometryRevision: 1 }));
  expect(port.getSession().mode).toBe('browsing');
  let accepted;
  act(() => { accepted = port.requestBottom('composer:late', sendStarted); });
  expect(accepted).toBe(false);
  expect(port.getSession().bottomIntent.id).toBe('');
});

it('revokes only the exact failed composer intent and cannot revoke a newer latest intent', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const snapshot = { revision: 1, rows: [], entities: new Map() };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot,
      history: { status: {} }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  render(<Harness />);
  await waitFor(() => expect(port?.captureBottomIntent()).toBeTruthy());

  const before = port.captureBottomIntent();
  act(() => expect(port.requestBottom('composer:send-start', before)).toBe(true));
  const failedToken = port.captureBottomIntent();
  expect(failedToken.bottomIntentID).toContain('composer:send-start:');
  act(() => expect(port.revokeBottomIntent(failedToken)).toBe(true));
  expect(port.getSession().bottomIntent.id).toBe('');
  expect(port.revokeBottomIntent(failedToken)).toBe(false);

  const nextBefore = port.captureBottomIntent();
  act(() => expect(port.requestBottom('composer:send-start', nextBefore)).toBe(true));
  const staleToken = port.captureBottomIntent();
  act(() => port.jumpToLatest());
  const latestID = port.getSession().bottomIntent.id;
  expect(latestID).toContain('latest:');
  expect(port.revokeBottomIntent(staleToken)).toBe(false);
  expect(port.getSession().bottomIntent.id).toBe(latestID);
});

it('keeps unseen until an explicit latest intent is acknowledged by the installed visible tail', async () => {
  let port;
  const markRead = vi.fn();
  const viewSessions = {
    readView: () => ({
      mode: 'browsing', revision: 0, unseenTail: 1,
      unseenKeys: ['incoming'], unseenRecords: [['incoming', 2]],
    }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const snapshot = {
    revision: 1,
    rows: [
      { id: 'old', seqLow: 1, seqHigh: 1 },
      { id: 'incoming', seqLow: 2, seqHigh: 2 },
    ],
    entities: new Map(),
  };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot,
      history: { status: { headSeq: 2 }, markRead }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  render(<Harness />);
  await waitFor(() => expect(port?.unseen).toBe(1));

  act(() => port.jumpToLatest());
  expect(port.getSession().mode).toBe('following');
  expect(port.getSession().bottomIntent.id).toContain('latest:');
  expect(port.unseen).toBe(1);
  expect(markRead).not.toHaveBeenCalled();

  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 2,
    visibleRows: [{ messageID: 'incoming', seqHigh: 2 }],
  }));
  expect(port.unseen).toBe(0);
  expectLastReadReceipt(markRead, 2);
});

it('does not admit legacy key-only unseen state into the active controller', async () => {
  let port;
  const viewSessions = {
    readView: () => ({
      mode: 'browsing', revision: 0, unseenTail: 1, unseenKeys: ['legacy-without-seq'],
    }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const snapshot = {
    revision: 1,
    rows: [{ id: 'installed', seqLow: 7, seqHigh: 7 }],
    entities: new Map(),
  };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot,
      history: { status: { headSeq: 7 } }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  render(<Harness />);
  await waitFor(() => expect(port?.unseen).toBe(0));
  act(() => port.jumpToLatest());
  expect(port.unseen).toBe(0);
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 7,
  }));
  expect(port.unseen).toBe(0);
});

it('an A→B→A replacement cannot let the old durable acceptance restart its controller', async () => {
  let port;
  const seen = [];
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(),
    save: vi.fn(() => true),
    deactivate: vi.fn(() => true),
  };
  const snapshot = { rows: [], entities: new Map() };
  function Harness({ channelID }) {
    const reading = useReadingSession({
      channelID, viewKey: `${channelID}:mine`, snapshot,
      history: { status: {} }, viewSessions,
    });
    useLayoutEffect(() => {
      port = reading;
      seen.push(reading);
    }, [reading]);
    return null;
  }
  const view = render(<Harness channelID="a" />);
  await waitFor(() => expect(port?.captureBottomIntent()).toBeTruthy());
  const oldPort = port;
  const sendStarted = oldPort.captureBottomIntent();

  view.rerender(<Harness channelID="b" />);
  await waitFor(() => expect(port.activationID).not.toBe(oldPort.activationID));
  view.rerender(<Harness channelID="a" />);
  await waitFor(() => expect(port.activationID).not.toBe(oldPort.activationID));
  const freshPort = port;
  const activationsBeforeLateAccept = viewSessions.activate.mock.calls.length;

  let accepted;
  act(() => { accepted = oldPort.requestBottom('composer:old-a', sendStarted); });
  expect(accepted).toBe(false);
  expect(viewSessions.activate).toHaveBeenCalledTimes(activationsBeforeLateAccept);
  expect(freshPort.getSession().bottomIntent.id).toBe('');

  const currentToken = freshPort.captureBottomIntent();
  act(() => { accepted = freshPort.requestBottom('composer:new-a', currentToken); });
  expect(accepted).toBe(true);
  expect(freshPort.getSession().bottomIntent.id).toContain('composer:new-a');
});

it('同频道语义view切换会为未安装的保存书签重新开启初始化供给', async () => {
  let port;
  const request = vi.fn(() => new Promise(() => {}));
  const viewSessions = {
    readView: (_channelID, viewKey) => viewKey === 'c0:all'
      ? { mode: 'browsing', revision: 0, bookmark: { messageID: 'saved-all-row', seq: 3, rowViewportOffset: 12 } }
      : { mode: 'following', revision: 0 },
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const installed = {
    rows: [{ id: 'mine-row', seqLow: 9, seqHigh: 9 }],
    entities: new Map([['mine-row', {}]]),
    sourceRevision: 9,
  };
  const missingBookmark = { rows: [], entities: new Map(), sourceRevision: 9 };
  const status = {
    attached: true, generation: 1, messageCurrent: true, headSeq: 9,
    hasOlder: true, localReplicaReady: true, presentationRevision: 9,
  };
  function Harness({ viewKey, snapshot }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey, snapshot,
      history: { status, request }, viewSessions,
      historyViewSpec: { scope: viewKey.endsWith(':all') ? 'all' : 'mine', selfId: 'me' },
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return <p>{reading.initializing ? 'initializing' : 'ready'}</p>;
  }

  const view = render(<Harness viewKey="c0:mine" snapshot={installed} />);
  await waitFor(() => expect(port?.initializing).toBe(false));
  const firstActivation = port.activationID;
  view.rerender(<Harness viewKey="c0:all" snapshot={missingBookmark} />);
  await waitFor(() => expect(port.activationID).not.toBe(firstActivation));

  expect(port.initializing).toBe(true);
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({
    intent: 'initial-view',
    urgency: 'blocking',
    targetSeq: 3,
    requiredVisibleCoverage: { messageID: 'saved-all-row', seq: 3 },
  })));
});

it('fresh following 立即显示缓存Projection，但在Replica修订消费前不授权尾随', async () => {
  let port;
  const request = vi.fn();
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(),
    save: vi.fn(() => true),
    deactivate: vi.fn(),
  };
  function Harness({ snapshot, status }) {
    const reading = useReadingSession({
      channelID: 'c0',
      viewKey: 'c0:mine',
      snapshot,
      history: { status, request },
      viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return <p>{reading.initializing ? 'initializing' : `${reading.availability}:${reading.bottomReady ? 'current' : 'stale'}`}</p>;
  }
  const empty = { rows: [], entities: new Map(), sourceRevision: 0 };
  const view = render(<Harness snapshot={empty} status={{ attached: false, generation: 0, messageCurrent: false, headSeq: 0, presentationRevision: 0 }} />);
  await waitFor(() => expect(port?.initializing).toBe(true));
  expect(request).not.toHaveBeenCalled();

  const lagging = {
    rows: [{ id: 'head-row', seqLow: 7, seqHigh: 7 }],
    entities: new Map([['head-row', {}]]),
    sourceRevision: 10,
  };
  view.rerender(<Harness snapshot={lagging} status={{ attached: true, generation: 1, messageCurrent: true, headSeq: 99, presentationRevision: 11 }} />);
  await waitFor(() => expect(port?.initializing).toBe(false));
  expect(port.availability).toBe('readable');
  expect(port.bottomReady).toBe(false);
  expect(screen.getByText('readable:stale')).toBeTruthy();

  const current = {
    ...lagging,
    sourceRevision: 11,
  };
  view.rerender(<Harness snapshot={current} status={{ attached: true, generation: 1, messageCurrent: true, headSeq: 99, presentationRevision: 11 }} />);
  await waitFor(() => expect(port?.bottomReady).toBe(true));
  expect(screen.getByText('readable:current')).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});

it('真实上滚会把同一个anticipatory历史operation升级为可见interactive demand', async () => {
  let port;
  let settle;
  const promote = vi.fn(() => true);
  const request = vi.fn((options) => {
    options.onOperation?.({ promote });
    return new Promise((resolve) => { settle = resolve; });
  });
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const row = { id: 'only-match', seqLow: 900, seqHigh: 901 };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'sparse', viewKey: 'sparse:claude',
      snapshot: { revision: 1, sourceRevision: 1, rows: [row], entities: new Map([[row.id, row]]) },
      history: { status: { attached: true, generation: 7, messageCurrent: true, hasOlder: true }, request },
      historyViewSpec: { scope: 'mine', actorFilter: new Set(['agent:claude:7']) },
      viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  render(<Harness />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());

  let anticipatory;
  act(() => { anticipatory = port.onUnderfill(); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toMatchObject({ urgency: 'anticipatory', reason: 'underfill' });
  let interactive;
  act(() => { interactive = port.onAtTop(); });
  expect(interactive).toBe(anticipatory);
  expect(request).toHaveBeenCalledTimes(1);
  expect(promote).toHaveBeenCalledTimes(1);
  expect(promote).toHaveBeenCalledWith({ intent: 'scroll-history', urgency: 'interactive' });
  act(() => { port.onAtTop(); });
  expect(promote).toHaveBeenCalledTimes(1);
  await act(async () => { settle({ kind: 'exhausted' }); await interactive; });
});

it('零行供给settle后的live admission事务先提交首批，再续发排队的interactive demand', async () => {
  let port;
  let settleFirst;
  let liveAdmission = { phase: 'idle', token: null };
  const presentationAdmission = {
    snapshot: vi.fn(() => liveAdmission),
  };
  const request = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { settleFirst = resolve; }))
    .mockImplementation(() => new Promise(() => {}));
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const snapshot = { revision: 1, sourceRevision: 7, rows: [], entities: new Map() };
  const baseStatus = {
    attached: true, generation: 7, messageCurrent: true, headSeq: 90,
    localReplicaReady: true, loading: false, hasOlder: true, completedPages: 1,
    presentationRevision: 7, presentationAdmission,
  };
  function Harness({ status }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot,
      history: { status, request }, viewSessions,
      historyViewSpec: { scope: 'mine', selfId: 'me' },
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }

  const view = render(<Harness status={{
    ...baseStatus,
    presentationAdmissionState: { phase: 'idle', token: null },
  }} />);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  const token = {
    activationID: port.activationID,
    viewID: 'c0:mine',
    epoch: 'c0:7',
    operationID: `history:${port.activationID}:1`,
  };

  liveAdmission = { phase: 'pending-baseline-commit', token };
  await act(async () => { settleFirst({ kind: 'satisfied' }); });
  // Scheduler progress can render before Timeline sees the authority's
  // pending-baseline phase. This stale render must not overwrite the settled
  // transaction with another admission begin.
  view.rerender(<Harness status={{
    ...baseStatus,
    completedPages: 2,
    presentationAdmissionState: { phase: 'pending', token },
  }} />);
  await act(async () => {});
  expect(request).toHaveBeenCalledTimes(1);

  // A real top demand is retained behind the same transaction. It does not
  // overwrite the staged first batch, and is issued as interactive once that
  // batch has committed/released.
  act(() => { void port.onAtTop(); });
  expect(request).toHaveBeenCalledTimes(1);
  liveAdmission = { phase: 'idle', token: null };
  view.rerender(<Harness status={{
    ...baseStatus,
    completedPages: 2,
    presentationAdmissionState: { phase: 'idle', token: null },
  }} />);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls[1][0]).toMatchObject({ reason: 'top', urgency: 'interactive' });
});

it('旧activation或generation的live admission不能阻塞当前历史请求', async () => {
  let port;
  const request = vi.fn(() => new Promise(() => {}));
  const presentationAdmission = {
    snapshot: vi.fn(() => ({
      phase: 'pending-baseline-commit',
      token: {
        activationID: 'retired-activation',
        viewID: 'c0:mine',
        epoch: 'c0:6',
        operationID: 'history:retired-activation:9',
      },
    })),
  };
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine',
      snapshot: { revision: 1, sourceRevision: 7, rows: [], entities: new Map() },
      history: { status: {
        attached: true, generation: 7, messageCurrent: true, headSeq: 90,
        localReplicaReady: true, loading: false, hasOlder: true,
        presentationRevision: 7,
        presentationAdmission,
        presentationAdmissionState: presentationAdmission.snapshot(),
      }, request },
      viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }

  render(<Harness />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
});

it('只从当前generation的权威exhaustion派生稀疏筛选顶部边界', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const row = { id: 'oldest-match', seqLow: 77, seqHigh: 78 };
  const baseStatus = {
    attached: true, generation: 4, messageCurrent: true, headSeq: 999,
    localReplicaReady: true, loaded: true, completedPages: 9, loading: false,
  };
  function Harness({ hasOlder }) {
    const reading = useReadingSession({
      channelID: 'sparse', viewKey: 'sparse:claude',
      snapshot: { revision: 1, sourceRevision: 1, rows: [row], entities: new Map([[row.id, row]]) },
      history: { status: { ...baseStatus, hasOlder } }, viewSessions,
      historyViewSpec: { scope: 'mine', actorFilter: new Set(['agent:claude:4']) },
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness hasOlder />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());
  expect(port.historyBoundary).toBeNull();
  view.rerender(<Harness hasOlder={false} />);
  await waitFor(() => expect(port.historyBoundary).toMatchObject({
    kind: 'exhausted', filtered: true, generation: 4,
  }));
});

it('冷入口只在Virtuoso报告当前activation首个公开range后退出materializing', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness({ snapshot }) {
    const reading = useReadingSession({
      channelID: 'cold',
      viewKey: 'cold:all',
      snapshot,
      surfaceVisible: true,
      history: { status: {
        attached: true, generation: 1, messageCurrent: true, headSeq: 7,
        localReplicaReady: true, presentationRevision: snapshot.sourceRevision,
      } },
      viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return <p>{reading.availability}</p>;
  }
  const empty = { rows: [], entities: new Map(), revision: 0, sourceRevision: 0 };
  const view = render(<Harness snapshot={empty} />);
  expect(screen.getByText('syncing')).toBeTruthy();

  const row = { id: 'cached', seqLow: 7, seqHigh: 7 };
  view.rerender(<Harness snapshot={{ rows: [row], entities: new Map([[row.id, row]]), revision: 4, sourceRevision: 4 }} />);
  await waitFor(() => expect(port.availability).toBe('materializing'));
  expect(port.initializing).toBe(false);
  expect(port.onPresentationMaterialized({
    activationID: port.activationID,
    presentationRevision: 3,
    startIndex: 0,
    endIndex: 0,
  })).toBe(false);
  expect(port.availability).toBe('materializing');

  expect(port.onPresentationMaterialized({
    activationID: port.activationID,
    presentationRevision: 4,
    startIndex: 0,
    endIndex: 0,
  })).toBe(true);
  await waitFor(() => expect(port.availability).toBe('readable'));
});

it('冷入口丢失range回调后由当前可见DOM观测收敛materializing', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness({ snapshot }) {
    const reading = useReadingSession({
      channelID: 'cold-observation',
      viewKey: 'cold-observation:all',
      snapshot,
      surfaceVisible: true,
      history: { status: {
        attached: true, generation: 1, messageCurrent: true, headSeq: 7,
        localReplicaReady: true, presentationRevision: snapshot.sourceRevision,
      } },
      viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return <p>{reading.availability}</p>;
  }
  const empty = { rows: [], entities: new Map(), revision: 0, sourceRevision: 0 };
  const view = render(<Harness snapshot={empty} />);
  const row = { id: 'cached', seqLow: 7, seqHigh: 7 };
  view.rerender(<Harness snapshot={{ rows: [row], entities: new Map([[row.id, row]]), revision: 4, sourceRevision: 4 }} />);
  await waitFor(() => expect(port.availability).toBe('materializing'));

  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout',
    surfaceVisible: false,
    installedHighSeq: 7,
    visibleRows: [{ messageID: row.id, seqHigh: 7 }],
  }));
  expect(port.availability).toBe('materializing');

  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout',
    surfaceVisible: true,
    installedHighSeq: 7,
    visibleRows: [],
  }));
  expect(port.availability).toBe('materializing');

  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout',
    surfaceVisible: true,
    installedHighSeq: 8,
    visibleRows: [{ messageID: 'retired-row', seqHigh: 8 }],
  }));
  expect(port.availability).toBe('materializing');

  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout',
    surfaceVisible: true,
    installedHighSeq: 7,
    visibleRows: [{ messageID: row.id, seqHigh: 7 }],
  }));
  await waitFor(() => expect(port.availability).toBe('readable'));
});

it('缺失书签继续请求恢复供给，但已有可读rows不再暴露阻塞初始化', async () => {
  let port;
  const request = vi.fn(() => new Promise(() => {}));
  const viewSessions = {
    readView: () => ({
      mode: 'browsing', revision: 2,
      bookmark: { messageID: 'older-target', seq: 3, rowViewportOffset: -18 },
    }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness() {
    const row = { id: 'cached-tail', seqLow: 9, seqHigh: 9 };
    const reading = useReadingSession({
      channelID: 'bookmark',
      viewKey: 'bookmark:all',
      snapshot: { rows: [row], entities: new Map([[row.id, row]]), revision: 2, sourceRevision: 2 },
      history: { status: {
        attached: true, generation: 1, messageCurrent: true, headSeq: 9,
        localReplicaReady: true, hasOlder: true, presentationRevision: 2,
      }, request },
      viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return <p>{reading.initializing ? 'blocked' : reading.availability}</p>;
  }
  render(<Harness />);
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({
    intent: 'initial-view',
    urgency: 'blocking',
    requiredVisibleCoverage: { messageID: 'older-target', seq: 3 },
  })));
  expect(port.initializing).toBe(false);
  expect(port.restorePending).toBe(true);
  expect(screen.getByText('readable')).toBeTruthy();
  expect(screen.queryByText('blocked')).toBeNull();
});

it('authoritative known-zero 直接安装空呈现，不与恢复提示同帧', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'following', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'empty',
      viewKey: 'empty:mine',
      snapshot: { rows: [], entities: new Map(), sourceRevision: 0 },
      history: { status: {
        attached: true, generation: 3, messageCurrent: true, headSeq: 0,
        localReplicaReady: true, presentationRevision: 0,
        sync: { interestRevision: 4, fulfilledRevision: 4, targetHead: 0 },
      } },
      viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return <p>{reading.initializing ? 'restoring' : reading.availability}</p>;
  }

  render(<Harness />);
  await waitFor(() => expect(port?.initializing).toBe(false));
  expect(port.availability).toBe('empty-known');
  expect(screen.getByText('empty-known')).toBeTruthy();
  expect(screen.queryByText('restoring')).toBeNull();
});

it('只把当前activation之后的live稳定身份累计为新动态', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0, unseenTail: 0 }),
    activate: vi.fn(),
    save: vi.fn(() => true),
    deactivate: vi.fn(),
  };
  const row = (id, seq) => ({ id, seqLow: seq, seqHigh: seq });
  const snapshot = (rows, revision) => ({
    rows,
    entities: new Map(rows.map((item) => [item.id, item])),
    sourceRevision: revision,
  });
  function Harness({ current, arrivals }) {
    const reading = useReadingSession({
      channelID: 'c0',
      viewKey: 'c0:mine',
      snapshot: current,
      arrivals,
      history: { status: {} },
      viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return <p>{reading.unseen}</p>;
  }

  const old = row('old', 10);
  const view = render(<Harness
    current={snapshot([old], 1)}
    arrivals={{ revision: 7, events: [{ revision: 7, key: 'old', rowID: 'old', seq: 10 }] }}
  />);
  await waitFor(() => expect(port?.unseen).toBe(0));

  // History/cache publication can append visible rows, but without a live
  // arrival record it cannot manufacture a notification.
  const cached = row('cached-tail', 11);
  view.rerender(<Harness
    current={snapshot([old, cached], 2)}
    arrivals={{ revision: 7, events: [{ revision: 7, key: 'old', rowID: 'old', seq: 10 }] }}
  />);
  await waitFor(() => expect(port.unseen).toBe(0));

  const live = row('live-root', 12);
  const events = [
    { revision: 7, key: 'old', rowID: 'old', seq: 10 },
    { revision: 8, key: 'live-root', rowID: 'live-root', seq: 12 },
  ];
  view.rerender(<Harness current={snapshot([old, cached, live], 3)} arrivals={{ revision: 8, events }} />);
  await waitFor(() => expect(port.unseen).toBe(1));

  // A later terminal/projection transition for the same root is one stable
  // notification, while a source update with no arrival record adds nothing.
  view.rerender(<Harness
    current={snapshot([old, cached, { ...live, seqHigh: 13 }], 4)}
    arrivals={{ revision: 9, events: [...events, { revision: 9, key: 'live-root', rowID: 'live-root', seq: 13 }] }}
  />);
  await waitFor(() => expect(port.unseen).toBe(1));
});

it('consumes an overflowed live batch exactly and de-duplicates beyond 256 identities', async () => {
  let port;
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0, unseenTail: 0, unseenKeys: [] }),
    activate: vi.fn(),
    save: vi.fn(() => true),
    deactivate: vi.fn(),
  };
  const rows = Array.from({ length: 1_100 }, (_, index) => ({
    id: `live-${index + 1}`, seqLow: index + 1, seqHigh: index + 1,
  }));
  const snapshot = { rows, entities: new Map(rows.map((row) => [row.id, row])), revision: 1 };
  const acknowledge = vi.fn();
  function Harness({ arrivals, current = snapshot }) {
    const reading = useReadingSession({
      channelID: 'c0', viewKey: 'c0:mine', snapshot: current,
      arrivals, history: { status: {} }, viewSessions,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const view = render(<Harness arrivals={{ revision: 0, events: [], acknowledge }} />);
  const events = rows.map((row, index) => ({
    revision: index + 1, key: row.id, rowID: row.id, seq: index + 1,
  }));
  view.rerender(<Harness arrivals={{ revision: 1_100, events, acknowledge }} />);
  await waitFor(() => expect(port?.unseen).toBe(1_100));
  expect(acknowledge).toHaveBeenCalledWith(1_100);

  view.rerender(<Harness arrivals={{
    revision: 1_101,
    events: [...events, { revision: 1_101, key: 'live-1', rowID: 'live-1', seq: 1_101 }],
    acknowledge,
  }} current={{
    ...snapshot,
    revision: 2,
    entities: new Map(snapshot.entities).set('live-1', { ...rows[0], seqHigh: 1_101 }),
  }} />);
  await waitFor(() => expect(port.unseen).toBe(1_100));
  expect(viewSessions.save.mock.calls.at(-1)?.[4]?.unseenRecords)
    .toContainEqual(['live-1', 1_101]);

  act(() => port.onUserControl({ direction: 'newer', gestureID: 'drag-to-tail', geometryRevision: 0 }));
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'user',
    atTail: true,
    inputEpoch: port.getSession().inputEpoch,
    geometryRevision: 0,
    surfaceVisible: true,
    installedHighSeq: 1_100,
    visibleRows: rows.map((row) => ({
      messageID: row.id,
      seqHigh: row.id === 'live-1' ? 1_100 : row.seqHigh,
    })),
  }));
  // The same stable identity received a newer seq=1101 terminal/update. An
  // installed high-water of 1100 must not clear that still-unpainted fact.
  expect(port.unseen).toBe(1);
  act(() => port.onReadingObservation({
    activationID: port.activationID,
    source: 'layout',
    atTail: true,
    inputEpoch: port.getSession().inputEpoch,
    geometryRevision: 1,
    surfaceVisible: true,
    installedHighSeq: 1_101,
    visibleRows: [{ messageID: 'live-1', seqHigh: 1_101 }],
  }));
  expect(port.unseen).toBe(0);
  expect(viewSessions.save.mock.calls.at(-1)?.[4]?.unseenKeys).toEqual([]);
});

it('does not sign intermediate history batch tails until coverage reaches the authoritative head', () => {
  const base = {
    epoch: 'c0:g1', viewID: 'c0:filtered', sourceRevision: 100,
    rows: [{ id: 'middle', seqHigh: 40 }],
    currentEntryCandidate: { id: 'middle', seqHigh: 40, local: false },
  };
  const status = { headSeq: 100, coverage: [{ lowSeq: 20, highSeq: 40 }] };
  expect(currentEntryAuthority({
    snapshot: base, historyStatus: status, bottomReady: true, availability: 'readable', authoritativeEmpty: false,
  })).toBeNull();
  expect(currentEntryAuthority({
    snapshot: { ...base, currentEntryCandidate: { id: 'middle-2', seqHigh: 60, local: false } },
    historyStatus: { ...status, coverage: [{ lowSeq: 20, highSeq: 60 }] },
    bottomReady: true, availability: 'readable', authoritativeEmpty: false,
  })).toBeNull();

  const authoritative = currentEntryAuthority({
    snapshot: { ...base, currentEntryCandidate: { id: 'latest-match', seqHigh: 20, local: false } },
    historyStatus: { ...status, coverage: [{ lowSeq: 20, highSeq: 100 }] },
    bottomReady: true, availability: 'readable', authoritativeEmpty: false,
  });
  expect(authoritative).toEqual({
    epoch: 'c0:g1', viewID: 'c0:filtered', sourceRevision: 100, candidateID: 'latest-match',
  });
});

it('requires a current durable physical tail before a local echo can inherit current-entry role', () => {
  const snapshotWithEcho = {
    epoch: 'c0:g2', viewID: 'c0:mine', sourceRevision: 9,
    rows: [{ id: 'local', seqHigh: 0 }],
    currentEntryCandidate: { id: 'local', seqHigh: 0, local: true },
  };
  const input = { snapshot: snapshotWithEcho, bottomReady: true, availability: 'readable', authoritativeEmpty: false };
  expect(currentEntryAuthority({ ...input, historyStatus: { headSeq: 9, coverage: [{ lowSeq: 1, highSeq: 8 }] } })).toBeNull();
  expect(currentEntryAuthority({ ...input, historyStatus: { headSeq: 9, coverage: [{ lowSeq: 1, highSeq: 9 }] } })?.candidateID).toBe('local');
  expect(currentEntryAuthority({
    ...input, bottomReady: false, authoritativeEmpty: true, historyStatus: { headSeq: 0, coverage: [] },
  })?.candidateID).toBe('local');
});

// ---------------------------------------------------------------------------
// Latest-scope backlog acknowledgement contract (user correction 2026-09-18):
// reaching the latest content of the current scope, including a successful
// jump-to-latest, acknowledges the backlog this scope has installed. It does
// not require every long message to pass through the viewport; browsing still
// acknowledges individually seen rows; a filtered tail cannot clear other
// scopes; later arrivals are not swept into an older receipt; nothing clears
// before the jump actually reaches the tail.
// ---------------------------------------------------------------------------

function mountBacklogHarness({
  scope = 'mine',
  actorFilter = new Set(),
  rows,
  unseenRecords,
  savedMode = 'browsing',
  revision = 3,
  sourceRevision = 12,
  arrivals = null,
}) {
  let port;
  const physicalMarkRead = vi.fn((acknowledgement) => acknowledgement.physicalSeq || acknowledgement.identities.length);
  const snapshot = {
    revision,
    sourceRevision,
    rows,
    entities: new Map(rows.map((row) => [row.id, row])),
  };
  const history = createHistoryDemandPort({
    channelId: 'c0',
    status: { attached: true, messageCurrent: true, generation: 4, presentationRevision: sourceRevision },
    markRead: physicalMarkRead,
  });
  const viewSessions = {
    readView: () => ({
      mode: savedMode, revision: 0, unseenTail: unseenRecords.length,
      unseenRecords,
    }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  function Harness() {
    const reading = useReadingSession({
      channelID: 'c0',
      viewKey: `c0:${scope}:${[...actorFilter].join(',')}`,
      snapshot,
      history,
      viewSessions,
      arrivals,
      historyViewSpec: { scope, actorFilter },
      surfaceVisible: true,
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  render(<Harness />);
  return { port: () => port, physicalMarkRead, snapshot };
}

const backlogRows = [
  { id: 'root-a', seqLow: 10, seqHigh: 31 },
  { id: 'root-b', seqLow: 20, seqHigh: 33 },
  { id: 'root-c', seqLow: 30, seqHigh: 35 },
  { id: 'tail', seqLow: 40, seqHigh: 40 },
];

it('reaching the installed tail acknowledges the whole installed backlog of the scope, not only visible rows', async () => {
  const { port, physicalMarkRead } = mountBacklogHarness({
    rows: backlogRows,
    unseenRecords: [['root-a', 31], ['root-b', 33], ['root-c', 35]],
  });
  await waitFor(() => expect(port()?.unseen).toBe(3));
  act(() => port().jumpToLatest());
  // Only the tail row is inside the viewport when the jump lands; the three
  // backlog roots above it never passed through the viewport.
  act(() => port().onReadingObservation({
    activationID: port().activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 40,
    visibleRows: [{ messageID: 'tail', seqHigh: 40 }],
  }));
  expect(port().unseen).toBe(0);
  const acknowledgement = physicalMarkRead.mock.calls.at(-1)[0];
  // Filtered scope: exact identities only, never the physical channel cursor.
  expect(acknowledgement.physicalSeq).toBe(0);
  expect(acknowledgement.identities).toEqual(expect.arrayContaining([
    { messageID: 'root-a', seqHigh: 31 },
    { messageID: 'root-b', seqHigh: 33 },
    { messageID: 'root-c', seqHigh: 35 },
    { messageID: 'tail', seqHigh: 40 },
  ]));
  expect(acknowledgement.identities).toHaveLength(4);
  expect(acknowledgement.receipt.tailAcknowledged).toBe(true);
  expect(acknowledgement.receipt.observedRows).toEqual([{ messageID: 'tail', seqHigh: 40 }]);
});

it('a jump-to-latest clears nothing until the tail is actually reached', async () => {
  const { port, physicalMarkRead } = mountBacklogHarness({
    rows: backlogRows,
    unseenRecords: [['root-a', 31], ['root-b', 33]],
  });
  await waitFor(() => expect(port()?.unseen).toBe(2));
  act(() => port().jumpToLatest());
  expect(port().getSession().mode).toBe('following');
  expect(port().unseen).toBe(2);
  // The list is still travelling: an observation that is not at the tail
  // (even in following mode, even with the tail row installed) is not success.
  act(() => port().onReadingObservation({
    activationID: port().activationID,
    source: 'layout', geometryRevision: 1, atTail: false,
    surfaceVisible: true, installedHighSeq: 40,
    visibleRows: [{ messageID: 'root-c', seqHigh: 35 }],
  }));
  expect(port().unseen).toBe(2);
  expect(physicalMarkRead.mock.calls.filter(([ack]) => ack.identities.some((row) => row.messageID === 'root-a'))).toHaveLength(0);
  // A hidden surface at the tail is not a successful jump either.
  act(() => port().onReadingObservation({
    activationID: port().activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: false, installedHighSeq: 40,
    visibleRows: [{ messageID: 'tail', seqHigh: 40 }],
  }));
  expect(port().unseen).toBe(2);
  act(() => port().onReadingObservation({
    activationID: port().activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 40,
    visibleRows: [{ messageID: 'tail', seqHigh: 40 }],
  }));
  expect(port().unseen).toBe(0);
});

it('a tail receipt never sweeps rows that landed above the observed installed high-water', async () => {
  const rows = [
    ...backlogRows,
    // Arrived after the observation being replayed: its seqHigh is above the
    // installed high-water that the DOM reported.
    { id: 'later', seqLow: 41, seqHigh: 41 },
  ];
  const { port, physicalMarkRead } = mountBacklogHarness({
    rows,
    unseenRecords: [['root-a', 31], ['later', 41]],
  });
  await waitFor(() => expect(port()?.unseen).toBe(2));
  act(() => port().jumpToLatest());
  act(() => port().onReadingObservation({
    activationID: port().activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 40,
    visibleRows: [{ messageID: 'tail', seqHigh: 40 }],
  }));
  expect(port().unseen).toBe(1);
  const acknowledgement = physicalMarkRead.mock.calls.at(-1)[0];
  expect(acknowledgement.identities.map((row) => row.messageID)).not.toContain('later');
  expect(acknowledgement.identities.map((row) => row.messageID)).toContain('root-a');
});

it('a staged arrival above the reached tail stays pending instead of being acknowledged by that tail', async () => {
  const rows = [
    ...backlogRows,
    { id: 'incoming', seqLow: 44, seqHigh: 44 },
  ];
  const arrivals = {
    revision: 1,
    acknowledgedRevision: 0,
    events: [{ revision: 1, key: 'incoming', rowID: 'incoming', seq: 44 }],
    acknowledge: vi.fn(),
  };
  const { port } = mountBacklogHarness({ rows, unseenRecords: [['root-b', 33]], arrivals });
  // Saved backlog root-b plus the staged arrival, which the browsing session
  // resolves as unseen from the committed projection before any observation.
  await waitFor(() => expect(port()?.unseen).toBe(2));
  act(() => port().jumpToLatest());
  // The tail observation was taken while the DOM had installed up to seq 40;
  // the arrival at 44 is later content and must not ride on this receipt.
  act(() => port().onReadingObservation({
    activationID: port().activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 40,
    visibleRows: [{ messageID: 'tail', seqHigh: 40 }],
  }));
  // root-b (33 <= 40) is acknowledged by the reached tail; incoming (44) is
  // above the observed installed high-water and survives this receipt.
  expect(port().unseen).toBe(1);
  expect(port().getSession().mode).toBe('following');
  // Once the DOM installs the new tail and the reader is still there, the
  // next observation acknowledges it.
  act(() => port().onReadingObservation({
    activationID: port().activationID,
    source: 'layout', geometryRevision: 2, atTail: true,
    surfaceVisible: true, installedHighSeq: 44,
    visibleRows: [{ messageID: 'incoming', seqHigh: 44 }],
  }));
  expect(port().unseen).toBe(0);
});

it('browsing away from the tail still acknowledges individually seen rows and keeps the rest', async () => {
  const { port, physicalMarkRead } = mountBacklogHarness({
    rows: backlogRows,
    unseenRecords: [['root-a', 31], ['root-b', 33], ['root-c', 35]],
  });
  await waitFor(() => expect(port()?.unseen).toBe(3));
  expect(port().getSession().mode).toBe('browsing');
  act(() => port().onReadingObservation({
    activationID: port().activationID,
    source: 'user', geometryRevision: 1, atTail: false,
    surfaceVisible: true, installedHighSeq: 40,
    visibleRows: [{ messageID: 'root-b', seqHigh: 33 }],
  }));
  expect(port().unseen).toBe(2);
  expect(port().getSession().mode).toBe('browsing');
  const acknowledgement = physicalMarkRead.mock.calls.at(-1)[0];
  expect(acknowledgement.physicalSeq).toBe(0);
  expect(acknowledgement.identities).toEqual([{ messageID: 'root-b', seqHigh: 33 }]);
  expect(acknowledgement.receipt.tailAcknowledged).toBeUndefined();
});

it('a filtered tail acknowledges only identities its own projection installed and never the physical cursor', async () => {
  // The channel also holds roots outside this filter; they are absent from
  // this view's projection and therefore cannot be named by its receipt.
  const { port, physicalMarkRead } = mountBacklogHarness({
    scope: 'mine',
    actorFilter: new Set(['agent:steward']),
    rows: backlogRows,
    unseenRecords: [['root-a', 31]],
  });
  await waitFor(() => expect(port()?.unseen).toBe(1));
  act(() => port().jumpToLatest());
  act(() => port().onReadingObservation({
    activationID: port().activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 40,
    visibleRows: [{ messageID: 'tail', seqHigh: 40 }],
  }));
  expect(port().unseen).toBe(0);
  const acknowledgement = physicalMarkRead.mock.calls.at(-1)[0];
  expect(acknowledgement.physicalSeq).toBe(0);
  expect(acknowledgement.identities.map((row) => row.messageID).sort())
    .toEqual(['root-a', 'root-b', 'root-c', 'tail']);
  expect(acknowledgement.identities.map((row) => row.messageID)).not.toContain('other-scope-root');
});

it('an unfiltered tail advances the physical cursor to the installed high-water even when that row is above the viewport', async () => {
  const rows = [
    { id: 'old-root', seqLow: 10, seqHigh: 52 }, // late terminal on an old root, physically above
    { id: 'tail', seqLow: 40, seqHigh: 40 },
  ];
  const { port, physicalMarkRead } = mountBacklogHarness({
    scope: 'all',
    rows,
    unseenRecords: [['old-root', 52]],
  });
  await waitFor(() => expect(port()?.unseen).toBe(1));
  act(() => port().jumpToLatest());
  act(() => port().onReadingObservation({
    activationID: port().activationID,
    source: 'layout', geometryRevision: 1, atTail: true,
    surfaceVisible: true, installedHighSeq: 52,
    visibleRows: [{ messageID: 'tail', seqHigh: 40 }],
  }));
  expect(port().unseen).toBe(0);
  const acknowledgement = physicalMarkRead.mock.calls.at(-1)[0];
  expect(acknowledgement.physicalSeq).toBe(52);
});

it('installedTailReadRows bounds identities by the installed high-water and drops local echo rows', () => {
  expect(installedTailReadRows([
    { id: 'a', seqHigh: 5 },
    { id: 'b', seqHigh: 9 },
    { id: 'future', seqHigh: 12 },
    { id: 'echo', seqHigh: 7, localState: 'sending' },
    { id: 'echo-body', seqHigh: 8, body: { local: true } },
  ], 9, [{ messageID: 'a', seqHigh: 6 }, { messageID: 'z', seqHigh: 99 }])).toEqual([
    { messageID: 'a', seqHigh: 6 },
    { messageID: 'b', seqHigh: 9 },
  ]);
  expect(installedTailReadRows([{ id: 'a', seqHigh: 5 }], 0)).toEqual([]);
});

// ---------------------------------------------------------------------------
// IM 读侧兜底（监理 2026-09-18 14:58 补充裁定）：活动视图处于 跟随 ∧ 在底部 ∧
// 可见 时，新到达即读——视窗计数在派生层恒为 0，不依赖任何一条回执是否已经落
// 地。真相仍是回执（unseen 记录、exact identities、物理游标一律不动）。
// ---------------------------------------------------------------------------

const tailObservation = (port, change = {}) => ({
  activationID: port.activationID,
  source: 'layout',
  geometryRevision: 1,
  atTail: true,
  surfaceVisible: true,
  installedHighSeq: 40,
  visibleRows: [{ messageID: 'tail', seqHigh: 40 }],
  ...change,
});

it('在底部且可见时视窗计数派生为 0，而回执真相一字不改', async () => {
  const rows = [...backlogRows, { id: 'later', seqLow: 41, seqHigh: 41 }];
  // 跟随态、在底部：IM 模型里这就是「在场」。
  const { port } = mountBacklogHarness({ rows, unseenRecords: [['later', 41]], savedMode: 'following' });
  await waitFor(() => expect(port()?.unseen).toBe(1));
  // 还没有任何尾部观测：显示值就是真值。
  expect(port().unseenNotice).toBe(1);
  expect(port().tailCaughtUp.caughtUp).toBe(false);

  act(() => port().onReadingObservation(tailObservation(port())));
  // 41 在观测到的已装入水位（40）之上，旧回执恒不扫它——真相保持 1。
  expect(port().unseen).toBe(1);
  // 但用户此刻就在最新端看着：显示值恒为 0。
  expect(port().tailCaughtUp).toMatchObject({
    channelId: 'c0', caughtUp: true, scope: 'mine', actorFiltered: false,
  });
  expect(port().unseenNotice).toBe(0);

  // 跟随态的短暂几何追赶不制造闪烁；持久回执由真实 atTail 观测另行证明。
  act(() => port().onReadingObservation(tailObservation(port(), {
    geometryRevision: 2, atTail: false, visibleRows: [{ messageID: 'root-c', seqHigh: 35 }],
  })));
  expect(port().tailCaughtUp.caughtUp).toBe(true);
  expect(port().unseenNotice).toBe(0);

  // 用户自己上滚（浏览态）才是离开底部，兜底立刻关闭，真值重新可见。
  act(() => port().onUserControl({ direction: 'older', gestureID: 'leave-tail' }));
  expect(port().tailCaughtUp.caughtUp).toBe(false);
  expect(port().unseenNotice).toBe(1);
});

it('跳到最新在真正到达之前一字不清：意图改回跟随不等于在场', async () => {
  const rows = [...backlogRows, { id: 'later', seqLow: 41, seqHigh: 41 }];
  const { port } = mountBacklogHarness({ rows, unseenRecords: [['later', 41]], savedMode: 'browsing' });
  await waitFor(() => expect(port()?.unseen).toBe(1));
  act(() => port().jumpToLatest());
  expect(port().getSession().mode).toBe('following');
  // 还没有任何尾部观测：意图是跟随，人还没到。
  expect(port().tailCaughtUp.caughtUp).toBe(false);
  expect(port().unseenNotice).toBe(1);
  act(() => port().onReadingObservation(tailObservation(port())));
  expect(port().tailCaughtUp.caughtUp).toBe(true);
});

it('兜底只认真实在场：浏览态、Surface 隐藏、页面不可见都不压计数', async () => {
  const rows = [...backlogRows, { id: 'later', seqLow: 41, seqHigh: 41 }];
  // 跟随态、在底部：IM 模型里这就是「在场」。
  const { port } = mountBacklogHarness({ rows, unseenRecords: [['later', 41]], savedMode: 'following' });
  await waitFor(() => expect(port()?.unseen).toBe(1));

  // 在底部但 Surface 未报可见：不是在场。
  act(() => port().onReadingObservation(tailObservation(port(), { surfaceVisible: false })));
  expect(port().tailCaughtUp.caughtUp).toBe(false);
  expect(port().unseenNotice).toBe(1);

  act(() => port().onReadingObservation(tailObservation(port(), { geometryRevision: 2 })));
  expect(port().tailCaughtUp.caughtUp).toBe(true);

  // 用户上滚（浏览态）：兜底关闭。
  act(() => port().onUserControl({ direction: 'older', gestureID: 'g1' }));
  expect(port().getSession().mode).toBe('browsing');
  expect(port().tailCaughtUp.caughtUp).toBe(false);
  expect(port().unseenNotice).toBe(1);

  // 回到底部（跟随）后重新在场。
  act(() => port().jumpToLatest());
  expect(port().getSession().mode).toBe('following');
  act(() => port().onReadingObservation(tailObservation(port(), { geometryRevision: 3 })));
  expect(port().tailCaughtUp.caughtUp).toBe(true);

  // Surface 被隐藏（切到别的工作区页签）：在场结束。
  act(() => port().onSurfaceVisibilityChange(false));
  expect(port().tailCaughtUp.caughtUp).toBe(false);
  expect(port().unseenNotice).toBe(1);
});

it('页面不可见时兜底关闭，回到前台立刻恢复', async () => {
  const rows = [...backlogRows, { id: 'later', seqLow: 41, seqHigh: 41 }];
  // 跟随态、在底部：IM 模型里这就是「在场」。
  const { port } = mountBacklogHarness({ rows, unseenRecords: [['later', 41]], savedMode: 'following' });
  await waitFor(() => expect(port()?.unseen).toBe(1));
  act(() => port().onReadingObservation(tailObservation(port())));
  expect(port().tailCaughtUp.caughtUp).toBe(true);

  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(port().tailCaughtUp.caughtUp).toBe(false);
    expect(port().unseenNotice).toBe(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(port().tailCaughtUp.caughtUp).toBe(true);
    expect(port().unseenNotice).toBe(0);
  } finally {
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
    else delete document.visibilityState;
  }
});
