// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewSessionStore } from '../src/model/view-session.js';
import { ConversationSurface } from '../src/ui/conversation/ConversationSurface.jsx';

// SZ-220 uses the current public composition owner.  The old Timeline and
// LegendMessageList were deleted; this adapter is only the public paint
// boundary, so the test can drive the same rendered row without inventing a
// second reading owner or inspecting a private session field.
const harness = vi.hoisted(() => ({
  rowsByChannel: new Map(),
  viewports: new Map(),
}));

vi.mock('../src/ui/timeline/useConversationProjection.js', () => ({
  useConversationProjection: ({ state }) => {
    const channelID = state.channelId;
    const rows = harness.rowsByChannel.get(channelID) || [];
    return {
      projection: {
        presentation: { revision: rows.length ? 1 : 0, rows },
        filtered: rows,
        allEntries: rows,
        localEchoes: [],
      },
      viewport: harness.viewports.get(channelID),
      latestRowID: '',
      browsingExpandedSlots: new Set(),
      livePresentationArrivals: [],
    };
  },
}));

vi.mock('../src/ui/timeline/ReadingContainerHandoff.jsx', () => ({
  ReadingContainerHandoff: ({ reading, snapshot, renderRow }) => (
    <div
      className="timeline-reading-stack"
      data-reading-container="following-tail"
      data-reading-mode={reading.session.mode}
    >
      <div className="timeline-message-list" role="region" aria-label="频道动态">
        {snapshot.rows.map((row) => <div key={row.id}>{renderRow(row)}</div>)}
      </div>
    </div>
  ),
}));

afterEach(() => {
  harness.rowsByChannel.clear();
  harness.viewports.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const LONG_TEXT = `${'一段用于证明当前展示选择的公开正文。'.repeat(80)}\n最后一行仍属于同一条动态。`;

function committedTurn() {
  return {
    requestId: 'committed-work',
    request: {
      id: 'committed-work',
      kind: 'request',
      type: 'agent.ask',
      ts: 100,
      sender: { id: 'human:me', kind: 'human' },
      audience: ['agent:worker'],
      payload: { body: { text: LONG_TEXT } },
    },
    status: 'processing',
    terminal: null,
    provisional: [],
    thread: [],
  };
}

function viewport(channelID) {
  return {
    activationID: `activation-${channelID}`,
    session: {
      mode: 'following',
      inputEpoch: 1,
      intentRevision: 0,
      bottomIntent: null,
    },
    availability: 'readable',
    historyDemand: { phase: 'idle' },
    historyBoundary: null,
    unseenNotice: 0,
    cache: { phase: 'current', error: '' },
    captureContentAnchor: vi.fn(() => false),
    beginNavigation: vi.fn(),
    cancelScopeHandoff: vi.fn(),
    captureBottomIntent: vi.fn(() => null),
    requestBottom: vi.fn(() => false),
    bindBottomIntentTargets: vi.fn(() => false),
    revokeBottomIntent: vi.fn(() => false),
    jumpToLatest: vi.fn(),
    retryAvailability: vi.fn(),
    retryHistoryDemand: vi.fn(),
    tailCaughtUp: { channelId: channelID, caughtUp: true, scope: 'all', actorFiltered: false },
  };
}

const callbacks = {
  onComposerEditChange: vi.fn(),
  onTaskControl: vi.fn(),
  onRequestCapability: vi.fn(),
  onCancel: vi.fn(),
};

function SurfaceHarness() {
  const [candidate, setCandidate] = React.useState(false);
  return <>
    <button type="button" onClick={() => React.startTransition(() => setCandidate(true))}>
      start candidate
    </button>
    <React.Suspense fallback={<div>candidate fallback</div>}>
      <ConversationSurface
        state={{ channelId: candidate ? 'c1' : 'c0', narration: [] }}
        history={{}}
        viewSessions={harness.viewSessions}
        roster={[
          { id: 'human:me', kind: 'human', name: '我' },
          { id: 'agent:worker', kind: 'agent', name: 'Worker' },
        ]}
        selfId="human:me"
        access="member_active"
        surfaceVisible
        pending={[]}
        approvalStates={{}}
        capabilityIndex={new Map()}
        composer={<div>composer</div>}
        {...callbacks}
      />
      <Suspender active={candidate} />
    </React.Suspense>
  </>;
}

function Suspender({ active }) {
  if (active) {
    harness.candidateRendered = true;
    throw harness.never;
  }
  return null;
}

describe('SZ-220 committed presentation owner', () => {
  it('keeps a fold choice on the committed channel while a candidate is suspended', async () => {
    const store = createViewSessionStore({ storage: null });
    const writeConversation = vi.fn((...args) => store.writeConversation(...args));
    harness.viewSessions = { ...store, writeConversation };
    harness.candidateRendered = false;
    harness.never = new Promise(() => {});

    const row = {
      id: 'committed-work',
      contentRevision: 'committed-1',
      seqLow: 1,
      seqHigh: 1,
      layoutClass: 'rich',
      body: { kind: 'turn', turn: committedTurn(), thread: [] },
    };
    harness.rowsByChannel.set('c0', [row]);
    harness.viewports.set('c0', viewport('c0'));
    harness.viewports.set('c1', viewport('c1'));

    render(<SurfaceHarness />);
    const fold = await screen.findByRole('button', { name: /展开全文/ });
    const committedReading = fold.closest('[data-reading-container="following-tail"]');
    expect(committedReading).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'start candidate' }));
    await waitFor(() => expect(harness.candidateRendered).toBe(true));
    expect(screen.queryByText('candidate fallback')).toBeNull();
    expect(fold.isConnected).toBe(true);

    fireEvent.click(fold);
    await waitFor(() => expect(writeConversation).toHaveBeenCalled());

    // User ability: the committed row can choose its presentation while the
    // candidate is suspended.  Its durable preference is scoped to c0 only.
    expect(store.read('c0')).toMatchObject({
      foldOverrides: [['committed-work:body', true]],
    });
    expect(writeConversation.mock.calls.some(([channelID]) => channelID === 'c0')).toBe(true);
    expect(writeConversation.mock.calls.some(([channelID]) => channelID === 'c1')).toBe(false);

    // Invariant: a presentation choice must not turn into navigation control
    // or replace the committed reading DOM.  The public viewport remains in
    // following mode and no native navigation entry was requested.
    expect(committedReading.isConnected).toBe(true);
    expect(committedReading.dataset.readingMode).toBe('following');
    expect(harness.viewports.get('c0').beginNavigation).not.toHaveBeenCalled();
    expect(harness.viewports.get('c0').captureContentAnchor).toHaveBeenCalledWith(expect.objectContaining({
      anchorID: 'committed-work:body',
      expectedExpanded: true,
    }));
  });
});
