import React, { useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createViewSessionStore } from '../../../src/model/view-session.js';
import { MarkdownContent } from '../../../src/ui/MarkdownContent.jsx';
import { MessageList } from '../../../src/ui/timeline/LegendMessageList.jsx';
import { useReadingSession } from '../../../src/ui/timeline/useReadingSession.js';
import '../../../src/styles.css';

document.documentElement.style.cssText = '--workspace:#fff; --timeline-track:760px;';
document.body.style.cssText = 'margin:0; font:14px/1.45 sans-serif; background:#fff;';
document.getElementById('root').style.cssText = 'display:flex; width:100%; height:640px; min-height:0;';

const root = createRoot(document.getElementById('root'));
const adapterTrace = [];
window.__ATOLL_READING_TRACE__ = (entry) => adapterTrace.push(entry);
const targetIndex = Math.max(0, Number(new URLSearchParams(location.search).get('target')) || 0);
const fixtureStorage = targetIndex ? (() => {
  const values = new Map([[
    'atoll.view-session.v2.production-perf',
    JSON.stringify({
      schema: 2,
      preferences: {},
      readings: {
        ['production-perf\u0000production-perf']: {
          revision: 1,
          mode: 'browsing',
          bookmark: { messageID: `perf-row-${targetIndex}`, seq: targetIndex, viewportOffset: 0 },
          unseenTail: 0,
          unseenKeys: [],
          unseenRecords: [],
        },
      },
    }),
  ]]);
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
})() : null;
const store = createViewSessionStore({ principalID: targetIndex ? 'production-perf' : '', storage: fixtureStorage });
const seededReading = store.readView('production-perf', 'production-perf');
const history = {
  status: { hasOlder: false },
  request: async () => ({ kind: 'exhausted' }),
};
const longTasks = [];
let reading = null;
let snapshot = Object.freeze({
  viewID: 'production-perf', revision: 0, sourceRevision: 0, firstItemIndex: 1_000_000,
  orderedIDs: Object.freeze([]), entities: new Map(), rows: Object.freeze([]),
  changes: Object.freeze({ kind: 'empty', prefixCount: 0, inserted: Object.freeze([]), updated: Object.freeze([]), removed: Object.freeze([]) }),
});

try {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  });
  observer.observe({ type: 'longtask', buffered: true });
} catch { /* Chromium exposes longtask; the fixture remains usable elsewhere. */ }

function Fixture() {
  const owner = useReadingSession({
    channelID: 'production-perf', viewKey: 'production-perf', snapshot, history, viewSessions: store,
  });
  useLayoutEffect(() => { reading = owner; });
  return <MessageList
    snapshot={snapshot}
    reading={owner}
    surfaceVisible
    renderRow={(row) => <article className="timeline-virtual-item" data-perf-seq={row.seqLow}>
      <MarkdownContent contentKey={`perf:${row.id}:body`} text={row.text} />
    </article>}
  />;
}

function render() {
  flushSync(() => root.render(<Fixture />));
}

function ordinaryText(index) {
  return `Message ${index.toLocaleString('en-US')}\n\nBounded production row ${index}; selectable Markdown body.`;
}

function longMarkdown(characters = 100_000, blocks = 320) {
  const target = Math.max(1, Math.floor(characters / blocks));
  const values = [];
  for (let index = 0; index < blocks; index += 1) {
    const prefix = index % 7 === 0 ? `## Section ${index}\n\n` : '';
    const body = (`Long Markdown block ${index} with **bold**, [link](https://example.com), and selectable text. `)
      .repeat(Math.ceil(target / 84))
      .slice(0, target);
    values.push(`${prefix}${body}`);
  }
  return values.join('\n\n');
}

