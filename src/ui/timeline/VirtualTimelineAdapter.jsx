import React, { cloneElement, forwardRef, isValidElement, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Virtuoso, VirtuosoMockContext } from 'react-virtuoso';

// The history scheduler keeps data ahead of the reader; the adapter separately
// keeps DOM ahead of the compositor. Two screens in the older direction let a
// trackpad fling consume already materialized rows instead of exposing the
// background while rich Markdown is mounted.
const INITIAL_MATERIALIZATION_RUNWAY = Object.freeze({ top: 1_800, bottom: 600 });

const TimelineScroller = forwardRef(function TimelineScroller({ children, tabIndex: _tabIndex, ...props }, ref) {
  return <div {...props} ref={ref} tabIndex={0} role="region" aria-label="频道动态">{children}</div>;
});
const TIMELINE_COMPONENTS = Object.freeze({ Scroller: TimelineScroller });

function TestViewport({ children }) {
  if (import.meta.env.MODE !== 'test') return children;
  return <VirtuosoMockContext.Provider value={{ viewportHeight: 720, itemHeight: 96 }}>{children}</VirtuosoMockContext.Provider>;
}

// The only module allowed to know react-virtuoso's API. Conversation owns
// intent, the viewport controller owns scroll semantics, and this adapter owns
// DOM range materialization and height measurement.
export function VirtualTimelineAdapter({ listKey, rows, viewport, itemKey, renderRow, rowRevision }) {
  const virtuosoRef = useRef(null);
  const scrollerRef = useRef(null);
  const cleanupRef = useRef(() => {});
  const anchorFrameRef = useRef(0);
  const handlersRef = useRef(viewport);
  const renderRowRef = useRef(renderRow);
  const [materializationRunway, setMaterializationRunway] = useState(INITIAL_MATERIALIZATION_RUNWAY);
  handlersRef.current = viewport;
  renderRowRef.current = renderRow;
  const expandMaterializationRunway = useCallback((viewportHeight, velocity = 0) => {
    const height = Math.max(480, Number(viewportHeight || 0));
    const screensAhead = velocity >= 3 ? 6 : velocity >= 1.5 ? 4.5 : 3;
    const target = {
      top: Math.round(height * screensAhead),
      bottom: Math.round(height * 1.25),
    };
    setMaterializationRunway((current) => (
      current.top >= target.top && current.bottom >= target.bottom
        ? current
        : { top: Math.max(current.top, target.top), bottom: Math.max(current.bottom, target.bottom) }
    ));
  }, []);
  const presentationRow = useCallback((index, row) => (
    <PresentationRow
      index={index}
      row={row}
      contentRevision={row.contentRevision}
      layoutClass={row.layoutClass}
      settled={row.settled}
      renderRowRef={renderRowRef}
      renderRevision={rowRevision?.(index, row) || ''}
    />
  ), [rowRevision]);

  useImperativeHandle(viewport.adapterRef, () => ({
    latest: ({ behavior = 'auto' } = {}) => virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior }),
    restore: ({ index, offset = 0 } = {}) => virtuosoRef.current?.scrollToIndex({ index, align: 'start', offset, behavior: 'auto' }),
    focus: ({ index } = {}) => virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' }),
  }), []);

  const observeAnchor = useCallback(() => {
    cancelAnimationFrame(anchorFrameRef.current);
    anchorFrameRef.current = requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const viewportRect = scroller.getBoundingClientRect();
      let row = null;
      if (typeof document.elementsFromPoint === 'function') {
        const x = Math.min(viewportRect.right - 1, viewportRect.left + Math.max(8, viewportRect.width / 2));
        const y = Math.min(viewportRect.bottom - 1, viewportRect.top + 1);
        row = document.elementsFromPoint(x, y)
          .map((node) => node.closest?.('[data-presentation-row-id]'))
          .find((node) => node && scroller.contains(node));
      }
      if (!row) {
        row = [...scroller.querySelectorAll('[data-presentation-row-id]')]
          .find((node) => node.getBoundingClientRect().bottom > viewportRect.top);
      }
      if (!row) return;
      handlersRef.current.handleAnchorObserved({
        rowID: row.dataset.presentationRowId || '',
        offset: row.getBoundingClientRect().top - viewportRect.top,
      });
    });
  }, []);

  const setScroller = useCallback((node) => {
    cleanupRef.current();
    scrollerRef.current = node;
    if (!node) {
      cleanupRef.current = () => {};
      return;
    }
    let touchY = null;
    let pointerActive = false;
    let lastScrollTop = node.scrollTop;
    let lastScrollAt = performance.now();
    expandMaterializationRunway(node.clientHeight);
    const sizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => expandMaterializationRunway(node.clientHeight))
      : null;
    sizeObserver?.observe(node);
    const wheel = (event) => {
      if (event.deltaY !== 0) {
        handlersRef.current.handleUserIntent(event.deltaY < 0 ? 'older' : 'newer');
        expandMaterializationRunway(node.clientHeight, Math.abs(event.deltaY) / 16);
      }
    };
    const pointerDown = () => {
      pointerActive = true;
      lastScrollTop = node.scrollTop;
    };
    const pointerUp = () => { pointerActive = false; };
    const scroll = () => {
      const nextScrollTop = node.scrollTop;
      const now = performance.now();
      const velocity = Math.abs(nextScrollTop - lastScrollTop) / Math.max(1, now - lastScrollAt);
      if (pointerActive && nextScrollTop !== lastScrollTop) {
        handlersRef.current.handleUserIntent(nextScrollTop < lastScrollTop ? 'older' : 'newer');
      }
      lastScrollTop = nextScrollTop;
      lastScrollAt = now;
      expandMaterializationRunway(node.clientHeight, velocity);
      observeAnchor();
    };
    const touchStart = (event) => { touchY = event.touches[0]?.clientY ?? null; };
    const touchMove = (event) => {
      const y = event.touches[0]?.clientY;
      if (y != null && touchY != null && Math.abs(y - touchY) > 2) handlersRef.current.handleUserIntent(y > touchY ? 'older' : 'newer');
      touchY = y ?? null;
    };
    const key = (event) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) handlersRef.current.handleUserIntent('older');
      else if (['ArrowDown', 'PageDown', 'End'].includes(event.key) || event.key === ' ') handlersRef.current.handleUserIntent('newer');
    };
    const click = (event) => {
      // Expand/collapse is an explicit reading action. Announce that intent
      // before React changes the row height so following cannot drag the
      // reader toward the new physical tail.
      if (event.target.closest?.('button[aria-expanded], summary, [data-viewport-layout-action]')) {
        handlersRef.current.handleUserIntent('browse');
        observeAnchor();
      }
    };
    node.addEventListener('scroll', scroll, { passive: true });
    node.addEventListener('wheel', wheel, { passive: true });
    node.addEventListener('pointerdown', pointerDown, { passive: true });
    window.addEventListener('pointerup', pointerUp, { passive: true });
    node.addEventListener('touchstart', touchStart, { passive: true });
    node.addEventListener('touchmove', touchMove, { passive: true });
    node.addEventListener('keydown', key);
    node.addEventListener('click', click);
    cleanupRef.current = () => {
      node.removeEventListener('scroll', scroll);
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointerup', pointerUp);
      node.removeEventListener('touchstart', touchStart);
      node.removeEventListener('touchmove', touchMove);
      node.removeEventListener('keydown', key);
      node.removeEventListener('click', click);
      sizeObserver?.disconnect();
    };
  }, [expandMaterializationRunway, observeAnchor]);

  useEffect(() => () => {
    cleanupRef.current();
    cancelAnimationFrame(anchorFrameRef.current);
  }, []);

  // Capture the renderer's measured ranges before a channel Surface leaves.
  // ViewSession restores this only when the presentation geometry key is an
  // exact match; changed content falls back to the semantic row anchor.
  useLayoutEffect(() => () => {
    virtuosoRef.current?.getState((snapshot) => handlersRef.current.handleAdapterSnapshot(snapshot));
  }, []);

  return <TestViewport>
    <Virtuoso
      key={listKey}
      ref={virtuosoRef}
      scrollerRef={setScroller}
      className="timeline-message-list"
      components={TIMELINE_COMPONENTS}
      firstItemIndex={viewport.firstItemIndex}
      initialTopMostItemIndex={import.meta.env.MODE === 'test' || viewport.restoreStateFrom || viewport.hasInitialAnchor || viewport.hasPendingNavigation ? undefined : { index: 'LAST', align: 'end' }}
      restoreStateFrom={viewport.restoreStateFrom || undefined}
      alignToBottom
      atBottomThreshold={24}
      // Timeline rows are deliberately heterogeneous. A fabricated global
      // height makes the cold list visible before its geometry is true, then
      // corrects it on the first scroll/content resize. Let Virtuoso probe the
      // real row and commit ResizeObserver measurements in the same frame.
      skipAnimationFrameInResizeObserver
      increaseViewportBy={materializationRunway}
      overscan={{ reverse: Math.round(materializationRunway.top / 3), main: Math.round(materializationRunway.bottom / 2) }}
      data={rows}
      computeItemKey={itemKey}
      itemContent={presentationRow}
      rangeChanged={viewport.handleRangeChanged}
      startReached={viewport.handleStartReached}
      atTopStateChange={viewport.handleAtTopChange}
      atBottomStateChange={viewport.handleAtBottomChange}
      followOutput={viewport.followOutput}
    />
  </TestViewport>;
}

const PresentationRow = memo(function PresentationRow({ index, row, contentRevision, layoutClass, settled, renderRowRef }) {
  const children = renderRowRef.current(index, row);
  if (!isValidElement(children)) return children;
  // Presentation metadata belongs on the adapter's existing item root. An
  // extra wrapper would change CSS sibling relationships and is itself a
  // visual-layout decision, which an adapter must not introduce.
  return cloneElement(children, {
    className: `${children.props.className || ''} presentation-row presentation-row-${layoutClass}`.trim(),
    'data-presentation-row-id': row.id,
    'data-content-revision': contentRevision,
    'data-settled': settled || undefined,
    style: children.props.style,
  });
});
