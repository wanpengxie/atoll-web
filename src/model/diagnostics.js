const STORAGE_KEY = 'atoll.diagnostics.v1';
const MAX_ENTRIES = 500;
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
  try { storage()?.removeItem(STORAGE_KEY); }
  catch { /* best effort */ }
}

export function diagnosticsText() {
  return JSON.stringify(diagnosticsSnapshot(), null, 2);
}

export function isResizeObserverLoop(message) {
  return /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/.test(String(message || ''));
}

export function installGlobalDiagnostics() {
  if (!globalThis.addEventListener) return () => {};
  const onError = (event) => {
    // 这一条不是错误：时间线的 Virtuoso 开着 skipAnimationFrameInResizeObserver
    // （收起长消息时的锚定要靠它同步量高度），浏览器就会在同一帧里又冒出新尺寸
    // 通知时报这句。Virtuoso 自己下一轮会补量，页面没有任何坏结果。降到 debug 记
    // 一笔，别再当错误刷屏。
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
    clear: clearDiagnostics,
  });
}
