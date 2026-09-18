const root = document.querySelector('#scroll-root');
const unitsRoot = document.querySelector('#units');
const prefixRoot = document.querySelector('#prefix-units');
const topSpacer = document.querySelector('#top-spacer');
const bottomSpacer = document.querySelector('#bottom-spacer');
const revealSlot = document.querySelector('#reveal-slot');
const bookmarkStatus = document.querySelector('#bookmark-status');
const bookmarkStage = document.querySelector('#bookmark-stage');

const VIEWPORT_SCREENS = 2;
const state = {
  units: [],
  prepared: [],
  sealed: new Map(),
  mounted: new Map(),
  windowStart: 0,
  windowEnd: -1,
  batch: 0,
  frame: 0,
  frames: [],
  mutations: [],
  admissions: [],
  writers: [],
  foldEvents: [],
  longTasks: [],
  peakElements: 0,
  peakUnits: 0,
  nativeScrollEvents: [],
  revealEvents: [],
  ownerLayoutWrites: [],
  activeReveal: null,
  auditWrites: false,
  pinnedIDs: new Set(),
  reconcileQueued: false,
  mode: 'following',
  dynamicEvents: [],
  rematerializations: [],
  trustedInputs: [],
  metadata: [],
  metadataIndex: new Map(),
  bookmark: { pending: null, events: [], activation: 0, sourceRevision: 0 },
  reconcileTimings: [],
};

const rowResizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const row = entry.target;
    const id = row.dataset.unitId || '';
    const next = row.getBoundingClientRect().height;
    const previous = state.sealed.get(id);
    if (!id || !(next > 0) || (Number.isFinite(previous) && Math.abs(next - previous) < 0.1)) continue;
    state.sealed.set(id, next);
    const rootRect = root.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    state.dynamicEvents.push({
      type: 'row-resize', id, previous: Number(previous || 0), next,
      epochMs: Date.now(), mounted: row.isConnected,
      visible: rect.bottom > rootRect.top && rect.top < rootRect.bottom,
      top: rect.top - rootRect.top, bottom: rect.bottom - rootRect.top,
      anchor: semanticAnchor(), scrollTop: root.scrollTop, scrollHeight: root.scrollHeight,
    });
    queueReconcile();
  }
});

const repeat = (text, count) => Array.from({ length: count }, (_, index) => `${text} ${index + 1}.`).join(' ');

function unit(id, serial, { long = false, folded = false } = {}) {
  const paragraphCount = long ? 160 : 2 + (serial % 7);
  return {
    id,
    serial,
    folded,
    long,
    title: `Conversation ${id}`,
    text: repeat(`Semantic token ${id}`, paragraphCount),
    contentRevision: '1',
    imageURL: '',
    fontScale: 1,
  };
}

function selectionSnapshot() {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return { text: '', rowID: '' };
  const range = selection.getRangeAt(0);
  const row = (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement)?.closest?.('.conversation-unit');
  return { text: selection.toString(), rowID: row?.dataset.unitId || '' };
}

function pinnedIDs() {
  const result = new Set(state.pinnedIDs);
  const activeRow = document.activeElement?.closest?.('.conversation-unit');
  if (activeRow?.dataset.unitId) result.add(activeRow.dataset.unitId);
  const selection = selectionSnapshot();
  if (selection.rowID) result.add(selection.rowID);
  return result;
}

function elementCount() {
  return document.querySelectorAll('*').length;
}

function recordPeaks() {
  state.peakUnits = Math.max(state.peakUnits, root.querySelectorAll('.conversation-unit').length);
  state.peakElements = Math.max(state.peakElements, elementCount());
}

