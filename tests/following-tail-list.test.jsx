// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VendorListExecutor } from '../src/ui/timeline/VendorListExecutor.jsx';

// The old FollowingTailList.jsx / LegendMessageList.jsx duo (and their
// startTransition+Suspense candidate/committed handoff) are gone; there is
// now one virtualized executor for both following and browsing
// (VendorListExecutor.jsx). This mock keeps the minimum react-virtuoso
// surface VendorListExecutor actually reads/calls: data, itemContent,
// firstItemIndex, computeItemKey, components.{List,Header}, context,
// scrollerRef and rangeChanged.
const harness = vi.hoisted(() => ({ props: null }));

vi.mock('react-virtuoso', async () => {
  const ReactModule = await import('react');
  const Virtuoso = ReactModule.forwardRef(function ExecutorVirtuoso(props, ref) {
    const nodeRef = ReactModule.useRef(null);
    ReactModule.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }), []);
    ReactModule.useLayoutEffect(() => {
      harness.props = props;
      props.scrollerRef?.(nodeRef.current);
      props.rangeChanged?.({
        startIndex: props.firstItemIndex,
        endIndex: props.firstItemIndex + props.data.length - 1,
      });
      return () => props.scrollerRef?.(null);
    }, [props]);
    const List = props.components?.List || 'div';
    const Header = props.components?.Header || (() => null);
    return (
      <div ref={nodeRef} className={props.className} role={props.role} aria-label={props['aria-label']} tabIndex={props.tabIndex}>
        <List context={props.context}>
          <Header context={props.context} />
          {props.data.map((value, index) => (
            <div key={props.computeItemKey(index + props.firstItemIndex, value)}>
              {props.itemContent(index + props.firstItemIndex, value)}
            </div>
          ))}
        </List>
      </div>
    );
  });
  return { Virtuoso };
});

afterEach(() => {
  cleanup();
  harness.props = null;
});

function readingPort(overrides = {}) {
  const session = {
    activationID: 'activation-1',
    inputEpoch: 2,
    geometryRevision: 0,
    mode: 'following',
    bottomIntent: { id: '', inputEpoch: 0 },
    bookmark: null,
  };
  return {
    activationID: session.activationID,
    session,
    status: {},
    getSession: () => session,
    consumeBottomIntent: vi.fn(() => false),
    onPresentationMaterialized: vi.fn(),
    onReadingObservation: vi.fn(),
    onSurfaceVisibilityChange: vi.fn(),
    onUserControl: vi.fn(),
    ...overrides,
  };
}

function snapshot(count = 100) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    contentRevision: index + 1,
    seqLow: index + 1,
    seqHigh: index + 1,
    layoutClass: 'message',
  }));
  return { rows, revision: 7, roleRevision: 3, firstItemIndex: 900 };
}

it('uses the presentation absolute coordinate for tail row revisions and materialization (VendorListExecutor)', () => {
  const reading = readingPort();
  const revisionIndices = [];
  render(<VendorListExecutor
    snapshot={snapshot(4)}
    reading={reading}
    rowRevision={(index, row) => { revisionIndices.push([index, row.id]); return String(index); }}
    renderRow={(row) => <div>{row.id}</div>}
    surfaceVisible
  />);

  // firstItemIndex is 900, 4 rows -> absolute indices 900..903.
  expect(revisionIndices.at(0)).toEqual([900, 'row-0']);
  expect(revisionIndices.at(-1)).toEqual([903, 'row-3']);
  expect(reading.onPresentationMaterialized).toHaveBeenCalledWith({
    activationID: 'activation-1',
    presentationRevision: 7,
    startIndex: 900,
    endIndex: 903,
  });
});

it('renders the authoritative history start before the oldest row only when the tail window contains it (VendorListExecutor)', () => {
  const reading = readingPort();
  const view = render(<VendorListExecutor
    snapshot={snapshot(4)}
    reading={reading}
    rowRevision={(index) => String(index)}
    renderRow={(row) => <div>{row.id}</div>}
    surfaceVisible
    historyStartBoundary={{ generation: 7, label: '已到频道最早一条动态' }}
  />);
  const boundary = view.getByText('已到频道最早一条动态');
  const slot = boundary.closest('.timeline-history-boundary-slot');
  expect(slot).toBeTruthy();
  expect(boundary.closest('[role="status"]')).toBeTruthy();
});

it('focuses following when a real handoff requests focus from outside the adapter (VendorListExecutor)', () => {
  const reading = readingPort();
  const { container } = render(<VendorListExecutor
    snapshot={snapshot(1)}
    reading={reading}
    rowRevision={(index) => String(index)}
    renderRow={(row) => <button type="button">{row.id}</button>}
    surfaceVisible
    focusOnMount
  />);

  const root = container.querySelector('.timeline-message-list');
  expect(document.activeElement).toBe(root);
});

it('keeps an empty conversation surface addressable without mounting a vendor list (VendorListExecutor)', () => {
  const reading = readingPort();
  const view = render(<VendorListExecutor
    snapshot={{ rows: [], revision: 1, firstItemIndex: 1 }}
    reading={reading}
    surfaceVisible
    renderRow={() => null}
  />);

  const surface = view.getByRole('region', { name: '频道动态' });
  expect(surface.getAttribute('data-empty')).toBe('true');
  expect(harness.props).toBeNull();
});

it('exposes restore-pending state before the first row is available (VendorListExecutor)', () => {
  const reading = readingPort({ restorePending: true });
  const view = render(<VendorListExecutor
    snapshot={{ rows: [], revision: 1, firstItemIndex: 1 }}
    reading={reading}
    renderRow={() => null}
  />);

  expect(view.getByRole('status').textContent).toContain('正在恢复上次阅读位置');
  expect(view.container.querySelector('[data-empty="true"]')).toBeNull();
});

it('publishes row presentation state through the shared public row shell', () => {
  const reading = readingPort();
  const view = render(<VendorListExecutor
    snapshot={snapshot(1)}
    reading={reading}
    rowRevision={(index) => `revision-${index}`}
    rowPresentationState={(row) => `focused:${row.id}`}
    renderRow={(row) => <article>{row.id}</article>}
    surfaceVisible
  />);

  const shell = view.container.querySelector('[data-presentation-row-id="row-0"]');
  expect(shell.getAttribute('data-presentation-state')).toBe('focused:row-0');
  expect(shell.querySelector('[data-render-revision="revision-900"]').textContent).toContain('row-0');
});

it('contains a row render failure behind the public retry boundary', () => {
  const reading = readingPort();
  const view = render(<VendorListExecutor
    snapshot={snapshot(1)}
    reading={reading}
    rowRevision={(index) => String(index)}
    renderRow={() => { throw new Error('render failed'); }}
    surfaceVisible
  />);

  expect(view.getByRole('alert').textContent).toContain('内容更新后会自动重试');
});
