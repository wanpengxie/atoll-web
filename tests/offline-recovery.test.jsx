// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSubmissions } from '../src/app/hooks/useSubmissions.js';
import { createOutboxStore } from '../src/model/outbox-store.js';
import { Composer } from '../src/ui/Composer.jsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function memberHarness(overrides = {}) {
  return {
    principalId: 'offline-root',
    activeChannelId: 'c0',
    wireState: 'reconnecting',
    wireRef: { current: null },
    rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
    accessRef: { current: { state: () => ({ relationship: 'member', runtime: 'open', unavailable: false }) } },
    channelStatesRef: { current: new Map() },
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    ...overrides,
  };
}

describe('W6 offline draft and recovery', () => {
  it('keeps an offline member editor writable, accepts text locally, and disables live attachment entry', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(['offline-message']);
    render(<Composer
      channelId="c0"
      roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent', kind: 'agent', name: 'Agent' }]}
      selfId="me"
      canEditDraft
      canDurablyAccept
      canTransmit={false}
      onDraftChange={vi.fn().mockResolvedValue({ revision: 1 })}
      onSend={onSend}
      onUploadAttachments={vi.fn()}
      onOpenChannelFiles={vi.fn()}
    />);

    const editor = screen.getByRole('textbox', { name: '消息' });
    expect(editor.getAttribute('contenteditable')).toBe('true');
    expect(screen.getByText(/离线编辑/)).toBeTruthy();
    expect(screen.getByLabelText('上传本机文件到频道').disabled).toBe(true);
    expect(screen.getByRole('button', { name: '从频道文件选择' }).disabled).toBe(true);

    await user.type(editor, '@Ag');
    await user.click(screen.getByRole('option', { name: /Agent/ }));
    await user.type(editor, '离线也能保存{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend.mock.calls[0][0]).toMatchObject({
      batch: [expect.objectContaining({ text: '离线也能保存', audience: ['agent'] })],
    });
  });

  it.each([
    ['unknown principal', { canEditDraft: false, canDurablyAccept: false, canTransmit: false }],
    ['read-only observer', { canEditDraft: false, canDurablyAccept: false, canTransmit: false }],
    ['revoked member', { canEditDraft: false, canDurablyAccept: false, canTransmit: false }],
  ])('does not expose a durable send seam for %s', async (_label, capabilities) => {
    const onSend = vi.fn();
    render(<Composer channelId="c0" roster={[]} disabledReason="不可写" onSend={onSend} {...capabilities} />);
    const editor = screen.getByRole('textbox', { name: '消息' });
    expect(editor.getAttribute('contenteditable')).toBe('false');
    expect(screen.getByRole('button', { name: '发送' }).disabled).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('retries a rejected IndexedDB open on the next explicit draft write without losing the dirty draft', async () => {
    const durableIndexedDB = globalThis.indexedDB;
    let opens = 0;
    const flakyIndexedDB = Object.create(durableIndexedDB);
    flakyIndexedDB.open = (...args) => {
      opens += 1;
      if (opens <= 2) throw new Error('retryable indexeddb failure');
      return durableIndexedDB.open(...args);
    };
    vi.stubGlobal('indexedDB', flakyIndexedDB);
    const common = memberHarness();
    const { result } = renderHook(() => useSubmissions(common));

    await waitFor(() => expect(common.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'retryable indexeddb failure' })));
    let firstFailure;
    await act(async () => {
      try {
        await result.current.updateDraft('c0', { text: '数据库恢复后仍在', editorRevision: 1 });
      } catch (error) {
        firstFailure = error;
      }
    });
    expect(firstFailure).toMatchObject({ message: 'retryable indexeddb failure' });
    // The failed durable attempt must not roll back the user's optimistic
    // editor state. A later explicit edit/save retries the lifecycle.
    expect(result.current.draftFor('c0')).toMatchObject({ text: '数据库恢复后仍在', editorRevision: 1 });
    let saved;
    await act(async () => {
      saved = await result.current.updateDraft('c0', { text: '数据库恢复后仍在', editorRevision: 1 });
    });
    expect(opens).toBe(3);
    expect(saved).toMatchObject({ draft: { text: '数据库恢复后仍在' }, editorRevision: 1 });
    expect(result.current.draftFor('c0')).toMatchObject({ text: '数据库恢复后仍在', editorRevision: 1 });
  });

  it('lets only the newest draft transaction publish and persist', async () => {
    const principalId = `draft-owner-${crypto.randomUUID()}`;
    const common = memberHarness({ principalId });
    const { result } = renderHook(() => useSubmissions(common));
    await waitFor(() => expect(result.current.draftFor('c0').text).toBe(''));

    let transactions;
    act(() => {
      transactions = [
        result.current.updateDraft('c0', { text: 'stale', editorRevision: 1 }),
        result.current.updateDraft('c0', { text: 'current', editorRevision: 2 }),
      ];
    });
    const [first] = await Promise.all(transactions);
    await act(async () => {});

    expect(first).toBeNull();
    expect(result.current.draftFor('c0')).toMatchObject({ text: 'current', editorRevision: 2 });
    const store = createOutboxStore();
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
