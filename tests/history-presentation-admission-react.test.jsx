// @vitest-environment jsdom

import React, { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createHistoryPresentationAdmission } from '../src/model/history-presentation-admission.js';

const item = (id, seq) => ({
  kind: 'standalone',
  seq,
  envelope: { id, seq, sender: { id: 'agent:test:1' }, payload: { text: id } },
});

const token = {
  activationID: 'activation-1',
  inputEpoch: 2,
  operationID: 'history:activation-1:1',
  viewID: 'channel:mine:agent',
  epoch: 'channel:7',
  baselineIDs: Object.freeze(['b', 'c']),
  demandUnits: 1,
};

const meta = (sourceRevision) => ({
  operationID: token.operationID,
  viewID: token.viewID,
  epoch: token.epoch,
  sourceRevision,
});

function commitAdmission(authority, items, admissionMeta) {
  const candidate = authority.evaluate('channel', items, admissionMeta);
  expect(authority.commitCandidate('channel', candidate)).toBe(true);
  return candidate.items;
}

describe('history presentation admission React ownership', () => {
  it('does not move a pending owner to holding from a suspended render', () => {
    const admission = createHistoryPresentationAdmission();
    admission.begin('channel', token, [item('b', 20), item('c', 30)]);
    const never = new Promise(() => {});

    function DiscardedCandidate() {
      admission.evaluate('channel', [item('c', 30)], meta(12));
      throw never;
    }

    render(
      <Suspense fallback={<div>pending fallback</div>}>
        <DiscardedCandidate />
      </Suspense>,
    );
    expect(screen.getByText('pending fallback')).toBeTruthy();
    expect(admission.snapshot('channel').phase).toBe('pending');
  });

  it('does not publish a candidate from a suspended render', () => {
    const admission = createHistoryPresentationAdmission();
    const baseline = [item('b', 20), item('c', 30)];
    const candidate = [item('a', 10), ...baseline];

    admission.begin('channel', token, baseline);
    commitAdmission(admission, baseline, meta(11));
    admission.observe('channel', candidate, meta(12));
    admission.settle('channel');
    commitAdmission(admission, candidate, meta(12));
    admission.prepareCommit('channel', {
      revision: 11,
      sourceRevision: 12,
      rows: baseline.map((body) => ({ id: body.envelope.id, body })),
    });
    const commitID = admission.snapshot('channel').committed.commitID;

    const never = new Promise(() => {});
    function DiscardedCandidate() {
      admission.evaluate('channel', [item('x', 5), ...candidate], meta(13));
      throw never;
    }

    render(
      <Suspense fallback={<div>fallback</div>}>
        <DiscardedCandidate />
      </Suspense>,
    );
    expect(screen.getByText('fallback')).toBeTruthy();

    // The already-committed tree may acknowledge while React retains the old
    // UI. A discarded candidate must not become deferred history authority.
    expect(admission.acknowledge('channel', commitID)).toBe(true);
    expect(admission.snapshot('channel').phase).toBe('idle');
  });
});
