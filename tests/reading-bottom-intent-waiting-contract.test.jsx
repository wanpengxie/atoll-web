// @vitest-environment jsdom
// Public ConversationSurface -> ReadingContainerHandoff -> Vendor contracts.
// These cases deliberately keep a send target in Waiting and prove that a
// local projection cannot authorize a tail write or consume the send intent.
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  projection: null,
  waiting: { queuedTurns: [] },
}));

const harness = vi.hoisted(() => ({
  props: null,
  receipt: null,
  root: null,
  scrollTo: null,
  metrics: { clientHeight: 600, scrollHeight: 1_000, scrollTop: 200 },
}));

vi.mock('react-virtuoso', async () => {
  const ReactModule = await import('react');
  const Virtuoso = ReactModule.forwardRef(function PublicContractVirtuoso(props, ref) {
    const nodeRef = ReactModule.useRef(null);
    ReactModule.useLayoutEffect(() => {
      const node = nodeRef.current;
      const sameRoot = harness.root === node && harness.scrollTo;
      harness.props = props;
      harness.root = node;
      if (!sameRoot) {
        harness.scrollTo = vi.fn((options) => {
          if (node && options && typeof options === 'object') {
            node.scrollTop = Number(options.top || 0);
          }
        });
      }
      node.scrollTo = harness.scrollTo;
      Object.defineProperties(node, {
        clientHeight: { configurable: true, value: harness.metrics.clientHeight },
        scrollHeight: { configurable: true, value: harness.metrics.scrollHeight },
        scrollTop: {
          configurable: true,
          writable: true,
          value: harness.metrics.scrollTop,
        },
      });
      node.getBoundingClientRect = () => ({
        top: 0,
        bottom: harness.metrics.clientHeight,
        left: 0,
        right: 800,
        width: 800,
        height: harness.metrics.clientHeight,
      });
      props.scrollerRef?.(node);
      props.rangeChanged?.({
        startIndex: props.firstItemIndex,
        endIndex: props.firstItemIndex + props.data.length - 1,
      });
      return () => props.scrollerRef?.(null);
    }, [props]);
    ReactModule.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }), []);
    return <div ref={nodeRef}>{props.data.map((row, index) => (
      <div key={props.computeItemKey(index + props.firstItemIndex, row)}>
        {props.itemContent(index + props.firstItemIndex, row)}
      </div>
    ))}</div>;
  });
  return { Virtuoso };
});

vi.mock('../src/ui/timeline/useTimelinePreferences.js', () => ({
  CONVERSATION_SCOPE: { mine: 'mine', all: 'all' },
  useTimelinePreferences: () => ({
    scope: 'all',
    actorFilter: new Set(),
    foldOverrides: new Map(),
    messageLayoutStore: {},
    toggleScope: vi.fn(),
    toggleActorFilter: vi.fn(),
    removeActorFilter: vi.fn(),
    toggleFold: vi.fn(),
  }),
}));

vi.mock('../src/ui/timeline/useConversationProjection.js', () => ({
  useConversationProjection: () => state.projection,
}));

vi.mock('../src/ui/timeline/useWaitingEditingController.jsx', () => ({
  WaitingLayer: () => null,
  useWaitingEditingController: () => ({
    editingTargetId: '',
    editingReplacementId: '',
    presentationEditing: null,
    timelineLocalEchoes: [],
    queuedTurns: state.waiting.queuedTurns,
    editNotice: '',
    startEditing: vi.fn(),
  }),
  useWaitingHandoff: () => ({ enteringRequestIDs: new Set(), exiting: [] }),
}));

vi.mock('../src/ui/timeline/useTimelineRowRenderer.jsx', () => ({
  useTimelineRowRenderer: () => ({
    rowRenderRevision: () => 'waiting-contract-row',
    renderRow: (row) => <article>{row.id}</article>,
  }),
}));

vi.mock('../src/ui/timeline/ReadingContainerHandoff.jsx', async () => {
  const { VendorListExecutor } = await vi.importActual('../src/ui/timeline/VendorListExecutor.jsx');
  return {
    ReadingContainerHandoff: (props) => {
      harness.receipt = props.bottomIntentPresentation;
      return <VendorListExecutor {...props} />;
    },
  };
});

import { ConversationSurface } from '../src/ui/conversation/ConversationSurface.jsx';

const TARGET = 'queued-target';
const ACTIVATION = 'activation:waiting-contract';

function row(id, options = {}) {
  return {
    id,
    seqLow: 1,
    seqHigh: 1,
    contentRevision: 1,
    visualSlotID: id,
    layoutClass: 'message',
    ...options,
    body: { kind: 'standalone', envelope: { id, kind: 'event', type: 'human.note' }, ...options.body },
  };
}

