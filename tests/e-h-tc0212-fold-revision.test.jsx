// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

function renderOwner(effectiveFoldOverrides = new Map()) {
  return renderHook(() => useTimelineRowRenderer({
    state: { channelId: 'c0', narration: [] },
    names: new Map(),
    selfId: 'me',
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides,
    approvalStates: {},
    latestRowID: '',
    onResolve: vi.fn(),
    onCancel: vi.fn(),
    onTaskControl: vi.fn(),
    startEditing: vi.fn(),
    toggleFold: vi.fn(),
  }));
}

function completedTurn() {
  return {
    id: 'history-request-104',
    contentRevision: '2:0',
    layoutClass: 'normal',
    body: { kind: 'turn', turn: { requestId: 'history-request-104' } },
  };
}

it('rerenders a historical turn when its response fold override changes', () => {
  const initial = renderOwner();
  const responseExpanded = renderOwner(new Map([['history-request-104:response', true]]));
  const row = completedTurn();

  expect(responseExpanded.result.current.rowRenderRevision(null, row))
    .not.toBe(initial.result.current.rowRenderRevision(null, row));
});