function renderUnit(value) {
  const row = document.createElement('article');
  row.className = 'conversation-unit';
  row.dataset.unitId = value.id;
  row.dataset.serial = String(value.serial);
  row.dataset.contentRevision = value.contentRevision;
  row.style.fontSize = `${14 * Number(value.fontScale || 1)}px`;
  row.innerHTML = `
    <h2 class="unit-title"></h2>
    <div class="unit-body"></div>
    <button class="fold-toggle" type="button"></button>
    <button class="focus-target" type="button">Pin focus</button>
  `;
  row.querySelector('.unit-title').textContent = value.title;
  const body = row.querySelector('.unit-body');
  body.textContent = value.text;
  body.dataset.folded = String(Boolean(value.folded));
  if (value.imageURL) {
    const image = document.createElement('img');
    image.className = 'late-media';
    image.alt = `late media ${value.id}`;
    image.style.cssText = 'display:block;width:100%;height:auto;margin:8px 0;';
    image.addEventListener('load', () => state.dynamicEvents.push({
      type: 'image-element-load', id: value.id, epochMs: Date.now(),
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      mounted: row.isConnected, contentRevision: value.contentRevision,
    }), { once: true });
    image.src = value.imageURL;
    body.after(image);
  }
  const toggle = row.querySelector('.fold-toggle');
  toggle.hidden = !value.long;
  toggle.textContent = value.folded ? 'Expand full body' : 'Collapse body';
  toggle.setAttribute('aria-expanded', String(!value.folded));
  toggle.addEventListener('click', () => setFold(value.id, value.folded));
  row.querySelector('.focus-target').addEventListener('focus', () => {
    state.pinnedIDs.add(value.id);
    queueReconcile();
  });
  row.querySelector('.focus-target').addEventListener('blur', () => {
    state.pinnedIDs.delete(value.id);
    queueReconcile();
  });
  rowResizeObserver.observe(row);
  return row;
}

function sealedHeight(start, end) {
  let total = 0;
  for (let index = start; index < end; index += 1) {
    const id = state.units[index]?.id;
    if (!id || !state.sealed.has(id)) throw new Error(`unsealed spacer unit ${id || index}`);
    total += state.sealed.get(id);
  }
  return total;
}

function syncSpacers() {
  topSpacer.style.height = `${sealedHeight(0, state.windowStart)}px`;
  bottomSpacer.style.height = `${sealedHeight(state.windowEnd + 1, state.units.length)}px`;
}

function mountRange(start, end) {
  const desiredIDs = new Set();
  for (let index = start; index <= end; index += 1) {
    desiredIDs.add(state.units[index].id);
  }
  for (const row of [...unitsRoot.children]) {
    if (!desiredIDs.has(row.dataset.unitId)) {
      rowResizeObserver.unobserve(row);
      row.remove();
    }
  }
  let cursor = unitsRoot.firstElementChild;
  for (let index = start; index <= end; index += 1) {
    const value = state.units[index];
    let row = [...unitsRoot.children].find((candidate) => candidate.dataset.unitId === value.id);
    if (!row) {
      const sealedBefore = state.sealed.get(value.id);
      row = renderUnit(value);
      state.rematerializations.push({
        id: value.id, epochMs: Date.now(), sealedBefore: Number(sealedBefore || 0),
        contentRevision: value.contentRevision, imageReady: Boolean(value.imageURL), fontScale: value.fontScale,
      });
    }
    if (row !== cursor) unitsRoot.insertBefore(row, cursor);
    cursor = row.nextElementSibling;
  }
  state.mounted = new Map([...unitsRoot.children].map((row) => [row.dataset.unitId, row]));
  state.windowStart = start;
  state.windowEnd = end;
  syncSpacers();
  measureMounted();
  const rootRect = root.getBoundingClientRect();
  for (const event of state.rematerializations) {
    if (event.measuredAfter || !state.mounted.has(event.id)) continue;
    const row = state.mounted.get(event.id);
    const rect = row.getBoundingClientRect();
    event.measuredAfter = rect.height;
    event.top = rect.top - rootRect.top;
    event.bottom = rect.bottom - rootRect.top;
    event.visibleAtMount = rect.bottom > rootRect.top && rect.top < rootRect.bottom;
  }
  recordPeaks();
}

function measureMounted() {
  for (const [id, row] of state.mounted) {
    const height = row.getBoundingClientRect().height;
    if (height > 0) state.sealed.set(id, height);
  }
}

function visibleRows() {
  const rootRect = root.getBoundingClientRect();
  return [...root.querySelectorAll('.conversation-unit')].map((row) => {
    const rect = row.getBoundingClientRect();
    return {
      id: row.dataset.unitId,
      top: rect.top - rootRect.top,
      bottom: rect.bottom - rootRect.top,
      height: rect.height,
      intersects: rect.bottom > rootRect.top && rect.top < rootRect.bottom,
    };
  }).filter((entry) => entry.intersects);
}

function semanticAnchor() {
  const visible = visibleRows();
  const first = visible[0];
  return first ? { id: first.id, offset: first.top } : { id: '', offset: 0 };
}

