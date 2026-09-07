import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDiagnostics, diagnostic, diagnosticsSnapshot } from '../src/model/diagnostics.js';

describe('frontend diagnostics', () => {
  let stored;
  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal('sessionStorage', {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value)),
      removeItem: (key) => stored.delete(key),
    });
    clearDiagnostics();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps structured records while redacting message and credential fields', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    diagnostic('error', 'wire.failed', {
      channelId: 'c1', token: 'secret', payload: { message: 'private' },
      error: Object.assign(new Error('boom'), { code: 'closed' }),
    });
    const [entry] = diagnosticsSnapshot();
    expect(entry).toMatchObject({ level: 'error', event: 'wire.failed', detail: { channelId: 'c1', token: '[redacted]', payload: '[redacted]' } });
    expect(entry.detail.error).toMatchObject({ name: 'Error', message: 'boom', code: 'closed' });
    expect(JSON.parse(sessionStorage.getItem('atoll.diagnostics.v1'))).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
  });

  it('exposes a browser-readable snapshot and clear operation', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    diagnostic('info', 'feed.ready', { channels: 2 });
    expect(globalThis.__ATOLL_DIAGNOSTICS__.snapshot()).toHaveLength(1);
    expect(JSON.parse(globalThis.__ATOLL_DIAGNOSTICS__.exportText())).toHaveLength(1);
    globalThis.__ATOLL_DIAGNOSTICS__.clear();
    expect(diagnosticsSnapshot()).toEqual([]);
  });
});

describe('ResizeObserver loop 报错的处置', () => {
  it('只降级记录，不再算 window.error', async () => {
    const { installGlobalDiagnostics, isResizeObserverLoop, clearDiagnostics: clear, diagnosticsSnapshot: snapshot } = await import('../src/model/diagnostics.js');
    expect(isResizeObserverLoop('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isResizeObserverLoop('ResizeObserver loop limit exceeded')).toBe(true);
    expect(isResizeObserverLoop('TypeError: x is not a function')).toBe(false);
    const listeners = {};
    vi.stubGlobal('addEventListener', (name, fn) => { listeners[name] = fn; });
    vi.stubGlobal('removeEventListener', () => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    clear();
    const uninstall = installGlobalDiagnostics();
    listeners.error({ message: 'ResizeObserver loop completed with undelivered notifications.', filename: 'x' });
    listeners.error({ message: 'boom', filename: 'y', lineno: 1, colno: 2, error: null });
    const events = snapshot().map((e) => [e.level, e.event]);
    expect(events).toContainEqual(['error', 'window.error']);
    expect(events.some(([, event]) => event === 'window.error' && false)).toBe(false);
    expect(events.filter(([, event]) => event === 'window.error')).toHaveLength(1);
    expect(events).toContainEqual(['debug', 'window.resize_observer_loop']);
    uninstall();
  });
});
