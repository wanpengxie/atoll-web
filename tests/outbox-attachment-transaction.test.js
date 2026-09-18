// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createOutboxStore } from '../src/model/outbox-store.js';

describe('durable attachment association', () => {
  it('rechecks send authority after the awaited draft read and before bulkPut', async () => {
    const store = createOutboxStore({ databaseName: `send-fence-${crypto.randomUUID()}` });
    await store.writeDraft('p', 'c', { text: 'do not leak', editorRevision: 1 }, 0);
    let checks = 0;
    await expect(store.acceptDraft({
      principalId: 'p', channelId: 'c', expectedRevision: 1, editorRevision: 1,
      submissions: [{
        key: 'blocked', messageId: 'blocked', channelId: 'c', state: 'queued', createdAt: 1, updatedAt: 1,
        frame: { id: 'blocked', channel_id: 'c', payload: { text: 'do not leak' } },
      }],
      // First check admits transaction entry. The Dexie get then yields and
      // the second observation represents a revoke before the first write.
      authorize: () => ++checks === 1,
    })).rejects.toThrow('发送授权已变化');
    expect(checks).toBe(2);
    expect(await store.restore('p')).toEqual([]);
    expect((await store.restoreDrafts('p'))[0]).toMatchObject({ draft: { text: 'do not leak' } });
    store.close();
  });

  it('merges into the latest durable text inside one authorized transaction', async () => {
    const store = createOutboxStore({ databaseName: `attachment-${crypto.randomUUID()}` });
    await store.writeDraft('p', 'c', { text: 'latest', attachments: [], editorRevision: 3 }, 0);
    const result = await store.mergeDraftAttachments({
      principalId: 'p',
      channelId: 'c',
      expectedRevision: 1,
      attachments: [{ resource_id: 'device:/c/a.txt', name: 'a.txt' }],
      authorize: () => true,
    });
    expect(result.record).toMatchObject({
      revision: 2,
      draft: { text: 'latest', attachments: [{ resource_id: 'device:/c/a.txt', name: 'a.txt' }] },
    });
    store.close();
  });

  it('does not recreate a draft consumed after upload capture', async () => {
    const store = createOutboxStore({ databaseName: `attachment-${crypto.randomUUID()}` });
    await store.writeDraft('p', 'c', { text: 'send me', editorRevision: 1 }, 0);
    await store.acceptDraft({
      principalId: 'p', channelId: 'c', expectedRevision: 1, editorRevision: 1,
      submissions: [{
        key: 'm', messageId: 'm', channelId: 'c', state: 'queued', createdAt: 1, updatedAt: 1,
        frame: { id: 'm', channel_id: 'c', payload: { text: 'send me' } },
      }],
      authorize: () => true,
    });
    const result = await store.mergeDraftAttachments({
      principalId: 'p', channelId: 'c', expectedRevision: 1,
      attachments: [{ resource_id: 'device:/c/late.txt', name: 'late.txt' }],
      authorize: () => true,
    });
    expect(result).toMatchObject({ conflict: true, reason: 'draft_consumed' });
    store.close();
  });
});
