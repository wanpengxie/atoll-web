import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MessageList } from '../../../src/ui/timeline/LegendMessageList.jsx';
import { useReadingSession } from '../../../src/ui/timeline/useReadingSession.js';
import { createViewSessionStore } from '../../../src/model/view-session.js';
import '../../../src/styles/timeline.css';

document.body.style.cssText = 'margin:0;font:16px/1.5 sans-serif;--workspace:white';
const store = createViewSessionStore({ storage: null });
const rowsFor = (channel) => Array.from({ length: 120 }, (_, i) => Object.freeze({
  id: `${channel}-${i}`, seqLow: i + 1, seqHigh: i + 1, contentRevision: 1,
  lines: 3 + i % 9, layoutClass: 'normal',
  longText: i === 60 || i === 118
    ? Array.from({ length: 900 }, (_, word) => `${channel}-${i}-long-${word}`).join(' ')
    : '',
}));
const channels = new Map(['a', 'b'].map((channel) => [channel, rowsFor(channel)]));
const firstIndexes = new Map(['a', 'b'].map((channel) => [channel, 1_000_000]));
let revision = 1;
let reading;
let paint;
let switchChannel;
let active = 'a';
const history = { status: { hasOlder: false }, request: async () => ({ kind: 'exhausted' }) };
const anchor = () => {
  const root = document.querySelector('.timeline-message-list');
  const top = root.getBoundingClientRect().top;
  const row = [...root.querySelectorAll('[data-presentation-row-id]')].find((node) => node.getBoundingClientRect().bottom > top);
  return {
    id: row?.dataset.presentationRowId,
    top: row?.getBoundingClientRect().top - top,
    rowHeight: row?.getBoundingClientRect().height,
    scrollTop: root.scrollTop,
    scrollHeight: root.scrollHeight,
    clientHeight: root.clientHeight,
    maxScrollTop: root.scrollHeight - root.clientHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
};
const debugGeometry = () => {
  const root = document.querySelector('.timeline-message-list');
  const rootRect = root.getBoundingClientRect();
  const list = root.querySelector('[data-testid="virtuoso-item-list"]');
  const listRect = list?.getBoundingClientRect();
  const materialized = [...root.querySelectorAll('[data-presentation-row-id]')].map((node) => {
    const rect = node.getBoundingClientRect();
    const item = node.closest('[data-index]');
    return {
      id: node.dataset.presentationRowId,
      index: Number(item?.dataset.index ?? -1),
      top: rect.top - rootRect.top,
      bottom: rect.bottom - rootRect.top,
      height: rect.height,
    };
  });
  const current = reading?.getSession?.() || reading?.session || null;
  return {
    revision,
    activationID: current?.activationID || '',
    inputEpoch: Number(current?.inputEpoch || 0),
    mode: current?.mode || '',
    anchor: anchor(),
    viewport: {
      scrollTop: root.scrollTop,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
    },
    list: listRect ? {
      top: listRect.top - rootRect.top,
      bottom: listRect.bottom - rootRect.top,
      height: listRect.height,
      paddingTop: getComputedStyle(list).paddingTop,
      paddingBottom: getComputedStyle(list).paddingBottom,
      transform: getComputedStyle(list).transform,
    } : null,
    materialized,
  };
};
const rowAnchor = (id) => {
  const root = document.querySelector('.timeline-message-list');
  const row = [...root.querySelectorAll('[data-presentation-row-id]')]
    .find((node) => node.dataset.presentationRowId === id);
  return {
    id: row?.dataset.presentationRowId,
    top: row ? row.getBoundingClientRect().top - root.getBoundingClientRect().top : null,
    visible: row ? getComputedStyle(row).visibility !== 'hidden' : false,
  };
};
const caretOffset = (block, x, y) => {
  const range = document.caretRangeFromPoint?.(x, y);
  if (!range || !block.contains(range.startContainer)) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === range.startContainer) return offset + range.startOffset;
    offset += node.textContent?.length || 0;
  }
  return null;
};
const readingPoint = (bookmark) => {
  const root = document.querySelector('.timeline-message-list');
  const row = [...root.querySelectorAll('[data-presentation-row-id]')]
    .find((node) => node.dataset.presentationRowId === bookmark?.messageID);
  const block = row && [...row.querySelectorAll('[data-reading-block-id]')]
    .find((node) => node.dataset.readingBlockId === bookmark?.blockID);
  const rootTop = root.getBoundingClientRect().top;
  const bounds = root.getBoundingClientRect();
  return {
    id: row?.dataset.presentationRowId,
    blockID: block?.dataset.readingBlockId,
    blockText: block?.textContent || '',
    rowTop: row ? row.getBoundingClientRect().top - rootTop : null,
    blockTop: block ? block.getBoundingClientRect().top - rootTop : null,
    textOffset: block ? caretOffset(
      block,
      block.getBoundingClientRect().left + 2,
      Math.max(block.getBoundingClientRect().top, bounds.top) + 2,
    ) : null,
    visible: Boolean(row) && getComputedStyle(row).visibility !== 'hidden',
  };
};

