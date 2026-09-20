// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReadingSession,
  observeReading,
  READING_MODE,
  takeReadingControl,
} from '../src/model/reading-session.js';
import { VendorListExecutor } from '../src/ui/timeline/VendorListExecutor.jsx';

const harness = vi.hoisted(() => ({ props: null }));
const defaultElementFromPoint = document.elementFromPoint;

vi.mock('react-virtuoso', async () => {
  const ReactModule = await import('react');
  const Virtuoso = ReactModule.forwardRef(function ObservationVirtuoso(props, ref) {
    const nodeRef = ReactModule.useRef(null);
    ReactModule.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }), []);
    ReactModule.useLayoutEffect(() => {
      harness.props = props;
      props.scrollerRef?.(nodeRef.current);
      return () => props.scrollerRef?.(null);
    }, [props]);
    const List = props.components?.List || 'div';
    return (
      <div
        ref={nodeRef}
        className={props.className}
        role={props.role}
        aria-label={props['aria-label']}
        data-reading-presentation-revision={props['data-reading-presentation-revision']}
      >
        <List context={props.context}>
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
  document.elementFromPoint = defaultElementFromPoint;
  harness.props = null;
});

function row(id = 'tail') {
  return {
    id,
    seqLow: 1,
    seqHigh: 1,
    contentRevision: 1,
    layoutClass: 'standalone',
    settled: true,
  };
}

function snapshot() {
  return {
    rows: [row()],
    firstItemIndex: 99,
    revision: 1,
    changes: { kind: 'append', inserted: ['tail'], updated: [], removed: [] },
  };
}

function readingOwner() {
  let session = createReadingSession({
    key: 'channel:view',
    activationID: 'activation:current',
    saved: { mode: READING_MODE.browsing },
  });
  const observations = [];
  const owner = {
    activationID: session.activationID,
    session,
    restorePending: false,
    bottomReady: true,
    status: {},
    onAtTop: vi.fn(),
    onNearTop: vi.fn(),
    onSurfaceVisibilityChange: vi.fn(),
    consumeBottomIntent: vi.fn(() => false),
    isFollowing: () => session.mode === READING_MODE.following,
    getSession: () => session,
    onUserControl: vi.fn((control) => {
      session = takeReadingControl(session, control);
      owner.session = session;
      return session;
    }),
    onReadingObservation: vi.fn((observation) => {
      observations.push(observation);
      session = observeReading(session, observation);
      owner.session = session;
      return session;
    }),
    advanceEpoch() {
      session = takeReadingControl(session, {
        direction: 'browse',
        gestureID: 'replacement',
        geometryRevision: session.geometryRevision,
      });
      owner.session = session;
    },
    observations,
  };
  owner.beginNavigation = vi.fn((control) => {
    owner.onUserControl(control);
    return { inputGeneration: session.inputEpoch };
  });
  owner.updateNavigation = vi.fn(() => true);
  owner.finishNavigation = vi.fn(() => true);
  owner.cancelNavigation = vi.fn(() => true);
  return owner;
}

function setScrollerGeometry(node, { scrollTop = 300 } = {}) {
  Object.defineProperties(node, {
    offsetHeight: { configurable: true, value: 600 },
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 1000 },
    scrollTop: { configurable: true, writable: true, value: scrollTop },
  });
  node.getBoundingClientRect = () => ({
    top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600,
  });
}

async function nextFrame() {
  await new Promise(requestAnimationFrame);
}

