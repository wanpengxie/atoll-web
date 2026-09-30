// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useUiWords } from '../src/app/hooks/useUiWords.js';

// 回复是在 key 写完之后才发的：表单已经关了、回复发不出去时，要照实说 key 已经写进去了。
describe('useUiWords closed notice', () => {
  const form = { id: 'form-1', channelId: 'c0', envelope: { id: 'form-1', channel_id: 'c0' }, secret: { api_key: 'global/deepseek_prod' } };
  function mount(resolveError) {
    const onNotice = vi.fn();
    const wireRef = { current: { resolve: vi.fn(async () => { throw resolveError; }), session: () => ({ id: 's-1' }) } };
    const { result } = renderHook(() => useUiWords({ stateEntries: [], version: 0, selfFor: () => '', wireRef, wireState: 'closed', onNotice }));
    return { result, onNotice };
  }

  it('says the key was written when the form closed before the reply went out', async () => {
    const { result, onNotice } = mount(Object.assign(new Error('closed'), { code: 'already_closed' }));
    const writeSecret = vi.fn(async () => {});
    await act(async () => { await result.current.submit(form, { api_key: 'sk-new' }, writeSecret); });
    expect(writeSecret).toHaveBeenCalledWith('global/deepseek_prod', 'sk-new');
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('key 已写入 global/deepseek_prod'));
    expect(onNotice.mock.calls[0][0]).toContain('agent 没收到回复');
  });

  it('keeps the plain notice when nothing was written', async () => {
    const { result, onNotice } = mount(Object.assign(new Error('closed'), { code: 'already_closed' }));
    await act(async () => { await result.current.submit({ ...form, secret: {} }, { model: 'x' }, vi.fn()); });
    expect(onNotice).toHaveBeenCalledWith('这张表单已经关闭（在别处答复了或已过期）。');
  });
});