function Conversation({ channel, snapshot }) {
  const session = useReadingSession({ channelID: channel, viewKey: channel, snapshot, history, viewSessions: store });
  useLayoutEffect(() => { reading = session; });
  return <MessageList snapshot={snapshot} reading={session} renderRow={(row) => <article>
    <strong>{row.id}</strong>
    {row.longText
      ? <p data-reading-block-id="long" style={{ margin: '4px 0' }}>{row.longText}</p>
      : Array.from({ length: row.lines }, (_, i) => <p key={i} data-reading-block-id={`p-${i}`} style={{ margin: '4px 0' }}>{row.id} paragraph {i}</p>)}
  </article>} />;
}
function App() {
  const [channel, select] = useState('a');
  const [change, update] = useState({ kind: 'rebase', updated: [] });
  paint = (next) => update({ ...next });
  switchChannel = select;
  const rows = channels.get(channel);
  const snapshot = { viewID: channel, revision, firstItemIndex: firstIndexes.get(channel), rows, orderedIDs: rows.map((row) => row.id), entities: new Map(rows.map((row) => [row.id, row])), changes: change };
  return <div style={{ display: 'flex', height: 600 }}><Conversation key={channel} channel={channel} snapshot={snapshot} /></div>;
}
flushSync(() => createRoot(document.getElementById('root')).render(<App />));
window.readingLifecycle = {
  anchor,
  debugGeometry,
  rowAnchor,
  readingPoint,
  session: () => reading.session,
  saved: (channel = active) => store.readView(channel, channel),
  switch(channel) { active = channel; flushSync(() => switchChannel(channel)); },
  async scrollLongBlockToMiddle(messageID = 'a-118') {
    const root = document.querySelector('.timeline-message-list');
    let block = root.querySelector(`[data-presentation-row-id="${messageID}"] [data-reading-block-id="long"]`);
    if (!block) {
      const targetIndex = channels.get('a').findIndex((row) => row.id === messageID);
      root.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
      root.scrollTop = (root.scrollHeight - root.clientHeight) * targetIndex / Math.max(1, channels.get('a').length - 1);
      root.dispatchEvent(new Event('scroll'));
      for (let frame = 0; frame < 20 && !block; frame++) {
        await new Promise(requestAnimationFrame);
        block = root.querySelector(`[data-presentation-row-id="${messageID}"] [data-reading-block-id="long"]`);
        if (!block) {
          const currentID = root.querySelector('[data-presentation-row-id]')?.dataset.presentationRowId;
          const currentIndex = channels.get('a').findIndex((row) => row.id === currentID);
          if (currentIndex >= 0) {
            root.scrollTop += (targetIndex - currentIndex) * 180;
            root.dispatchEvent(new Event('scroll'));
          }
        }
      }
    }
    if (!block) return null;
    // A virtualized jump can first position from estimated sizes and correct
    // itself after the long row is measured. Establish the intended test
    // precondition from committed geometry instead of returning the first
    // transient bookmark and racing the later measurement correction.
    let stableFrames = 0;
    for (let frame = 0; frame < 32; frame++) {
      block = root.querySelector(`[data-presentation-row-id="${messageID}"] [data-reading-block-id="long"]`);
      let delta = 0;
      if (block) {
        const bounds = root.getBoundingClientRect();
        const blockBounds = block.getBoundingClientRect();
        delta = blockBounds.top - bounds.top + blockBounds.height / 2 - bounds.height / 2;
      } else {
        const targetIndex = channels.get('a').findIndex((row) => row.id === messageID);
        const currentID = root.querySelector('[data-presentation-row-id]')?.dataset.presentationRowId;
        const currentIndex = channels.get('a').findIndex((row) => row.id === currentID);
        if (currentIndex >= 0) delta = (targetIndex - currentIndex) * 180;
      }
      if (Math.abs(delta) > 1) {
        root.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true }));
        root.scrollTop += delta;
        root.dispatchEvent(new Event('scroll'));
        stableFrames = 0;
      }
      await new Promise(requestAnimationFrame);
      const bookmark = store.readView('a', 'a').bookmark;
      block = root.querySelector(`[data-presentation-row-id="${messageID}"] [data-reading-block-id="long"]`);
      if (block && bookmark?.messageID === messageID && Math.abs(delta) <= 1) {
        stableFrames += 1;
        if (stableFrames >= 6) return bookmark;
      } else {
        stableFrames = 0;
      }
    }
    return store.readView('a', 'a').bookmark;
  },
  revise(messageID) {
    const rows = channels.get(active);
    const target = rows.find((row) => row.id === messageID) || rows.at(-1);
    channels.set(active, rows.map((row) => row === target ? Object.freeze({ ...row, lines: row.lines + 1, contentRevision: row.contentRevision + 1 }) : row));
    revision++;
    flushSync(() => paint({ kind: 'revise', updated: [target.id] }));
    return target.id;
  },
  reviseLast() {
    return this.revise(channels.get(active).at(-1).id);
  },
  prependActive(count = 8) {
    const before = anchor();
    const rows = channels.get(active);
    const firstSeq = Number(rows[0]?.seqLow || 1);
    const inserted = Array.from({ length: count }, (_, index) => Object.freeze({
      id: `${active}-late-prepend-${revision}-${index}`,
      seqLow: firstSeq - count + index,
      seqHigh: firstSeq - count + index,
      contentRevision: 1,
      lines: 4 + index % 3,
      layoutClass: 'normal',
      longText: '',
    }));
    channels.set(active, [...inserted, ...rows]);
    firstIndexes.set(active, firstIndexes.get(active) - inserted.length);
    revision++;
    flushSync(() => paint({ kind: 'prepend', inserted: inserted.map((row) => row.id), updated: [] }));
    return before;
  },
  // Browser scroll positions change before their asynchronously delivered
  // scroll event. A data commit can occur in precisely that interval.
  scrollAndRevise(delta) {
    const node = document.querySelector('.timeline-message-list');
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: delta }));
    node.scrollTop += delta;
    const before = anchor();
    this.reviseLast();
    return before;
  },
  scrollAndSwitch(delta, channel) {
    const node = document.querySelector('.timeline-message-list');
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: delta }));
    node.scrollTop += delta;
    node.dispatchEvent(new Event('scroll'));
    const before = anchor();
    this.switch(channel);
    return before;
  },
  deleteLongAnchor(messageID = 'a-118') {
    const rows = channels.get('a');
    channels.set('a', rows.filter((row) => row.id !== messageID));
    revision++;
  },
};
