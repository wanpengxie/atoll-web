import { describe, expect, it, vi } from 'vitest';
import { createHistoryPresentationAdmission as createAdmissionAuthority } from '../src/model/history-presentation-admission.js';
import { createConversationPresentation } from '../src/model/conversation-presentation.js';

const item = (id, seq = 1) => ({
  kind: 'standalone',
  seq,
  envelope: { id, seq, sender: { id: 'agent:test:1' }, payload: { text: id } },
});

const ids = (items) => items.map((entry) => entry.envelope?.id || entry.id);

const token = (overrides = {}) => ({
  activationID: 'activation-1',
  inputEpoch: 2,
  operationID: 'history:activation-1:1',
  viewID: 'channel:mine:agent',
  epoch: 'channel:7',
  baselinePresentationRevision: 11,
  baselineIDs: Object.freeze(['b', 'c']),
  anchorID: 'b',
  anchorSeq: 20,
  demandUnits: 2,
  ...overrides,
});

const meta = (sourceRevision, operationID = 'history:activation-1:1') => ({
  operationID,
  viewID: 'channel:mine:agent',
  epoch: 'channel:7',
  sourceRevision,
});

const viewportAuthority = (overrides = {}) => ({
  activationID: 'activation-1',
  inputEpoch: 2,
  viewID: 'channel:mine:agent',
  epoch: 'channel:7',
  ...overrides,
});

// Drive the current owner contracts explicitly, as Timeline does in its
// committed layout effect. These are not aliases for removed public methods.
function commitAdmission(authority, channelID, items, admissionMeta) {
  const candidate = authority.evaluate(channelID, items, admissionMeta);
  expect(authority.commitCandidate(channelID, candidate)).toBe(true);
  return candidate.items;
}

function commitPresentation(presentation, items, presentationMeta) {
  const candidate = presentation.evaluate(items, presentationMeta);
  expect(presentation.commitCandidate(candidate)).toBe(true);
  return candidate.snapshot;
}

