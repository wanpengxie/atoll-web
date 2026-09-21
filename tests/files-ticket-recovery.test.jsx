// @vitest-environment jsdom
// TC-0337 / E-BR-09 successor. The Files surface and the attachment
// transaction hook are the current owner after the historical resource panel
// was removed. A failed PUT must leave the same channel directory usable, and
// a later user retry must acquire a fresh one-shot ticket instead of replaying
// the expired PUT.
import React, { useRef } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesFeature } from '../src/ui/features/files/FilesFeature.jsx';
import { useAttachmentTransactions } from '../src/app/hooks/useAttachmentTransactions.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Harness({ wireResource }) {
  const channel = useRef({ id: 'c0', qualified_name: 'c0' }).current;
  const activeChannelRef = useRef(channel.id);
  const accessStateRef = useRef({
    authorityEpoch: 1, relationship: 'member', existence: 'active', runtime: 'open', unavailable: false,
  });
  const accessRef = useRef(null);
  accessRef.current ??= { state: () => accessStateRef.current };
  const wireRef = useRef({ resource: wireResource });
  const obsRef = useRef({
    channelDevices: vi.fn(async () => ({
      items: [{
        key: 'local-device',
        declared: { device_id: 'local-device', name: 'local-device', default_storage: true },
        actual: { measures: [{ name: 'online', value: true }] },
      }],
    })),
  });
  const drafts = useRef(new Map());
  const callbacks = useRef(null);
  callbacks.current ??= {
    draftFor: (channelId) => drafts.current.get(channelId) || { attachments: [] },
    updateDraft: (channelId, next) => drafts.current.set(channelId, next),
    onNotice: vi.fn(),
    onOpenDynamic: vi.fn(),
    persistDraftAttachments: vi.fn(async () => undefined),
  };
  const attachments = useAttachmentTransactions({
    activeChannel: channel,
    activeChannelId: channel.id,
    activeChannelRef,
    accessRef,
    obsRef,
    directoryVersion: 0,
    draftFor: callbacks.current.draftFor,
    drafts: drafts.current,
    updateDraft: callbacks.current.updateDraft,
    onNotice: callbacks.current.onNotice,
    onOpenDynamic: callbacks.current.onOpenDynamic,
    persistDraftAttachments: callbacks.current.persistDraftAttachments,
    principalId: 'human:root:1',
    producerOwnerToken: 'owner:tc0337',
    generationFor: () => 1,
    serverWorld: 'world-1',
    wireRef,
    wireState: 'open',
  });
  return <FilesFeature channel={channel} port={{
    devices: attachments.devices,
    deviceId: attachments.deviceId,
    directory: attachments.directory,
    entries: attachments.entries,
    busy: attachments.filesBusy,
    uploading: attachments.filesUploading,
    error: attachments.filesError,
    commands: {
      upload: async ({ files, directory, deviceId }) => {
        await attachments.uploadChannelFiles(files, { directory, deviceId });
        await attachments.refreshDirectory({ targetDirectory: directory, targetDeviceId: deviceId });
      },
      refresh: attachments.refreshDirectory,
      navigate: attachments.navigateFiles,
      selectDevice: attachments.selectDevice,
    },
  }} visible />;
}

describe('TC-0337 file ticket recovery', () => {
  it('keeps the mounted context and requests a new ticket after the first PUT expires', async () => {
    const user = userEvent.setup();
    const ticketRequests = [];
    const wireResource = vi.fn(async (payload) => {
      if (payload.op === 'list') return { items: [] };
      if (payload.op === 'create' && payload.with_content) {
        const ticket = `ticket-${ticketRequests.length + 1}`;
        ticketRequests.push(ticket);
        return { ticket, resource_id: 'daemon://local-device/c0/expired.txt' };
      }
      return { status: 'ok' };
    });
    const fetchImpl = vi.fn(async () => (fetchImpl.mock.calls.length === 1
      ? { ok: false, status: 403 }
      : { ok: true }));
    vi.stubGlobal('fetch', fetchImpl);

    render(<Harness wireResource={wireResource} />);
    const input = await screen.findByLabelText('选择要上传到当前目录的文件');
    await waitFor(() => expect(input.disabled).toBe(false));
    await waitFor(() => expect(wireResource).toHaveBeenCalledWith(expect.objectContaining({ op: 'list' })));
    const file = new File(['retry me'], 'expired.txt', { type: 'text/plain' });

    await user.upload(input, file);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('403');
    expect(alert.textContent).toContain('ticket expired');
    expect(alert.textContent).toContain('上传失败，可重新获取票据');
    expect(screen.getByRole('region', { name: '频道文件' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'c0' })).toBeTruthy();
    expect(screen.getByText('local-device')).toBeTruthy();
    expect(ticketRequests).toEqual(['ticket-1']);
    expect(fetchImpl).toHaveBeenCalledWith('/files?channel_id=c0&t=ticket-1', expect.objectContaining({ method: 'PUT' }));

    await user.upload(input, file);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(ticketRequests).toEqual(['ticket-1', 'ticket-2']);
    expect(fetchImpl).toHaveBeenCalledWith('/files?channel_id=c0&t=ticket-2', expect.objectContaining({ method: 'PUT' }));
    expect(fetchImpl.mock.calls).toHaveLength(2);
  });
});
