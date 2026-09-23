import React, {
  Component,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Virtuoso } from 'react-virtuoso';
import { MessageLayoutScope } from './MessageLayoutState.jsx';

// The list is a thin view over the vendored Virtuoso. Every position change —
// following new rows, keeping place while a row grows, holding the reader
// still while older history is prepended — is the vendor's; this component
// never writes scrollTop. It reports three facts to the reading owner (the
// rendered range, whether the reader is at the bottom, and whether the
// vendor's measured range is settled) and forwards three commands to the
// vendor (follow output, go to the last row, scroll by an offset the reader's
// own action caused).

class RowErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidUpdate(previous) {
    if (previous.revision !== this.props.revision && this.state.failed) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return <div className="timeline-row-error" role="alert">这条消息暂时无法显示。内容更新后会自动重试。</div>;
    }
    return this.props.children;
  }
}

function RowContent({ row, revision, renderRow }) {
  const child = renderRow(row);
  if (!isValidElement(child)) return child;
  return cloneElement(child, {
    className: [child.props.className, 'presentation-row', `presentation-row-${row.layoutClass}`]
      .filter(Boolean).join(' '),
    'data-content-revision': row.contentRevision,
    'data-render-revision': revision,
    'data-settled': row.settled || undefined,
  });
}

const MessageRow = memo(function MessageRow({ row, revision, renderRow, presentationState }) {
  return <MessageLayoutScope rowID={row.id}>
    <div
      data-presentation-row-id={row.id}
      data-visual-slot-id={row.visualSlotID || row.id}
      data-presentation-state={presentationState || undefined}
      className="presentation-row-shell"
    >
      <RowErrorBoundary revision={revision}>
        <RowContent row={row} revision={revision} renderRow={renderRow} />
      </RowErrorBoundary>
    </div>
  </MessageLayoutScope>;
}, (left, right) => left.row === right.row
  && left.revision === right.revision
  && left.presentationState === right.presentationState);

function WaitingObstructionFooter() {
  return <div className="timeline-waiting-obstruction" aria-hidden="true" />;
}

function HistoryHeader({ context }) {
  const boundary = context?.historyStartBoundary;
  return <div className="timeline-history-boundary-slot" aria-hidden={boundary?.label ? undefined : 'true'}>
    {boundary?.label && <div
      className="timeline-history-boundary"
      data-phase="exhausted"
      data-generation={boundary.generation}
      role="status"
    >{boundary.label}</div>}
  </div>;
}

const VIRTUOSO_COMPONENTS = Object.freeze({
  Footer: WaitingObstructionFooter,
  Header: HistoryHeader,
});

export function TimelineList({
  snapshot,
  reading,
  renderRow,
  rowRevision,
  rowPresentationState,
  historyStartBoundary,
}) {
  const virtuosoRef = useRef(null);
  const { list } = reading;
  const rows = snapshot.rows;
  const firstItemIndex = Number(snapshot.firstItemIndex || 1);

  useEffect(() => list.attach({
    // The vendor's own positioning: it waits for the measured range before it
    // runs, so the last row is never reached on an estimated height.
    toLatest(behavior = 'auto') {
      virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior });
    },
    // A row at the bottom grew (streaming output, an expanded fold). The
    // vendor re-follows only when it sees the growth at the bottom itself.
    followGrowth() {
      virtuosoRef.current?.autoscrollToBottom?.();
    },
    // A reader's own action moved what they were pointing at (a collapse
    // shrinks the text above its button). The vendor scrolls by the offset.
    scrollBy(top) {
      virtuosoRef.current?.scrollBy?.({ top, behavior: 'auto' });
    },
  }), [list]);

  const bindScroller = useCallback((node) => list.bindScroller(node || null), [list]);
  const measurementKey = useCallback(
    (index, row) => (rowRevision ? rowRevision(index, row) : String(row.contentRevision)),
    [rowRevision],
  );
  const context = useMemo(() => ({ historyStartBoundary }), [historyStartBoundary]);

  if (!rows.length) {
    return <div
      className="timeline-message-list"
      data-empty="true"
      role="region"
      aria-label="频道动态"
    />;
  }

  return <Virtuoso
    ref={virtuosoRef}
    className="timeline-message-list"
    role="region"
    aria-label="频道动态"
    data-reading-mode={reading.mode}
    tabIndex={0}
    data={rows}
    firstItemIndex={firstItemIndex}
    initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
    computeItemKey={(_index, row) => row.id}
    // The same row can render a different height without changing identity
    // (content revision, fold state, editing). The vendor re-measures a row
    // whose key changes before it re-enters the formal range, so a row that
    // changed off-screen never comes back at its old height.
    computeItemMeasurementKey={measurementKey}
    formalRangeStateChange={list.formalRangeStateChange}
    itemContent={(index, row) => <MessageRow
      row={row}
      revision={measurementKey(index, row)}
      renderRow={renderRow}
      presentationState={rowPresentationState?.(row) || ''}
    />}
    followOutput={list.followOutput}
    atBottomStateChange={list.atBottomStateChange}
    atBottomThreshold={24}
    rangeChanged={list.rangeChanged}
    totalListHeightChanged={list.totalListHeightChanged}
    defaultItemHeight={132}
    increaseViewportBy={900}
    scrollerRef={bindScroller}
    components={VIRTUOSO_COMPONENTS}
    context={context}
  />;
}