describe('history presentation admission', () => {
  it('keeps incremental prefixes out of the visible snapshot and publishes them once', () => {
    const changed = vi.fn();
    const admission = createAdmissionAuthority({ onChange: changed });
    admission.begin('channel', token());

    const first = [item('a', 10), item('b', 20), item('c', 30), item('tail', 40)];
    expect(ids(commitAdmission(admission, 'channel', first, meta(12)))).toEqual(['b', 'c', 'tail']);
    expect(admission.observe('channel', first, meta(12))).toMatchObject({
      stagedIDs: ['a'], completeUnits: 1, fulfilled: false,
    });

    const second = [item('x', 5), ...first];
    expect(ids(commitAdmission(admission, 'channel', second, meta(13)))).toEqual(['b', 'c', 'tail']);
    expect(admission.observe('channel', second, meta(13))).toMatchObject({
      stagedIDs: ['x', 'a'], completeUnits: 2, fulfilled: true,
    });

    const commit = admission.settle('channel', 'fulfilled');
    expect(commit).toMatchObject({
      stagedIDs: ['x', 'a'], candidateSourceRevision: 13,
      candidatePresentationRevision: 0,
    });
    expect(ids(commitAdmission(admission, 'channel', second, meta(13)))).toEqual(['b', 'c', 'tail']);
    expect(admission.prepareCommit('channel', {
      revision: 11, sourceRevision: 13,
      rows: [
        { id: 'b', body: item('b', 20) },
        { id: 'c', body: item('c', 30) },
        { id: 'tail', body: item('tail', 40) },
      ],
    })).toBe(true);
    const release = admission.evaluate('channel', second, meta(13));
    expect(ids(release.items)).toEqual(['x', 'a', 'b', 'c', 'tail']);
    const validation = admission.validatePresentation('channel', release, {
      revision: 12,
      rows: ['x', 'a', 'b', 'c', 'tail'].map((id) => ({ id })),
      changes: {
        kind: 'prepend', inserted: ['x', 'a'], frontInsertedIDs: ['x', 'a'],
        backInsertedIDs: [], updated: [], removed: [],
      },
    }, viewportAuthority());
    expect(validation.accepted).toBe(true);
    expect(admission.commitPresentationGrant('channel', validation.grant)).toBe(true);
    expect(admission.snapshot('channel').phase).toBe('idle');
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it('withholds every candidate for an empty baseline until semantic demand is fulfilled', () => {
    const admission = createAdmissionAuthority();
    admission.begin('channel', token({ baselineIDs: [], demandUnits: 2 }));

    const first = [item('a', 10)];
    expect(commitAdmission(admission, 'channel', first, meta(12))).toEqual([]);
    expect(admission.observe('channel', first, meta(12)).fulfilled).toBe(false);

    const second = [item('x', 5), item('a', 10)];
    expect(commitAdmission(admission, 'channel', second, meta(13))).toEqual([]);
    expect(admission.observe('channel', second, meta(13))).toMatchObject({
      stagedIDs: ['x', 'a'], completeUnits: 2, fulfilled: true,
    });

    admission.settle('channel');
    admission.prepareCommit('channel', { revision: 1, sourceRevision: 13, rows: [] });
    expect(ids(commitAdmission(admission, 'channel', second, meta(13)))).toEqual(['x', 'a']);
  });

  it('atomically acknowledges an exact first publish from an empty baseline', () => {
    const admission = createAdmissionAuthority();
    admission.begin('channel', token({ baselineIDs: [], demandUnits: 1 }));
    const first = [item('a', 10)];
    commitAdmission(admission, 'channel', first, meta(12));
    expect(admission.observe('channel', first, meta(12))).toMatchObject({
      stagedIDs: ['a'], fulfilled: true,
    });
    admission.settle('channel');
    expect(admission.prepareCommit('channel', {
      revision: 1, sourceRevision: 12, rows: [],
    })).toBe(true);
    const release = admission.evaluate('channel', first, meta(12));
    expect(ids(release.items)).toEqual(['a']);
    const validation = admission.validatePresentation('channel', release, {
      revision: 2,
      rows: [{ id: 'a' }],
      changes: {
        kind: 'mixed', inserted: ['a'], frontInsertedIDs: [], backInsertedIDs: [],
        updated: [], removed: [],
      },
    }, viewportAuthority());
    expect(validation.accepted).toBe(true);
    expect(admission.commitPresentationGrant('channel', validation.grant)).toBe(true);
    expect(admission.snapshot('channel').phase).toBe('idle');
  });

  it('rejects a polluted release atomically instead of binding an impossible revision', () => {
    const admission = createAdmissionAuthority();
    const baseline = [item('b', 20), item('c', 30)];
    const withOlder = [item('a', 10), ...baseline];
    admission.begin('channel', token({ demandUnits: 1 }));
    commitAdmission(admission, 'channel', baseline, meta(11));
    admission.observe('channel', withOlder, meta(12));
    admission.settle('channel');
    commitAdmission(admission, 'channel', withOlder, meta(12));
    expect(admission.prepareCommit('channel', {
      revision: 11, sourceRevision: 12,
      rows: baseline.map((body) => ({ id: body.envelope.id, body })),
    })).toBe(true);

    const release = admission.evaluate('channel', withOlder, meta(12));
    const currentToken = admission.snapshot('channel').committed;
    expect(admission.validatePresentation('channel', release, {
      revision: 12,
      rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      changes: {
        kind: 'mixed', inserted: ['a'], frontInsertedIDs: [], backInsertedIDs: [],
        updated: [], removed: ['live-d'],
      },
    }, viewportAuthority())).toEqual({ accepted: false, reason: 'identity-mismatch' });
    expect(admission.rejectPresentation('channel', currentToken)).toBe(true);
    expect(admission.snapshot('channel')).toMatchObject({
      phase: 'holding', committed: null, stagedIDs: ['a'],
    });
  });

  it('lets no stale layout receipt complete or reject a renewed transaction', () => {
    const admission = createAdmissionAuthority();
    const baseline = [item('b', 20), item('c', 30)];
    const withOlder = [item('a', 10), ...baseline];
    admission.begin('channel', token({ demandUnits: 1 }));
    commitAdmission(admission, 'channel', baseline, meta(11));
    admission.observe('channel', withOlder, meta(12));
    admission.settle('channel');
    commitAdmission(admission, 'channel', withOlder, meta(12));
    admission.prepareCommit('channel', {
      revision: 11, sourceRevision: 12,
      rows: baseline.map((body) => ({ id: body.envelope.id, body })),
    });
    const staleToken = admission.snapshot('channel').committed;
    const staleCandidate = admission.evaluate('channel', withOlder, meta(12));
    admission.advanceInputEpoch('channel', {
      operationID: staleToken.operationID,
      activationID: staleToken.activationID,
      direction: 'older',
      inputEpoch: 3,
      currentInputEpoch: 3,
    });
    const presentation = {
      revision: 12,
      rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      changes: {
        kind: 'prepend', inserted: ['a'], frontInsertedIDs: ['a'], backInsertedIDs: [],
        updated: [], removed: [],
      },
    };

    expect(admission.validatePresentation('channel', staleCandidate, presentation, viewportAuthority({ inputEpoch: 3 })))
      .toEqual({ accepted: false, reason: 'stale-transaction' });
    expect(admission.snapshot('channel')).toMatchObject({
      phase: 'committed-awaiting-layout', committed: { inputEpoch: 3 },
    });
    const currentCandidate = admission.evaluate('channel', withOlder, meta(12));
    const current = admission.validatePresentation('channel', currentCandidate, presentation, viewportAuthority({ inputEpoch: 3 }));
    expect(current.accepted).toBe(true);
    expect(admission.commitPresentationGrant('channel', current.grant)).toBe(true);
  });

  it('grants publication only to the exact committed Reading viewport owner', () => {
    const admission = createAdmissionAuthority();
    const baseline = [item('b', 20)];
    const withOlder = [item('a', 10), ...baseline];
    admission.begin('channel', token({ baselineIDs: ['b'], demandUnits: 1 }));
    commitAdmission(admission, 'channel', baseline, meta(11));
    admission.observe('channel', withOlder, meta(12));
    admission.settle('channel');
    commitAdmission(admission, 'channel', withOlder, meta(12));
    admission.prepareCommit('channel', {
      revision: 11, sourceRevision: 12,
      rows: [{ id: 'b', body: baseline[0] }],
    });
    const candidate = admission.evaluate('channel', withOlder, meta(12));
    const presentation = {
      revision: 12,
      rows: [{ id: 'a' }, { id: 'b' }],
      changes: {
        kind: 'prepend', inserted: ['a'], frontInsertedIDs: ['a'], backInsertedIDs: [],
        updated: [], removed: [],
      },
    };

    expect(admission.validatePresentation(
      'channel', candidate, presentation, viewportAuthority({ inputEpoch: 3 }),
    )).toEqual({ accepted: false, reason: 'stale-viewport-owner' });
    expect(admission.snapshot('channel').phase).toBe('committed-awaiting-layout');
    expect(admission.validatePresentation(
      'channel', candidate, presentation, viewportAuthority(),
    ).accepted).toBe(true);
  });

  it('fences an accepted history grant by intent revision as well as input epoch', () => {
    const admission = createAdmissionAuthority();
    const baseline = [item('b', 20)];
    const withOlder = [item('a', 10), ...baseline];
    admission.begin('channel', token({
      intentRevision: 9,
      messageID: 'b',
      viewportOffset: -394,
      baselineIDs: ['b'],
      uiBaselineIDs: ['b'],
      durableBaselineIDs: ['b'],
    }));
    commitAdmission(admission, 'channel', baseline, meta(11));
    admission.observe('channel', withOlder, meta(12));
    admission.settle('channel');
    commitAdmission(admission, 'channel', withOlder, meta(12));
    admission.prepareCommit('channel', {
      revision: 11, sourceRevision: 12,
      rows: [{ id: 'b', body: baseline[0] }],
    });
    const candidate = admission.evaluate('channel', withOlder, meta(12));
    const presentation = {
      revision: 12,
      rows: [{ id: 'a' }, { id: 'b' }],
      changes: {
        kind: 'prepend', inserted: ['a'], frontInsertedIDs: ['a'],
        backInsertedIDs: [], updated: [], removed: [],
      },
    };
    expect(admission.validatePresentation(
      'channel', candidate, presentation, viewportAuthority({ intentRevision: 8 }),
    )).toEqual({ accepted: false, reason: 'stale-viewport-owner' });
    const accepted = admission.validatePresentation(
      'channel', candidate, presentation, viewportAuthority({ intentRevision: 9 }),
    );
    expect(accepted.accepted).toBe(true);
    expect(accepted.grant.commitToken).toMatchObject({
      activationID: 'activation-1', inputEpoch: 2, intentRevision: 9,
      operationID: 'history:activation-1:1', viewID: 'channel:mine:agent',
      epoch: 'channel:7', messageID: 'b', viewportOffset: -394,
    });
  });

  it('keeps cancelled facts staged and lets the next same-view intent inherit them', () => {
    const admission = createAdmissionAuthority();
    const firstToken = token({ demandUnits: 3 });
    admission.begin('channel', firstToken);
    admission.observe('channel', [item('a', 10), item('b', 20), item('c', 30)], meta(12));
    expect(admission.cancel('channel', firstToken.operationID)).toBe(true);
    expect(ids(commitAdmission(admission,
      'channel',
      [item('a', 10), item('b', 20), item('c', 30)],
      meta(12),
    ))).toEqual(['b', 'c']);

    admission.begin('channel', token({ operationID: 'history:activation-1:2', demandUnits: 2 }));
    expect(admission.snapshot('channel')).toMatchObject({
      phase: 'pending', stagedIDs: ['a'], completeUnits: 1,
    });
    expect(admission.observe(
      'channel',
      [item('x', 5), item('a', 10), item('b', 20), item('c', 30)],
      meta(13, 'history:activation-1:2'),
    )).toMatchObject({ stagedIDs: ['x', 'a'], fulfilled: true });
  });

  it('does not inherit held facts across a new reading activation in the same view', () => {
    const admission = createAdmissionAuthority();
    const firstToken = token({ demandUnits: 3 });
    admission.begin('channel', firstToken);
    commitAdmission(admission, 'channel', [item('b', 20), item('c', 30)], meta(11));
    admission.observe('channel', [item('a', 10), item('b', 20), item('c', 30)], meta(12));
    expect(admission.cancel('channel', firstToken.operationID)).toBe(true);

    const nextToken = token({
      activationID: 'activation-2',
      operationID: 'history:activation-2:1',
      uiBaselineIDs: ['b', 'c'],
      durableBaselineIDs: ['b', 'c'],
      demandUnits: 2,
    });
    admission.begin('channel', nextToken, [item('b', 20), item('c', 30)]);
    expect(admission.snapshot('channel')).toMatchObject({
      phase: 'pending', stagedIDs: [], completeUnits: 0,
      token: { activationID: 'activation-2' },
    });
  });

  it('fails closed and rebases when the baseline stops being an ordered subsequence', () => {
    const changed = vi.fn();
    const admission = createAdmissionAuthority({ onChange: changed });
    admission.begin('channel', token());
    const candidate = [item('a', 10), item('c', 30), item('b', 20)];
    expect(admission.observe('channel', candidate, meta(12))).toMatchObject({ rebased: true });
    expect(admission.snapshot('channel').phase).toBe('pending');
    expect(ids(commitAdmission(admission, 'channel', candidate, meta(12)))).toEqual([]);
    expect(admission.snapshot('channel').phase).toBe('holding');
  });

  it('does not release a committed prefix into a different view or epoch', () => {
    const changed = vi.fn();
    const admission = createAdmissionAuthority({ onChange: changed });
    admission.begin('channel', token({ demandUnits: 1 }));
    const candidate = [item('a', 10), item('b', 20), item('c', 30)];
    admission.observe('channel', candidate, meta(12));
    admission.settle('channel');
    const changesBeforeStaleRender = changed.mock.calls.length;

    expect(ids(admission.evaluate('channel', candidate, {
      viewID: 'channel:all', epoch: 'channel:8', sourceRevision: 13,
    }).items)).toEqual([]);
    expect(admission.snapshot('channel').phase).toBe('pending-baseline-commit');
    expect(changed).toHaveBeenCalledTimes(changesBeforeStaleRender);
    expect(admission.reconcileCurrent('channel', {
      viewID: 'channel:all', epoch: 'channel:8',
    })).toBe(true);
    expect(admission.snapshot('channel').phase).toBe('idle');
    expect(changed).toHaveBeenCalledTimes(changesBeforeStaleRender + 1);
  });

  it('rejects a committed render candidate after the owner revision advances', () => {
    const admission = createAdmissionAuthority();
    admission.begin('channel', token(), [item('b', 20), item('c', 30)]);
    const staleCandidate = admission.evaluate(
      'channel',
      [item('c', 30)],
      meta(11),
    );

    // A feed observation advances the same admission owner before React can
    // commit the render candidate. The old receipt must not move it to holding.
    admission.observe(
      'channel',
      [item('a', 10), item('b', 20), item('c', 30)],
      meta(12),
    );
    expect(admission.commitCandidate('channel', staleCandidate)).toBe(false);
    expect(admission.snapshot('channel')).toMatchObject({
      phase: 'pending', stagedIDs: ['a'],
    });
  });

  it('renews only the same operation for exact current older input', () => {
    const admission = createAdmissionAuthority();
    const active = token({ demandUnits: 1 });
    admission.begin('channel', active);
    const renewed = admission.advanceInputEpoch('channel', {
      operationID: active.operationID,
      activationID: active.activationID,
      direction: 'older',
      inputEpoch: 5,
      currentInputEpoch: 5,
    });
    expect(renewed).toEqual(expect.objectContaining({ fromInputEpoch: 2, toInputEpoch: 5 }));
    expect(admission.snapshot('channel').token.inputEpoch).toBe(5);
    expect(admission.advanceInputEpoch('channel', {
      operationID: active.operationID, activationID: active.activationID,
      direction: 'newer', inputEpoch: 6, currentInputEpoch: 6,
    })).toBeNull();
    expect(admission.advanceInputEpoch('channel', {
      operationID: active.operationID, activationID: active.activationID,
      direction: 'older', inputEpoch: 6, currentInputEpoch: 7,
    })).toBeNull();

    commitAdmission(admission, 'channel', [item('b', 20), item('c', 30)], meta(11));
    admission.observe('channel', [item('a', 10), item('b', 20), item('c', 30)], meta(12));
    expect(admission.settle('channel').inputEpoch).toBe(5);
    expect(admission.advanceInputEpoch('channel', {
      operationID: active.operationID, activationID: active.activationID,
      direction: 'older', inputEpoch: 7, currentInputEpoch: 7,
    })).toEqual(expect.objectContaining({ fromInputEpoch: 5, toInputEpoch: 7 }));
    admission.prepareCommit('channel', {
      revision: 12, sourceRevision: 12,
      rows: [{ id: 'b', body: item('b', 20) }, { id: 'c', body: item('c', 30) }],
    });
    const commitID = admission.snapshot('channel').committed.commitID;
    expect(admission.acknowledge('channel', commitID)).toBe(true);
    expect(admission.advanceInputEpoch('channel', {
      operationID: active.operationID, activationID: active.activationID,
      direction: 'older', inputEpoch: 8, currentInputEpoch: 8,
    })).toBeNull();
  });

  it('commits an existing-row revision before releasing an exact pure prepend', () => {
    const admission = createAdmissionAuthority();
    const presentation = createConversationPresentation();
    const baseline = [item('b', 20), item('c', 30)];
    const first = commitPresentation(presentation, baseline, {
      nextViewID: 'channel:mine:agent', epoch: 'channel:7', sourceRevision: 11,
    });
    admission.begin('channel', token({ demandUnits: 1 }), baseline);

    const updatedB = item('b', 20);
    updatedB.envelope.payload.text = 'updated baseline body';
    const candidate = [item('a', 10), updatedB, baseline[1]];
    expect(admission.observe('channel', candidate, meta(12)).fulfilled).toBe(true);
    admission.settle('channel');

    const admittedBaseline = commitAdmission(admission, 'channel', candidate, meta(12));
    expect(ids(admittedBaseline)).toEqual(['b', 'c']);
    const baselineUpdate = commitPresentation(presentation, admittedBaseline, {
      nextViewID: 'channel:mine:agent', epoch: 'channel:7', sourceRevision: 12,
      sourceChanges: [{ revision: 12, id: 'b', kind: 'content' }],
    });
    expect(baselineUpdate.changes.kind).toBe('revise');
    expect(baselineUpdate.entities.get('b')).not.toBe(first.entities.get('b'));
    const settledB = baselineUpdate.entities.get('b');

    expect(admission.prepareCommit('channel', baselineUpdate)).toBe(true);
    const released = commitPresentation(
      presentation,
      commitAdmission(admission, 'channel', candidate, meta(12)), {
      nextViewID: 'channel:mine:agent', epoch: 'channel:7', sourceRevision: 12,
      sourceChanges: [{ revision: 12, id: 'b', kind: 'content' }],
      },
    );
    expect(released.changes).toMatchObject({ kind: 'prepend', inserted: ['a'], updated: [] });
    expect(released.entities.get('b')).toBe(settledB);
  });

  it('keeps live append and baseline revise after the exact prefix release commit', () => {
    const admission = createAdmissionAuthority();
    const presentation = createConversationPresentation();
    const b = item('b', 20);
    const c = item('c', 30);
    const initial = commitPresentation(presentation, [b, c], {
      nextViewID: 'channel:mine:agent', epoch: 'channel:7', sourceRevision: 11,
    });
    admission.begin('channel', token({ demandUnits: 1 }));
    commitAdmission(admission, 'channel', [b, c], meta(11));
    admission.observe('channel', [item('a', 10), b, c], meta(12));
    const commit = admission.settle('channel');

    const barrierItems = commitAdmission(admission, 'channel', [item('a', 10), b, c], meta(12));
    const barrier = commitPresentation(presentation, barrierItems, {
      nextViewID: 'channel:mine:agent', epoch: 'channel:7', sourceRevision: 12,
    });
    expect(admission.prepareCommit('channel', barrier)).toBe(true);

    const updatedB = item('b', 20);
    updatedB.envelope.payload.text = 'late baseline update';
    const current = [item('a', 10), updatedB, c, item('d', 40)];
    const releaseItems = commitAdmission(admission, 'channel', current, meta(13));
    expect(ids(releaseItems)).toEqual(['a', 'b', 'c']);
    expect(releaseItems[1]).toBe(barrier.entities.get('b').body);
    expect(releaseItems[1].envelope.payload.text).toBe('b');
    const sourceFence = admission.sourceFence('channel');
    const released = commitPresentation(presentation, releaseItems, {
      nextViewID: 'channel:mine:agent', epoch: 'channel:7', sourceRevision: sourceFence,
      sourceChanges: [],
    });
    expect(released.changes).toMatchObject({
      kind: 'prepend', frontInsertedIDs: ['a'], backInsertedIDs: [], updated: [], removed: [],
    });
    expect(admission.acknowledge('channel', commit.commitID)).toBe(true);

    const ordinary = commitPresentation(presentation, current, {
      nextViewID: 'channel:mine:agent', epoch: 'channel:7', sourceRevision: 13,
      sourceChanges: [{ revision: 13, id: 'b', kind: 'content' }],
    });
    expect(ordinary.changes).toMatchObject({
      kind: 'append', frontInsertedIDs: [], backInsertedIDs: ['d'], updated: ['b'],
    });
    expect(initial.entities.get('b')).not.toBe(ordinary.entities.get('b'));
  });

  it('releases only the exact settled prefix and defers later older facts', () => {
    const admission = createAdmissionAuthority();
    const active = token({ demandUnits: 1 });
    admission.begin('channel', active);
    const settledCandidate = [item('a', 10), item('b', 20), item('c', 30)];
    admission.observe('channel', settledCandidate, meta(12));
    const committed = admission.settle('channel');
    expect(ids(commitAdmission(admission, 'channel', settledCandidate, meta(12)))).toEqual(['b', 'c']);
    admission.prepareCommit('channel', {
      revision: 11, sourceRevision: 12,
      rows: [{ id: 'b', body: item('b', 20) }, { id: 'c', body: item('c', 30) }],
    });

    const racedCandidate = [item('x', 5), ...settledCandidate];
    expect(ids(commitAdmission(admission, 'channel', racedCandidate, meta(13)))).toEqual(['a', 'b', 'c']);
    expect(admission.snapshot('channel').committed.stagedIDs).toEqual(['a']);
    expect(admission.acknowledge('channel', committed.commitID)).toBe(true);
    expect(admission.snapshot('channel')).toMatchObject({
      phase: 'holding', stagedIDs: ['x'], completeUnits: 1,
    });

    admission.begin('channel', token({ operationID: 'history:activation-1:2', demandUnits: 1 }));
    expect(admission.observe(
      'channel', racedCandidate, meta(13, 'history:activation-1:2'),
    )).toMatchObject({
      stagedIDs: ['x'], completeUnits: 1, fulfilled: true,
    });
  });

  it('keeps deferred prefix held when newer input cancels an already published commit', () => {
    const admission = createAdmissionAuthority();
    const active = token({ demandUnits: 1 });
    admission.begin('channel', active);
    const settledCandidate = [item('a', 10), item('b', 20), item('c', 30)];
    admission.observe('channel', settledCandidate, meta(12));
    admission.settle('channel');
    expect(ids(commitAdmission(admission, 'channel', settledCandidate, meta(12)))).toEqual(['b', 'c']);
    admission.prepareCommit('channel', {
      revision: 11, sourceRevision: 12,
      rows: [{ id: 'b', body: item('b', 20) }, { id: 'c', body: item('c', 30) }],
    });
    expect(ids(commitAdmission(admission,
      'channel', [item('x', 5), ...settledCandidate], meta(13),
    ))).toEqual(['a', 'b', 'c']);

    expect(admission.cancel('channel', active.operationID)).toBe(true);
    expect(admission.snapshot('channel')).toMatchObject({
      phase: 'holding', stagedIDs: ['x'], committed: null,
    });
    expect(ids(commitAdmission(admission,
      'channel', [item('x', 5), ...settledCandidate], meta(13),
    ))).toEqual(['a', 'b', 'c']);
    expect(admission.advanceInputEpoch('channel', {
      operationID: active.operationID, activationID: active.activationID,
      direction: 'older', inputEpoch: 9, currentInputEpoch: 9,
    })).toBeNull();
  });

  it('ignores a late old-operation observation after a new-view token begins', () => {
    const admission = createAdmissionAuthority();
    const oldToken = token();
    admission.begin('channel', oldToken);
    const newToken = token({
      operationID: 'history:activation-2:1', activationID: 'activation-2',
      viewID: 'channel:mine:new-agent', epoch: 'channel:8', baselineIDs: [],
    });
    admission.begin('channel', newToken);

    expect(admission.observe('channel', [item('old', 1)], {
      operationID: oldToken.operationID,
      viewID: oldToken.viewID,
      epoch: oldToken.epoch,
      sourceRevision: 14,
    })).toMatchObject({ stale: true });
    expect(admission.snapshot('channel')).toMatchObject({
      phase: 'pending',
      token: { operationID: newToken.operationID, activationID: newToken.activationID },
    });
  });

  it('uses a durable feed baseline without hiding a UI-only local echo tail', () => {
    const admission = createAdmissionAuthority();
    const echo = { id: 'local-echo', kind: 'turn', local: true };
    admission.begin('channel', token({
      uiBaselineIDs: ['b', 'local-echo'],
      durableBaselineIDs: ['b'],
      demandUnits: 1,
    }));
    expect(ids(commitAdmission(admission, 'channel', [item('b', 20), echo], meta(11))))
      .toEqual(['b', 'local-echo']);
    expect(admission.observe('channel', [item('a', 10), item('b', 20)], meta(12)))
      .toMatchObject({ stagedIDs: ['a'], completeUnits: 1, fulfilled: true, rebased: false });
    expect(ids(commitAdmission(admission, 'channel', [item('a', 10), item('b', 20), echo], meta(12))))
      .toEqual(['b', 'local-echo']);
    admission.settle('channel');
    admission.prepareCommit('channel', {
      revision: 11, sourceRevision: 12,
      rows: [{ id: 'b', body: item('b', 20) }, { id: 'local-echo', body: echo }],
    });
    expect(ids(commitAdmission(admission, 'channel', [item('a', 10), item('b', 20), echo], meta(12))))
      .toEqual(['a', 'b', 'local-echo']);
  });

  // Production wedge, pinned at this module's boundary (agent B, 2026-09-18):
  // useReadingSession routes both renewal and cancellation through
  // runwayRequestRef, which it clears in the request promise's .finally() at
  // history.intent_satisfied. This operation is still open for two more
  // phases after that, so any further input arrives with no handle and the
  // token silently falls behind the reading session's inputEpoch, which is
  // what Timeline's exactOwner gate compares. The authority itself always
  // carries the handle needed to reach it; these assertions are the contract
  // the delivery-side fix is allowed to rely on.
  it('remains addressable for renewal and cancellation after its request has settled', () => {
    const active = token({ demandUnits: 1 });
    const baseline = [item('b', 20), item('c', 30)];
    const withOlder = [item('a', 10), ...baseline];
    const baselineRows = [{ id: 'b', body: item('b', 20) }, { id: 'c', body: item('c', 30) }];

    const renewing = createAdmissionAuthority();
    renewing.begin('channel', active);
    commitAdmission(renewing, 'channel', baseline, meta(11));
    renewing.observe('channel', withOlder, meta(12));
    renewing.settle('channel');
    commitAdmission(renewing, 'channel', withOlder, meta(12));
    expect(renewing.prepareCommit('channel', {
      revision: 12, sourceRevision: 12, rows: baselineRows,
    })).toBe(true);

    // The request is over; the operation is not. Its own snapshot is the
    // handle, and it names the same operation the request used to name.
    const open = renewing.snapshot('channel');
    expect(open.phase).toBe('committed-awaiting-layout');
    expect(open.token.operationID).toBe(active.operationID);
    expect(renewing.snapshot('channel').committed.inputEpoch).toBe(2);

    // Continued older input renewed through that handle keeps the bound token
    // level with the reading session, so exactOwner can still pass.
    expect(renewing.advanceInputEpoch('channel', {
      operationID: open.token.operationID,
      activationID: open.token.activationID,
      direction: 'older',
      inputEpoch: 3,
      currentInputEpoch: 3,
    })).toEqual(expect.objectContaining({ fromInputEpoch: 2, toInputEpoch: 3 }));
    expect(renewing.snapshot('channel').committed.inputEpoch).toBe(3);
    expect(renewing.acknowledge('channel', renewing.snapshot('channel').committed.commitID)).toBe(true);
    expect(renewing.snapshot('channel').phase).toBe('idle');

    // Reverse input reaches the same operation through the same handle and
    // retires it, so a blocked demand is never left with no way out.
    const cancelling = createAdmissionAuthority();
    cancelling.begin('channel', active);
    commitAdmission(cancelling, 'channel', baseline, meta(11));
    cancelling.observe('channel', withOlder, meta(12));
    cancelling.settle('channel');
    commitAdmission(cancelling, 'channel', withOlder, meta(12));
    cancelling.prepareCommit('channel', { revision: 12, sourceRevision: 12, rows: baselineRows });
    expect(cancelling.snapshot('channel').phase).toBe('committed-awaiting-layout');
    expect(cancelling.cancel('channel', cancelling.snapshot('channel').token.operationID)).toBe(true);
    expect(cancelling.snapshot('channel').phase).toBe('idle');
  });

  it('keeps a local-only UI baseline visible while durable history is staged', () => {
    const admission = createAdmissionAuthority();
    const echo = { id: 'local-echo', kind: 'turn', local: true };
    admission.begin('channel', token({
      uiBaselineIDs: ['local-echo'], durableBaselineIDs: [], demandUnits: 1,
    }));
    expect(ids(commitAdmission(admission, 'channel', [echo], meta(11)))).toEqual(['local-echo']);
    expect(admission.observe('channel', [item('a', 10)], meta(12)))
      .toMatchObject({ stagedIDs: ['a'], completeUnits: 1, fulfilled: true });
    expect(ids(commitAdmission(admission, 'channel', [item('a', 10), echo], meta(12))))
      .toEqual(['local-echo']);
  });
});
