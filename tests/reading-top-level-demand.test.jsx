// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBrowsingReadingController } from '../src/ui/timeline/useBrowsingReadingController.js';

function status(overrides = {}) {
  return {
    channelId: 'c0', attached: true, generation: 1, messageCurrent: true, headSeq: 500,
    hasOlder: true, buffered: 0, loading: false, completedPages: 4, revealVersion: 0,
    oldestSeq: 400, sourceLease: 'lease-1', localReplicaReady: true,
    notificationAuthorityRevision: 0, presentationRevision: 3,
    historyDemand: { revision: 0, phase: 'idle', error: '' },
    ...overrides,
  };
}

function owner({ mode = 'browsing', inputEpoch = 3, ...rest } = {}) {
  const session = { activationID: 'act-1', inputEpoch, intentRevision: inputEpoch, mode };
  const reading = {
    activationID: 'act-1',
    session,
    getSession: () => session,
    status: status(rest.status),
    bottomReady: true,
    initializing: false,
    restorePending: false,
    onReadingObservation: vi.fn(() => true),
    onAtTop: vi.fn(() => Promise.resolve({ kind: 'satisfied' })),
    onNearTop: vi.fn(() => Promise.resolve({ kind: 'satisfied' })),
    onUnderfill: vi.fn(() => Promise.resolve({ kind: 'satisfied' })),
  };
  return reading;
}

const rows = [{ id: 'r1', seqLow: 400 }, { id: 'r2', seqLow: 450 }];
const snapshot = { rows, revision: 3 };

function harness(reading, root = { scrollTop: 0, scrollHeight: 4000, clientHeight: 600 }) {
  const hook = renderHook(
    ({ reading: current, snapshot: snap }) => useBrowsingReadingController({
      reading: current, snapshot: snap, rootNode: root, rootIdentity: 1, rootMountedRef: { current: true },
    }),
    { initialProps: { reading, snapshot } },
  );
  const evidence = (extra = {}) => Object.freeze({
    type: 'scroll-position', activationID: 'act-1', inputEpoch: reading.session.inputEpoch,
    direction: 'older', atTop: true, scrollTop: 0, scrollHeight: 4000, clientHeight: 600, demandUnits: 3,
    ...extra,
  });
  // The list's settled paint receipt: the reading position has actually been
  // painted once for this activation.
  const settle = (current = reading, snap = snapshot) => act(() => {
    const st = current.status;
    hook.result.current.reportDomEvidence(Object.freeze({
      type: 'reading-authority', activationID: 'act-1', inputEpoch: current.session.inputEpoch,
      source: 'settled', settled: true, surfaceVisible: true, atTail: false,
      installedHighSeq: st.headSeq, presentationRevision: snap.revision, domPresentationRevision: snap.revision,
      rootIdentity: 1, rootNode: root, tailID: snap.rows.at(-1).id, geometryRevision: 1,
      visibleRows: [{ messageID: snap.rows[0].id }], visibleRowIDs: [snap.rows[0].id],
      bookmark: { messageID: snap.rows[0].id, seq: snap.rows[0].seqLow },
      observationIdentity: {
        activationID: 'act-1', inputEpoch: current.session.inputEpoch, intentRevision: current.session.intentRevision,
        presentationRevision: snap.revision, generation: st.generation, authorityRevision: st.notificationAuthorityRevision,
        tailID: snap.rows.at(-1).id, rootIdentity: 1,
      },
    }));
  });
  return { hook, evidence, root, settle };
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });

