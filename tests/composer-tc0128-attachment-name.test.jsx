// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountAttachmentTransactions } from './helpers/attachment-transactions-harness.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TC-0128 Composer attachment naming', () => {
  it('assigns readable suffixes for same-name uploads without replacing earlier draft attachments', async () => {
    const drafts = new Map();
    const persistDraftAttachments = vi.fn(async (channelId, attachments) => {
      const current = drafts.get(channelId) || { revision: 0, attachments: [] };
      drafts.set(channelId, {
        revision: current.revision + 1,
        attachments: [...current.attachments, ...attachments],
      });
    });
    const wireResource = vi.fn(async (payload) => (
      payload.op === 'create' && payload.with_content
        ? { ticket: `put-${payload.address}`, resource_id: `uploaded:${payload.address}` }
        : { items: [] }
    ));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const { view } = mountAttachmentTransactions({
      activeChannel: { id: 'c0', qualified_name: 'c0' },
      devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }],
      wireResource,
      drafts,
      persistDraftAttachments,
    });
    await waitFor(() => expect(view.result.current.deviceId).toBe('local-device'));

    let firstBatch;
    await act(async () => {
      firstBatch = await view.result.current.uploadComposerAttachments([
        new File(['a'], 'image.png', { type: 'image/png' }),
        new File(['b'], 'image.png', { type: 'image/png' }),
      ]);
    });
    expect(firstBatch.map((row) => row.name)).toEqual(['image.png', 'image-2.png']);

    let readme;
    await act(async () => {
      readme = await view.result.current.uploadComposerAttachments([
        new File(['existing'], 'README', { type: 'text/plain' }),
      ]);
    });
    expect(readme[0].name).toBe('README');

    let later;
    await act(async () => {
      later = await view.result.current.uploadComposerAttachments([
        new File(['c'], 'image.png', { type: 'image/png' }),
        new File(['d'], 'README', { type: 'text/plain' }),
      ]);
    });
    expect(later.map((row) => row.name)).toEqual(['image-3.png', 'README-2']);

    const persisted = drafts.get('c0')?.attachments || [];
    expect(persisted.map((row) => row.name)).toEqual([
      'image.png', 'image-2.png', 'README', 'image-3.png', 'README-2',
    ]);
    expect(new Set(persisted.map((row) => row.name)).size).toBe(persisted.length);
  });

  it('keeps suffix allocation case-insensitive when existing draft names differ only by case', async () => {
    const drafts = new Map([
      ['c0', {
        revision: 0,
        attachments: [
          { resource_id: 'existing:image', name: 'IMAGE.PNG', _atoll_world_epoch: 'world-1' },
          { resource_id: 'existing:image-2', name: 'image-2.png', _atoll_world_epoch: 'world-1' },
          { resource_id: 'existing:readme', name: 'README', _atoll_world_epoch: 'world-1' },
        ],
      }],
    ]);
    const wireResource = vi.fn(async (payload) => (
      payload.op === 'create' && payload.with_content
        ? { ticket: `put-${payload.address}`, resource_id: `uploaded:${payload.address}` }
        : { items: [] }
    ));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const { view } = mountAttachmentTransactions({
      activeChannel: { id: 'c0', qualified_name: 'c0' },
      devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }],
      wireResource,
      drafts,
    });
    await waitFor(() => expect(view.result.current.deviceId).toBe('local-device'));

    let uploaded;
    await act(async () => {
      uploaded = await view.result.current.uploadComposerAttachments([
        new File(['image'], 'image.png', { type: 'image/png' }),
        new File(['readme'], 'README', { type: 'text/plain' }),
      ]);
    });
    expect(uploaded.map((row) => row.name)).toEqual(['image-3.png', 'README-2']);
  });
});
