import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useAttachmentTransactions } from '../../src/app/hooks/useAttachmentTransactions.js';

// Shared harness for the single production owner of file listing / preview /
// upload / attach behaviour (useAttachmentTransactions). Every RF-scope
// vitest case that needs real hook behaviour (not just presentational
// wiring) mounts through this helper so the fixture matches what
// WorkspaceApp actually constructs, rather than inventing a second shape.
export function deviceObservation(devices = []) {
  return {
    items: devices.map((device) => ({
      key: device.id,
      declared: {
        device_id: device.id,
        name: device.name || device.id,
        default_storage: device.defaultStorage === true,
      },
      actual: { measures: [{ name: 'online', unknown: device.online === undefined, value: device.online }] },
    })),
  };
}

export function mountAttachmentTransactions(overrides = {}) {
  const channel = overrides.activeChannel === undefined
    ? { id: 'c0', qualified_name: 'c0' }
    : overrides.activeChannel;
  const activeChannelId = overrides.activeChannelId ?? channel?.id ?? '';
  const accessState = {
    authorityEpoch: 1, relationship: 'member', existence: 'active', runtime: 'open', unavailable: false,
    ...overrides.access,
  };
  const wireResource = overrides.wireResource || vi.fn(async () => ({ items: [] }));
  const wire = { resource: wireResource };
  const drafts = overrides.drafts || new Map();
  const channelDevices = overrides.channelDevices
    || vi.fn().mockResolvedValue(deviceObservation(overrides.devices || []));
  const activeChannelRef = { current: activeChannelId };
  const baseProps = {
    activeChannel: channel,
    activeChannelId,
    activeChannelRef,
    accessRef: { current: { state: () => accessState } },
    obsRef: { current: { channelDevices } },
    directoryVersion: 0,
    draftFor: overrides.draftFor || ((channelId) => drafts.get(channelId) || { attachments: [] }),
    drafts,
    updateDraft: overrides.updateDraft || vi.fn((channelId, next) => drafts.set(channelId, next)),
    onNotice: overrides.onNotice || vi.fn(),
    onOpenDynamic: overrides.onOpenDynamic || vi.fn(),
    persistDraftAttachments: overrides.persistDraftAttachments || vi.fn(async () => undefined),
    principalId: overrides.principalId || 'human:root:1',
    producerOwnerToken: overrides.producerOwnerToken || 'owner:1',
    generationFor: overrides.generationFor || (() => 1),
    serverWorld: overrides.serverWorld || 'world-1',
    wireRef: { current: wire },
    wireState: overrides.wireState || 'open',
  };
  const view = renderHook((props) => useAttachmentTransactions(props), { initialProps: baseProps });
  return { view, wire, wireResource, channelDevices, drafts, accessState, activeChannelRef, props: baseProps };
}
