// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  identity: { session: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() },
  obs: { spacePrincipals: vi.fn() },
}));

vi.mock('../src/net/identity.js', () => ({ createIdentityClient: () => doubles.identity }));
vi.mock('../src/net/obs.js', () => ({ createObsClient: () => doubles.obs }));

import { useAtollSession } from '../src/app/hooks/useAtollSession.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('Atoll session identity recovery', () => {
  it('recovers the authoritative principal without browser storage', async () => {
    localStorage.clear();
    doubles.identity.session.mockResolvedValue({ id: 'root' });
    doubles.obs.spacePrincipals.mockResolvedValue({
      items: [{ declared: { id: 'root', display_name: 'Root' } }],
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useAtollSession({ onError }));

    await waitFor(() => expect(result.current.principal).toEqual({ id: 'root', display_name: 'Root' }));
    expect(doubles.identity.session).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('atoll.principal')).toBeNull();
  });

  it('releases boot from identity before slow profile enrichment', async () => {
    let resolvePrincipals;
    doubles.identity.session.mockResolvedValue({ id: 'root' });
    doubles.obs.spacePrincipals.mockReturnValue(new Promise((resolve) => { resolvePrincipals = resolve; }));

    const { result } = renderHook(() => useAtollSession({ onError: vi.fn() }));

    await waitFor(() => expect(result.current).toMatchObject({
      booting: false,
      principal: { id: 'root', display_name: '' },
    }));
    resolvePrincipals({ items: [{ declared: { id: 'root', display_name: 'Root' } }] });
    await waitFor(() => expect(result.current.principal.display_name).toBe('Root'));
  });

  it('still recovers the principal when profile observation is temporarily unavailable', async () => {
    const onError = vi.fn();
    doubles.identity.session.mockResolvedValue({ id: 'alice' });
    doubles.obs.spacePrincipals.mockRejectedValue(Object.assign(new Error('offline'), { status: 503 }));

    const { result } = renderHook(() => useAtollSession({ onError }));

    await waitFor(() => expect(result.current.principal).toEqual({ id: 'alice', display_name: '' }));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
