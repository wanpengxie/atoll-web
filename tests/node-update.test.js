// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markUpdateChecked, nodeUpdateLabel, readNodeUpdate, startNodeUpdate, updateCheckDue } from '../src/model/node-update.js';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('daily node update check', () => {
  it('is due once per 24 hours', () => {
    expect(updateCheckDue(localStorage, 100_000)).toBe(true);
    markUpdateChecked(localStorage, 100_000);
    expect(updateCheckDue(localStorage, 100_000 + 23 * 60 * 60 * 1000)).toBe(false);
    expect(updateCheckDue(localStorage, 100_000 + 24 * 60 * 60 * 1000)).toBe(true);
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

  it('keeps restart feedback in the same button', () => {
    expect(nodeUpdateLabel({ status: 'restarting' }, 'open')).toBe('正在重启…');
    expect(nodeUpdateLabel({ status: 'restarting' }, 'reconnecting')).toBe('正在重连…');
  });
});
