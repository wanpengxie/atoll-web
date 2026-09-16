import React, { Component, cloneElement, isValidElement, memo, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { clampPosition, materializedRange, measuredLayout, readingAnchor, readingPosition, rowAt, survivingAnchor } from '../../model/measured-layout.js';

// One renderer owns measurements AND position. No third-party prepend,
// follow-output, resize or delayed index-navigation controller runs behind it.
export function VirtualTimelineAdapter(props) {
  return <MeasuredTimeline key={props.listKey} {...props} />;
}

class MeasuredTimeline extends Component {
  state = { revision: 0 };
  node = null;
  before = null;
  after = null;
  elements = new Map();
  measurements = new Map();
  layout = measuredLayout([], this.measurements);
  dimensions = { width: 0, height: 720 };
  renderRowRef = { current: null };
  inputEpoch = 0;
  command = null;
  preparing = null;
  mounted = false;
  lastObservation = {};
  pointerActive = false;
  touchY = null;
  committedPosition = 0;

  constructor(props) {
    super(props);
    const cache = props.viewport.measurementSnapshot;
    if (cache?.version === 1) {
      for (const row of cache.rows) this.measurements.set(row.id, { size: row.size, width: cache.width });
    }
  }

  capture = () => {
    // Read the native offset at commit time, not when history was requested or
    // when the last scroll callback ran. Preserve motion during async work.
    if (this.preparing?.epoch === this.inputEpoch) return this.preparing.snapshot;
    const position = this.node?.scrollTop || 0;
    return { anchor: readingAnchor(this.layout, position), position, epoch: this.inputEpoch };
  };
  getSnapshotBeforeUpdate() { return this.capture(); }
  componentDidMount() {
    this.mounted = true;
    this.props.viewport.adapterRef.current = this.api;
    for (const [type, handler] of this.events) this.node.addEventListener(type, handler, { passive: true });
    window.addEventListener('pointerup', this.onPointerUp, { passive: true });
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(this.onResize);
      this.observer.observe(this.node, { box: 'border-box' });
      for (const element of this.elements.values()) this.observer.observe(element, { box: 'border-box' });
    }
    this.commit(this.capture());
  }
  componentDidUpdate(_props, _state, snapshot) {
    this.props.viewport.adapterRef.current = this.api;
    this.commit(snapshot);
  }
  componentWillUnmount() {
    this.mounted = false;
    this.command = null;
    this.observer?.disconnect();
    window.removeEventListener('pointerup', this.onPointerUp);
    for (const [type, handler] of this.events) this.node?.removeEventListener(type, handler);
    this.observeAnchor();
    this.props.viewport.handleAdapterSnapshot({
      version: 1, width: this.dimensions.width,
      rows: [...this.measurements].filter(([id, value]) => (
        this.layout.indexes.has(id) && value.width === this.dimensions.width
      )).map(([id, value]) => ({ id, size: value.size })),
    });
    if (this.props.viewport.adapterRef.current === this.api) this.props.viewport.adapterRef.current = null;
  }

  api = {
    latest: () => this.navigate({ align: 'end' }),
    restore: ({ rowID, offset = 0 }) => this.navigate({ rowID, offset }),
    focus: ({ rowID }) => this.navigate({ rowID, align: 'center' }),
    cancelNavigation: () => {
      this.inputEpoch += 1;
      this.command = null;
      this.preparing = null;
    },
  };
  navigate(command) {
    this.command = { ...command, epoch: this.inputEpoch };
    this.setState(({ revision }) => ({ revision: revision + 1 }));
  }
  positionFor(layout, snapshot, height) {
    const command = this.command?.epoch === this.inputEpoch ? this.command : null;
    if (command) {
      if (!command.rowID && command.align === 'end') return Math.max(0, layout.height - height);
      const index = layout.indexes.get(command.rowID);
      if (index != null) {
        const size = layout.offsets[index + 1] - layout.offsets[index];
        const offset = command.align === 'center' ? (height - size) / 2 : command.offset || 0;
        return clampPosition(layout, layout.leading + layout.offsets[index] - offset, height);
      }
    }
    if (this.props.viewport.isFollowing()) return Math.max(0, layout.height - height);
    const anchor = survivingAnchor(this.layout, layout, snapshot.anchor);
    return clampPosition(layout, readingPosition(layout, anchor, snapshot.position), height);
  }
  commit(snapshot) {
    if (!this.node || this.node.clientHeight <= 0 || this.node.clientWidth <= 0) return;
    const { clientHeight: height, clientWidth: width } = this.node;
    this.dimensions = { height, width };
    for (const [id, element] of this.elements) {
      const size = element.getBoundingClientRect().height;
      if (size > 0) this.measurements.set(id, { size, width });
    }
    const layout = measuredLayout(this.props.rows, this.measurements, height);
    const position = this.positionFor(layout, snapshot, height);
    const visibleStart = rowAt(layout, position);
    const visibleEnd = rowAt(layout, position + height - 0.01) + 1;
    const range = this.renderedRange;
    // Unknown sizes may reveal more rows. Prepare them synchronously before
    // paint with the same input snapshot. Preparation never writes position.
    if (visibleStart >= 0 && (visibleStart < range.start || visibleEnd > range.end)) {
      const needed = materializedRange(layout, position, height);
      this.preparing = {
        snapshot, epoch: this.inputEpoch,
        range: { start: Math.min(range.start, needed.start), end: Math.max(range.end, needed.end) },
      };
      this.setState(({ revision }) => ({ revision: revision + 1 }));
      return;
    }
    // Update spacers and position in one layout-phase commit. Stable row keys
    // retain the existing visible DOM when a history prefix is inserted.
    this.before.style.height = String(layout.leading + layout.offsets[range.start]) + 'px';
    this.after.style.height = String(layout.offsets.at(-1) - layout.offsets[range.end]) + 'px';
    this.layout = layout;
    this.preparing = null;
    this.command = null;
    if (Math.abs(this.node.scrollTop - position) > 0.01) this.node.scrollTop = position;
    this.committedPosition = this.node.scrollTop;
    this.observe();
  }

  register = (id, node) => {
    const old = this.elements.get(id);
    if (old) this.observer?.unobserve(old);
    if (node) {
      this.elements.set(id, node);
      // Measurements include padding and borders. Observe that same box;
      // content-box observation misses padding-only layout changes entirely.
      this.observer?.observe(node, { box: 'border-box' });
    } else this.elements.delete(id);
  };
  onResize = () => {
    if (!this.mounted || this.node.clientHeight <= 0 || this.node.clientWidth <= 0) return;
    const resized = this.node.clientWidth !== this.dimensions.width || this.node.clientHeight !== this.dimensions.height;
    const changed = resized || [...this.elements].some(([id, node]) => (
      Math.abs(node.getBoundingClientRect().height - (this.measurements.get(id)?.size || 0)) > 0.01
    ));
    if (changed) flushSync(() => this.setState(({ revision }) => ({ revision: revision + 1 })));
  };
  observeAnchor() {
    if (!this.node) return;
    const anchor = readingAnchor(this.layout, this.node.scrollTop);
    if (anchor) this.props.viewport.handleAnchorObserved(anchor);
  }
  observe() {
    const node = this.node;
    const height = node.clientHeight;
    if (!height || !this.layout.rows.length) return;
    const startIndex = rowAt(this.layout, node.scrollTop);
    const endIndex = rowAt(this.layout, node.scrollTop + height - 0.01);
    const top = node.scrollTop <= 1;
    const bottom = this.layout.height - height - node.scrollTop <= 24;
    const previous = this.lastObservation;
    this.lastObservation = { startIndex, endIndex, top, bottom };
    const port = this.props.viewport;
    if (top !== previous.top) port.handleAtTopChange(top);
    if (bottom !== previous.bottom) port.handleAtBottomChange(bottom);
    if (startIndex !== previous.startIndex || endIndex !== previous.endIndex) port.handleRangeChanged({ startIndex, endIndex });
    this.observeAnchor();
  }
  intent = (direction) => {
    this.api.cancelNavigation();
    this.props.viewport.handleUserIntent(direction);
  };
  onWheel = (event) => { if (event.deltaY) this.intent(event.deltaY < 0 ? 'older' : 'newer'); };
  onTouchStart = (event) => {
    this.touchY = event.touches[0]?.clientY ?? null;
    this.intent('browse');
  };
  onTouchMove = (event) => {
    const y = event.touches[0]?.clientY;
    if (y != null && this.touchY != null && Math.abs(y - this.touchY) > 2) this.intent(y > this.touchY ? 'older' : 'newer');
    this.touchY = y ?? null;
  };
  onPointerDown = (event) => {
    this.pointerActive = event.target === this.node;
    if (this.pointerActive) this.intent('browse');
  };
  onPointerUp = () => { this.pointerActive = false; };
  onKey = (event) => {
    if (event.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) this.intent('older');
    else if (['ArrowDown', 'PageDown', 'End'].includes(event.key) || event.key === ' ') this.intent('newer');
  };
  onClick = (event) => {
    if (event.target.closest?.('button[aria-expanded], summary, [data-viewport-layout-action]')) this.intent('browse');
  };
  onScroll = () => {
    if (!this.mounted) return;
    const position = this.node.scrollTop;
    if (this.pointerActive && position !== this.committedPosition) this.intent(position < this.committedPosition ? 'older' : 'newer');
    this.committedPosition = position;
    this.observe();
    const height = this.node.clientHeight;
    const range = this.renderedRange;
    const top = this.layout.leading + this.layout.offsets[range.start];
    const bottom = this.layout.leading + this.layout.offsets[range.end];
    if ((range.start > 0 && position - top < height * 0.5)
      || (range.end < this.layout.rows.length && bottom - position - height < height * 0.5)) {
      flushSync(() => this.setState(({ revision }) => ({ revision: revision + 1 })));
    }
  };
  events = [
    ['scroll', this.onScroll], ['wheel', this.onWheel], ['touchstart', this.onTouchStart],
    ['touchmove', this.onTouchMove], ['pointerdown', this.onPointerDown],
    ['keydown', this.onKey], ['click', this.onClick],
  ];

  render() {
    const { rows, renderRow, rowRevision } = this.props;
    this.renderRowRef.current = renderRow;
    const height = this.node?.clientHeight || this.dimensions.height;
    const layout = measuredLayout(rows, this.measurements, height);
    const position = this.positionFor(layout, this.capture(), height);
    const range = this.preparing?.epoch === this.inputEpoch
      ? this.preparing.range : materializedRange(layout, position, height);
    this.renderedRange = range;
    return <div ref={(node) => { this.node = node; }} className="timeline-message-list"
      data-measured-timeline="true" tabIndex={0} role="region" aria-label="频道动态"
      style={{ overflowY: 'auto' }}>
      <div aria-hidden="true" ref={(node) => { this.before = node; }}
        style={{ height: layout.leading + layout.offsets[range.start] }} />
      {rows.slice(range.start, range.end).map((row) => <PresentationRow
        key={row.id} row={row} contentRevision={row.contentRevision}
        layoutClass={row.layoutClass} settled={row.settled}
        renderRowRef={this.renderRowRef} renderRevision={rowRevision?.(null, row) || ''}
        register={this.register}
      />)}
      <div aria-hidden="true" ref={(node) => { this.after = node; }}
        style={{ height: layout.offsets.at(-1) - layout.offsets[range.end] }} />
    </div>;
  }
}

const PresentationRow = memo(function PresentationRow({ row, contentRevision, layoutClass, settled, renderRowRef, register }) {
  const ref = useCallback((node) => register(row.id, node), [register, row.id]);
  const children = renderRowRef.current(null, row);
  if (!isValidElement(children)) return children;
  return cloneElement(children, {
    ref,
    className: [children.props.className, 'presentation-row', 'presentation-row-' + layoutClass].filter(Boolean).join(' '),
    'data-presentation-row-id': row.id,
    'data-content-revision': contentRevision,
    'data-settled': settled || undefined,
  });
});