async function mount(owner) {
  render(
    <VendorListExecutor
      snapshot={snapshot()}
      reading={owner}
      surfaceVisible
      renderRow={(value) => <article data-reading-block-id={`block:${value.id}`}>{value.id}</article>}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller);
  const rowNode = scroller.querySelector('[data-presentation-row-id]');
  const block = scroller.querySelector('[data-reading-block-id]');
  rowNode.getBoundingClientRect = () => ({
    top: 0, bottom: 132, left: 0, right: 800, width: 800, height: 132,
  });
  block.getBoundingClientRect = () => ({
    top: 8, bottom: 40, left: 8, right: 400, width: 392, height: 32,
  });
  // The production receipt requires a real hit-tested row. jsdom's shared
  // setup fallback returns document.body for every point, which intentionally
  // models "no painted row" and would make this fixture test the rejection
  // path in every case. Keep the production predicate intact and model the
  // one mounted row's hit-test here instead.
  document.elementFromPoint = () => rowNode;
  await act(async () => {
    scroller.dispatchEvent(new Event('scroll'));
    await Promise.resolve();
    await nextFrame();
  });
  owner.observations.length = 0;
  owner.onReadingObservation.mockClear();
  return scroller;
}

function pointer(type, properties) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, { configurable: true, value }]),
  ));
  return event;
}

describe('reading observation settlement authority (VendorListExecutor)', () => {
  it('keeps current downward user authority when scrollend adds the settled sampling phase', async () => {
    const owner = readingOwner();
    const scroller = await mount(owner);

    await act(async () => {
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
      scroller.scrollTop = 400;
      scroller.dispatchEvent(new Event('scroll'));
      scroller.dispatchEvent(new Event('scrollend'));
      expect(owner.observations).toHaveLength(0);
      await nextFrame();
    });

    expect(owner.observations).toHaveLength(1);
    expect(owner.observations[0]).toMatchObject({
      source: 'user',
      settled: true,
      atTail: true,
      bookmark: { messageID: 'tail', blockID: 'block:tail' },
    });
    expect(owner.getSession().mode).toBe(READING_MODE.following);
  });

  it('does not let selection autoscroll acquire following authority at the tail', async () => {
    const owner = readingOwner();
    const scroller = await mount(owner);
    const content = screen.getByText('tail');

    await act(async () => {
      content.dispatchEvent(pointer('pointerdown', {
        pointerType: 'mouse', pointerId: 7, button: 0, clientX: 10, clientY: 10,
      }));
      content.dispatchEvent(pointer('pointermove', {
        pointerType: 'mouse', pointerId: 7, button: 0, clientX: 10, clientY: 20,
      }));
      scroller.scrollTop = 400;
      scroller.dispatchEvent(new Event('scroll'));
      content.dispatchEvent(pointer('pointerup', {
        pointerType: 'mouse', pointerId: 7, button: 0, clientX: 10, clientY: 20,
      }));
      scroller.dispatchEvent(new Event('scrollend'));
      await nextFrame();
    });

    expect(owner.observations).toHaveLength(1);
    expect(owner.observations[0]).toMatchObject({ source: 'user', settled: true, atTail: true });
    expect(owner.getSession().mode).toBe(READING_MODE.browsing);
  });

  it('keeps an input-free layout arrival at the tail non-authoritative', async () => {
    const owner = readingOwner();
    const scroller = await mount(owner);

    await act(async () => {
      scroller.scrollTop = 400;
      scroller.dispatchEvent(new Event('scroll'));
      scroller.dispatchEvent(new Event('scrollend'));
      await nextFrame();
    });

    expect(owner.observations).toHaveLength(1);
    expect(owner.observations[0]).toMatchObject({ source: 'settled', settled: true, atTail: true });
    expect(owner.getSession().mode).toBe(READING_MODE.browsing);
  });

  it('rejects pending user authority after the reading input epoch advances', async () => {
    const owner = readingOwner();
    const scroller = await mount(owner);

    await act(async () => {
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
      scroller.scrollTop = 400;
      scroller.dispatchEvent(new Event('scroll'));
      owner.advanceEpoch();
      scroller.dispatchEvent(new Event('scrollend'));
      await nextFrame();
    });

    expect(owner.observations).toHaveLength(1);
    expect(owner.observations[0]).toMatchObject({ source: 'settled', settled: true, atTail: true });
    expect(owner.getSession().mode).toBe(READING_MODE.browsing);
  });
});
