// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationSurface } from '../src/ui/conversation/ConversationSurface.jsx';

const conversationHarness = vi.hoisted(() => ({
  value: null,
  handoffProps: null,
}));

vi.mock('../src/ui/timeline/useTimelinePreferences.js', () => ({
  CONVERSATION_SCOPE: { mine: 'mine', all: 'all' },
  useTimelinePreferences: () => ({
    scope: 'all', actorFilter: new Set(), foldOverrides: new Map(), messageLayoutStore: {},
    toggleScope: vi.fn(), toggleActorFilter: vi.fn(), removeActorFilter: vi.fn(), toggleFold: vi.fn(),
  }),
}));

vi.mock('../src/ui/timeline/useConversationProjection.js', () => ({
  useConversationProjection: () => conversationHarness.value || {
    projection: { presentation: { rows: [] } },
    viewport: {
      activationID: 'activation-1', session: { mode: 'following' }, availability: 'empty-known',
      historyDemand: { phase: 'idle' }, historyBoundary: null, unseenNotice: 0,
      captureBottomIntent: vi.fn(), requestBottom: vi.fn(), bindBottomIntentTargets: vi.fn(),
      revokeBottomIntent: vi.fn(), jumpToLatest: vi.fn(),
    },
    latestRowID: '', browsingExpandedSlots: new Set(), livePresentationArrivals: [],
  },
}));

vi.mock('../src/ui/timeline/useWaitingEditingController.jsx', async (load) => {
  const actual = await load();
  return {
    ...actual,
    useWaitingEditingController: ({ pending }) => ({
      editingTargetId: '', editingReplacementId: '', presentationEditing: null,
      timelineLocalEchoes: [], queuedTurns: pending, editNotice: '', startEditing: vi.fn(),
    }),
    useWaitingHandoff: () => ({ enteringRequestIDs: new Set(), exiting: [] }),
    WaitingLayer: ({ turns }) => turns.length
      ? <section className="agent-wait-layer">waiting</section>
      : null,
  };
});

vi.mock('../src/ui/timeline/useTimelineRowRenderer.jsx', () => ({
  useTimelineRowRenderer: () => ({ rowRenderRevision: 0, renderRow: () => null }),
}));

vi.mock('../src/ui/timeline/ReadingContainerHandoff.jsx', () => ({
  ReadingContainerHandoff: (props) => {
    conversationHarness.handoffProps = props;
    return <div data-testid="reading">reading</div>;
  },
}));

