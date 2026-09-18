import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MessageList } from '../../../src/ui/timeline/LegendMessageList.jsx';
import { useReadingSession } from '../../../src/ui/timeline/useReadingSession.js';
import { createViewSessionStore } from '../../../src/model/view-session.js';
import '../../../src/styles/timeline.css';

document.documentElement.style.cssText = '--workspace: white; --timeline-track: 760px;';
document.body.style.cssText = 'margin:0; font: 16px/1.5 sans-serif';
document.getElementById('root').style.cssText = 'display:flex; width:100%; height:600px; min-height:0';

const makeRow = (id, seq, lines, prefixBlocks = 0, extraHeight = 0) => Object.freeze({
  id, seqLow: seq, seqHigh: seq, contentRevision: `1:${seq}:${lines}:${prefixBlocks}:${extraHeight}`,
  layoutClass: lines > 8 ? 'rich' : 'normal', settled: true, lines, prefixBlocks, extraHeight,
});

let rows = Array.from({ length: 400 }, (_, index) => makeRow(`row-${index}`, index + 1, 1 + index % 17));
let revision = 1;
let firstItemIndex = 1_000_000;
let changes = { kind: 'rebase', prefixCount: 0, inserted: [], updated: [], removed: [] };
let reading;
let generation = 0;
let frameTrace = [];
const store = createViewSessionStore({ storage: null });
const history = {
  status: { hasOlder: false, attached: true, generation: 1, messageCurrent: true, headSeq: 400, presentationRevision: 1 },
  request: async () => ({ kind: 'exhausted' }),
};
const root = createRoot(document.getElementById('root'));

const snapshot = () => ({
  viewID: 'fixture', revision, sourceRevision: revision, firstItemIndex, orderedIDs: rows.map((row) => row.id), rows,
  entities: new Map(rows.map((row) => [row.id, row])), changes,
});

function Fixture() {
  const current = snapshot();
  history.status.headSeq = current.rows.at(-1)?.seqHigh || 0;
  history.status.presentationRevision = current.sourceRevision;
  const owner = useReadingSession({
    channelID: 'fixture', viewKey: 'fixture', snapshot: current, history, viewSessions: store,
  });
  useLayoutEffect(() => { reading = owner; });
  return <MessageList
    snapshot={current}
    reading={owner}
    renderRow={(row) => <div className="timeline-virtual-item">
      <strong>{row.id}</strong>
      {Array.from({ length: row.prefixBlocks }, (_, index) => (
        <p key={`prefix-${index}`} data-reading-block-id={`p:${index + 1}`} style={{ margin: '3px 0' }}>
          {`新插入前文 ${row.id} ${index}`}
        </p>
      ))}
      {Array.from({ length: row.lines }, (_, index) => (
        <p key={`body-${index}`} data-reading-block-id={`p:${row.prefixBlocks + index + 1}`} style={{ margin: '3px 0' }}>
          {`${row.id} 原正文段落 ${index} ${('异构长文本 Natural wrapped message content. ').repeat(1 + index % 8)}`}
        </p>
      ))}
      {row.extraHeight > 0 && <div data-fixture-growth style={{ height: row.extraHeight }} />}
    </div>}
  />;
}

const paint = () => flushSync(() => root.render(<Fixture />));
const scroller = () => document.querySelector('.timeline-message-list');
const anchor = () => {
  const top = scroller().getBoundingClientRect().top;
  const node = [...scroller().querySelectorAll('[data-presentation-row-id]')]
    .filter((row) => row.getBoundingClientRect().bottom > top + 0.5)
    .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0];
  return { id: node?.dataset.presentationRowId, offset: (node?.getBoundingClientRect().top || 0) - top };
};
const blockAnchor = () => {
  const bounds = scroller().getBoundingClientRect();
  const node = [...scroller().querySelectorAll('[data-reading-block-id]')]
    .filter((block) => block.getBoundingClientRect().bottom > bounds.top + 0.5)
    .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0];
  return { text: node?.textContent || '', offset: (node?.getBoundingClientRect().top || 0) - bounds.top };
};

paint();

