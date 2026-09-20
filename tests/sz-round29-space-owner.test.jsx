// @vitest-environment jsdom
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deviceObservation,
  mountAttachmentTransactions,
} from './helpers/attachment-transactions-harness.js';

afterEach(() => vi.restoreAllMocks());

describe('round 29 current channel-device owner', () => {
  it('[SZ-019] derives file storage choices from the channel device authority', async () => {
    const channelDevices = vi.fn().mockResolvedValue(deviceObservation([
      { id: 'mounted-device', name: 'Mounted', defaultStorage: true, online: true },
    ]));
    const mounted = mountAttachmentTransactions({
      activeChannel: {
        id: 'c0',
        qualified_name: 'c0',
        // A space-inventory id must not become a channel mount by fallback.
        default_storage_device_id: 'space-only-device',
      },
      channelDevices,
    });

    await waitFor(() => expect(mounted.view.result.current.deviceId).toBe('mounted-device'));
    expect(channelDevices).toHaveBeenCalledWith('c0');
    expect(mounted.view.result.current.devices).toEqual([{
      id: 'mounted-device',
      name: 'Mounted',
      defaultStorage: true,
      online: true,
    }]);
    expect(mounted.view.result.current.devices[0]).not.toHaveProperty('ownerPrincipal');
    expect(mounted.view.result.current.devices[0]).not.toHaveProperty('attachedAt');
    mounted.view.unmount();
  });

  it('[SZ-019] does not invent a channel device from a space-only configured id', async () => {
    const channelDevices = vi.fn().mockResolvedValue(deviceObservation([]));
    const mounted = mountAttachmentTransactions({
      activeChannel: {
        id: 'c0',
        qualified_name: 'c0',
        default_storage_device_id: 'space-only-device',
      },
      channelDevices,
    });

    await waitFor(() => expect(channelDevices).toHaveBeenCalledWith('c0'));
    await waitFor(() => expect(mounted.view.result.current.devices).toEqual([]));
    expect(mounted.view.result.current.deviceId).toBe('');
    mounted.view.unmount();
  });
});
