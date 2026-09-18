import Dexie from 'dexie';

const DATABASE_NAME = 'atoll-outbox-v1';

function meaningfulDraft(draft) {
  return Boolean(
    draft?.text
    || draft?.recipients?.length
    || draft?.attachments?.length
    || draft?.replyTarget
    || draft?.doc?.content?.some?.((node) => node?.content?.length || node?.text),
  );
}

export function isDurablyRecoverableAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') return false;
  const resourceId = String(attachment.resource_id || '').trim();
  return Boolean(resourceId && !resourceId.startsWith('blob:'));
}

function withoutRendererHandles(value) {
  if (typeof value === 'string' && value.startsWith('blob:')) return undefined;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined;
  if (Array.isArray(value)) return value.map(withoutRendererHandles).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, withoutRendererHandles(item)])
    .filter(([, item]) => item !== undefined));
}

function durableDraft(draft) {
  if (!draft || typeof draft !== 'object') return draft;
  const cleaned = withoutRendererHandles(draft);
  if (!Array.isArray(draft.attachments)) return cleaned;
  return {
    ...cleaned,
    // Local-only File/object-URL attachments remain an in-memory draft fact.
    // They cannot survive reload and therefore cannot be represented in the
    // durable draft as though recovery were possible.
    attachments: draft.attachments
      .filter(isDurablyRecoverableAttachment)
      .map(withoutRendererHandles),
  };
}

function durableSubmissions(submissions) {
  return (submissions || []).map((submission) => {
    const attachments = submission?.frame?.payload?.attachments;
    if (!attachments) return submission;
    if (!Array.isArray(attachments) || attachments.some((row) => !isDurablyRecoverableAttachment(row))) {
      throw new TypeError('附件尚未成为可恢复的频道资源，无法保存到本机发送队列');
    }
    return {
      ...submission,
      frame: {
        ...submission.frame,
        payload: {
          ...submission.frame.payload,
          // A stable channel resource is durable; its object URL preview is
          // not. Persist and later transmit the protocol resource metadata,
          // never a handle owned by the old renderer document.
          attachments: attachments.map(withoutRendererHandles),
        },
      },
    };
  });
}