async function prepareRows(count, { longTailCharacters = 0, longTailBlocks = 320 } = {}) {
  const started = performance.now();
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push(Object.freeze({
      id: `perf-row-${index + 1}`,
      seqLow: index + 1,
      seqHigh: index + 1,
      contentRevision: '1',
      layoutClass: index === count - 1 && longTailCharacters ? 'rich' : 'normal',
      settled: true,
      text: index === count - 1 && longTailCharacters
        ? longMarkdown(longTailCharacters, longTailBlocks)
        : ordinaryText(index + 1),
    }));
    // Fixture generation is not product work. Yield so it cannot be mistaken
    // for a virtualizer long task in the evidence collected below.
    if (index > 0 && index % 2_000 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { rows, preparationMs: performance.now() - started };
}

function installRows(rows) {
  const started = performance.now();
  const count = rows.length;
  const orderedIDs = Object.freeze(rows.map((row) => row.id));
  snapshot = Object.freeze({
    viewID: 'production-perf', revision: snapshot.revision + 1, sourceRevision: snapshot.sourceRevision + 1,
    firstItemIndex: 1_000_000, orderedIDs, entities: new Map(rows.map((row) => [row.id, row])),
    rows: Object.freeze(rows),
    changes: Object.freeze({
      kind: 'rebase', prefixCount: 0, inserted: orderedIDs,
      updated: Object.freeze([]), removed: Object.freeze([]),
    }),
  });
  render();
  return { synchronousMs: performance.now() - started, count: snapshot.rows.length };
}

function scroller() {
  return document.querySelector('.timeline-message-list');
}

async function settle(frames = 4) {
  for (let index = 0; index < frames; index += 1) await new Promise(requestAnimationFrame);
}

function visibleRows() {
  const node = scroller();
  if (!node) return [];
  const bounds = node.getBoundingClientRect();
  return [...node.querySelectorAll('[data-presentation-row-id]')]
    .map((row) => {
      const rect = row.getBoundingClientRect();
      return {
        id: row.dataset.presentationRowId || '',
        top: rect.top - bounds.top,
        bottom: rect.bottom - bounds.top,
        width: rect.width,
        height: rect.height,
      };
    })
    .filter((row) => row.bottom > 0 && row.top < bounds.height)
    .sort((left, right) => left.top - right.top);
}

function visibleBlocks() {
  const node = scroller();
  const bounds = node?.getBoundingClientRect();
  if (!node || !bounds) return [];
  const blocks = [...node.querySelectorAll('[data-reading-block-id]')];
  const fullyVisible = blocks.filter((block) => {
    const rect = block.getBoundingClientRect();
    return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
  });
  return fullyVisible.length ? fullyVisible : blocks.filter((block) => {
    const rect = block.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom;
  });
}

function firstTextNode(node) {
  if (!node) return null;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.textContent) return current;
  }
  return null;
}

function selectVisible() {
  const block = visibleBlocks()[0];
  const textNode = firstTextNode(block);
  if (!textNode) return { textLength: 0, textStart: '', textEnd: '', rects: 0 };
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, Math.min(64, textNode.textContent.length));
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const text = selection.toString();
  const rangeText = range.toString();
  return {
    textLength: text.length,
    textStart: text.slice(0, 96),
    textEnd: text.slice(-96),
    rangeTextLength: rangeText.length,
    rangeTextStart: rangeText.slice(0, 96),
    rangeCount: selection.rangeCount,
    isCollapsed: selection.isCollapsed,
    anchorOffset: selection.anchorOffset,
    focusOffset: selection.focusOffset,
    anchorConnected: selection.anchorNode?.isConnected === true,
    rects: range.getClientRects().length,
  };
}

