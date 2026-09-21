import { describe, expect, it } from 'vitest';
import {
  createConversationPresentation,
  presentationEntryId,
} from '../src/model/conversation-presentation.js';

function publish(owner, entries, options) {
  const candidate = owner.evaluate(entries, options);
  expect(owner.commitCandidate(candidate)).toBe(true);
  return candidate.snapshot;
}

const message = (id, seq, text = id, sender = 'agent-a') => ({
  kind: 'standalone', seq,
  envelope: { id, seq, ts: seq * 1_000, sender: { id: sender }, payload: { body: { text } } },
});

const turnEntry = (id, seq, {
  target = '',
  replacedBy = '',
  type = target ? 'agent.replace' : 'project.task',
  thread = [],
} = {}) => ({
  kind: 'turn', seq, thread,
  turn: {
    requestId: id,
    requestSeq: seq,
    lastSeq: replacedBy ? seq + 1 : seq,
    provisional: [],
    request: {
      id, seq, kind: 'request', type, ts: seq * 1_000,
      sender: { id: 'human-a' }, audience: ['agent-a'],
      payload: { body: target ? { target } : {} },
    },
    terminal: replacedBy ? {
      id: `${id}:terminal`, seq: seq + 1, kind: 'response', type,
      parent_id: id, sender: { id: 'agent-a' }, payload: { body: { status: 'completed', replaced_by: replacedBy } },
    } : null,
    terminalSeq: replacedBy ? seq + 1 : 0,
  },
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
    const initial = publish(projector, [m2], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1 });
    const prepend = publish(projector, [message('m1', 1), m2], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 2 });
    expect(prepend.changes).toMatchObject({ kind: 'prepend', prefixCount: 1 });
    expect(prepend.entities.get('m2')).toBe(initial.entities.get('m2'));
    const append = publish(projector, [message('m1', 1), m2, m3], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 3 });
    expect(append.changes.kind).toBe('append');
    const mixed = publish(projector, [m3, m2], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 4 });
    expect(mixed.changes.kind).toBe('mixed');
  });

  it('hands a visual slot only to a reciprocal replacement at the same committed row position', () => {
    const projector = createConversationPresentation();
    const old = turnEntry('old', 2, { replacedBy: 'new' });
    const initial = publish(projector, [message('before', 1), old, message('after', 4)], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 4,
    });
    const replacement = turnEntry('new', 5, { target: 'old' });
    const next = publish(projector, [message('before', 1), replacement, message('after', 4)], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 5,
    });

    expect(initial.entities.get('old')).toMatchObject({ id: 'old', visualSlotID: 'old' });
    expect(next.entities.get('new')).toMatchObject({ id: 'new', visualSlotID: 'old' });
    expect(next.changes).toMatchObject({ inserted: ['new'], removed: ['old'] });
  });

  it('keeps the replacement position relative to surviving rows across an unrelated prepend', () => {
    const projector = createConversationPresentation();
    publish(projector, [message('before', 2), turnEntry('old', 3, { replacedBy: 'new' }), message('after', 4)], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 4,
    });
    const next = publish(projector, [
      message('prepended', 1), message('before', 2), turnEntry('new', 5, { target: 'old' }), message('after', 4),
    ], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 5,
    });
    expect(next.entities.get('new')).toMatchObject({ id: 'new', visualSlotID: 'old' });
  });

  it('does not infer a visual slot from one-way protocol facts, reorders, or a new view epoch', () => {
    const oneWay = createConversationPresentation();
    publish(oneWay, [turnEntry('old', 1)], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 1,
    });
    const incomplete = publish(oneWay, [turnEntry('new', 2, { target: 'old' })], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 2,
    });
    expect(incomplete.entities.get('new').visualSlotID).toBe('new');

    const reorder = createConversationPresentation();
    const a = turnEntry('a', 1, { replacedBy: 'b' });
    const b = turnEntry('b', 2, { target: 'a' });
    publish(reorder, [a, b], { nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 2 });
    const swapped = publish(reorder, [b, a], { nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 3 });
    expect(swapped.entities.get('a').visualSlotID).toBe('a');
    expect(swapped.entities.get('b').visualSlotID).toBe('b');

    const rebase = createConversationPresentation();
    publish(rebase, [turnEntry('old', 1, { replacedBy: 'new' })], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 1,
    });
    const rebased = publish(rebase, [turnEntry('new', 2, { target: 'old' })], {
      nextViewID: 'c0:all', epoch: 'generation:2', sourceRevision: 2,
    });
    expect(rebased.entities.get('new').visualSlotID).toBe('new');
  });

  it('rebases committed identities when a new authority epoch reuses the same view', () => {
    const projector = createConversationPresentation();
    const first = publish(projector, [message('m1', 1), message('m2', 2)], {
      nextViewID: 'c0:all', epoch: 'generation:1:authority:1', sourceRevision: 2,
    });
    const second = publish(projector, [message('m1', 1), message('m2', 2), message('m3', 3)], {
      nextViewID: 'c0:all', epoch: 'generation:1:authority:2', sourceRevision: 3,
    });

    expect(second.changes.kind).toBe('rebase');
    expect(second.changes.inserted).toEqual(['m1', 'm2', 'm3']);
    expect(second.entities.get('m1')).not.toBe(first.entities.get('m1'));
  });

  it('retains the original visual slot across committed reciprocal replacement chains', () => {
    const projector = createConversationPresentation();
    publish(projector, [turnEntry('a', 1, { replacedBy: 'b' })], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 1,
    });
    const b = publish(projector, [turnEntry('b', 2, { target: 'a', replacedBy: 'c' })], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 2,
    });
    const c = publish(projector, [turnEntry('c', 3, { target: 'b' })], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 3,
    });
    expect(b.entities.get('b').visualSlotID).toBe('a');
    expect(c.entities.get('c').visualSlotID).toBe('a');
  });

  it('does not hand a stable child root slot to a replacement folded into another visual root', () => {
    const projector = createConversationPresentation();
    publish(projector, [turnEntry('child', 2, { replacedBy: 'replacement' })], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 2,
    });
    const replacement = turnEntry('replacement', 4, { target: 'child' });
    const parent = turnEntry('parent', 1, { thread: [replacement] });
    const next = publish(projector, [parent], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 4,
    });

    expect(next.orderedIDs).toEqual(['parent']);
    expect(next.entities.get('parent')).toMatchObject({ id: 'parent', visualSlotID: 'parent' });
    expect(next.entities.has('replacement')).toBe(false);
  });

  it('reports simultaneous front and back insertions as orthogonal mixed structure', () => {
    const projector = createConversationPresentation();
    const b = message('b', 2);
    const c = message('c', 3);
    const initial = publish(projector, [b, c], {
      nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1,
    });
    const mixed = publish(projector, [message('a', 1), b, c, message('d', 4)], {
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
    publish(projector, [b], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1 });
    const updatedB = message('b', 2, 'after');
    const next = publish(projector, [message('a', 1), updatedB], {
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
    const snapshot = publish(projector, [entry], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1 });
    entry.envelope.payload.body.text = 'after';
    expect(snapshot.entities.get('m1').body.envelope.payload.body.text).toBe('before');
    expect(Object.isFrozen(snapshot.entities.get('m1').body)).toBe(true);
    expect(snapshot.entities).not.toHaveProperty('set');
  });

  it('looks up one nested progress root without revisiting every committed entry', () => {
    const projector = createConversationPresentation();
    const rootIndex = 2_048;
    const rootRequest = {
      id: 'root', type: 'project.task', kind: 'request', seq: rootIndex + 1,
      ts: (rootIndex + 1) * 1_000, sender: { id: 'human-a' }, audience: ['agent-a'],
    };
    const childRequest = {
      id: 'child', type: 'tool.exec', kind: 'request', parent_id: rootRequest.id,
      seq: rootIndex + 2, ts: (rootIndex + 2) * 1_000,
      sender: { id: 'agent-a' }, audience: ['human-a'],
    };
    const childTurn = {
      requestId: childRequest.id, request: childRequest, requestSeq: childRequest.seq,
      lastSeq: childRequest.seq, provisional: [], terminal: null,
    };
    const rootEntry = {
      kind: 'turn', seq: rootRequest.seq,
      turn: {
        requestId: rootRequest.id, request: rootRequest, requestSeq: rootRequest.seq,
        lastSeq: childRequest.seq, provisional: [], terminal: null,
      },
      thread: [{ kind: 'turn', seq: childRequest.seq, turn: childTurn }],
    };
    const source = Array.from({ length: 4_096 }, (_, index) => message(`m${index}`, index + 1));
    source[rootIndex] = rootEntry;
    let entryVisits = 0;
    const entries = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) entryVisits += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const initial = publish(projector, entries, {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 1,
    });
    const initialRoot = initial.entities.get(rootRequest.id);
    const initialNeighbour = initial.entities.get(`m${rootIndex - 1}`);

    const progress = {
      id: 'progress', type: childRequest.type, kind: 'response', parent_id: childRequest.id,
      seq: 9_001, ts: 9_001_000, sender: { id: 'agent-a' },
      payload: { body: { status: 'processing', process: { kind: 'stage', text: 'working' } } },
    };
    // Fold owns and mutates this input turn in place. Presentation must read
    // that committed source fact while keeping the already-published snapshot
    // detached and immutable.
    childTurn.lastSeq = progress.seq;
    childTurn.provisional.push({ seq: progress.seq, envelope: progress });
    entryVisits = 0;
    const advanced = publish(projector, entries, {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 2,
      sourceChanges: [{ revision: 2, id: rootRequest.id, subjectID: childRequest.id, kind: 'content' }],
    });

    // Only candidate neighbours are read from the array. The root itself is
    // found through the committed owner index, independent of root count.
    expect(entryVisits).toBeLessThanOrEqual(2);
    expect(advanced.changes.updated).toEqual([rootRequest.id]);
    expect(advanced.entities.get(rootRequest.id)).not.toBe(initialRoot);
    expect(advanced.entities.get(`m${rootIndex - 1}`)).toBe(initialNeighbour);
    expect(initialRoot.body.thread[0].turn.provisional).toEqual([]);
    expect(advanced.entities.get(rootRequest.id).body.thread[0].turn.provisional[0].envelope.id).toBe('progress');

    const filteredProjector = createConversationPresentation();
    const filteredEntries = [{ ...rootEntry, thread: [] }];
    const filteredInitial = publish(filteredProjector, filteredEntries, {
      nextViewID: 'c0:mine', epoch: 'generation:1', sourceRevision: 1,
    });
    const filteredAdvanced = publish(filteredProjector, filteredEntries, {
      nextViewID: 'c0:mine', epoch: 'generation:1', sourceRevision: 2,
      sourceChanges: [{ revision: 2, id: rootRequest.id, subjectID: childRequest.id, kind: 'content' }],
    });
    expect(filteredAdvanced.sourceRevision).toBe(2);
    expect(filteredAdvanced.revision).toBe(filteredInitial.revision);
    expect(filteredAdvanced.rows).toBe(filteredInitial.rows);
    expect(filteredAdvanced.entities).toBe(filteredInitial.entities);
  });

  it('bounds structural subject lookup to one evaluate-local root scan', () => {
    const projector = createConversationPresentation();
    const rootCount = 4_096;
    const initialEntries = Array.from({ length: rootCount }, (_, index) => message(`m${index}`, index + 1));
    publish(projector, initialEntries, {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 1,
    });

    let entryVisits = 0;
    const replacementEntries = new Proxy([...initialEntries], {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) entryVisits += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const sourceChanges = Array.from({ length: 128 }, (_, index) => ({
      revision: index + 2,
      id: `m${rootCount - 1}`,
      subjectID: `m${rootCount - 1}`,
      kind: 'structure',
    }));
    const rebuilt = publish(projector, replacementEntries, {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 129, sourceChanges,
    });

    // One local lookup-index pass plus the existing rebuild/candidate-neighbour
    // reads stays O(N), rather than one Array.find scan per change (O(N*K)).
    expect(entryVisits).toBeLessThan(rootCount * 5);
    expect(rebuilt.sourceRevision).toBe(129);
    expect(rebuilt.changes.updated).toEqual([`m${rootCount - 1}`]);
  });

  it('does not reinterpret the old window head when a predecessor arrives', () => {
    const projector = createConversationPresentation();
    const current = message('m2', 2);
    const initial = publish(projector, [current], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1 });
    const prepended = publish(projector, [message('m1', 1), current], { nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 2 });
    expect(prepended.entities.get('m2')).toBe(initial.entities.get('m2'));
    expect(prepended.entities.get('m2').continuation).toBe(false);
  });

  it('publishes consumed source readiness without rewriting unchanged rows or geometry', () => {
    const projector = createConversationPresentation();
    const entry = message('m1', 1);
    const initial = publish(projector, [entry], {
      nextViewID: 'c0:all', epoch: 'p:b', sourceRevision: 1,
    });
    const advanced = publish(projector, [entry], {
      nextViewID: 'c0:all',
      epoch: 'p:b',
      sourceRevision: 2,
      sourceChanges: [{ revision: 2, id: 'hidden-protocol-fact', kind: 'content' }],
    });
    const structurallyAdvanced = publish(projector, [entry], {
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

  it('publishes the current-entry candidate without mutating row geometry', () => {
    const projector = createConversationPresentation();
    const snapshot = publish(projector, [message('m1', 1), message('m2', 2)], {
      nextViewID: 'c0:all', epoch: 'generation:4', sourceRevision: 9,
    });
    expect(snapshot.currentEntryCandidate).toEqual({ id: 'm2', seqHigh: 2, local: false });
    expect(snapshot.rows).toEqual([snapshot.entities.get('m1'), snapshot.entities.get('m2')]);
  });

  it('keeps the same candidate across prepend and excludes control-only tail rows', () => {
    const projector = createConversationPresentation();
    const current = message('m2', 20);
    const initial = publish(projector, [current], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 20,
    });
    const control = {
      kind: 'standalone', seq: 21,
      envelope: { id: 'expired', type: 'agent.hold_expired', seq: 21, sender: { id: 'system' }, payload: { body: {} } },
    };
    const prepended = publish(projector, [message('m1', 10), current, control], {
      nextViewID: 'c0:all', epoch: 'generation:1', sourceRevision: 21,
    });
    expect(initial.currentEntryCandidate.id).toBe('m2');
    expect(prepended.currentEntryCandidate.id).toBe('m2');
    expect(prepended.entities.get('m2')).toBe(initial.entities.get('m2'));
  });

  it('publishes a projection candidate exactly once after commit', () => {
    const projector = createConversationPresentation();
    const initial = publish(projector, [message('a', 1)], {
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

});