function desiredWindow() {
  const minimum = Math.max(0, root.scrollTop - root.clientHeight * VIEWPORT_SCREENS);
  const maximum = root.scrollTop + root.clientHeight * (VIEWPORT_SCREENS + 1);
  let cursor = 0;
  let start = 0;
  let end = state.units.length - 1;
  let foundStart = false;
  for (let index = 0; index < state.units.length; index += 1) {
    const height = state.sealed.get(state.units[index].id);
    if (!Number.isFinite(height)) return { start: state.windowStart, end: state.windowEnd };
    const next = cursor + height;
    if (!foundStart && next >= minimum) {
      start = index;
      foundStart = true;
    }
    if (cursor <= maximum) end = index;
    cursor = next;
  }
  for (const id of pinnedIDs()) {
    const index = state.units.findIndex((value) => value.id === id);
    if (index >= 0 && index >= start - 2 && index <= end + 2) {
      start = Math.min(start, index);
      end = Math.max(end, index);
    }
  }
  return { start, end };
}

function reconcile() {
  const started = performance.now();
  state.reconcileQueued = false;
  try {
    if (state.activeReveal) return;
    if (!state.mounted.size) return;
    measureMounted();
    const desired = desiredWindow();
    if (desired.start === state.windowStart && desired.end === state.windowEnd) return;
    for (let index = 0; index < desired.start; index += 1) {
      if (!state.sealed.has(state.units[index].id)) return;
    }
    for (let index = desired.end + 1; index < state.units.length; index += 1) {
      if (!state.sealed.has(state.units[index].id)) return;
    }
    mountRange(desired.start, desired.end);
  } finally {
    state.reconcileTimings.push({ duration: performance.now() - started, activeUnits: state.units.length, epochMs: Date.now() });
  }
}

function queueReconcile() {
  if (state.reconcileQueued) return;
  state.reconcileQueued = true;
  requestAnimationFrame(() => requestAnimationFrame(reconcile));
}

function prepareBatch(count = 8) {
  const batch = ++state.batch;
  const values = Array.from({ length: count }, (_, index) => {
    const serial = -((batch * count) - index);
    return unit(`history-${batch}-${index}`, serial, { long: index === 2 && batch % 3 === 0, folded: true });
  });
  state.prepared.push({ batch, values });
  return { batch, ids: values.map((value) => value.id) };
}

