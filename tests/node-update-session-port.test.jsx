// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWireSessionPort } from '../src/app/hooks/useWireSession.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('canonical Shell/session node-update port', () => {
  it('checks on startup, sends one confirmed command, and polls the active receipt', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({
        current_version: 'v0.06', latest_version: 'v0.07', available: true, status: 'idle',
      }))
      .mockResolvedValueOnce(response({
        current_version: 'v0.06', latest_version: 'v0.07', available: true, status: 'starting',
      }))
      .mockResolvedValueOnce(response({
        current_version: 'v0.07', latest_version: 'v0.07', available: false, status: 'succeeded',
      }));
    vi.stubGlobal('fetch', fetch);

    const { result, unmount } = renderHook(() => useWireSessionPort({ principalId: 'root' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.update.value).toMatchObject({ status: 'idle' });
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/update?check=1', { credentials: 'include' });

    await act(async () => { await result.current.update.start(); });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/update', { method: 'POST', credentials: 'include' });
    expect(result.current.update.value).toMatchObject({ status: 'starting' });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.update.value).toMatchObject({ status: 'succeeded' });
    expect(fetch).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('does not probe or expose a command for a non-root principal', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { result, unmount } = renderHook(() => useWireSessionPort({ principalId: 'alice' }));
    expect(result.current.update.value).toBeNull();
    expect(result.current.update.active).toBe(false);
    expect(result.current.update.pending).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    await expect(result.current.update.start()).rejects.toMatchObject({ code: 'permission_denied' });
    unmount();
  });

  it.each([
    [403, { code: 'permission_denied', detail: 'only root may upgrade this node' }],
    [503, { code: 'unavailable', detail: 'automatic update unavailable' }],
  ])('projects HTTP %s as explicit unavailable instead of available', async (status, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body, status)));
    const { result, unmount } = renderHook(() => useWireSessionPort({ principalId: 'root' }));
    await waitFor(() => expect(result.current.update.value).toMatchObject({
      status: 'unsupported', available: false, detail: body.detail,
    }));
    await expect(result.current.update.start()).rejects.toMatchObject({ code: 'update_unavailable' });
    unmount();
  });

  it('projects the backend development-build detail as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      current_version: 'dev', available: false, status: 'idle', detail: '开发版不执行自动升级',
    })));
    const { result, unmount } = renderHook(() => useWireSessionPort({ principalId: 'root' }));
    await waitFor(() => expect(result.current.update.value).toMatchObject({
      status: 'unsupported', available: false, current_version: 'dev',
    }));
    unmount();
  });

  it('rechecks on a later wire reconnect and at the six-hour freshness boundary', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(response({
      current_version: 'v0.06', latest_version: 'v0.07', available: true, status: 'idle',
    }));
    vi.stubGlobal('fetch', fetch);
    const { result, unmount } = renderHook(() => useWireSessionPort({ principalId: 'root' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetch).toHaveBeenCalledTimes(1);

    act(() => { result.current.setState('open'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => { result.current.setState('reconnecting'); });
    act(() => { result.current.setState('open'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(6 * 60 * 60 * 1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenLastCalledWith('/api/update?check=1', { credentials: 'include' });
    unmount();
  });

  it('turns a rejected start into retryable failed state without claiming success', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({
        current_version: 'v0.06', latest_version: 'v0.07', available: true, status: 'idle',
      }))
      .mockResolvedValueOnce(response({ code: 'update_busy', detail: '升级已经在进行中' }, 409));
    vi.stubGlobal('fetch', fetch);
    const { result, unmount } = renderHook(() => useWireSessionPort({ principalId: 'root' }));
    await waitFor(() => expect(result.current.update.value).toMatchObject({ status: 'idle' }));
    await act(async () => {
      await expect(result.current.update.start()).rejects.toMatchObject({ code: 'update_busy', status: 409 });
    });
    expect(result.current.update.value).toMatchObject({
      current_version: 'v0.06', latest_version: 'v0.07', available: true,
      status: 'failed', detail: '升级已经在进行中',
    });
    expect(result.current.update.pending).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    unmount();
  });
});
