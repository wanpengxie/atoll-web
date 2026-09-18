import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Virtuoso } from 'react-virtuoso';

const makeRow = (id, serial) => ({ id, serial, lines: 2 + Math.abs(serial % 19) });
const initialRows = Array.from({ length: 180 }, (_, index) => makeRow(`live-${index}`, index));
const diagnostics = {
  phase: 'initial', frames: [], ranges: [], writers: [], ownerLayoutWrites: [], handoffs: [], longTasks: [], prepared: null,
};
let api = null;

function Row({ row, source = 'virtuoso' }) {
  return <article className="bridge-row" data-row-id={row.id} data-source={source}>
    <strong>{row.id}</strong>
    {Array.from({ length: row.lines }, (_, index) => <p key={index}>{`${row.id} semantic paragraph ${index} ${'wrapped content '.repeat(1 + index % 5)}`}</p>)}
  </article>;
}

function App() {
  const [rows, setRows] = useState(initialRows);
  const [firstItemIndex, setFirstItemIndex] = useState(1_000_000);
  const [scrollParent, setScrollParent] = useState(null);
  const [prefix, setPrefix] = useState(null);
  const rootRef = useRef(null);
  const prefixRef = useRef(null);
  const revealRef = useRef(null);

  const commitHandoff = (reason) => {
    const reveal = revealRef.current;
    if (!reveal || reveal.committed) return;
    reveal.committed = true;
    clearTimeout(reveal.timer);
    diagnostics.phase = 'handoff';
    const before = {
      scrollTop: rootRef.current.scrollTop,
      scrollHeight: rootRef.current.scrollHeight,
      visible: visibleRows(rootRef.current),
    };
    const nextRows = [...reveal.segment.rows, ...rows];
    flushSync(() => {
      setRows(nextRows);
      setFirstItemIndex((current) => current - reveal.segment.rows.length);
      setPrefix(null);
    });
    const afterCommit = {
      scrollTop: rootRef.current.scrollTop,
      scrollHeight: rootRef.current.scrollHeight,
      visible: visibleRows(rootRef.current),
    };
    diagnostics.handoffs.push({
      reason,
      commitID: reveal.segment.commitID,
      activation: reveal.segment.activation,
      orderedIDs: reveal.segment.orderedIDs,
      fullUnitBoundary: reveal.segment.fullUnitBoundary,
      sameObjectIdentity: reveal.segment.rows.every((row, index) => nextRows[index] === row),
      before,
      afterCommit,
    });
    diagnostics.phase = 'post-handoff';
    reveal.resolve?.(diagnostics.handoffs.at(-1));
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    setScrollParent(root);
    for (const method of ['scrollTo', 'scrollBy']) {
      const original = root[method]?.bind(root);
      if (!original) continue;
      root[method] = (...args) => {
        diagnostics.writers.push({ method, args, phase: diagnostics.phase, epochMs: Date.now(), stack: new Error().stack });
        return original(...args);
      };
    }
    root.addEventListener('wheel', (event) => {
      const reveal = revealRef.current;
      if (!event.isTrusted || !reveal || reveal.committed || event.deltaY <= 0) return;
      const node = prefixRef.current;
      const targetBlockSize = node?.firstElementChild?.scrollHeight || 0;
      node.style.transition = 'none';
      node.style.gridTemplateRows = '1fr';
      diagnostics.ownerLayoutWrites.push({ owner: 'HistoryRevealTransition', phase: 'trusted-reverse-complete', blockSize: targetBlockSize, epochMs: Date.now() });
      commitHandoff('trusted-reverse-wheel');
    }, { capture: true, passive: true });
    if ('PerformanceObserver' in window) {
      try {
        new PerformanceObserver((list) => diagnostics.longTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })))).observe({ type: 'longtask', buffered: true });
      } catch {}
    }
  }, []);

  useLayoutEffect(() => {
    if (!prefix || !prefixRef.current) return;
    const node = prefixRef.current;
    requestAnimationFrame(() => {
      diagnostics.phase = 'reveal';
      node.dataset.state = 'revealing';
      diagnostics.ownerLayoutWrites.push({ owner: 'HistoryRevealTransition', phase: 'reveal', blockSize: node.firstElementChild?.scrollHeight || 0, epochMs: Date.now() });
      const reveal = revealRef.current;
      reveal.timer = setTimeout(() => commitHandoff('transition-timeout'), 260);
      node.addEventListener('transitionend', () => commitHandoff('transitionend'), { once: true });
    });
  }, [prefix]);

  const context = useMemo(() => ({}), []);
  api = {
    prepare(count = 30) {
      const generation = Number(diagnostics.prepared?.generation || 0) + 1;
      const batch = Array.from({ length: count }, (_, index) => makeRow(`bridge-${generation}-${index}`, -(generation * count) + index));
      const segment = Object.freeze({
        commitID: `bridge-commit-${generation}`,
        activation: 'foreground-slab-bridge',
        orderedIDs: Object.freeze(batch.map((row) => row.id)),
        rows: Object.freeze(batch),
        fullUnitBoundary: Object.freeze({ first: batch[0].id, last: batch.at(-1).id, count: batch.length }),
      });
      diagnostics.prepared = { generation, segment };
      return { generation, commitID: segment.commitID, ids: segment.orderedIDs, scrollHeight: rootRef.current.scrollHeight };
    },
    revealAndHandoff() {
      if (rootRef.current.scrollTop > 1) throw new Error(`top reveal requires true top, got ${rootRef.current.scrollTop}`);
      const prepared = diagnostics.prepared;
      if (!prepared) throw new Error('nothing prepared');
      diagnostics.prepared = null;
      diagnostics.phase = 'prepared';
      const settled = new Promise((resolve) => { revealRef.current = { segment: prepared.segment, resolve, committed: false }; });
      setPrefix(prepared.segment.rows);
      return { generation: prepared.generation, commitID: prepared.segment.commitID, ids: prepared.segment.orderedIDs, settled };
    },
    snapshot() {
      return {
        phase: diagnostics.phase,
        rows: rows.length,
        firstItemIndex,
        range: diagnostics.ranges.at(-1) || null,
        writers: structuredClone(diagnostics.writers),
        ownerLayoutWrites: structuredClone(diagnostics.ownerLayoutWrites),
        handoffs: structuredClone(diagnostics.handoffs),
        longTasks: structuredClone(diagnostics.longTasks),
        scrollTop: rootRef.current.scrollTop,
        scrollHeight: rootRef.current.scrollHeight,
        clientHeight: rootRef.current.clientHeight,
        visible: visibleRows(rootRef.current),
      };
    },
    takeFrames() { return structuredClone(diagnostics.frames); },
    clearFrames() { diagnostics.frames.length = 0; },
    clearEvidence() {
      diagnostics.frames.length = 0;
      diagnostics.ranges.length = 0;
      diagnostics.writers.length = 0;
      diagnostics.ownerLayoutWrites.length = 0;
      diagnostics.handoffs.length = 0;
      diagnostics.longTasks.length = 0;
    },
  };

  return <div ref={rootRef} className="bridge-root" aria-label="shared scroll parent">
    {prefix && <div ref={prefixRef} className="history-reveal" data-state="prepared"><div className="history-reveal-inner">
      {prefix.map((row) => <Row key={row.id} row={row} source="prefix" />)}
    </div></div>}
    {scrollParent && <Virtuoso
      customScrollParent={scrollParent}
      data={rows}
      firstItemIndex={firstItemIndex}
      computeItemKey={(_, row) => row.id}
      defaultItemHeight={132}
      increaseViewportBy={900}
      overscan={900}
      components={{ List: React.forwardRef(function List(props, ref) { return <div {...props} ref={ref} data-bridge-list="true" />; }) }}
      context={context}
      rangeChanged={(range) => diagnostics.ranges.push({ epochMs: Date.now(), ...range, scrollTop: rootRef.current?.scrollTop || 0 })}
      itemContent={(_, row) => <Row row={row} />}
    />}
  </div>;
}