window.readingFixture = {
  state() { return reading?.session; },
  anchor,
  blockAnchor,
  scroll(delta) {
    const node = scroller();
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true }));
    node.scrollTop += delta;
    node.dispatchEvent(new Event('scroll'));
  },
  beginFrameTrace(count = 24) {
    frameTrace = [];
    const sample = () => {
      const node = scroller();
      frameTrace.push({
        gap: node.scrollHeight - node.clientHeight - node.scrollTop,
        mode: reading?.session.mode,
        anchor: anchor().id,
      });
      if (frameTrace.length < count) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  },
  frameTrace() { return frameTrace; },
  prepend() {
    generation += 1;
    const older = Array.from({ length: 30 }, (_, index) => (
      makeRow(`old-${generation}-${index}`, -(generation * 30) + index, 1 + index % 23)
    ));
    rows = [...older, ...rows];
    firstItemIndex -= older.length;
    revision += 1;
    changes = { kind: 'prepend', prefixCount: older.length, inserted: older.map((row) => row.id), updated: [], removed: [] };
    paint();
  },
  append() {
    generation += 1;
    const row = makeRow(`new-${generation}`, rows.at(-1).seqHigh + 1, 12);
    rows = [...rows, row];
    revision += 1;
    changes = { kind: 'append', prefixCount: 0, inserted: [row.id], updated: [], removed: [] };
    paint();
  },
  growTail() {
    const tail = rows.at(-1);
    rows = rows.map((row) => row === tail
      ? makeRow(row.id, row.seqLow, row.lines + 14, row.prefixBlocks)
      : row);
    revision += 1;
    changes = { kind: 'revise', prefixCount: 0, inserted: [], updated: [tail.id], removed: [] };
    paint();
  },
  growBelowViewport(delta = 28) {
    const viewport = scroller().getBoundingClientRect();
    const target = [...scroller().querySelectorAll('[data-presentation-row-id]')]
      .filter((node) => node.getBoundingClientRect().top >= viewport.bottom)
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0];
    const id = target?.dataset.presentationRowId || '';
    if (!id) return { id: '', before: anchor() };
    const before = anchor();
    rows = rows.map((row) => row.id === id
      ? makeRow(row.id, row.seqLow, row.lines, row.prefixBlocks, row.extraHeight + delta)
      : row);
    revision += 1;
    changes = { kind: 'revise', prefixCount: 0, inserted: [], updated: [id], removed: [] };
    paint();
    return { id, before };
  },
  expandViewportToClamp() {
    document.getElementById('root').style.height = '1800px';
    window.dispatchEvent(new Event('resize'));
  },
  installNestedScroller() {
    const row = [...scroller().querySelectorAll('[data-presentation-row-id]')]
      .find((node) => node.getBoundingClientRect().bottom > scroller().getBoundingClientRect().top + 20);
    if (!row) return false;
    const measuredItem = row.closest('[data-known-size]');
    if (!measuredItem) return false;
    const nested = document.createElement('div');
    nested.className = 'fixture-nested-scroll';
    nested.dataset.hostKnownSizeBefore = measuredItem.dataset.knownSize || '0';
    nested.tabIndex = 0;
    nested.style.cssText = 'height:64px; overflow-y:auto; border:1px solid #999';
    const content = document.createElement('div');
    content.style.height = '360px';
    content.textContent = 'nested scroll content';
    nested.append(content);
    row.append(nested);
    nested.scrollTop = 80;
    return true;
  },
  nestedLayout() {
    const nested = document.querySelector('.fixture-nested-scroll');
    const measuredItem = nested?.closest('[data-known-size]');
    return {
      knownSizeBefore: Number(nested?.dataset.hostKnownSizeBefore || 0),
      knownSize: Number(measuredItem?.dataset.knownSize || 0),
      mainTop: Number(scroller()?.scrollTop || 0),
      gap: Number((scroller()?.scrollHeight || 0) - (scroller()?.clientHeight || 0) - (scroller()?.scrollTop || 0)),
    };
  },
  growNestedHost() {
    const nested = document.querySelector('.fixture-nested-scroll');
    if (!nested) return false;
    nested.style.height = '96px';
    return true;
  },
  dragScrollbarToBottom() {
    const node = scroller();
    const bounds = node.getBoundingClientRect();
    node.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerType: 'mouse', button: 0,
      clientX: bounds.right - 2, clientY: bounds.top + 120,
    }));
    node.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerType: 'mouse', buttons: 1,
      clientX: bounds.right - 2, clientY: bounds.bottom - 2,
    }));
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event('scroll'));
    node.dispatchEvent(new Event('scrollend'));
  },
  prependBlockInsideAnchor() {
    const current = anchor();
    rows = rows.map((row) => row.id === current.id
      ? makeRow(row.id, row.seqLow, row.lines, row.prefixBlocks + 1)
      : row);
    revision += 1;
    changes = { kind: 'revise', prefixCount: 0, inserted: [], updated: [current.id], removed: [] };
    paint();
  },
  returnToBottom() { reading.jumpToLatest(); },
  resizeAfterUpwardTakeover() {
    this.scroll(-240);
    this.growTail();
  },
  selectAcrossVisibleRows() {
    const nodes = [...scroller().querySelectorAll('[data-reading-block-id]')];
    if (nodes.length < 3) return '';
    const range = document.createRange();
    range.setStart(nodes[0], 0);
    range.setEnd(nodes[2], nodes[2].childNodes.length);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  },
};