afterEach(() => {
  cleanup();
  conversationHarness.value = null;
  conversationHarness.handoffProps = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const callbacks = {
  onComposerEditChange: vi.fn(), onTaskControl: vi.fn(), onRequestCapability: vi.fn(), onCancel: vi.fn(),
};

function Surface({ composer, pending = [], className = '' }) {
  return <ConversationSurface
    state={{ channelId: 'c0' }} composer={composer} pending={pending} className={className} {...callbacks}
  />;
}

describe('fixed conversation surface ownership', () => {
  it.skip('publishes queued and local send destinations as not-ready, while timeline rows are ready', () => {
    const cases = [
      {
        targetID: 'queued-target',
        rows: [],
        pending: [{ requestId: 'queued-target' }],
        ready: false,
        destination: 'waiting',
      },
      {
        targetID: 'local-target',
        rows: [{ id: 'local-target', local: true, localState: 'queued' }],
        pending: [],
        ready: false,
        destination: 'waiting',
      },
      {
        targetID: 'timeline-target',
        rows: [{ id: 'timeline-target', local: false }],
        pending: [],
        ready: true,
        destination: 'timeline',
      },
    ];

    for (const candidate of cases) {
      conversationHarness.value = {
        projection: { presentation: { revision: 12, rows: candidate.rows } },
        viewport: {
          activationID: 'activation-contract',
          session: {
            mode: 'following',
            inputEpoch: 2,
            intentRevision: 7,
            bottomIntent: {
              id: `composer:send-start:${candidate.targetID}`,
              inputEpoch: 2,
              targetMessageIDs: [candidate.targetID],
            },
          },
          availability: 'readable',
          historyDemand: { phase: 'idle' }, historyBoundary: null, unseenNotice: 0,
          captureBottomIntent: vi.fn(), requestBottom: vi.fn(), bindBottomIntentTargets: vi.fn(),
          revokeBottomIntent: vi.fn(), jumpToLatest: vi.fn(),
        },
        latestRowID: '', browsingExpandedSlots: new Set(), livePresentationArrivals: [],
      };
      render(<Surface pending={candidate.pending} composer={<div>composer</div>} />);

      expect(conversationHarness.handoffProps.bottomIntentPresentation).toMatchObject({
        kind: 'bottom-intent-presentation',
        activationID: 'activation-contract',
        inputEpoch: 2,
        intentRevision: 7,
        presentationRevision: 12,
        targetIDs: [candidate.targetID],
        ready: candidate.ready,
        destinations: [{
          messageID: candidate.targetID,
          destination: candidate.destination,
          targetListRevision: 12,
        }],
      });
      cleanup();
    }
  });

  it.skip('does not install a size/mutation/frame observer or publish a scroll intent', () => {
    const ResizeObserver = vi.fn();
    const MutationObserver = vi.fn();
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal('ResizeObserver', ResizeObserver);
    vi.stubGlobal('MutationObserver', MutationObserver);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);

    const view = render(<Surface composer={<section className="composer-wrap">composer</section>} />);

    expect(ResizeObserver).not.toHaveBeenCalled();
    expect(MutationObserver).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(view.container.querySelector('[data-input-resize-transition]')).toBeNull();
    expect(view.container.querySelector('[data-send-clear-revision]')).toBeNull();
    expect(view.container.querySelector('[data-send-clear-transition]')).toBeNull();
  });

  it.skip('keeps reading and focused Composer DOM identities across Composer and Waiting changes', () => {
    function Subject({ lines, waiting }) {
      return <Surface
        pending={waiting ? [{ id: 'waiting-1' }] : []}
        composer={<section className="composer-wrap">
          <button type="button" data-testid="composer-control">send</button>
          {Array.from({ length: lines }, (_, index) => <p key={index}>{index}</p>)}
        </section>}
      />;
    }

    const view = render(<Subject lines={1} waiting={false} />);
    const surface = view.container.querySelector('.conversation-surface');
    const readingSlot = view.container.querySelector('.conversation-reading-slot');
    const inputSlot = view.container.querySelector('.conversation-input-slot');
    const control = view.getByTestId('composer-control');
    control.focus();

    view.rerender(<Subject lines={12} waiting />);
    expect(view.container.querySelector('.conversation-surface')).toBe(surface);
    expect(view.container.querySelector('.conversation-reading-slot')).toBe(readingSlot);
    expect(view.container.querySelector('.conversation-input-slot')).toBe(inputSlot);
    expect(view.getByTestId('composer-control')).toBe(control);
    expect(document.activeElement).toBe(control);
    expect(view.container.querySelector('.conversation-floating-slot .agent-wait-layer')).not.toBeNull();

    view.rerender(<Subject lines={2} waiting={false} />);
    expect(view.container.querySelector('.conversation-reading-slot')).toBe(readingSlot);
    expect(document.activeElement).toBe(control);
  });

  it.skip('keeps the waiting layer and Composer outside the reading subtree', () => {
    const view = render(<Surface
      className="is-test-surface"
      pending={[{ id: 'waiting-1' }]}
      composer={<div data-testid="composer">composer</div>}
    />);
    const surface = view.container.querySelector('.conversation-surface');
    const readingSlot = view.container.querySelector('.conversation-reading-slot');
    const bottomStack = view.container.querySelector('.conversation-bottom-stack');
    const waiting = view.container.querySelector('.agent-wait-layer');

    expect(surface.classList.contains('is-test-surface')).toBe(true);
    expect(readingSlot.contains(view.getByTestId('reading'))).toBe(true);
    expect(readingSlot.contains(view.getByTestId('composer'))).toBe(false);
    expect(readingSlot.contains(waiting)).toBe(false);
    expect(bottomStack.contains(view.getByTestId('composer'))).toBe(true);
    expect(bottomStack.contains(waiting)).toBe(true);
  });
});
