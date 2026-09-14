// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSubmissions } from '../src/app/hooks/useSubmissions.js';

afterEach(() => localStorage.clear());

describe('offline submission outbox', () => {
  it('accepts locally while disconnected and automatically transmits after reconnect', async () => {
    const wireRef = { current: null };
    const submit = vi.fn().mockResolvedValue({ message_id: 'fixed-message' });
    const common = {
      principalId: 'root', activeChannelId: 'c0', wireRef,
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: { receipt: vi.fn() } }, channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ wireState }) => useSubmissions({ ...common, wireState }), {
      initialProps: { wireState: 'reconnecting' },
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'fixed-message';
      try {
        await result.current.send({ text: 'offline', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.pending[0]).toMatchObject({ state: 'queued', text: 'offline' });

    wireRef.current = { submit };
    rerender({ wireState: 'open' });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
  });
});
