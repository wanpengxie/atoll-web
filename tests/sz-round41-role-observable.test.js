// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createConversationPresentation } from '../src/model/conversation-presentation.js';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

function row(id = 'latest') {
  return {
    id,
    contentRevision: '2:0',
    layoutClass: 'normal',
    body: { kind: 'standalone', envelope: { id, type: 'project.task', payload: { body: { text: id } } } },
  };
}

function renderOwner(latestRowID) {
  return renderHook(() => useTimelineRowRenderer({
    state: { channelId: 'c0', narration: [] },
    names: new Map(),
    selfId: 'human:root:1',
    latestRowID,
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
    onResolve: vi.fn(),
    onCancel: vi.fn(),
    onTaskControl: vi.fn(),
    startEditing: vi.fn(),
    toggleFold: vi.fn(),
  }));
}

describe('S-Z current latest-row observable without a role revision', () => {
  it('revises the visible row when the canonical authority selects a different latest ID', () => {
    const old = renderOwner('old');
    const oldRevision = old.result.current.rowRenderRevision(0, row('latest'));
    old.rerender();
    expect(old.result.current.rowRenderRevision(0, row('latest'))).toBe(oldRevision);

    const next = renderOwner('latest');
    expect(next.result.current.rowRenderRevision(0, row('latest'))).not.toBe(oldRevision);
  });

  it('keeps the committed current-entry observable stable when a projection receipt is replayed', () => {
    const projector = createConversationPresentation();
    const initial = projector.evaluate([row('old').body], {
      nextViewID: 'c0:all', epoch: 'generation:41', sourceRevision: 1,
    });
    expect(projector.commitCandidate(initial)).toBe(true);
    const candidate = projector.evaluate([row('old').body, row('latest').body], {
      nextViewID: 'c0:all', epoch: 'generation:41', sourceRevision: 2,
    });

    expect(projector.commitCandidate(candidate)).toBe(true);
    const committed = projector.current();
    expect(committed.currentEntryCandidate).toEqual({ id: 'latest', seqHigh: 0, local: false });
    expect(projector.commitCandidate(candidate)).toBe(false);
    expect(projector.current()).toBe(committed);
    expect(committed.rows.map((item) => item.id)).toEqual(['old', 'latest']);
  });
});
