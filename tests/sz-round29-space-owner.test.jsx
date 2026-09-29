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

  it('[SZ-019] does not invent local-device when the channel device authority lists none', async () => {
    const channelDevices = vi.fn().mockResolvedValue(deviceObservation([]));
    const mounted = mountAttachmentTransactions({
      activeChannel: {
        id: 'c0',
        qualified_name: 'c0',
      },
      channelDevices,
    });

    await waitFor(() => expect(channelDevices).toHaveBeenCalledWith('c0'));
    await waitFor(() => expect(mounted.view.result.current.devices).toEqual([]));
    expect(mounted.view.result.current.deviceId).toBe('');
    mounted.view.unmount();
  });
});
