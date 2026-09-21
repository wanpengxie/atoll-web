// @vitest-environment jsdom
import { cleanup, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountAttachmentTransactions } from './helpers/attachment-transactions-harness.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TC-0129 Composer attachment ticket upload', () => {
  it('creates a current-channel resource ticket before uploading bytes and returns a sendable attachment', async () => {
    const wireResource = vi.fn(async (payload) => (
      payload.op === 'create' && payload.with_content
        ? { status: 'ok', ticket: 'put-once', resource_id: 'file:uploaded:1' }
        : { items: [] }
    ));
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchImpl);

    const { view } = mountAttachmentTransactions({
      activeChannel: { id: 'c0', qualified_name: 'c0' },
      devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }],
      wireResource,
    });
    await waitFor(() => expect(view.result.current.deviceId).toBe('local-device'));

    const file = new File(['可信内容'], '研究 文档.md', { type: 'text/markdown' });
    let uploaded;
    await act(async () => {
      uploaded = await view.result.current.uploadChannelFiles([file]);
    });

    expect(wireResource).toHaveBeenCalledWith(expect.objectContaining({
      channel_id: 'c0',
      op: 'create',
      address: 'daemon://local-device/c0/%E7%A0%94%E7%A9%B6-%E6%96%87%E6%A1%A3.md',
      with_content: true,
    }));
    expect(fetchImpl).toHaveBeenCalledWith(
      '/files?channel_id=c0&t=put-once',
      expect.objectContaining({ method: 'PUT', body: file, credentials: 'include' }),
    );
    expect(uploaded).toEqual([expect.objectContaining({
      resource_id: 'file:uploaded:1',
      name: '研究-文档.md',
      media_type: 'text/markdown',
    })]);
  });
});
