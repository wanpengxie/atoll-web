import { describe, expect, it } from 'vitest';
import { createConversationPresentation } from '../src/model/conversation-presentation.js';

const message = (id, seq, type = 'project.task', extra = {}) => ({
  kind: 'standalone',
  seq,
  ...extra,
  envelope: {
    id,
    seq,
    ts: seq * 1_000,
    type,
    sender: { id: 'agent-a' },
    payload: { body: { text: id } },
  },
});

function publish(owner, entries, sourceRevision) {
  const candidate = owner.evaluate(entries, {
    nextViewID: 'c0:all',
    epoch: 'generation:39',
    sourceRevision,
  });
  expect(owner.commitCandidate(candidate)).toBe(true);
  return candidate.snapshot;
}

describe('S-Z current Presentation role-owner boundary', () => {
  it('publishes the current-entry candidate without materializing a role field', () => {
    const projector = createConversationPresentation();
    const snapshot = publish(projector, [
      message('old', 1),
      message('latest', 2, 'project.task', { role: { latest: true } }),
    ], 2);

    expect(snapshot.currentEntryCandidate).toEqual({ id: 'latest', seqHigh: 2, local: false });
    expect(snapshot.rows.map((row) => row.id)).toEqual(['old', 'latest']);
    expect(snapshot.rows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'role'))).toBe(true);
    expect(snapshot.entities.get('latest').visualSlotID).toBe('latest');
  });

  it('does not promote a control-only tail or its removed role marker to current entry', () => {
    const projector = createConversationPresentation();
    const snapshot = publish(projector, [
      message('latest', 1),
      message('control', 2, 'agent.hold_expired', { role: { latest: true } }),
    ], 2);

    expect(snapshot.currentEntryCandidate).toEqual({ id: 'latest', seqHigh: 1, local: false });
    expect(snapshot.entities.get('control')).not.toHaveProperty('role');
  });

  it('keeps projection receipt consumption one-shot without exposing a role receipt', () => {
    const projector = createConversationPresentation();
    const first = publish(projector, [message('first', 1)], 1);
    const candidate = projector.evaluate([message('first', 1), message('second', 2)], {
      nextViewID: 'c0:all',
      epoch: 'generation:39',
      sourceRevision: 2,
    });

    expect(projector.current()).toBe(first);
    expect(candidate.snapshot.currentEntryCandidate).toEqual({ id: 'second', seqHigh: 2, local: false });
    expect(projector.commitCandidate(candidate)).toBe(true);
    expect(projector.commitCandidate(candidate)).toBe(false);
    expect(projector.current()).toBe(candidate.snapshot);
    expect(candidate.snapshot).not.toHaveProperty('roleRevision');
    expect(candidate.snapshot).not.toHaveProperty('roleChanges');
  });
});
