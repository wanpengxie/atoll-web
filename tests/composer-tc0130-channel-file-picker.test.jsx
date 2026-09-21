// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesFeature } from '../src/ui/features/files/FilesFeature.jsx';
import { mountAttachmentTransactions } from './helpers/attachment-transactions-harness.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TC-0130 Composer channel-file picker', () => {
  it('browses daemon files in the public file surface and returns one structured attachment to the Composer draft', async () => {
    const persistDraftAttachments = vi.fn(async () => undefined);
    const onOpenDynamic = vi.fn();
    const wireResource = vi.fn(async (payload) => (payload.op === 'list' ? { items: [
      { id: 'daemon://local-device/c0/资料', meta: { node_type: 'directory' } },
      { id: 'daemon://local-device/c0/说明.md', meta: { node_type: 'regular', media_type: 'text/markdown', size: 24 } },
    ] } : { items: [] }));

    const { view } = mountAttachmentTransactions({
      activeChannel: { id: 'c0', qualified_name: 'c0' },
      devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }],
      wireResource,
      persistDraftAttachments,
      onOpenDynamic,
    });
    await waitFor(() => expect(view.result.current.entries).toHaveLength(2));

    const attach = (entry) => view.result.current.attach({
      resource_id: entry.resourceId,
      address: entry.resourceId,
      name: entry.name,
      media_type: entry.mediaType || 'application/octet-stream',
      size: Number(entry.size || 0),
    });
    render(<FilesFeature channel={{ id: 'c0', qualified_name: 'c0' }} port={{
      directory: view.result.current.directory,
      deviceId: view.result.current.deviceId,
      devices: [{ id: 'local-device', name: 'local-device' }],
      entries: view.result.current.entries,
      commands: { attach, select: () => {}, navigate: () => {} },
    }} />);

    fireEvent.click(screen.getByRole('button', { name: '附加' }));
    await waitFor(() => expect(persistDraftAttachments).toHaveBeenCalledWith(
      'c0',
      [expect.objectContaining({
        resource_id: 'daemon://local-device/c0/说明.md',
        name: '说明.md',
        media_type: 'text/markdown',
      })],
      expect.anything(),
    ));
    await waitFor(() => expect(onOpenDynamic).toHaveBeenCalledOnce());
  });
});
