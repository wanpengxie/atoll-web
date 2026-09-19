// @vitest-environment jsdom
// A–D AD-125..127 use the current public identity boundary. The former
// useAtollSession owner was deleted; identity authentication is now owned by
// useIdentitySession, while optional OBS enrichment belongs to useWireConnection.
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  identity: { session: vi.fn(), logout: vi.fn() },
}));

vi.mock('../src/net/identity.js', () => ({
  createIdentityClient: vi.fn(() => doubles.identity),
}));

import { createIdentityClient } from '../src/net/identity.js';
import { useIdentitySession } from '../src/app/hooks/useWireSession.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  globalThis.localStorage?.clear();
});

describe('Atoll identity boundary (public useIdentitySession owner)', () => {
  it('[AD-125] recovers the authoritative principal without browser storage', async () => {
    // 用户能力：已有服务端 session 时能进入工作区，即使本地缓存为空。
    // 不变量：服务端认证先于 principal 发布；缓存只保存显示元数据。
    // 公共 owner：useIdentitySession().principal/booting。
    // 结果：公开 hook 恢复 root，且只调用一次 session owner。
    doubles.identity.session.mockResolvedValue({ id: 'root', display_name: 'Root' });
    const onError = vi.fn();
    const { result } = renderHook(() => useIdentitySession({ onError }));

    await waitFor(() => expect(result.current.principal).toEqual({ id: 'root', display_name: 'Root' }));
    expect(result.current.booting).toBe(false);
    expect(doubles.identity.session).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(createIdentityClient).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('atoll.session.principal.v2')).toContain('root');
  });

  it('[AD-126] releases boot from identity before optional profile enrichment', async () => {
    // 用户能力：身份已确认时立即解除启动屏，不等待显示名/目录补充。
    // 不变量：principal 的发布只依赖 identity.session；OBS enrichment 不延迟 boot。
    // 公共 owner：useIdentitySession().booting/principal。
    // 结果：session 返回无显示元数据也能公开 root，display_name 保持空值。
    let resolveSession;
    doubles.identity.session.mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));
    const { result } = renderHook(() => useIdentitySession({ onError: vi.fn() }));
    expect(result.current).toMatchObject({ booting: true, principal: null });

    resolveSession({ id: 'root' });
    await waitFor(() => expect(result.current).toMatchObject({
      booting: false,
      principal: { id: 'root', display_name: '' },
    }));
  });

  it('[AD-127] optional profile metadata 缺席时仍恢复 principal', async () => {
    // 用户能力：目录/档案显示资料暂时没有时仍可进入自己的工作区。
    // 不变量：身份事实与可选 display_name 解耦；缺少 profile 不得伪造或清除 principal。
    // 公共 owner：useIdentitySession().principal；OBS 目录由独立 useWireConnection owner 负责。
    // 结果：只有 id 的认证回执仍公开为 root，错误回调不因缺少显示资料触发。
    doubles.identity.session.mockResolvedValue({ id: 'root' });
    const onError = vi.fn();
    const { result } = renderHook(() => useIdentitySession({ onError }));

    await waitFor(() => expect(result.current.principal).toEqual({ id: 'root', display_name: '' }));
    expect(result.current.booting).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
});
