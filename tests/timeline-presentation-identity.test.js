import { describe, expect, it } from 'vitest';
import {
  createConversationPresentation,
  createConversationRoleFinalizer,
  finalizeConversationPresentation,
  presentationEntryId,
  presentationGeometryKey,
} from '../src/model/conversation-presentation.js';

const message = (id, seq, text = id, sender = 'agent-a') => ({
  kind: 'standalone', seq,
  envelope: { id, seq, ts: seq * 1_000, sender: { id: sender }, payload: { text } },
});

describe('immutable conversation presentation', () => {
  it('uses semantic identities independent from array position', () => {
    const current = message('m2', 2);
    expect([current].map(presentationEntryId)).toEqual([message('m1', 1), current].slice(1).map(presentationEntryId));
  });

  it('classifies prepend, append, and mixed commits', () => {
    const projector = createConversationPresentation();
    const m2 = message('m2', 2);
    const m3 = message('m3', 3);
    const initial = projector.project([m2], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1 });
    const prepend = projector.project([message('m1', 1), m2], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 2 });
    expect(prepend.changes).toMatchObject({ kind: 'prepend', prefixCount: 1 });
    expect(prepend.entities.get('m2')).toBe(initial.entities.get('m2'));
    const append = projector.project([message('m1', 1), m2, m3], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 3 });
    expect(append.changes.kind).toBe('append');
    const mixed = projector.project([m3, m2], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 4 });
    expect(mixed.changes.kind).toBe('mixed');
  });

  it('reports simultaneous front and back insertions as orthogonal mixed structure', () => {
    const projector = createConversationPresentation();
    const b = message('b', 2);
    const c = message('c', 3);
    const initial = projector.project([b, c], {
      nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1,
    });
    const mixed = projector.project([message('a', 1), b, c, message('d', 4)], {
      nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 2,
    });
    expect(mixed.changes).toMatchObject({
      kind: 'mixed', prefixCount: 1, frontInsertedIDs: ['a'], backInsertedIDs: ['d'],
    });
    expect(mixed.firstItemIndex).toBe(initial.firstItemIndex - 1);
  });

  it('keeps prepend structure orthogonal from an existing-row revision', () => {
    const projector = createConversationPresentation();
    const b = message('b', 2, 'before');
    projector.project([b], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1 });
    const updatedB = message('b', 2, 'after');
    const next = projector.project([message('a', 1), updatedB], {
      nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 2,
      sourceChanges: [{ revision: 2, id: 'b', kind: 'content' }],
    });
    expect(next.changes).toMatchObject({
      kind: 'prepend', frontInsertedIDs: ['a'], backInsertedIDs: [], updated: ['b'],
    });
  });

  it('detaches published rows from mutable replica entries', () => {
    const projector = createConversationPresentation();
    const entry = message('m1', 1, 'before');
    const snapshot = projector.project([entry], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1 });
    entry.envelope.payload.text = 'after';
    expect(snapshot.entities.get('m1').body.envelope.payload.text).toBe('before');
    expect(Object.isFrozen(snapshot.entities.get('m1').body)).toBe(true);
    expect(snapshot.entities).not.toHaveProperty('set');
  });

  it('does not reinterpret the old window head when a predecessor arrives', () => {
    const projector = createConversationPresentation();
    const current = message('m2', 2);
    const initial = projector.project([current], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1 });
    const prepended = projector.project([message('m1', 1), current], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 2 });
    expect(prepended.entities.get('m2')).toBe(initial.entities.get('m2'));
    expect(prepended.entities.get('m2').continuation).toBe(false);
  });

  it('publishes consumed source readiness without rewriting unchanged rows or geometry', () => {
    const projector = createConversationPresentation();
    const entry = message('m1', 1);
    const initial = projector.project([entry], {
      nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1,
    });
    const advanced = projector.project([entry], {
      nextViewID: 'c0:all',
      epoch: 'p:b',
      sourceRevision: 2,
      sourceChanges: [{ revision: 2, id: 'hidden-protocol-fact', kind: 'content' }],
    });
    const structurallyAdvanced = projector.project([entry], {
      nextViewID: 'c0:all',
      epoch: 'p:b',
      sourceRevision: 3,
      sourceChanges: [{ revision: 3, id: 'hidden-structural-fact', kind: 'structure' }],
    });

    expect(advanced).not.toBe(initial);
    expect(advanced.sourceRevision).toBe(2);
    expect(advanced.revision).toBe(initial.revision);
    expect(advanced.rows).toBe(initial.rows);
    expect(advanced.entities).toBe(initial.entities);
    expect(advanced.entities.get('m1')).toBe(initial.entities.get('m1'));
    expect(structurallyAdvanced.sourceRevision).toBe(3);
    expect(structurallyAdvanced.revision).toBe(initial.revision);
    expect(structurallyAdvanced.rows).toBe(initial.rows);
    expect(structurallyAdvanced.entities.get('m1')).toBe(initial.entities.get('m1'));
  });

  it('includes content and local layout decisions in the geometry key', () => {
    const rows = [{ id: 'm1', contentRevision: '1:0', layoutClass: 'normal' }];
    expect(presentationGeometryKey(rows, 'fold:0')).not.toBe(presentationGeometryKey([{ ...rows[0], contentRevision: '2:0' }], 'fold:0'));
    expect(presentationGeometryKey(rows, 'fold:0')).not.toBe(presentationGeometryKey(rows, 'fold:1'));
  });

  it('publishes latest only from an exact authority token and keeps role out of geometry', () => {
    const projector = createConversationPresentation();
    const snapshot = projector.project([message('m1', 1), message('m2', 2)], {
      nextViewID: 'c0:all', epoch: 'generation:4', sourceRevision: 9,
    });
    expect(snapshot.currentEntryCandidate).toEqual({ id: 'm2', seqHigh: 2, local: false });
    expect(snapshot.rows.every((row) => row.role.latest === false)).toBe(true);

    const authority = { epoch: 'generation:4', viewID: 'c0:all', sourceRevision: 9, candidateID: 'm2' };
    const finalized = finalizeConversationPresentation(snapshot, authority);
    expect(finalized.entities.get('m1')).toBe(snapshot.entities.get('m1'));
    expect(finalized.entities.get('m2')).not.toBe(snapshot.entities.get('m2'));
    expect(finalized.entities.get('m2').role.latest).toBe(true);
    expect(finalized.revision).toBe(snapshot.revision);
    expect(finalized.entities.get('m2').contentRevision).toBe(snapshot.entities.get('m2').contentRevision);
    expect(presentationGeometryKey(finalized.rows)).toBe(presentationGeometryKey(snapshot.rows));
    expect(finalizeConversationPresentation(snapshot, authority).entities.get('m2').role.latest).toBe(true);
    expect(finalizeConversationPresentation(snapshot, { ...authority, epoch: 'generation:3' })).toBe(snapshot);
    expect(finalizeConversationPresentation(snapshot, { ...authority, sourceRevision: 8 })).toBe(snapshot);
  });

  it('keeps the same candidate across prepend and excludes control-only tail rows', () => {
    const projector = createConversationPresentation();
    const current = message('m2', 20);
    const initial = projector.project([current], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 20,
    });
    const control = {
      kind: 'standalone', seq: 21,
      envelope: { id: 'expired', type: 'agent.hold_expired', seq: 21, sender: { id: 'system' }, payload: {} },
    };
    const prepended = projector.project([message('m1', 10), current, control], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 21,
    });
    expect(initial.currentEntryCandidate.id).toBe('m2');
    expect(prepended.currentEntryCandidate.id).toBe('m2');
    expect(prepended.entities.get('m2')).toBe(initial.entities.get('m2'));
  });

  it('publishes exact role deltas on a separate monotonic revision', () => {
    const projector = createConversationPresentation();
    const roles = createConversationRoleFinalizer();
    const initial = projector.project([message('m1', 1)], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 1,
    });
    const none = roles.finalize(initial, null);
    expect(none).toMatchObject({ roleRevision: 0, roleChanges: { updated: [] } });

    const m1 = roles.finalize(initial, {
      epoch: initial.epoch, viewID: initial.viewID, sourceRevision: 1, candidateID: 'm1',
    });
    expect(m1).toMatchObject({ roleRevision: 1, roleChanges: { updated: ['m1'] } });
    expect(roles.finalize(initial, {
      epoch: initial.epoch, viewID: initial.viewID, sourceRevision: 1, candidateID: 'm1',
    })).toBe(m1);

    const appended = projector.project([message('m1', 1), message('m2', 2)], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 2,
    });
    const m2 = roles.finalize(appended, {
      epoch: appended.epoch, viewID: appended.viewID, sourceRevision: 2, candidateID: 'm2',
    });
    expect(m2).toMatchObject({ roleRevision: 2, roleChanges: { updated: ['m1', 'm2'] } });
    expect(m2.entities.get('m1').role.latest).toBe(false);
    expect(m2.entities.get('m2').role.latest).toBe(true);
    expect(m2.revision).toBe(appended.revision);
    expect(presentationGeometryKey(m2.rows)).toBe(presentationGeometryKey(appended.rows));

    const revoked = roles.finalize(appended, null);
    expect(revoked).toMatchObject({ roleRevision: 3, roleChanges: { updated: ['m2'] } });
    expect(revoked.entities.get('m2').role.latest).toBe(false);
    const restored = roles.finalize(appended, {
      epoch: appended.epoch, viewID: appended.viewID, sourceRevision: 2, candidateID: 'm2',
    });
    expect(restored).toMatchObject({ roleRevision: 4, roleChanges: { updated: ['m2'] } });
    expect(restored.entities.get('m2').role.latest).toBe(true);
  });

  it('publishes a projection candidate exactly once after commit', () => {
    const projector = createConversationPresentation();
    const initial = projector.project([message('a', 1)], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 1,
    });
    const candidate = projector.evaluate([message('a', 1), message('b', 2)], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 2,
    });

    expect(projector.current()).toBe(initial);
    expect(candidate.snapshot.changes).toMatchObject({ kind: 'append', inserted: ['b'] });
    expect(projector.commitCandidate(candidate)).toBe(true);
    expect(projector.current()).toBe(candidate.snapshot);
    expect(projector.commitCandidate(candidate)).toBe(false);
    expect(projector.current().revision).toBe(initial.revision + 1);
  });

  it('publishes a latest-role candidate exactly once after commit', () => {
    const projector = createConversationPresentation();
    const roles = createConversationRoleFinalizer();
    const snapshot = projector.project([message('a', 1)], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 1,
    });
    const candidate = roles.evaluate(snapshot, {
      epoch: snapshot.epoch, viewID: snapshot.viewID,
      sourceRevision: snapshot.sourceRevision, candidateID: 'a',
    });

    expect(roles.current()).toBeNull();
    expect(candidate.snapshot).toMatchObject({ roleRevision: 1, roleChanges: { updated: ['a'] } });
    expect(roles.commitCandidate(candidate)).toBe(true);
    expect(roles.current()).toBe(candidate.snapshot);
    expect(roles.commitCandidate(candidate)).toBe(false);
    expect(roles.current().roleRevision).toBe(1);
  });
});
