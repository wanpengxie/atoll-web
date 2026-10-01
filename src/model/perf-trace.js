// perf-trace.js — how long the page really takes, measured where it is used.
//
// A lab run on another machine cannot rebuild what a reader's tab has been
// through: hours open, which channels, how much history, how much live
// traffic. So the page keeps its own record, on this device, and hands it over
// on request:
//
//   - every channel switch: click → header shows the channel → first painted
//     frame → the page settles (a second with no long frame); the long frames
//     in between, with the scripts that ran in them (source position, forced
//     layout) from the Long Animation Frames API where the browser has it;
//   - once a minute: heap, loaded rows, and how busy the page was while nobody
//     touched it.
//
// Each record carries the context that makes it comparable across time:
// minutes since load, heap, DOM size, loaded rows. No message content is ever
// recorded — only counts, timings and source positions.

const STORAGE_KEY = 'atoll.perf.v1';
const MAX_RECORDS = 400;
const SETTLE_QUIET_MS = 1_000;
const SETTLE_LIMIT_MS = 8_000;
const SAMPLE_EVERY_MS = 60_000;
const TOP_SCRIPTS = 5;

const loadedAt = Date.now();
let records = restore();
let contextProvider = null;
let pending = null;
let longFrames = [];
let observer = null;
let sampler = null;
let saveTimer = null;

function restore() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_RECORDS) : [];
  } catch {
    return [];
  }
}

function persistSoon() {
  if (saveTimer) return;
  saveTimer = globalThis.setTimeout(() => {
    saveTimer = null;
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* quota: keep in memory */ }
  }, 2_000);
}

function push(record) {
  records.push(record);
  if (records.length > MAX_RECORDS) records = records.slice(-MAX_RECORDS);
  persistSoon();
}

const now = () => Number(globalThis.performance?.now?.() || Date.now());

function round(value) {
  return Math.round(Number(value) || 0);
}

// What the page is holding right now. The provider is registered by the app,
// which owns the replica; this module never reaches into it.
function context() {
  const memory = globalThis.performance?.memory;
  let provided = {};
  try { provided = contextProvider?.() || {}; } catch { provided = {}; }
  return {
    uptimeMin: round((Date.now() - loadedAt) / 60_000),
    ...(memory ? { heapMB: round(memory.usedJSHeapSize / 1e6) } : {}),
    domNodes: globalThis.document?.getElementsByTagName?.('*').length || 0,
    ...provided,
  };
}

function ensureObserver() {
  if (observer || typeof PerformanceObserver !== 'function') return;
  const types = PerformanceObserver.supportedEntryTypes || [];
  const type = types.includes('long-animation-frame') ? 'long-animation-frame' : types.includes('longtask') ? 'longtask' : '';
  if (!type) return;
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longFrames.push(entry);
      if (pending) pending.lastLongFrameAt = now();
    }
    // Only the sampler window and an open switch read these.
    const floor = now() - SAMPLE_EVERY_MS - SETTLE_LIMIT_MS;
    if (longFrames.length > 2_000 || (longFrames[0] && longFrames[0].startTime < floor)) {
      longFrames = longFrames.filter((entry) => entry.startTime >= floor);
    }
  });
  try { observer.observe({ type, buffered: false }); } catch { observer = null; }
}