function visibleRows(root) {
  if (!root) return [];
  const bounds = root.getBoundingClientRect();
  return [...root.querySelectorAll('[data-row-id]')].map((node) => {
    const rect = node.getBoundingClientRect();
    return { id: node.dataset.rowId, source: node.dataset.source, top: rect.top - bounds.top, bottom: rect.bottom - bounds.top };
  }).filter((row) => row.bottom > 0 && row.top < bounds.height);
}

function sample(timestamp) {
  const root = document.querySelector('.bridge-root');
  if (root) diagnostics.frames.push({
    epochMs: performance.timeOrigin + timestamp,
    phase: diagnostics.phase,
    scrollTop: root.scrollTop,
    scrollHeight: root.scrollHeight,
    clientHeight: root.clientHeight,
    range: diagnostics.ranges.at(-1) || null,
    visible: visibleRows(root),
    emptyViewport: visibleRows(root).length === 0,
    prefixMounted: Boolean(root.querySelector('.history-reveal')),
    prefixHeight: root.querySelector('.history-reveal')?.getBoundingClientRect().height || 0,
  });
  requestAnimationFrame(sample);
}

createRoot(document.querySelector('#root')).render(<App />);
window.bridgePrototype = new Proxy({}, { get: (_, property) => (...args) => api?.[property](...args) });
requestAnimationFrame(sample);
