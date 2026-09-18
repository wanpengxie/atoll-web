import { describe, expect, it } from 'vitest';
import {
  abandonFoldAdmission,
  acknowledgeFoldItemSize,
  commitFoldChoice,
  createFoldAdmissionState,
  foldSizeMVCPEnabled,
  replaceFoldActivation,
  requestFoldChoice,
} from '../src/model/fold-admission.js';

function choose(state, nextExpanded, overrides = {}) {
  return requestFoldChoice(state, {
    foldID: 'm:with:colon:response',
    itemKey: 'm:with:colon',
    currentExpanded: !nextExpanded,
    nextExpanded,
    ...overrides,
  });
}

function commit(state, choice) {
  return commitFoldChoice(state, choice).state;
}

describe('fold size admission', () => {
  it('disables size MVCP only for an expand commit and closes on its matching growth ack', () => {
    const opened = choose(createFoldAdmissionState({ activationID: 'a:1' }), true);
    expect(opened.changed).toBe(true);
    expect(opened.choice).toMatchObject({
      activationID: 'a:1', choiceRevision: 1, itemKey: 'm:with:colon', direction: 'expand', commitSeen: false,
    });
    expect(foldSizeMVCPEnabled(opened.state)).toBe(false);

    const beforeCommit = acknowledgeFoldItemSize(opened.state, {
      stamp: opened.choice, itemKey: 'm:with:colon', previousSize: 100, size: 400,
    });
    expect(beforeCommit).toMatchObject({ accepted: false, reason: 'choice-not-committed' });

    const committed = commit(opened.state, opened.choice);
    const acknowledged = acknowledgeFoldItemSize(committed, {
      ...committed.pendingChoice, itemKey: 'm:with:colon', previousSize: 100, size: 400,
    });
    expect(acknowledged).toMatchObject({ accepted: true, reason: 'matching-item-size' });
    expect(acknowledged.state.admission).toBeNull();
    expect(acknowledged.state.pendingChoice).toBeNull();
    expect(foldSizeMVCPEnabled(acknowledged.state)).toBe(true);
  });

  it('keeps collapse on normal size MVCP and records its shrink acknowledgement', () => {
    const initial = createFoldAdmissionState({
      activationID: 'a:1', choices: [['m:with:colon:response', true]],
    });
    const collapsed = choose(initial, false);
    expect(collapsed.reason).toBe('collapse');
    expect(collapsed.state.admission).toBeNull();
    expect(foldSizeMVCPEnabled(collapsed.state)).toBe(true);

    const committed = commit(collapsed.state, collapsed.choice);
    const acknowledged = acknowledgeFoldItemSize(committed, {
      stamp: committed.pendingChoice, itemKey: 'm:with:colon', previous: 400, size: 100,
    });
    expect(acknowledged.accepted).toBe(true);
    expect(acknowledged.state.acknowledgedChoices.get('m:with:colon:response')).toBe(false);
  });

  it('closes expand admission synchronously when a rapid inverse returns to acknowledged geometry', () => {
    const expanded = choose(createFoldAdmissionState({ activationID: 'a:1' }), true);
    const committedExpansion = commit(expanded.state, expanded.choice);
    const collapsed = choose(committedExpansion, false, { currentExpanded: true });
    expect(collapsed).toMatchObject({ changed: true, reason: 'superseded-no-net-choice' });
    expect(collapsed.state.admission).toBeNull();
    expect(collapsed.state.pendingChoice).toBeNull();
    expect(foldSizeMVCPEnabled(collapsed.state)).toBe(true);

    const stale = acknowledgeFoldItemSize(collapsed.state, {
      stamp: committedExpansion.pendingChoice,
      itemKey: 'm:with:colon', previousSize: 100, size: 400,
    });
    expect(stale.accepted).toBe(false);
  });

  it('does not create a revision or admission for the same visible choice', () => {
    const initial = createFoldAdmissionState({ activationID: 'a:1' });
    const result = choose(initial, false, { currentExpanded: false });
    expect(result).toMatchObject({ changed: false, reason: 'same-choice', state: initial });
    expect(foldSizeMVCPEnabled(result.state)).toBe(true);
  });

  it('cannot let a stale activation or superseded item ack consume the current token', () => {
    const a1 = choose(createFoldAdmissionState({ activationID: 'a:1' }), true);
    const oldCommitted = commit(a1.state, a1.choice);
    const a2Base = replaceFoldActivation(oldCommitted, 'a:2');
    const reset = choose(a2Base, false, { currentExpanded: true });
    const resetCommitted = commit(reset.state, reset.choice);
    const resetAcknowledged = acknowledgeFoldItemSize(resetCommitted, {
      stamp: resetCommitted.pendingChoice,
      itemKey: 'm:with:colon', previousSize: 400, size: 100,
    }).state;
    const a2 = choose(resetAcknowledged, true, { currentExpanded: false });
    const currentCommitted = commit(a2.state, a2.choice);

    const stale = acknowledgeFoldItemSize(currentCommitted, {
      stamp: oldCommitted.pendingChoice,
      itemKey: 'm:with:colon', previousSize: 100, size: 400,
    });
    expect(stale).toMatchObject({ accepted: false, reason: 'stale-choice' });
    expect(stale.state.admission.token).toBe(currentCommitted.admission.token);

    const wrongItem = acknowledgeFoldItemSize(currentCommitted, {
      stamp: currentCommitted.pendingChoice,
      itemKey: 'another-row', previousSize: 100, size: 400,
    });
    expect(wrongItem).toMatchObject({ accepted: false, reason: 'wrong-item' });
    const wrongSign = acknowledgeFoldItemSize(currentCommitted, {
      stamp: currentCommitted.pendingChoice,
      itemKey: 'm:with:colon', previousSize: 400, size: 100,
    });
    expect(wrongSign).toMatchObject({ accepted: false, reason: 'wrong-direction' });
  });

  it('restores normal policy when the owning list unmounts', () => {
    const opened = choose(createFoldAdmissionState({ activationID: 'a:1' }), true);
    const abandoned = abandonFoldAdmission(opened.state);
    expect(abandoned.admission).toBeNull();
    expect(abandoned.pendingChoice).toBeNull();
    expect(foldSizeMVCPEnabled(abandoned)).toBe(true);
  });
});
