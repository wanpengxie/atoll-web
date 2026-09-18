const STORAGE_KEY = 'atoll.diagnostics.v1';
const MAX_ENTRIES = 500;
const MAX_READING_TRACE_ENTRIES = 1_024;
const MAX_STACK_LINES = 12;
const REDACTED_KEY = /(?:password|secret|token|credential|authorization|cookie|envelope|payload|body|content|text)/i;

function storage() {
  try { return globalThis.sessionStorage || null; }
  catch { return null; }
}

function safeValue(value, key = '', depth = 0) {
  if (REDACTED_KEY.test(key)) return '[redacted]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.code ? { code: value.code } : {}),
      ...(value.stack ? { stack: value.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n') } : {}),
    };
  }
  if (typeof value === 'string') return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  if (value == null || ['number', 'boolean'].includes(typeof value)) return value;
  if (depth >= 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeValue(item, '', depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([name, item]) => [name, safeValue(item, name, depth + 1)]));
  }
  return String(value);
}

function restore() {
  try {
    const parsed = JSON.parse(storage()?.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

const entries = restore();
const readingTraceEntries = [];
let readingTraceEnabled = false;
let readingTraceSequence = 0;
let readingTraceStartedAt = 0;
let readingTraceMetadata = {};
let readingTraceDropped = 0;
let railDiagnosticProvider = null;

function monotonicNow() {
  return Number(globalThis.performance?.now?.() || Date.now());
}

export function readingTrace(event, detail = {}) {
  if (!readingTraceEnabled) return null;
  let resolvedDetail;
  let normalizedEvent;
  try {
    normalizedEvent = String(event || 'unknown');
    resolvedDetail = typeof detail === 'function' ? detail() : detail;
    resolvedDetail = safeValue(resolvedDetail);
  } catch {
    // An opt-in recorder must never turn a geometry getter, a test hook, or a
    // hostile diagnostic value into an application failure. Keep only a
    // metadata marker; never echo the thrown message, which may contain text.
    normalizedEvent = 'trace.detail-error';
    resolvedDetail = { sourceEvent: typeof event === 'string' ? event : 'unknown' };
  }
  try {
    const entry = {
      sequence: ++readingTraceSequence,
      elapsedMs: Math.max(0, monotonicNow() - readingTraceStartedAt),
      event: normalizedEvent,
      detail: resolvedDetail,
    };
    readingTraceEntries.push(entry);
    if (readingTraceEntries.length > MAX_READING_TRACE_ENTRIES) {
      const overflow = readingTraceEntries.length - MAX_READING_TRACE_ENTRIES;
      readingTraceEntries.splice(0, overflow);
      readingTraceDropped += overflow;
    }
    return entry;
  } catch {
    return null;
  }
}

export function enableReadingTrace(metadata = {}) {
  readingTraceEntries.length = 0;
  readingTraceSequence = 0;
  readingTraceDropped = 0;
  readingTraceStartedAt = monotonicNow();
  readingTraceMetadata = safeValue(metadata);
  readingTraceEnabled = true;
  readingTrace('trace.enabled', { version: 1, metadata: readingTraceMetadata });
}

export function disableReadingTrace() {
  readingTraceEnabled = false;
}

export function isReadingTraceEnabled() {
  return readingTraceEnabled;
}

export function clearReadingTrace() {
  readingTraceEntries.length = 0;
  readingTraceSequence = 0;
  readingTraceDropped = 0;
  readingTraceMetadata = {};
}

export function readingTraceSnapshot() {
  return {
    version: 1,
    enabled: readingTraceEnabled,
    limit: MAX_READING_TRACE_ENTRIES,
    dropped: readingTraceDropped,
    metadata: structuredClone(readingTraceMetadata),
    entries: readingTraceEntries.map((entry) => structuredClone(entry)),
  };
}

export function registerRailDiagnosticProvider(provider) {
  const installed = typeof provider === 'function' ? provider : null;
  railDiagnosticProvider = installed;
  return () => {
    if (railDiagnosticProvider === installed) railDiagnosticProvider = null;
  };
}

function sanitizeRailDiagnostic(value) {
  const channels = Array.isArray(value?.channels) ? value.channels : [];
  return {
    version: 1,
    channels: channels.slice(0, 200).map((channel) => ({
      channelId: String(channel?.channelId || '').slice(0, 256),
      authorityReady: channel?.authorityReady === true,
      readSeq: Math.max(0, Number(channel?.readSeq || 0)),
      notificationHighWater: Math.max(0, Number(channel?.notificationHighWater || 0)),
      counts: {
        related: Math.max(0, Number(channel?.counts?.related || 0)),
        total: Math.max(0, Number(channel?.counts?.total || 0)),
      },
      rows: (Array.isArray(channel?.rows) ? channel.rows : []).slice(0, 200).map((row) => ({
        id: String(row?.id || '').slice(0, 256),
        type: String(row?.type || '').slice(0, 256),
        kind: String(row?.kind || '').slice(0, 64),
        status: String(row?.status || '').slice(0, 128),
        seq: Math.max(0, Number(row?.seq || 0)),
        ackReason: String(row?.ackReason || '').slice(0, 128),
      })),
    })),
  };
}

export function railDiagnosticSnapshot(channelId = '') {
  if (!railDiagnosticProvider) return { version: 1, channels: [] };
  try {
    return sanitizeRailDiagnostic(railDiagnosticProvider(String(channelId || '')));
  } catch {
    return { version: 1, channels: [], error: 'snapshot_failed' };
  }
}

export function railDiagnosticsText(channelId = '') {
  return JSON.stringify(railDiagnosticSnapshot(channelId), null, 2);
}

function persist() {
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(entries)); }
  catch { /* Diagnostics must never become another application failure. */ }
}

export function diagnostic(level, event, detail = {}) {
  const normalizedLevel = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
  const entry = {
    at: new Date().toISOString(),
    level: normalizedLevel,
    event: String(event || 'unknown'),
    detail: safeValue(detail),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  // State transitions remain in the in-memory flight recorder. Warnings and
  // failures also survive a reload, without turning every history page into a
  // synchronous sessionStorage rewrite on the UI thread.
  if (normalizedLevel === 'warn' || normalizedLevel === 'error') persist();

  const method = normalizedLevel === 'error' ? 'error' : normalizedLevel === 'warn' ? 'warn' : normalizedLevel === 'info' ? 'info' : 'debug';
  globalThis.console?.[method]?.(`[atoll:${entry.event}]`, entry.detail);
  return entry;
}

export function diagnosticsSnapshot() {
  return entries.map((entry) => structuredClone(entry));
}

export function clearDiagnostics() {
  entries.length = 0;
  readingTraceEnabled = false;
  clearReadingTrace();
  try { storage()?.removeItem(STORAGE_KEY); }
  catch { /* best effort */ }
}

export function diagnosticsText() {
  return JSON.stringify(diagnosticsSnapshot(), null, 2);
}

export function diagnosticsBundleText() {
  return JSON.stringify({
    diagnostics: diagnosticsSnapshot(),
    reading: readingTraceSnapshot(),
  }, null, 2);
}

export function isResizeObserverLoop(message) {
  return /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/.test(String(message || ''));
}

export function installGlobalDiagnostics() {
  if (!globalThis.addEventListener) return () => {};
  const onError = (event) => {
    // ResizeObserver 的交付循环可能在第三方布局组件同一帧继续改变尺寸时触发。
    // 浏览器会在下一帧继续投递；保留诊断但不要把这个可恢复通知升级成页面错误。
    if (isResizeObserverLoop(event.message)) {
      diagnostic('debug', 'window.resize_observer_loop', { source: event.filename });
      return;
    }
    diagnostic('error', 'window.error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    });
  };
  const onRejection = (event) => diagnostic('error', 'window.unhandled_rejection', { error: event.reason });
  globalThis.addEventListener('error', onError);
  globalThis.addEventListener('unhandledrejection', onRejection);
  return () => {
    globalThis.removeEventListener('error', onError);
    globalThis.removeEventListener('unhandledrejection', onRejection);
  };
}

if (typeof globalThis === 'object') {
  globalThis.__ATOLL_DIAGNOSTICS__ = Object.freeze({
    snapshot: diagnosticsSnapshot,
    exportText: diagnosticsText,
    exportBundleText: diagnosticsBundleText,
    clear: clearDiagnostics,
    reading: Object.freeze({
      enable: enableReadingTrace,
      disable: disableReadingTrace,
      snapshot: readingTraceSnapshot,
      clear: clearReadingTrace,
    }),
    // Explicit, read-only local snapshot. The provider exposes protocol
    // identity/classification facts only; it never queries a channel or
    // includes envelope payloads/message bodies.
    rail: Object.freeze({
      snapshot: railDiagnosticSnapshot,
      exportText: railDiagnosticsText,
    }),
  });
}
