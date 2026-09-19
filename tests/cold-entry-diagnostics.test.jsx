// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearDiagnostics,
  coldEntryDiagnosticSnapshot,
  diagnosticsSnapshot,
} from '../src/model/diagnostics.js';
import { useColdEntryDiagnostics } from '../src/ui/timeline/useColdEntryDiagnostics.js';

function spec({
  channelId = 'a', activationID = 'activation:a',
  replicaRevision = 0, replicaRows = 0, historyStatus = {},
} = {}) {
  return {
    channelId,
    viewKey: `${channelId}:all`,
    selfReady: true,
    surfaceVisible: true,
    presentation: { revision: 1, sourceRevision: replicaRevision, rows: [] },
    reading: {
      activationID,
      availability: 'empty-known',
      initializing: false,
      presentationPending: false,
      restorePending: false,
      bottomReady: false,
      historyDemand: { revision: 0, phase: 'idle', error: false },
      getSession: () => ({ activationID, inputEpoch: 0, mode: 'following' }),
    },
    history: {
      channelId, attached: true, hasOlder: false, localReplicaReady: true,
      presentationRevision: replicaRevision,
      loaded: replicaRows > 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      ...historyStatus,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  clearDiagnostics();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('uses the committed activation for provider/deadline reads and logs every entry at info', () => {
  const hook = renderHook(({ value }) => useColdEntryDiagnostics(value), {
    initialProps: { value: spec() },
  });
  hook.rerender({ value: spec({ channelId: 'b', activationID: 'activation:b' }) });
  act(() => vi.advanceTimersByTime(2_600));

  expect(coldEntryDiagnosticSnapshot()).toMatchObject({
    channelId: 'b',
    reading: { activationID: 'activation:b' },
  });
  const entries = diagnosticsSnapshot().filter((entry) => (
    entry.event === 'cold_entry.snapshot' && entry.detail.trigger === 'entry'
  ));
  expect(entries.map((entry) => [entry.level, entry.detail.channelId])).toEqual([
    ['info', 'a'],
    ['info', 'b'],
  ]);
  expect(diagnosticsSnapshot().some((entry) => (
    entry.detail.trigger === 'stalled-deadline' && entry.detail.channelId === 'a'
  ))).toBe(false);
});

it('associates dispatch and Replica completion without calling presentation success early', () => {
  const hook = renderHook(({ value }) => useColdEntryDiagnostics(value), {
    initialProps: { value: spec() },
  });
  hook.rerender({ value: spec({
    historyStatus: {
      loading: true, foregroundLoading: true,
      historyDemand: { revision: 1, phase: 'pending', error: '' },
    },
  }) });
  act(() => vi.advanceTimersByTime(300));
  hook.rerender({ value: spec({
    replicaRevision: 1,
    replicaRows: 8,
    historyStatus: { completedPages: 1 },
  }) });
  act(() => vi.advanceTimersByTime(300));

  const triggers = diagnosticsSnapshot()
    .filter((entry) => entry.event === 'cold_entry.snapshot')
    .map((entry) => entry.detail.trigger);
  expect(triggers).toContain('dispatch');
  expect(triggers).toContain('data-complete');
  expect(triggers).not.toContain('presented');
});
