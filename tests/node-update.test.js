// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNodeUpdate } from '../src/app/hooks/useNodeUpdate.js';
import { nodeUpdateLabel, readNodeUpdate, startNodeUpdate, UPDATE_CHECK_INTERVAL_MS } from '../src/model/node-update.js';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('node update checks', () => {
  it('checks every six hours while the page stays open', () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('uses the authenticated current-node endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'idle' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'starting' }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    await readNodeUpdate({ check: true });
    await startNodeUpdate();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/update?check=1', { credentials: 'same-origin' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/update', { credentials: 'same-origin', method: 'POST' });
  });

  it('checks on page startup and again after a node reconnect', async () => {
    const response = () => new Response(JSON.stringify({ current_version: 'v0.06', available: false, status: 'idle' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response());
    const { rerender } = renderHook(({ wireState }) => useNodeUpdate({ principalId: 'root', wireState }), { initialProps: { wireState: 'open' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender({ wireState: 'reconnecting' });
    rerender({ wireState: 'open' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/update?check=1', '/api/update?check=1']);
  });

  it('keeps restart feedback in the same button', () => {
    expect(nodeUpdateLabel({ status: 'restarting' }, 'open')).toBe('正在重启…');
    expect(nodeUpdateLabel({ status: 'restarting' }, 'reconnecting')).toBe('正在重连…');
  });
});