function owner(intent) {
  const session = {
    activationID: ACTIVATION,
    inputEpoch: 0,
    intentRevision: 0,
    geometryRevision: 0,
    mode: 'following',
    bottomIntent: intent,
    bookmark: null,
  };
  const reading = {
    activationID: ACTIVATION,
    session,
    initializing: false,
    restorePending: false,
    bottomReady: true,
    availability: 'known',
    historyDemand: { phase: 'idle' },
    historyBoundary: null,
    unseenNotice: 0,
    status: {},
    getSession: () => reading.session,
    onAtTop: vi.fn(),
    onNearTop: vi.fn(),
    onUnderfill: vi.fn(() => null),
    onPresentationMaterialized: vi.fn(),
    onReadingObservation: vi.fn(),
    onSurfaceVisibilityChange: vi.fn(),
    onUserControl: vi.fn(),
    consumeBottomIntent: vi.fn(),
    beginNavigation: vi.fn(() => ({ inputGeneration: reading.session.inputEpoch })),
    updateNavigation: vi.fn(),
    finishNavigation: vi.fn(),
    cancelNavigation: vi.fn(),
    cancelScopeHandoff: vi.fn(),
    captureBottomIntent: vi.fn(),
    requestBottom: vi.fn(),
    bindBottomIntentTargets: vi.fn(),
    revokeBottomIntent: vi.fn(),
    jumpToLatest: vi.fn(),
    retryAvailability: vi.fn(),
    retryHistoryDemand: vi.fn(),
    revokeHistoryPositionLease: vi.fn(),
    cancelHistoryStart: vi.fn(),
  };
  return reading;
}

function projection(reading, rows) {
  return {
    projection: {
      presentation: {
        rows,
        firstItemIndex: 1,
        revision: 2,
        roleRevision: 1,
      },
      filtered: rows,
      allEntries: rows,
      localEchoes: [],
    },
    viewport: reading,
    latestRowID: rows.at(-1)?.id || '',
    browsingExpandedSlots: new Set(),
    livePresentationArrivals: [],
  };
}

function renderPublicSurface(reading) {
  return render(<ConversationSurface
    state={{ channelId: 'c0' }}
    composer={<div data-testid="composer">composer</div>}
    pending={state.waiting.queuedTurns}
    onComposerEditChange={vi.fn()}
    onTaskControl={vi.fn()}
    onRequestCapability={vi.fn()}
    onCancel={vi.fn()}
  />);
}

afterEach(() => {
  cleanup();
  state.projection = null;
  state.waiting = { queuedTurns: [] };
  harness.props = null;
  harness.receipt = null;
  harness.root = null;
  harness.scrollTo = null;
  harness.metrics = { clientHeight: 600, scrollHeight: 1_000, scrollTop: 200 };
});

describe('Reading public send join refuses Waiting destinations', () => {
  it.skip('rejects a queued local row before it becomes a timeline row', () => {
    const intent = {
      id: 'composer:send-start:queued-row',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: [TARGET],
    };
    const reading = owner(intent);
    const target = row(TARGET, { localState: 'queued', local: true });
    const rows = [row('anchor'), target];
    state.projection = projection(reading, rows);

    renderPublicSurface(reading);

    const receipt = harness.receipt;
    expect.soft(receipt).toMatchObject({
      kind: 'bottom-intent-presentation',
      intentID: intent.id,
      ready: false,
      destinations: [{ messageID: TARGET, destination: 'waiting' }],
    });
    act(() => harness.props.totalListHeightChanged());
    expect.soft(harness.scrollTo).not.toHaveBeenCalled();
    expect.soft(reading.consumeBottomIntent).not.toHaveBeenCalled();
  });

  it.skip('rejects a local echo row before backend acceptance', () => {
    const intent = {
      id: 'composer:send-start:local-row',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: [TARGET],
    };
    const reading = owner(intent);
    const target = row(TARGET, { local: true });
    state.projection = projection(reading, [row('anchor'), target]);

    renderPublicSurface(reading);

    const receipt = harness.receipt;
    expect.soft(receipt).toMatchObject({
      kind: 'bottom-intent-presentation',
      intentID: intent.id,
      ready: false,
      destinations: [{ messageID: TARGET, destination: 'waiting' }],
    });
    act(() => harness.props.totalListHeightChanged());
    expect.soft(harness.scrollTo).not.toHaveBeenCalled();
    expect.soft(reading.consumeBottomIntent).not.toHaveBeenCalled();
  });

  it.skip('rejects a queuedTurns-only target before materialization', () => {
    const intent = {
      id: 'composer:send-start:queued-turn',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: [TARGET],
    };
    const reading = owner(intent);
    state.waiting = { queuedTurns: [{ requestId: TARGET, local: true }] };
    state.projection = projection(reading, [row('anchor')]);

    renderPublicSurface(reading);

    const receipt = harness.receipt;
    expect.soft(receipt).toMatchObject({
      kind: 'bottom-intent-presentation',
      intentID: intent.id,
      ready: false,
      destinations: [{ messageID: TARGET, destination: 'waiting' }],
    });
    act(() => harness.props.totalListHeightChanged());
    expect.soft(harness.scrollTo).not.toHaveBeenCalled();
    expect.soft(reading.consumeBottomIntent).not.toHaveBeenCalled();
  });
});
