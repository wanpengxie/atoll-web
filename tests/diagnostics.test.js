import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDiagnostics,
  coldEntryDiagnosticSnapshot,
  diagnostic,
  diagnosticsSnapshot,
  enableReadingTrace,
  railDiagnosticSnapshot,
  readingTrace,
  readingTraceSnapshot,
  registerRailDiagnosticProvider,
  registerColdEntryDiagnosticProvider,
} from '../src/model/diagnostics.js';

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

  it('exports an explicit local rail snapshot without retaining its provider after cleanup', () => {
    const release = registerRailDiagnosticProvider((channelId) => ({
      version: 1,
      channels: [{
        channelId,
        rows: [{ id: 'root', type: 'agent.ask', kind: 'response', status: 'completed', seq: 9, ackReason: 'counted_related' }],
      }],
    }));
    expect(globalThis.__ATOLL_DIAGNOSTICS__.rail.snapshot('c0')).toEqual({
      version: 1,
      channels: [{
        channelId: 'c0',
        authorityReady: false,
        readSeq: 0,
        notificationHighWater: 0,
        counts: { related: 0, total: 0 },
        rows: [{ id: 'root', type: 'agent.ask', kind: 'response', status: 'completed', seq: 9, ackReason: 'counted_related' }],
      }],
    });
    expect(JSON.parse(globalThis.__ATOLL_DIAGNOSTICS__.rail.exportText('c0'))).toEqual(railDiagnosticSnapshot('c0'));
    release();
    expect(railDiagnosticSnapshot('c0')).toEqual({ version: 1, channels: [] });
  });

  it('exports the bounded cold-entry chain deeply enough to name the occupying lane', () => {
    const release = registerColdEntryDiagnosticProvider(() => ({
      version: 1,
      channelId: 'cold',
      input: { kind: 'wheel', deltaY: -120, body: 'never export' },
      feed: { scheduler: { global: { occupants: [{
        channelId: 'warm', purpose: 'hydrate', priority: 'background', queuedMs: 42,
      }] } } },
    }));
    expect(coldEntryDiagnosticSnapshot()).toEqual({
      version: 1,
      channelId: 'cold',
      input: { kind: 'wheel', deltaY: -120, body: '[redacted]' },
      feed: { scheduler: { global: { occupants: [{
        channelId: 'warm', purpose: 'hydrate', priority: 'background', queuedMs: 42,
      }] } } },
    });
    expect(globalThis.__ATOLL_DIAGNOSTICS__.coldEntry.snapshot())
      .toEqual(coldEntryDiagnosticSnapshot());
    release();
    expect(coldEntryDiagnosticSnapshot()).toEqual({ version: 1, active: false });
  });

  it('keeps opt-in reading geometry metadata bounded, monotonic, redacted, and off the console', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    enableReadingTrace({ version: 'test', token: 'never-export' });
    for (let index = 0; index < 1_200; index += 1) {
      readingTrace('reading.sample', { index, body: `private-${index}`, scrollTop: index * 2 });
    }
    const snapshot = readingTraceSnapshot();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.entries).toHaveLength(snapshot.limit);
    expect(snapshot.dropped).toBe(177);
    expect(snapshot.entries[0].sequence).toBeGreaterThan(1);
    expect(snapshot.entries.every((entry, index) => (
      index === 0
      || (entry.sequence > snapshot.entries[index - 1].sequence
        && entry.elapsedMs >= snapshot.entries[index - 1].elapsedMs)
    ))).toBe(true);
    expect(snapshot.entries.at(-1).detail).toMatchObject({ index: 1_199, body: '[redacted]', scrollTop: 2_398 });
    expect(snapshot.metadata.token).toBe('[redacted]');
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.parse(globalThis.__ATOLL_DIAGNOSTICS__.exportBundleText()).reading.entries).toHaveLength(snapshot.limit);
  });

  it('does not evaluate trace-only geometry while the reading recorder is disabled', () => {
    let geometryReads = 0;
    readingTrace('reading.geometry', () => {
      geometryReads += 1;
      return { scrollHeight: 1000 };
    });
    expect(geometryReads).toBe(0);

    enableReadingTrace({ case: 'lazy-geometry' });
    readingTrace('reading.geometry', () => {
      geometryReads += 1;
      return { scrollHeight: 1000 };
    });
    expect(geometryReads).toBe(1);
    expect(readingTraceSnapshot().entries.at(-1).detail.scrollHeight).toBe(1000);
  });

  it('isolates a failing detail factory without leaking its error text', () => {
    enableReadingTrace({ case: 'failing-detail' });
    expect(() => readingTrace('reading.geometry', () => {
      throw new Error('private message body');
    })).not.toThrow();
    expect(readingTraceSnapshot().entries.at(-1)).toMatchObject({
      event: 'trace.detail-error',
      detail: { sourceEvent: 'reading.geometry' },
    });
    expect(JSON.stringify(readingTraceSnapshot())).not.toContain('private message body');
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