// The frames that overlapped [from, to], summed, with their heaviest scripts.
function framesBetween(from, to) {
  const frames = longFrames.filter((entry) => entry.startTime + entry.duration >= from && entry.startTime <= to);
  const scripts = new Map();
  let busy = 0;
  let blocking = 0;
  let layout = 0;
  for (const frame of frames) {
    busy += frame.duration;
    blocking += frame.blockingDuration || 0;
    layout += frame.styleAndLayoutStart ? Math.max(0, frame.startTime + frame.duration - frame.styleAndLayoutStart) : 0;
    for (const script of frame.scripts || []) {
      const where = `${script.sourceURL || '?'}:${script.sourceCharPosition ?? -1}`;
      const key = `${script.sourceFunctionName || script.invoker || '?'} @ ${where}`;
      const row = scripts.get(key) || { script: key, ms: 0, forcedLayoutMs: 0, count: 0 };
      row.ms += script.duration;
      row.forcedLayoutMs += script.forcedStyleAndLayoutDuration || 0;
      row.count += 1;
      scripts.set(key, row);
    }
  }
  return {
    longFrames: frames.length,
    busyMs: round(busy),
    blockingMs: round(blocking),
    renderMs: round(layout),
    topScripts: [...scripts.values()]
      .sort((left, right) => right.ms - left.ms)
      .slice(0, TOP_SCRIPTS)
      .map((row) => ({ ...row, ms: round(row.ms), forcedLayoutMs: round(row.forcedLayoutMs) })),
  };
}

function finishSwitch() {
  const current = pending;
  if (!current) return;
  pending = null;
  const settledAt = now();
  push({
    kind: 'switch',
    at: new Date().toISOString(),
    from: current.from,
    to: current.to,
    headerMs: current.committedAt ? round(current.committedAt - current.startedAt) : null,
    paintMs: current.paintedAt ? round(current.paintedAt - current.startedAt) : null,
    settleMs: round(settledAt - current.startedAt),
    ...framesBetween(current.startedAt, settledAt),
    context: context(),
  });
}

function watchSettle() {
  const current = pending;
  if (!current) return;
  const quietFor = now() - Math.max(current.lastLongFrameAt || 0, current.paintedAt || current.startedAt);
  if (quietFor >= SETTLE_QUIET_MS || now() - current.startedAt >= SETTLE_LIMIT_MS) {
    finishSwitch();
    return;
  }
  current.timer = globalThis.setTimeout(watchSettle, 200);
}

// The reader asked for another channel.
export function perfSwitchStart(from, to) {
  if (!to || from === to) return;
  ensureObserver();
  if (pending) {
    globalThis.clearTimeout(pending.timer);
    finishSwitch();
  }
  pending = { from: String(from || ''), to: String(to), startedAt: now() };
}

// The header now shows `channelId` (called from the layout commit).
export function perfSwitchCommitted(channelId) {
  const current = pending;
  if (!current || current.to !== channelId || current.committedAt) return;
  current.committedAt = now();
  globalThis.requestAnimationFrame?.(() => {
    // The frame after the one this rAF runs in is the first one painted with
    // the new channel.
    globalThis.setTimeout(() => {
      if (pending !== current) return;
      current.paintedAt = now();
      current.timer = globalThis.setTimeout(watchSettle, 200);
    }, 0);
  });
}

export function registerPerfContextProvider(provider) {
  contextProvider = typeof provider === 'function' ? provider : null;
  ensureObserver();
  if (!sampler && typeof globalThis.setInterval === 'function') {
    let windowStart = now();
    sampler = globalThis.setInterval(() => {
      const end = now();
      const { topScripts, ...frames } = framesBetween(windowStart, end);
      push({
        kind: 'sample',
        at: new Date().toISOString(),
        hidden: globalThis.document?.visibilityState === 'hidden',
        ...frames,
        topScripts: topScripts.slice(0, 3),
        context: context(),
      });
      windowStart = end;
    }, SAMPLE_EVERY_MS);
  }
  return () => {
    if (contextProvider === provider) contextProvider = null;
  };
}

export function perfSnapshot() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    userAgent: globalThis.navigator?.userAgent || '',
    build: globalThis.document?.querySelector?.('script[type=module][src]')?.getAttribute('src') || '',
    loadedAt: new Date(loadedAt).toISOString(),
    current: context(),
    records: records.slice(),
  };
}

export function perfText() {
  return JSON.stringify(perfSnapshot(), null, 1);
}

export function clearPerf() {
  records = [];
  persistSoon();
}