async function admitPrepared() {
  const prepared = state.prepared.shift();
  if (!prepared) throw new Error('no prepared batch');
  const before = semanticAnchor();
  const previousStart = state.windowStart;
  state.units.unshift(...prepared.values);
  const insertion = document.createDocumentFragment();
  const inserted = [];
  for (const value of prepared.values) {
    const row = renderUnit(value);
    insertion.append(row);
    inserted.push(row);
  }
  if (previousStart === 0) {
    unitsRoot.prepend(insertion);
    for (const row of inserted) state.mounted.set(row.dataset.unitId, row);
    state.windowStart = 0;
    state.windowEnd += prepared.values.length;
    measureMounted();
    syncSpacers();
  } else {
    prefixRoot.replaceChildren(insertion);
    state.windowStart += prepared.values.length;
    state.windowEnd += prepared.values.length;
    for (const row of inserted) {
      const height = row.getBoundingClientRect().height;
      if (!(height > 0)) throw new Error(`prepared unit did not materialize: ${row.dataset.unitId}`);
      state.sealed.set(row.dataset.unitId, height);
    }
  }
  recordPeaks();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (previousStart !== 0) {
    syncSpacers();
    prefixRoot.replaceChildren();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  const after = semanticAnchor();
  const admission = {
    batch: prepared.batch,
    ids: prepared.values.map((value) => value.id),
    before,
    after,
    delta: before.id === after.id ? after.offset - before.offset : null,
    scrollTop: root.scrollTop,
    scrollHeight: root.scrollHeight,
  };
  state.admissions.push(admission);
  queueReconcile();
  return admission;
}

function commitPreparedValues(prepared, rows) {
  state.units.unshift(...prepared.values);
  for (const row of rows) state.mounted.set(row.dataset.unitId, row);
  state.windowStart = 0;
  state.windowEnd += prepared.values.length;
  unitsRoot.prepend(...rows);
  measureMounted();
  syncSpacers();
  recordPeaks();
}

async function revealPreparedAtTop({ durationMs = 180 } = {}) {
  if (root.scrollTop > 1) throw new Error(`top reveal requires true top, got ${root.scrollTop}`);
  if (state.activeReveal) throw new Error('reveal already active');
  const prepared = state.prepared.shift();
  if (!prepared) throw new Error('no prepared batch');
  const before = semanticAnchor();
  const wrapper = document.createElement('div');
  wrapper.className = 'history-reveal';
  wrapper.dataset.state = 'prepared';
  wrapper.style.transitionDuration = `${durationMs}ms`;
  const inner = document.createElement('div');
  inner.className = 'history-reveal-inner';
  const rows = prepared.values.map(renderUnit);
  inner.append(...rows);
  wrapper.append(inner);
  revealSlot.replaceChildren(wrapper);
  const reveal = {
    batch: prepared.batch,
    values: prepared.values,
    state: 'prepared',
    wrapper,
    inner,
    rows,
    before,
    startedAt: performance.now(),
    settled: false,
    reverseCancelled: false,
  };
  state.activeReveal = reveal;
  state.ownerLayoutWrites.push({ owner: 'HistoryRevealTransition', phase: 'prepare', blockSize: 0, epochMs: Date.now() });
  await new Promise((resolve) => requestAnimationFrame(resolve));
  wrapper.dataset.state = 'revealing';
  reveal.state = 'revealing';
  state.ownerLayoutWrites.push({ owner: 'HistoryRevealTransition', phase: 'reveal', blockSize: inner.getBoundingClientRect().height, epochMs: Date.now() });
  const settled = new Promise((resolve) => {
    reveal.resolve = resolve;
    reveal.timer = setTimeout(() => settleReveal('transition-timeout'), durationMs + 80);
    wrapper.addEventListener('transitionend', () => settleReveal('transitionend'), { once: true });
  });
  return { batch: prepared.batch, settled };
}

function settleReveal(reason) {
  const reveal = state.activeReveal;
  if (!reveal || reveal.settled) return;
  reveal.settled = true;
  clearTimeout(reveal.timer);
  const computedHeight = reveal.wrapper.getBoundingClientRect().height;
  const innerHeight = reveal.inner.getBoundingClientRect().height;
  reveal.wrapper.style.transition = 'none';
  reveal.wrapper.style.gridTemplateRows = `${computedHeight}px`;
  state.ownerLayoutWrites.push({ owner: 'HistoryRevealTransition', phase: 'settle', reason, blockSize: computedHeight, epochMs: Date.now() });
  if (!reveal.reverseCancelled) {
    reveal.wrapper.style.gridTemplateRows = `${innerHeight}px`;
    state.ownerLayoutWrites.push({ owner: 'HistoryRevealTransition', phase: 'commit-full', reason, blockSize: innerHeight, epochMs: Date.now() });
  }
  const committedRows = reveal.rows;
  revealSlot.replaceChildren();
  commitPreparedValues({ batch: reveal.batch, values: reveal.values }, committedRows);
  const after = semanticAnchor();
  const event = {
    batch: reveal.batch,
    reason,
    reverseCancelled: reveal.reverseCancelled,
    before: reveal.before,
    after,
    delta: reveal.before.id === after.id ? after.offset - reveal.before.offset : null,
    computedHeight,
    innerHeight,
    scrollTop: root.scrollTop,
  };
  state.revealEvents.push(event);
  state.activeReveal = null;
  reveal.resolve?.(event);
  queueReconcile();
}

function cancelRevealForReverseWheel(deltaY) {
  const reveal = state.activeReveal;
  if (!reveal || reveal.settled || deltaY <= 0) return false;
  const height = reveal.inner.getBoundingClientRect().height;
  reveal.reverseCancelled = true;
  reveal.wrapper.style.transition = 'none';
  reveal.wrapper.style.gridTemplateRows = '1fr';
  state.ownerLayoutWrites.push({ owner: 'HistoryRevealTransition', phase: 'trusted-reverse-complete', blockSize: height, deltaY, epochMs: Date.now() });
  settleReveal('trusted-reverse-wheel');
  return true;
}

async function setFold(id, collapse) {
  const value = state.units.find((candidate) => candidate.id === id);
  const row = state.mounted.get(id);
  if (!value || !row) throw new Error(`fold row unavailable: ${id}`);
  const body = row.querySelector('.unit-body');
  const toggle = row.querySelector('.fold-toggle');
  const before = {
    anchor: semanticAnchor(),
    rowTop: row.getBoundingClientRect().top,
    rowHeight: row.getBoundingClientRect().height,
    scrollTop: root.scrollTop,
    maxScrollTop: root.scrollHeight - root.clientHeight,
    firstTextBottom: body.getBoundingClientRect().bottom,
  };
  if (!collapse) {
    root.style.overflowAnchor = 'none';
    row.style.overflowAnchor = 'none';
  }
  value.folded = collapse;
  body.dataset.folded = String(collapse);
  toggle.textContent = collapse ? 'Expand full body' : 'Collapse body';
  toggle.setAttribute('aria-expanded', String(!collapse));
  await new Promise((resolve) => {
    const observer = new ResizeObserver(() => {
      observer.disconnect();
      requestAnimationFrame(resolve);
    });
    observer.observe(row);
  });
  measureMounted();
  if (!collapse) {
    root.style.overflowAnchor = 'auto';
    row.style.overflowAnchor = 'auto';
  }
  const after = {
    anchor: semanticAnchor(),
    rowTop: row.getBoundingClientRect().top,
    rowHeight: row.getBoundingClientRect().height,
    scrollTop: root.scrollTop,
    maxScrollTop: root.scrollHeight - root.clientHeight,
    bodyBottom: body.getBoundingClientRect().bottom,
  };
  const necessaryClamp = collapse ? Math.max(0, before.scrollTop - after.maxScrollTop) : 0;
  const event = { id, collapse, before, after, necessaryClamp, nativeScrollDelta: after.scrollTop - before.scrollTop };
  state.foldEvents.push(event);
  queueReconcile();
  return event;
}

function cancelBookmark(reason) {
  const pending = state.bookmark.pending;
  if (!pending || pending.committed || pending.cancelled) return false;
  pending.cancelled = true;
  clearTimeout(pending.timer);
  for (const row of bookmarkStage.querySelectorAll('.conversation-unit')) rowResizeObserver.unobserve(row);
  bookmarkStage.replaceChildren();
  bookmarkStatus.textContent = `Restore cancelled by ${reason}`;
  state.bookmark.events.push({
    type: 'cancel', reason, token: pending.token, activation: pending.activation,
    sourceRevision: pending.sourceRevision, epochMs: Date.now(), writers: state.writers.length,
  });
  state.bookmark.pending = null;
  return true;
}

async function prepareAndCommitBookmark(pending) {
  if (pending.cancelled || state.bookmark.pending !== pending) return;
  const targetIndex = state.metadataIndex.get(pending.targetID);
  if (!Number.isInteger(targetIndex)) throw new Error(`bookmark target unavailable: ${pending.targetID}`);
  const start = targetIndex;
  const end = Math.min(state.metadata.length, start + 24);
  const values = state.metadata.slice(start, end).map((entry) => unit(entry.id, entry.seq));
  const orderedIDs = Object.freeze(values.map((value) => value.id));
  const rows = values.map(renderUnit);
  bookmarkStage.replaceChildren(...rows);
  recordPeaks();
  const heights = new Map();
  let stableFrames = 0;
  for (let frame = 0; frame < 8 && stableFrames < 2; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    let stable = true;
    for (const row of rows) {
      const height = row.getBoundingClientRect().height;
      if (!(height > 0)) stable = false;
      if (heights.has(row.dataset.unitId) && Math.abs(heights.get(row.dataset.unitId) - height) > 0.1) stable = false;
      heights.set(row.dataset.unitId, height);
    }
    stableFrames = stable ? stableFrames + 1 : 0;
  }
  state.bookmark.events.push({
    type: 'ready', token: pending.token, activation: pending.activation,
    sourceRevision: pending.sourceRevision, targetID: pending.targetID,
    orderedIDs, stableFrames, epochMs: Date.now(), scrollTop: root.scrollTop,
    positionWriterCount: state.writers.length - pending.writerBaseline,
  });
  if (pending.cancelled || state.bookmark.pending !== pending) return;
  if (root.scrollTop > 1) {
    bookmarkStatus.textContent = 'Restore ready; waiting for a safe top activation';
    return;
  }
  const before = { anchor: semanticAnchor(), scrollTop: root.scrollTop, scrollHeight: root.scrollHeight };
  for (const row of unitsRoot.querySelectorAll('.conversation-unit')) rowResizeObserver.unobserve(row);
  unitsRoot.replaceChildren(...rows);
  state.units = values;
  state.sealed = new Map(heights);
  state.mounted = new Map(rows.map((row) => [row.dataset.unitId, row]));
  state.windowStart = 0;
  state.windowEnd = values.length - 1;
  syncSpacers();
  pending.committed = true;
  bookmarkStatus.textContent = '';
  bookmarkStage.replaceChildren();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const target = state.mounted.get(pending.targetID);
  const viewportRect = root.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  state.bookmark.events.push({
    type: 'position', token: pending.token, activation: pending.activation,
    sourceRevision: pending.sourceRevision, targetID: pending.targetID,
    exactActivation: pending.activation === state.bookmark.activation,
    exactSourceRevision: pending.sourceRevision === state.bookmark.sourceRevision,
    orderedIDs, sameObjects: values.every((value, index) => state.units[index] === value),
    fullUnitBoundary: { first: orderedIDs[0], last: orderedIDs.at(-1), count: orderedIDs.length },
    before,
    after: { anchor: semanticAnchor(), scrollTop: root.scrollTop, scrollHeight: root.scrollHeight },
    targetOffset: targetRect.top - viewportRect.top,
    targetHeight: targetRect.height,
    positionWriterCount: state.writers.length - pending.writerBaseline,
    epochMs: Date.now(),
  });
  state.bookmark.pending = null;
  recordPeaks();
}

function requestBookmark(targetID, delayMs = 80) {
  cancelBookmark('superseded');
  const activation = ++state.bookmark.activation;
  const pending = {
    token: `bookmark-${activation}`, activation,
    sourceRevision: state.bookmark.sourceRevision,
    targetID, writerBaseline: state.writers.length,
    committed: false, cancelled: false,
  };
  state.bookmark.pending = pending;
  bookmarkStatus.textContent = `Restoring ${targetID}…`;
  state.bookmark.events.push({
    type: 'request', token: pending.token, activation, sourceRevision: pending.sourceRevision,
    targetID, epochMs: Date.now(), mounted: state.mounted.has(targetID),
    oldAnchor: semanticAnchor(), scrollTop: root.scrollTop, scrollHeight: root.scrollHeight,
  });
  pending.timer = setTimeout(() => prepareAndCommitBookmark(pending), delayMs);
  return { token: pending.token, activation, sourceRevision: pending.sourceRevision, targetID };
}

function recordFrame(timestamp) {
  const rootRect = root.getBoundingClientRect();
  const visible = visibleRows();
  const selection = selectionSnapshot();
  state.frames.push({
    frame: state.frame++,
    epochMs: performance.timeOrigin + timestamp,
    scrollTop: root.scrollTop,
    scrollHeight: root.scrollHeight,
    clientHeight: root.clientHeight,
    mounted: state.mounted.size,
    elementCount: elementCount(),
    range: [state.windowStart, state.windowEnd],
    topSpacer: topSpacer.getBoundingClientRect().height,
    bottomSpacer: bottomSpacer.getBoundingClientRect().height,
    visible,
    emptyViewport: visible.length === 0,
    uncoveredTop: visible.length > 0 && visible[0].top > 1,
    uncoveredBottom: visible.length > 0 && visible.at(-1).bottom < rootRect.height - 1,
    anchor: semanticAnchor(),
    selection,
    focusID: document.activeElement?.closest?.('.conversation-unit')?.dataset.unitId || '',
    mode: state.mode,
  });
  requestAnimationFrame(recordFrame);
}

new MutationObserver((records) => {
  state.mutations.push({ epochMs: Date.now(), records: records.length, mounted: state.mounted.size });
  recordPeaks();
}).observe(slab, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-folded'] });

if ('PerformanceObserver' in window) {
  try {
    new PerformanceObserver((list) => {
      state.longTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })));
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
}

root.addEventListener('scroll', () => {
  state.nativeScrollEvents.push({ epochMs: Date.now(), scrollTop: root.scrollTop });
  queueReconcile();
}, { passive: true });
root.addEventListener('wheel', (event) => {
  if (event.isTrusted) {
    const before = {
      scrollTop: root.scrollTop,
      revealPhase: state.activeReveal?.state || '',
      revealBatch: Number(state.activeReveal?.batch || 0),
    };
    state.mode = 'browsing';
    cancelBookmark('wheel');
    const completedReveal = cancelRevealForReverseWheel(event.deltaY);
    state.trustedInputs.push({
      type: 'wheel', deltaY: event.deltaY, epochMs: Date.now(),
      ...before, completedReveal, mode: state.mode,
    });
  }
}, { capture: true, passive: true });
root.addEventListener('pointerdown', (event) => {
  if (event.isTrusted) cancelBookmark('pointer');
}, { capture: true, passive: true });
root.addEventListener('touchstart', (event) => {
  if (event.isTrusted) cancelBookmark('touch');
}, { capture: true, passive: true });

function initialize() {
  state.units = Array.from({ length: 24 }, (_, index) => unit(`live-${index}`, index, {
    long: index === 12 || index === 22,
    folded: index === 12 || index === 22,
  }));
  mountRange(0, state.units.length - 1);
  state.writers.length = 0;
  state.auditWrites = true;
  requestAnimationFrame(recordFrame);
}

function instrumentWriter(method) {
  const original = root[method]?.bind(root);
  if (!original) return;
  root[method] = (...args) => {
    state.writers.push({ method, args, epochMs: Date.now(), stack: new Error().stack });
    return original(...args);
  };
}
instrumentWriter('scrollTo');
instrumentWriter('scrollBy');

window.foregroundSlab = {
  prepareBatch,
  admitPrepared,
  revealPreparedAtTop,
  setFold,
  semanticAnchor,
  snapshot() {
    measureMounted();
    return {
      units: state.units.length,
      prepared: state.prepared.map((entry) => ({ batch: entry.batch, count: entry.values.length })),
      sealed: state.sealed.size,
      mounted: state.mounted.size,
      peakUnits: state.peakUnits,
      peakElements: state.peakElements,
      range: [state.windowStart, state.windowEnd],
      writers: structuredClone(state.writers),
      admissions: structuredClone(state.admissions),
      foldEvents: structuredClone(state.foldEvents),
      longTasks: structuredClone(state.longTasks),
      revealEvents: structuredClone(state.revealEvents),
      ownerLayoutWrites: structuredClone(state.ownerLayoutWrites),
      anchor: semanticAnchor(),
      selection: selectionSnapshot(),
      focusID: document.activeElement?.closest?.('.conversation-unit')?.dataset.unitId || '',
      mode: state.mode,
      mountedIDs: [...state.mounted.keys()],
      dynamicEvents: structuredClone(state.dynamicEvents),
      rematerializations: structuredClone(state.rematerializations),
      trustedInputs: structuredClone(state.trustedInputs),
      metadata: {
        count: state.metadata.length,
        sourceRevision: state.bookmark.sourceRevision,
        install: state.bookmark.events.findLast((event) => event.type === 'metadata-install') || null,
      },
      bookmark: {
        pending: state.bookmark.pending ? {
          token: state.bookmark.pending.token,
          activation: state.bookmark.pending.activation,
          sourceRevision: state.bookmark.pending.sourceRevision,
          targetID: state.bookmark.pending.targetID,
          cancelled: state.bookmark.pending.cancelled,
          committed: state.bookmark.pending.committed,
        } : null,
        events: structuredClone(state.bookmark.events),
        status: bookmarkStatus.textContent,
      },
      reconcileTimings: structuredClone(state.reconcileTimings),
      scrollTop: root.scrollTop,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
    };
  },
  takeFrames() { return structuredClone(state.frames); },
  clearFrames() { state.frames.length = 0; },
  clearDynamicEvidence() {
    state.dynamicEvents.length = 0;
    state.rematerializations.length = 0;
  },
  installMetadata(count = 100_000) {
    const heapBefore = performance.memory?.usedJSHeapSize || 0;
    const started = performance.now();
    const metadata = Array.from({ length: count }, (_, index) => ({ id: `meta-${index}`, seq: index + 1 }));
    const index = new Map(metadata.map((entry, position) => [entry.id, position]));
    state.metadata = metadata;
    state.metadataIndex = index;
    state.bookmark.sourceRevision += 1;
    const duration = performance.now() - started;
    const heapAfter = performance.memory?.usedJSHeapSize || 0;
    const event = {
      type: 'metadata-install', count, duration,
      approximateBytes: metadata.reduce((sum, entry) => sum + 24 + entry.id.length * 2, 0),
      heapBefore, heapAfter, heapDelta: heapAfter && heapBefore ? heapAfter - heapBefore : 0,
      sourceRevision: state.bookmark.sourceRevision, epochMs: Date.now(),
      domElements: elementCount(), mountedUnits: state.mounted.size,
    };
    state.bookmark.events.push(event);
    return structuredClone(event);
  },
  async installMetadataChunked(count = 100_000, chunkSize = 5_000) {
    const heapBefore = performance.memory?.usedJSHeapSize || 0;
    const started = performance.now();
    const scrollHeightBefore = root.scrollHeight;
    const reconcileBaseline = state.reconcileTimings.length;
    const metadata = [];
    const index = new Map();
    const chunkDurations = [];
    for (let start = 0; start < count; start += chunkSize) {
      const chunkStarted = performance.now();
      const end = Math.min(count, start + chunkSize);
      for (let position = start; position < end; position += 1) {
        const entry = { id: `meta-${position}`, seq: position + 1 };
        metadata.push(entry);
        index.set(entry.id, position);
      }
      chunkDurations.push(performance.now() - chunkStarted);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    state.metadata = metadata;
    state.metadataIndex = index;
    state.bookmark.sourceRevision += 1;
    const sorted = [...chunkDurations].sort((left, right) => left - right);
    const heapAfter = performance.memory?.usedJSHeapSize || 0;
    const event = {
      type: 'metadata-install-chunked', count, chunkSize,
      totalDuration: performance.now() - started,
      chunks: chunkDurations.length,
      chunkP95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0,
      chunkMax: sorted.at(-1) || 0,
      approximateBytes: metadata.reduce((sum, entry) => sum + 24 + entry.id.length * 2, 0),
      heapBefore, heapAfter, heapDelta: heapAfter && heapBefore ? heapAfter - heapBefore : 0,
      sourceRevision: state.bookmark.sourceRevision, epochMs: Date.now(),
      domElements: elementCount(), mountedUnits: state.mounted.size,
      scrollHeightBefore, scrollHeightAfter: root.scrollHeight,
      reconcileDelta: state.reconcileTimings.length - reconcileBaseline,
    };
    state.bookmark.events.push(event);
    return structuredClone(event);
  },
  requestBookmark,
  async loadDetachedImage(id) {
    const value = state.units.find((candidate) => candidate.id === id);
    if (!value) throw new Error(`unknown media unit ${id}`);
    if (state.mounted.has(id)) throw new Error(`media unit must be unmounted before detached load: ${id}`);
    const before = { sealed: state.sealed.get(id), scrollHeight: root.scrollHeight, contentRevision: value.contentRevision };
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 640, 360);
    gradient.addColorStop(0, '#16324f');
    gradient.addColorStop(1, '#f4a261');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#fff';
    context.font = '36px sans-serif';
    context.fillText(`late ${id}`, 36, 190);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const url = URL.createObjectURL(blob);
    const detached = new Image();
    const loaded = new Promise((resolve, reject) => {
      detached.onload = resolve;
      detached.onerror = reject;
    });
    detached.src = url;
    await loaded;
    await detached.decode?.().catch(() => {});
    value.imageURL = url;
    state.dynamicEvents.push({
      type: 'detached-image-loaded', id, epochMs: Date.now(), mounted: state.mounted.has(id),
      naturalWidth: detached.naturalWidth, naturalHeight: detached.naturalHeight,
      contentRevision: value.contentRevision, sealed: state.sealed.get(id), scrollHeight: root.scrollHeight,
    });
    return { before, after: { sealed: state.sealed.get(id), scrollHeight: root.scrollHeight, contentRevision: value.contentRevision } };
  },
  async changeFontScale(id, scale) {
    const value = state.units.find((candidate) => candidate.id === id);
    const row = state.mounted.get(id);
    if (!value || !row) throw new Error(`font unit must be mounted: ${id}`);
    const before = { anchor: semanticAnchor(), height: row.getBoundingClientRect().height, sealed: state.sealed.get(id), scrollTop: root.scrollTop };
    const baselineEvents = state.dynamicEvents.length;
    value.fontScale = scale;
    row.style.fontSize = `${14 * scale}px`;
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        if (state.dynamicEvents.slice(baselineEvents).some((event) => event.type === 'row-resize' && event.id === id)) return resolve();
        if (performance.now() - started > 1_000) return reject(new Error('font resize did not reach RO'));
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    return { before, after: { anchor: semanticAnchor(), height: row.getBoundingClientRect().height, sealed: state.sealed.get(id), scrollTop: root.scrollTop } };
  },
  pinSelection(id = 'live-12') {
    const row = state.mounted.get(id);
    const body = row?.querySelector('.unit-body');
    if (!body?.firstChild) throw new Error(`selection row unavailable: ${id}`);
    const range = document.createRange();
    range.setStart(body.firstChild, 0);
    range.setEnd(body.firstChild, Math.min(36, body.firstChild.length));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    state.pinnedIDs.add(id);
    return selectionSnapshot();
  },
  focus(id = 'live-12') {
    state.mounted.get(id)?.querySelector('.focus-target')?.focus({ preventScroll: true });
    return document.activeElement?.closest?.('.conversation-unit')?.dataset.unitId || '';
  },
  unpin() {
    getSelection()?.removeAllRanges();
    document.activeElement?.blur?.();
    state.pinnedIDs.clear();
  },
  scrollRoot: root,
};

initialize();
