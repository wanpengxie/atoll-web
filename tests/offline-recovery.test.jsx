// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOutboxStore } from '../src/model/outbox-store.js';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { useComposerSubmissionRuntime } from '../src/ui/composer/useComposerSubmissionRuntime.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function memberHarness(overrides = {}) {
  const databaseName = `current-composer-${crypto.randomUUID()}`;
  return {
    principalId: 'offline-root',
    activeChannelId: 'c0',
    wireState: 'reconnecting',
    wireRef: { current: null },
    rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
    accessRef: { current: { state: () => ({
      authorityEpoch: 1,
      relationship: 'member',
      existence: 'present',
      runtime: 'open',
      unavailable: false,
    }) } },
    producerOwnerToken: 'owner:offline-root',
    generationFor: () => 1,
    serverWorld: 'world-a',
    outboxFactory: () => createOutboxStore({ databaseName }),
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    ...overrides,
  };
}

function composerModel(draft, permissions) {
  return {
    channelId: 'c0',
    draft,
    permissions,
    delivery: { kind: 'channel', rows: [], label: '频道成员' },
    mentionCandidates: [],
    mentionQuery: null,
    commandMenu: null,
    agents: [],
    selectedAgent: null,
    parameters: null,
    controls: { actorId: '', steer: { state: 'unsupported', enabled: false, reason: '' } },
    busy: false,
    failure: null,
    edit: null,
    editSession: null,
    canSubmit: permissions.canDurablyAccept && Boolean(draft.text.trim()),
  };
}

function OfflineComposer({ onSend }) {
  const [draft, setDraft] = useState({
    text: '', recipients: [], attachments: [], replyTarget: null, editorRevision: 0,
  });
  const permissions = { canEditDraft: true, canDurablyAccept: true, canTransmit: false, reason: '' };
  const commands = {
    changeDraft(change) {
      setDraft((current) => ({ ...current, ...change, editorRevision: current.editorRevision + 1 }));
    },
    send() { return onSend(draft); },
  };
  return <Composer model={composerModel(draft, permissions)} commands={commands} />;
}