function summary() {
  const node = scroller();
  const visible = visibleRows();
  const probe = visibleBlocks()[0];
  const probeText = firstTextNode(probe);
  const probeRange = probeText ? document.createRange() : null;
  if (probeRange) {
    probeRange.setStart(probeText, 0);
    probeRange.setEnd(probeText, Math.min(1, probeText.textContent.length));
  }
  const probeBounds = probeRange?.getBoundingClientRect();
  const viewportBounds = node?.getBoundingClientRect();
  const hit = probeBounds && viewportBounds
    ? document.elementFromPoint(
      Math.max(viewportBounds.left + 1, Math.min(viewportBounds.right - 1, probeBounds.left + 4)),
      Math.max(viewportBounds.top + 1, Math.min(viewportBounds.bottom - 1, probeBounds.top + 4)),
    )
    : null;
  const hitStack = probeBounds && viewportBounds
    ? document.elementsFromPoint(
      Math.max(viewportBounds.left + 1, Math.min(viewportBounds.right - 1, probeBounds.left + 4)),
      Math.max(viewportBounds.top + 1, Math.min(viewportBounds.bottom - 1, probeBounds.top + 4)),
    ).slice(0, 8).map((element) => ({
      tag: element.tagName,
      className: typeof element.className === 'string' ? element.className : '',
      rowID: element.closest?.('[data-presentation-row-id]')?.dataset.presentationRowId || '',
      pointerEvents: getComputedStyle(element).pointerEvents,
      position: getComputedStyle(element).position,
      zIndex: getComputedStyle(element).zIndex,
    }))
    : [];
  const probeAncestors = [];
  for (let element = probe; element && probeAncestors.length < 10; element = element.parentElement) {
    const style = getComputedStyle(element);
    probeAncestors.push({
      tag: element.tagName,
      className: typeof element.className === 'string' ? element.className : '',
      rowID: element.closest?.('[data-presentation-row-id]')?.dataset.presentationRowId || '',
      pointerEvents: style.pointerEvents,
      userSelect: style.userSelect,
      position: style.position,
      zIndex: style.zIndex,
      transform: style.transform,
    });
  }
  return {
    logicalRows: snapshot.rows.length,
    materializedRows: node?.querySelectorAll('[data-presentation-row-id]').length || 0,
    businessRows: node?.querySelectorAll('.timeline-virtual-item').length || 0,
    domElements: document.querySelectorAll('*').length,
    visible,
    hitRowID: hit?.closest?.('[data-presentation-row-id]')?.dataset.presentationRowId || '',
    hitTag: hit?.tagName || '',
    hitClass: hit?.className || '',
    hitStack,
    probeAncestors,
    probeBounds: probeBounds ? {
      left: probeBounds.left, top: probeBounds.top, right: probeBounds.right, bottom: probeBounds.bottom,
    } : null,
    viewportBounds: viewportBounds ? {
      left: viewportBounds.left, top: viewportBounds.top, right: viewportBounds.right, bottom: viewportBounds.bottom,
    } : null,
    probePointerEvents: probe ? getComputedStyle(probe).pointerEvents : '',
    scrollTop: node?.scrollTop || 0,
    scrollHeight: node?.scrollHeight || 0,
    clientHeight: node?.clientHeight || 0,
    selected: selectVisible(),
    longTasks: [...longTasks],
    readingMode: reading?.session?.mode || '',
    readingBookmark: reading?.session?.bookmark || null,
    fixtureTargetIndex: targetIndex,
    seededReading,
    adapterTrace: adapterTrace.slice(-200),
  };
}

window.productionPerf = Object.freeze({
  async mount(count, options = {}) {
    const prepared = await prepareRows(count, options);
    longTasks.length = 0;
    const timerStarted = performance.now();
    let timerDelayMs = null;
    const timer = new Promise((resolve) => setTimeout(() => {
      timerDelayMs = performance.now() - timerStarted;
      resolve();
    }, 0));
    const mount = installRows(prepared.rows);
    const immediate = targetIndex ? summary() : null;
    await timer;
    const afterTimer = targetIndex ? summary() : null;
    await settle(6);
    return { preparationMs: prepared.preparationMs, mount, timerDelayMs, immediate, afterTimer, summary: summary() };
  },
  async scrollFraction(fraction) {
    const node = scroller();
    node.scrollTop = Math.max(0, (node.scrollHeight - node.clientHeight) * fraction);
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle(8);
    return summary();
  },
  summary,
});