export function createOutboxStore({
  indexedDBImpl = globalThis.indexedDB,
  IDBKeyRangeImpl = globalThis.IDBKeyRange,
  databaseName = DATABASE_NAME,
  now = () => Date.now(),
} = {}) {
  let database = null;
  let opened = null;
  let openGeneration = 0;

  function open() {
    if (opened) return opened;
    if (!indexedDBImpl || !IDBKeyRangeImpl) return Promise.reject(new Error('本机持久发送队列不可用'));
    const generation = ++openGeneration;
    const candidate = new Dexie(databaseName, { indexedDB: indexedDBImpl, IDBKeyRange: IDBKeyRangeImpl });
    database = candidate;
    candidate.version(1).stores({
      submissions: '&[principalId+messageId], principalId, channelId, state, updatedAt',
      drafts: '&[principalId+channelId], principalId, updatedAt',
    });
    candidate.version(2).stores({
      submissions: '&[principalId+messageId], principalId, channelId, state, updatedAt, leaseUntil',
      drafts: '&[principalId+channelId], principalId, updatedAt',
    });
    const attempt = candidate.open().then(() => candidate).catch((error) => {
      // A failed Dexie.open() is an attempt, not the lifetime state of this
      // store. Clear only this generation so an explicit later user action can
      // retry without racing a newer successful open.
      if (openGeneration === generation && opened === attempt) {
        candidate.close();
        database = null;
        opened = null;
      }
      throw error;
    });
    opened = attempt;
    return opened;
  }

  return Object.freeze({
    async restore(principalId) {
      if (!principalId) return [];
      const db = await open();
      return db.submissions.where('principalId').equals(principalId).sortBy('createdAt');
    },
    async restoreDrafts(principalId) {
      if (!principalId) return [];
      const db = await open();
      return db.drafts.where('principalId').equals(principalId).toArray();
    },
    async putMany(principalId, submissions, { authorize } = {}) {
      if (!principalId) throw new TypeError('outbox write requires principal');
      const durable = durableSubmissions(submissions);
      const db = await open();
      await db.transaction('rw', db.submissions, () => {
        if (authorize && authorize() !== true) throw new Error('发送授权已变化，未保存到发送队列');
        return db.submissions.bulkPut(durable.map((submission) => ({ ...submission, principalId })));
      });
      return durable;
    },
    async patch(principalId, messageId, expectedStates, change, { authorize } = {}) {
      const db = await open();
      return db.transaction('rw', db.submissions, async () => {
        const key = [principalId, messageId];
        const current = await db.submissions.get(key);
        if (!current || (expectedStates?.length && !expectedStates.includes(current.state))) return null;
        // The read above yields. A queued request may lose its exact access or
        // transport owner while waiting behind another IndexedDB writer. Check
        // the phase lease inside this transaction immediately before the first
        // durable mutation; an outer before/after check can only compensate
        // after a stale `transmitting` record has already become crash-visible.
        if (authorize && authorize() !== true) throw new Error('发送授权已变化，未推进发送状态');
        const next = { ...current, ...change, principalId, messageId, updatedAt: now() };
        await db.submissions.put(next);
        return next;
      });
    },
    async remove(principalId, messageId, expectedStates = null) {
      if (!principalId || !messageId) return;
      const db = await open();
      return db.transaction('rw', db.submissions, async () => {
        const key = [principalId, messageId];
        const current = await db.submissions.get(key);
        if (!current || (expectedStates?.length && !expectedStates.includes(current.state))) return false;
        await db.submissions.delete(key);
        return true;
      });
    },
    async writeDraft(principalId, channelId, draft, expectedRevision) {
      if (!principalId || !channelId) throw new TypeError('draft write requires principal and channel');
      const durable = durableDraft(draft);
      const db = await open();
      return db.transaction('rw', db.drafts, async () => {
        const key = [principalId, channelId];
        const current = await db.drafts.get(key);
        const revision = Number(current?.revision || 0);
        if (Number.isFinite(expectedRevision) && Number(expectedRevision) !== revision) {
          return { conflict: true, current };
        }
        const next = {
          principalId,
          channelId,
          revision: revision + 1,
          editorRevision: Math.max(0, Number(draft?.editorRevision) || 0),
          draft: meaningfulDraft(durable) ? durable : null,
          updatedAt: now(),
        };
        await db.drafts.put(next);
        return { conflict: false, record: next };
      });
    },
    async mergeDraftAttachments({ principalId, channelId, attachments, expectedRevision = 0, authorize }) {
      if (!principalId || !channelId) throw new TypeError('draft attachment merge requires principal and channel');
      const durableAttachments = (attachments || [])
        .filter(isDurablyRecoverableAttachment)
        .map(withoutRendererHandles);
      if (durableAttachments.length !== (attachments || []).length) {
        throw new TypeError('附件尚未成为可恢复的频道资源');
      }
      const db = await open();
      return db.transaction('rw', db.drafts, async () => {
        if (authorize && authorize() !== true) throw new Error('草稿附件授权已变化');
        const key = [principalId, channelId];
        const current = await db.drafts.get(key);
        const revision = Number(current?.revision || 0);
        if (revision < Number(expectedRevision || 0)) return { conflict: true, current, reason: 'revision_rewound' };
        // A consumed row is the durable send boundary. An upload captured
        // before that boundary may not recreate the just-sent draft.
        if (current && current.draft == null && revision > Number(expectedRevision || 0)) {
          return { conflict: true, current, reason: 'draft_consumed' };
        }
        const base = current?.draft || {};
        const merged = [...(base.attachments || [])];
        for (const attachment of durableAttachments) {
          const index = merged.findIndex((row) => row.resource_id === attachment.resource_id);
          if (index >= 0) merged[index] = attachment;
          else merged.push(attachment);
        }
        if (authorize && authorize() !== true) throw new Error('草稿附件授权已变化');
        const draft = durableDraft({ ...base, attachments: merged });
        const next = {
          principalId,
          channelId,
          revision: revision + 1,
          editorRevision: Math.max(0, Number(current?.editorRevision || 0)) + 1,
          draft: meaningfulDraft(draft) ? draft : null,
          updatedAt: now(),
        };
        await db.drafts.put(next);
        return { conflict: false, record: next };
      });
    },
    async acceptDraft({ principalId, channelId, expectedRevision, editorRevision, submissions, authorize }) {
      if (!principalId || !channelId || !submissions?.length) throw new TypeError('acceptDraft requires draft identity and frames');
      const durable = durableSubmissions(submissions);
      const db = await open();
      return db.transaction('rw', db.drafts, db.submissions, async () => {
        if (authorize && authorize() !== true) throw new Error('发送授权已变化，未保存到发送队列');
        const key = [principalId, channelId];
        const current = await db.drafts.get(key);
        const revision = Number(current?.revision || 0);
        const expected = Number(expectedRevision || 0);
        if (revision < expected) return { accepted: false, conflict: current || null };
        // `get` yields. Revalidate inside the same transaction immediately
        // before its first durable submission write so revoke/retire cannot
        // slip between the entry check and bulkPut/consume.
        if (authorize && authorize() !== true) throw new Error('发送授权已变化，未保存到发送队列');
        await db.submissions.bulkPut(durable.map((submission) => ({ ...submission, principalId })));
        // The editor may advance while the acceptance transaction waits for
        // IndexedDB. The immutable frames still belong in the outbox, but a
        // newer draft version must remain untouched.
        if (revision > expected || Number(current?.editorRevision || 0) > Number(editorRevision || 0)) {
          return { accepted: true, consumed: false, record: current || null, submissions: durable };
        }
        const consumed = {
          principalId,
          channelId,
          revision: revision + 1,
          editorRevision: Math.max(0, Number(editorRevision) || 0),
          draft: null,
          consumedAt: now(),
          updatedAt: now(),
        };
        await db.drafts.put(consumed);
        return { accepted: true, consumed: true, record: consumed, submissions: durable };
      });
    },
    async acquireLease(principalId, messageId, owner, ttlMs = 15_000) {
      const db = await open();
      return db.transaction('rw', db.submissions, async () => {
        const key = [principalId, messageId];
        const current = await db.submissions.get(key);
        if (!current) return null;
        const timestamp = now();
        if (current.leaseOwner && current.leaseOwner !== owner && Number(current.leaseUntil || 0) > timestamp) return null;
        const next = { ...current, leaseOwner: owner, leaseUntil: timestamp + ttlMs, updatedAt: timestamp };
        await db.submissions.put(next);
        return next;
      });
    },
    async releaseLease(principalId, messageId, owner) {
      const db = await open();
      return db.transaction('rw', db.submissions, async () => {
        const key = [principalId, messageId];
        const current = await db.submissions.get(key);
        if (!current || current.leaseOwner !== owner) return false;
        await db.submissions.put({ ...current, leaseOwner: '', leaseUntil: 0, updatedAt: now() });
        return true;
      });
    },
    close() {
      openGeneration += 1;
      database?.close();
      database = null;
      opened = null;
    },
  });
}
