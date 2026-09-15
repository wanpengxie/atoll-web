import React, { cloneElement, isValidElement, useCallback } from 'react';
import { Virtuoso, VirtuosoMockContext } from 'react-virtuoso';

function TestViewport({ children }) {
  if (import.meta.env.MODE !== 'test') return children;
  return <VirtuosoMockContext.Provider value={{ viewportHeight: 720, itemHeight: 96 }}>{children}</VirtuosoMockContext.Provider>;
}

// The only module allowed to know react-virtuoso's API. Conversation owns
// intent, the viewport controller owns scroll semantics, and this adapter owns
// DOM range materialization and height measurement.
export function VirtualTimelineAdapter({ listKey, rows, viewport, itemKey, renderRow }) {
  const presentationRow = useCallback((index, row) => (
    <PresentationRow row={row}>
      {renderRow(index, row)}
    </PresentationRow>
  ), [renderRow]);

  return <TestViewport>
    <Virtuoso
      key={listKey}
      ref={viewport.listRef}
      scrollerRef={viewport.setScroller}
      className="timeline-message-list"
      firstItemIndex={viewport.firstItemIndex}
      initialTopMostItemIndex={import.meta.env.MODE === 'test' || viewport.hasInitialAnchor ? undefined : { index: 'LAST', align: 'end' }}
      alignToBottom
      atBottomThreshold={24}
      defaultItemHeight={110}
      increaseViewportBy={{ top: 720, bottom: 320 }}
      data={rows}
      computeItemKey={itemKey}
      itemContent={presentationRow}
      rangeChanged={viewport.handleRangeChanged}
      startReached={viewport.handleStartReached}
      atTopStateChange={viewport.handleAtTopChange}
      atBottomStateChange={viewport.handleAtBottomChange}
      totalListHeightChanged={viewport.followTail}
    />
  </TestViewport>;
}

function PresentationRow({ row, children }) {
  if (!isValidElement(children)) return children;
  // Presentation metadata belongs on the adapter's existing item root. An
  // extra wrapper would change CSS sibling relationships and is itself a
  // visual-layout decision, which an adapter must not introduce.
  return cloneElement(children, {
    className: `${children.props.className || ''} presentation-row presentation-row-${row.layoutClass}`.trim(),
    'data-presentation-row-id': row.id,
    'data-content-revision': row.contentRevision,
    'data-settled': row.settled || undefined,
    style: children.props.style,
  });
}
