// @vitest-environment jsdom
// TC-1201 membership-revoke successor.  This is deliberately the queued,
// never-transmitted variant only; retired-channel settlement is covered by
// SZ-034 and is not part of this candidate.
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOutboxStore } from '../src/model/outbox-store.js';
import { useComposerSubmissionRuntime } from '../src/ui/composer/useComposerSubmissionRuntime.js';

let databaseSerial = 0;
const databaseName = () => `tc1201-membership-${++databaseSerial}-${Date.now()}`;

function memberAccess(overrides = {}) {
  return {
    authorityEpoch: 1,
    relationship: 'member',
    existence: 'present',
    runtime: 'open',
    unavailable: false,
    ...overrides,
  };
}

function runtimeHarness({ accessRef, submit, principalId = `tc1201-root-${++databaseSerial}` } = {}) {
  const store = createOutboxStore({ databaseName: databaseName() });
  return {
    activeChannelId: 'c0',
    principalId,
    producerOwnerToken: `owner-${principalId}`,
    wireState: 'reconnecting',
    wireRef: { current: null },
    accessRef,
    rosterRef: { current: { recordSubmission: vi.fn(), forgetSubmission: vi.fn(), observeFeed: vi.fn() } },
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    outboxFactory: () => store,
    store,
    submit,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('TC-1201 membership revoke: queued Composer intent is terminal before wire', () => {
  it('rejects only the queued intent, preserves the independent draft, and does not auto-revive after regrant', async () => {
    let access = memberAccess();
    const submit = vi.fn().mockResolvedValue({ message_id: 'queued-membership-revoke' });
    const config = runtimeHarness({ accessRef: { current: { state: () => access } }, submit });
    const { result, rerender, unmount } = renderHook(
      ({ wireState, accessVersion }) => useComposerSubmissionRuntime({ ...config, wireState, accessVersion }),
      { initialProps: { wireState: 'reconnecting', accessVersion: 0 } },
    );

    await waitFor(() => expect(result.current.pending).toEqual([]));
    await act(async () => {
      await result.current.updateDraft('c0', { text: 'draft survives revoke', editorRevision: 1 });
      await result.current.send({
        channelId: 'c0',
        messageId: 'queued-membership-revoke',
        text: 'queued but not transmitted',
        msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });

    expect(result.current.pending).toEqual([
      expect.objectContaining({ messageId: 'queued-membership-revoke', state: 'queued' }),
    ]);
    expect(submit).not.toHaveBeenCalled();

    access = memberAccess({ authorityEpoch: 2, relationship: 'denied' });
    config.wireRef.current = { submit };
    rerender({ wireState: 'open', accessVersion: 1 });
    await waitFor(() => expect(result.current.pending).toEqual([
      expect.objectContaining({
        messageId: 'queued-membership-revoke',
        state: 'rejected',
        error: expect.objectContaining({ code: 'forbidden' }),
      }),
    ]));

    expect(submit).not.toHaveBeenCalled();
    expect(result.current.draftFor('c0')).toMatchObject({ text: 'draft survives revoke' });
    expect(await config.store.restoreDrafts(config.principalId)).toEqual([
      expect.objectContaining({ draft: expect.objectContaining({ text: 'draft survives revoke' }) }),
    ]);

    access = memberAccess({ authorityEpoch: 3 });
    rerender({ wireState: 'open', accessVersion: 2 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(result.current.pending).toEqual([
      expect.objectContaining({ messageId: 'queued-membership-revoke', state: 'rejected' }),
    ]);
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.draftFor('c0')).toMatchObject({ text: 'draft survives revoke' });
    expect(await config.store.restoreDrafts(config.principalId)).toEqual([
      expect.objectContaining({ draft: expect.objectContaining({ text: 'draft survives revoke' }) }),
    ]);

    unmount();
    config.store.close();
  });
});
