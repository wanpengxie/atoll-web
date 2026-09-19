// @vitest-environment jsdom

import React, { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createConversationPresentation } from '../src/model/conversation-presentation.js';

const message = (id, seq) => ({
  kind: 'standalone',
  seq,
  envelope: { id, seq, ts: seq * 1_000, sender: { id: 'agent-a' }, payload: { text: id } },
});

function projectionCandidate(projector, entries, options) {
  if (!projector.evaluate) return { snapshot: projector.project(entries, options), receipt: null };
  return projector.evaluate(entries, options);
}

function committedProjection(projector, entries, options) {
  const candidate = projectionCandidate(projector, entries, options);
  projector.commitCandidate?.(candidate);
  return candidate.snapshot;
}

describe('conversation presentation React ownership', () => {
  it('does not rebase the committed view after a different view suspends', () => {
    const projector = createConversationPresentation();
    const a = message('a', 1);
    const initial = committedProjection(projector, [a], {
      nextViewID: 'channel:mine:a', epoch: 'generation:1', sourceRevision: 1,
    });
    const never = new Promise(() => {});

    function DiscardedView() {
      projectionCandidate(projector, [message('b', 2)], {
        nextViewID: 'channel:mine:b', epoch: 'generation:1', sourceRevision: 2,
      });
      throw never;
    }

    render(<Suspense fallback={<div>projection fallback</div>}><DiscardedView /></Suspense>);
    expect(screen.getByText('projection fallback')).toBeTruthy();
    expect(projector.current()).toBe(initial);

    const resumed = committedProjection(projector, [a], {
      nextViewID: 'channel:mine:a', epoch: 'generation:1', sourceRevision: 1,
    });
    expect(resumed).toBe(initial);
    expect(resumed.entities.get('a')).toBe(initial.entities.get('a'));
    expect(resumed.revision).toBe(initial.revision);
  });

});
