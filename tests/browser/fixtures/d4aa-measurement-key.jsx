import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Virtuoso } from '../../../../audit-output/formal-stable-observer-193454f2/dist/index.mjs';

document.body.style.cssText = 'margin:0;font:14px/1.4 sans-serif';
document.getElementById('root').style.cssText = 'height:420px;width:0;position:relative';

const TARGET = 11;
const rows = Object.freeze(Array.from({ length: 12 }, (_, index) => Object.freeze({
  id: `row-${index}`,
  contentRevision: 'stable-content',
})));
const mounts = new Map();
const transitions = [];
const formalStates = [];
const runtimeErrors = [];
let businessWrites = 0;
let api = null;

window.addEventListener('error', (event) => {
  runtimeErrors.push({
    at: performance.now(),
    message: String(event.error?.message || event.message || event.error || 'window error'),
    rootWidth: document.getElementById('root')?.getBoundingClientRect().width || 0,
  });
});

function recordTargetElement(source, content) {
  const item = content?.parentElement;
  if (!item) return;
  transitions.push({
    source,
    at: performance.now(),
    actual: item.getBoundingClientRect().height,
    formalPreparing: item.dataset.formalPreparing || '',
    historyPreparing: item.dataset.historyPreparing || '',
    retained: item.dataset.historyRetained !== undefined,
    dataIndex: item.dataset.index || '',
    itemIndex: item.dataset.itemIndex || '',
    knownSize: Number(item.dataset.knownSize || 0),
  });
}

function recordTargetState(source) {
  recordTargetElement(source, document.querySelector(`[data-row-id="row-${TARGET}"]`));
}

function Row({ row, height, onToggle }) {
  const elementRef = useRef(null);
  useEffect(() => {
    mounts.set(row.id, (mounts.get(row.id) || 0) + 1);
  }, [row.id]);
  useLayoutEffect(() => {
    if (row.id === `row-${TARGET}`) recordTargetElement('row-layout', elementRef.current);
  }, [height, row.id]);
  return <div
    ref={elementRef}
    data-row-id={row.id}
    style={{ boxSizing: 'border-box', height, borderBottom: '1px solid #ddd' }}
  >
    <span>{row.id}</span>
    {row.id === `row-${TARGET}` && <>
      <button type="button" onClick={onToggle}>toggle local fold</button>
      <button type="button" onClick={() => { businessWrites += 1; }}>business action</button>
    </>}
  </div>;
}

function Fixture() {
  const virtuosoRef = useRef(null);
  const [targetLayout, setTargetLayout] = useState({ height: 40, revision: 'base' });
  const [targetFolded, setTargetFolded] = useState(false);
  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const [formalState, setFormalState] = useState(null);
  const rowRenderRevision = useCallback((_index, row) => JSON.stringify([
    row.contentRevision,
    row.id === `row-${TARGET}` ? targetLayout.revision : 'base',
    row.id === `row-${TARGET}` ? targetFolded : false,
  ]), [targetFolded, targetLayout.revision]);
  const renderRow = useCallback((_index, row) => (
    <Row
      row={row}
      height={row.id === `row-${TARGET}` ? targetLayout.height + (targetFolded ? 80 : 0) : 40}
      onToggle={row.id === `row-${TARGET}` ? () => setTargetFolded((value) => !value) : undefined}
    />
  ), [targetFolded, targetLayout.height]);
  const onFormalRangeStateChange = useCallback((state) => {
    formalStates.push({ ...state, at: performance.now() });
    setFormalState(state);
  }, []);

  useLayoutEffect(() => {
    api = {
      showSurface() {
        setSurfaceVisible(true);
      },
      revealHost() {
        document.getElementById('root').style.width = '640px';
      },
      changeOffscreenLayout() {
        flushSync(() => setTargetLayout({ height: 140, revision: 'external-layout-2' }));
      },
      scrollTarget() {
        virtuosoRef.current.scrollToIndex({ index: TARGET, align: 'center', behavior: 'auto' });
      },
    };
  }, []);

  return <>
    {surfaceVisible && formalState?.phase === 'pending' && formalState.blocking && <div style={{ position: 'absolute', zIndex: 2 }} role="status">正在准备频道内容…</div>}
    {surfaceVisible && formalState?.phase === 'failed' && <div style={{ position: 'absolute', zIndex: 2 }} role="alert">频道内容准备失败</div>}
    <Virtuoso
      ref={virtuosoRef}
      style={{ height: '100%', width: '100%' }}
      data={rows}
      defaultItemHeight={40}
      computeItemKey={(_index, row) => row.id}
      computeItemMeasurementKey={rowRenderRevision}
      formalRangeStateChange={onFormalRangeStateChange}
      itemContent={renderRow}
    />
  </>;
}

const observer = new MutationObserver((records) => {
  if (records.some((record) => {
    const element = record.target instanceof Element ? record.target : record.target.parentElement;
    return element?.matches?.(`[data-row-id="row-${TARGET}"]`)
      || element?.querySelector?.(`[data-row-id="row-${TARGET}"]`);
  })) recordTargetState('mutation');
});
observer.observe(document.getElementById('root'), { attributes: true, childList: true, subtree: true });

createRoot(document.getElementById('root')).render(<Fixture />);

window.d4aaMeasurementKey = {
  target: TARGET,
  ready() {
    return Boolean(api && document.querySelector('[data-testid="virtuoso-item-list"]'));
  },
  showSurface() {
    api.showSurface();
  },
  changeOffscreenLayout() {
    api.changeOffscreenLayout();
    recordTargetState('external-layout-change');
  },
  revealHost() {
    api.revealHost();
  },
  scrollTarget() {
    api.scrollTarget();
  },
  toggleLocalFold() {
    document.querySelector(`[data-row-id="row-${TARGET}"] button`)?.click();
  },
  snapshot() {
    recordTargetState('snapshot');
    const content = document.querySelector(`[data-row-id="row-${TARGET}"]`);
    const item = content?.parentElement;
    return {
      mountCount: mounts.get(`row-${TARGET}`) || 0,
      businessWrites,
      actual: item?.getBoundingClientRect().height || 0,
      formalPreparing: item?.dataset.formalPreparing || '',
      historyPreparing: item?.dataset.historyPreparing || '',
      retained: item?.dataset.historyRetained !== undefined,
      dataIndex: item?.dataset.index || '',
      knownSize: Number(item?.dataset.knownSize || 0),
      formalStates: [...formalStates],
      runtimeErrors: [...runtimeErrors],
      status: document.querySelector('[role="status"]')?.textContent || '',
      transitions: [...transitions],
    };
  },
};