describe('reading top level demand (level-triggered, owner-held)', () => {
  it('issues one top demand from a list top signal with no input transaction, and only one while it is outstanding', async () => {
    const reading = owner();
    const { hook, evidence, settle } = harness(reading);
    settle();
    act(() => { hook.result.current.reportDomEvidence(evidence()); });
    expect(reading.onAtTop).toHaveBeenCalledTimes(1);
    expect(reading.onAtTop.mock.calls[0][0]).toMatchObject({ demandUnits: 3, inputEpoch: 3, gestureID: '' });
    act(() => { hook.result.current.reportDomEvidence(evidence()); });
    act(() => { hook.result.current.reportDomEvidence(evidence()); });
    expect(reading.onAtTop).toHaveBeenCalledTimes(1);
  });

  it('stays consumed for the same supply after a settle, re-arms when the supply grows while still at top', async () => {
    const reading = owner();
    const { hook, evidence, settle } = harness(reading);
    settle();
    act(() => { hook.result.current.reportDomEvidence(evidence()); });
    await flush();
    expect(reading.onAtTop).toHaveBeenCalledTimes(1);
    // Same supply, still at top: inert.
    act(() => { hook.result.current.reportDomEvidence(evidence()); });
    await flush();
    expect(reading.onAtTop).toHaveBeenCalledTimes(1);
    // Supply grew (a page landed) and the reader is still physically at 0: the level re-issues.
    const grown = { ...reading, status: status({ oldestSeq: 300, completedPages: 5 }) };
    hook.rerender({ reading: grown, snapshot: { rows: [{ id: 'r0', seqLow: 300 }, ...rows], revision: 4 } });
    await flush();
    expect(reading.onAtTop).toHaveBeenCalledTimes(2);
  });

  it('leaving the top lowers the level; returning raises it and asks again for the same supply', async () => {
    const reading = owner();
    const { hook, evidence, root, settle } = harness(reading);
    settle();
    act(() => { hook.result.current.reportDomEvidence(evidence()); });
    await flush();
    expect(reading.onAtTop).toHaveBeenCalledTimes(1);
    root.scrollTop = 900;
    act(() => { hook.result.current.reportDomEvidence(evidence({ atTop: false, scrollTop: 900, direction: 'newer' })); });
    root.scrollTop = 0;
    act(() => { hook.result.current.reportDomEvidence(evidence()); });
    await flush();
    expect(reading.onAtTop).toHaveBeenCalledTimes(2);
  });

  it('ignores the mount-at-origin top signal until the list has painted its position once, then honours it', async () => {
    const reading = owner();
    const { hook, evidence, settle } = harness(reading);
    act(() => { hook.result.current.reportDomEvidence(evidence({ direction: '' })); });
    expect(reading.onAtTop).not.toHaveBeenCalled();
    settle();
    expect(reading.onAtTop).toHaveBeenCalledTimes(1);
  });

  it('is inert at the oldest boundary, in following mode, and before attach', async () => {
    const eof = owner({ status: { hasOlder: false } });
    const a = harness(eof);
    a.settle();
    act(() => { a.hook.result.current.reportDomEvidence(a.evidence()); });
    expect(eof.onAtTop).not.toHaveBeenCalled();

    const following = owner({ mode: 'following' });
    const b = harness(following);
    b.settle();
    act(() => { b.hook.result.current.reportDomEvidence(b.evidence()); });
    expect(following.onAtTop).not.toHaveBeenCalled();

    const detached = owner({ status: { attached: false } });
    const c = harness(detached);
    c.settle();
    act(() => { c.hook.result.current.reportDomEvidence(c.evidence()); });
    expect(detached.onAtTop).not.toHaveBeenCalled();
  });

  it('a non-terminal result does not consume the level; a publish re-issues after the retry pause', async () => {
    const reading = owner();
    reading.onAtTop = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ kind: 'admission-pending', deduplicated: true }))
      .mockImplementation(() => Promise.resolve({ kind: 'satisfied' }));
    const { hook, evidence, settle } = harness(reading);
    settle();
    act(() => { hook.result.current.reportDomEvidence(evidence()); });
    await flush();
    expect(reading.onAtTop).toHaveBeenCalledTimes(1);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    hook.rerender({ reading: { ...reading }, snapshot: { ...snapshot } });
    await flush();
    expect(reading.onAtTop).toHaveBeenCalledTimes(2);
  });
});
