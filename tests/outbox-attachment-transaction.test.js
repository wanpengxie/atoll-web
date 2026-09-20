// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createOutboxStore } from '../src/model/outbox-store.js';

describe('durable attachment association', () => {
  it('does not expose a stale transmitting transition after authority changes during the record read', async () => {
    const store = createOutboxStore({ databaseName: `transition-fence-${crypto.randomUUID()}` });
    await store.putMany('p', [{
      key: 'queued', messageId: 'queued', channelId: 'c', state: 'queued', createdAt: 1, updatedAt: 1,
      frame: { id: 'queued', channel_id: 'c', payload: { text: 'do not transmit' } },
    }]);
    let checks = 0;
    await expect(store.patch(
      'p',
      'queued',
      ['queued'],
      { state: 'transmitting' },
      // The IndexedDB get yields; this observation represents revoke before
      // the first durable state mutation, not a later compensating rejection.
      { authorize: () => { checks += 1; return false; } },
    )).rejects.toThrow('发送授权已变化');
    expect(checks).toBe(1);
    expect((await store.restore('p'))[0]).toMatchObject({ state: 'queued' });
    store.close();
  });

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

  it('marks a stale draft write as consumed while allowing a fresh write at the sentinel revision', async () => {
    const store = createOutboxStore({ databaseName: `attachment-${crypto.randomUUID()}` });
    const first = await store.writeDraft('p', 'c', { text: 'late picker', editorRevision: 1 }, 0);
    const accepted = await store.acceptDraft({
      principalId: 'p', channelId: 'c', expectedRevision: first.record.revision, editorRevision: 1,
      submissions: [{
        key: 'late', messageId: 'late', channelId: 'c', state: 'queued', createdAt: 1, updatedAt: 1,
        frame: { id: 'late', channel_id: 'c', payload: { text: 'late picker' } },
      }],
      authorize: () => true,
    });

    const stale = await store.writeDraft('p', 'c', { text: 'late picker', editorRevision: 1 }, first.record.revision);
    expect(stale).toMatchObject({ conflict: true, reason: 'draft_consumed', current: { draft: null } });
    expect((await store.restoreDrafts('p'))[0]).toMatchObject({ revision: accepted.record.revision, draft: null });

    const sameRevision = await store.writeDraft('p', 'c', { text: 'late picker', editorRevision: 1 }, accepted.record.revision);
    expect(sameRevision).toMatchObject({ conflict: true, reason: 'draft_consumed', current: { draft: null } });

    const fresh = await store.writeDraft('p', 'c', { text: 'new draft', editorRevision: 2 }, accepted.record.revision);
    expect(fresh).toMatchObject({ conflict: false, record: { revision: accepted.record.revision + 1, draft: { text: 'new draft' } } });
    store.close();
  });
});
