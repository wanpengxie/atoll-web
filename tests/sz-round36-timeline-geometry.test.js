// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

function setup(overrides = {}) {
  const { result } = renderHook(() => useTimelineRowRenderer({
    state: { channelId: 'c0', narration: [] },
    names: new Map(),
    selfId: 'me',
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
    latestRowID: '',
    onResolve: vi.fn(),
    onCancel: vi.fn(),
    onTaskControl: vi.fn(),
    startEditing: vi.fn(),
    toggleFold: vi.fn(),
    ...overrides,
  }));
  return result;
}

function row(contentRevision, layoutClass = 'normal') {
  return {
    id: 'done-response',
    contentRevision,
    layoutClass,
    body: { kind: 'turn', turn: { requestId: 'done' } },
  };
}

describe('S-Z current Timeline geometry owner', () => {
  it('revises measurement for content, published layout, and local fold decisions', () => {
    const owner = setup();
    const base = owner.current.rowRenderRevision(null, row('2:0'));

    expect(owner.current.rowRenderRevision(null, row('2:1'))).not.toBe(base);
    expect(owner.current.rowRenderRevision(null, row('2:0', 'rich'))).not.toBe(base);

    const folded = setup({ effectiveFoldOverrides: new Map([['done:body', true]]) });
    expect(folded.current.rowRenderRevision(null, row('2:0'))).not.toBe(base);
    expect(owner.current.rowRenderRevision(null, row('2:0'))).toBe(base);
  });
});