describe('W6 offline draft and recovery', () => {
  it('keeps an offline member editor writable, accepts text locally, and disables live attachment entry', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(['offline-message']);
    render(<OfflineComposer onSend={onSend} />);

    const editor = screen.getByRole('textbox', { name: '消息' });
    expect(editor.disabled).toBe(false);
    expect(screen.getByText(/离线编辑/)).toBeTruthy();
    expect(screen.getByLabelText('上传本机文件到频道').disabled).toBe(true);

    await user.type(editor, '离线也能保存{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: '离线也能保存' }));
  });

  it.each([
    ['unknown principal', { canEditDraft: false, canDurablyAccept: false, canTransmit: false }],
    ['read-only observer', { canEditDraft: false, canDurablyAccept: false, canTransmit: false }],
    ['revoked member', { canEditDraft: false, canDurablyAccept: false, canTransmit: false }],
  ])('does not expose a durable send seam for %s', async (_label, capabilities) => {
    const onSend = vi.fn();
    const draft = { text: '不能发送', recipients: [], attachments: [], replyTarget: null, editorRevision: 0 };
    render(<Composer
      model={composerModel(draft, { ...capabilities, reason: '不可写' })}
      commands={{ changeDraft: vi.fn(), send: onSend }}
    />);
    const editor = screen.getByRole('textbox', { name: '消息' });
    expect(editor.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '发送' }).disabled).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('rejects a draft write before persistence when the exact access owner is absent', async () => {
    const outbox = {
      restore: vi.fn().mockResolvedValue([]),
      restoreDrafts: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    };
    const common = memberHarness({
      outboxFactory: () => outbox,
      accessRef: { current: { state: () => ({
        authorityEpoch: 2,
        relationship: 'observer',
        existence: 'present',
        runtime: 'open',
        unavailable: false,
      }) } },
    });
    const { result } = renderHook(() => useComposerSubmissionRuntime(common));
    await waitFor(() => expect(outbox.restoreDrafts).toHaveBeenCalledOnce());

    let failure;
    try {
      result.current.updateDraft('c0', { text: '不属于当前成员 owner', editorRevision: 1 });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'forbidden', message: '频道成员权限已撤销' });
    expect(result.current.draftFor('c0')).toMatchObject({ text: '', editorRevision: 0 });
  });

  it('serializes draft CAS writes without letting an older settlement replace the newer editor state', async () => {
    const principalId = `draft-owner-${crypto.randomUUID()}`;
    const databaseName = `draft-owner-${crypto.randomUUID()}`;
    const storeOwner = createOutboxStore({ databaseName });
    let hydrationComplete;
    const hydrated = new Promise((resolve) => { hydrationComplete = resolve; });
    const outbox = {
      ...storeOwner,
      async restoreDrafts(...args) {
        const rows = await storeOwner.restoreDrafts(...args);
        hydrationComplete();
        return rows;
      },
    };
    const common = memberHarness({
      principalId,
      outboxFactory: () => outbox,
    });
    const { result } = renderHook(() => useComposerSubmissionRuntime(common));
    await hydrated;
    await act(async () => {});

    let transactions;
    act(() => {
      transactions = [
        result.current.updateDraft('c0', { text: 'stale', editorRevision: 1 }),
        result.current.updateDraft('c0', { text: 'current', editorRevision: 2 }),
      ];
    });
    const [first, second] = await Promise.all(transactions);
    await act(async () => {});

    expect(first).toMatchObject({ revision: 1, editorRevision: 1, draft: { text: 'stale' } });
    expect(second).toMatchObject({ revision: 2, editorRevision: 2, draft: { text: 'current' } });
    expect(result.current.draftFor('c0')).toMatchObject({ text: 'current', editorRevision: 2 });
    const store = createOutboxStore({ databaseName });
    expect((await store.restoreDrafts(principalId))[0]).toMatchObject({
      draft: { text: 'current' }, editorRevision: 2,
    });
    store.close();
  });

  it('rejects renderer-only attachment URLs before any durable submission is inserted', async () => {
    const store = createOutboxStore({ databaseName: `outbox-attachment-${crypto.randomUUID()}` });
    const submission = {
      key: 'c0:blob-only', channelId: 'c0', messageId: 'blob-only', state: 'queued',
      frame: {
        id: 'blob-only', channel_id: 'c0', msg_type: 'agent.ask',
        payload: { text: '附件', attachments: [{ name: 'temporary.png', url: 'blob:temporary' }] },
      },
      createdAt: 1, updatedAt: 1,
    };
    await expect(store.putMany('offline-root', [submission])).rejects.toThrow('附件尚未成为可恢复的频道资源');
    expect(await store.restore('offline-root')).toEqual([]);
    store.close();
  });

  it('keeps a stable uploaded attachment while removing its renderer-only preview handle', async () => {
    const store = createOutboxStore({ databaseName: `outbox-stable-attachment-${crypto.randomUUID()}` });
    const submission = {
      key: 'c0:stable-file', channelId: 'c0', messageId: 'stable-file', state: 'queued',
      frame: {
        id: 'stable-file', channel_id: 'c0', msg_type: 'agent.ask',
        payload: { text: '附件', attachments: [{ resource_id: 'file:stable', name: 'stable.png', preview_url: 'blob:temporary' }] },
      },
      createdAt: 1, updatedAt: 1,
    };
    const [durable] = await store.putMany('offline-root', [submission]);
    expect(durable.frame.payload.attachments).toEqual([{ resource_id: 'file:stable', name: 'stable.png' }]);
    expect((await store.restore('offline-root'))[0].frame.payload.attachments).toEqual([{ resource_id: 'file:stable', name: 'stable.png' }]);
    store.close();
  });

  it('never restores a local-only draft attachment as though its object URL were durable', async () => {
    const store = createOutboxStore({ databaseName: `draft-local-attachment-${crypto.randomUUID()}` });
    await store.writeDraft('offline-root', 'c0', {
      text: '正文仍可恢复',
      editorRevision: 1,
      attachments: [
        { name: 'local.png', preview_url: 'blob:local-only' },
        { resource_id: 'file:uploaded', name: 'uploaded.png', preview_url: 'blob:preview' },
      ],
    }, 0);
    const [restored] = await store.restoreDrafts('offline-root');
    expect(restored.draft).toMatchObject({
      text: '正文仍可恢复',
      attachments: [{ resource_id: 'file:uploaded', name: 'uploaded.png' }],
    });
    expect(JSON.stringify(restored)).not.toContain('blob:');
    store.close();
  });
});
