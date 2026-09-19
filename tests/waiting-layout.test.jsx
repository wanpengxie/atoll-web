// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationSurface } from '../src/ui/conversation/ConversationSurface.jsx';

vi.mock('../src/ui/timeline/useTimelinePreferences.js', () => ({
  CONVERSATION_SCOPE: { mine: 'mine', all: 'all' },
  useTimelinePreferences: () => ({
    scope: 'all', actorFilter: new Set(), foldOverrides: new Map(), messageLayoutStore: {},
    toggleScope: vi.fn(), toggleActorFilter: vi.fn(), removeActorFilter: vi.fn(), toggleFold: vi.fn(),
  }),
}));

vi.mock('../src/ui/timeline/useConversationProjection.js', () => ({
  useConversationProjection: () => ({
    projection: { presentation: { rows: [] } },
    viewport: {
      activationID: 'activation-1', session: { mode: 'following' }, availability: 'empty-known',
      historyDemand: { phase: 'idle' }, historyBoundary: null, unseenNotice: 0,
      captureBottomIntent: vi.fn(), requestBottom: vi.fn(), bindBottomIntentTargets: vi.fn(),
      revokeBottomIntent: vi.fn(), jumpToLatest: vi.fn(),
    },
    latestRowID: '', browsingExpandedSlots: new Set(), livePresentationArrivals: [],
  }),
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
  ReadingContainerHandoff: () => <div data-testid="reading">reading</div>,
}));

afterEach(() => {
  cleanup();
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
  it('does not install a size/mutation/frame observer or publish a scroll intent', () => {
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

  it('keeps reading and focused Composer DOM identities across Composer and Waiting changes', () => {
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

  it('keeps the waiting layer and Composer outside the reading subtree', () => {
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
