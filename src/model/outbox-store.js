import Dexie from 'dexie';

const DATABASE_NAME = 'atoll-outbox-v2';

function meaningfulDraft(draft) {
  return Boolean(
    draft?.recipients?.length
    || draft?.attachments?.length
    || draft?.replyTarget,
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

// The unsent body belongs to the editor, which is its only authority. A second
// copy here is what made a draft something two writers could race over, and
// every version number, tombstone and late-write check existed to referee that
// race. What stays is what actually has to survive being closed and reopened:
// uploaded resources, chosen recipients, and the reply target.
function durableDraft(draft) {
  if (!draft || typeof draft !== 'object') return draft;
  const { text, doc, ...body } = draft;
  const cleaned = withoutRendererHandles(body);
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
  let lifetimeGeneration = 0;
  let closed = false;
  let activeOperations = 0;
  let closingDatabase = null;

  function outboxClosedError() {
    const error = new Error('本机持久发送队列已关闭');
    error.code = 'outbox_closed';
    return error;
  }

  function assertLeaseCurrent(leaseGuard, detail) {
    if (!leaseGuard || leaseGuard() === true) return;
    const error = new Error(detail);
    error.code = 'send_lease_stale';
    throw error;
  }

  function assertStoreOpen() {
    if (closed) throw outboxClosedError();
  }

  async function withDatabase(operation) {
    const generation = lifetimeGeneration;
    const assertCurrent = () => {
      if (closed || lifetimeGeneration !== generation) throw outboxClosedError();
    };
    activeOperations += 1;
    try {
      assertCurrent();
      const db = await open();
      assertCurrent();
      const result = await operation(db, assertCurrent);
      assertCurrent();
      return result;
    } finally {
      activeOperations -= 1;
      if (closed && activeOperations === 0) {
        closingDatabase?.close();
        closingDatabase = null;
      }
    }
  }

  function open() {
    assertStoreOpen();
    if (opened) return opened;
    if (!indexedDBImpl || !IDBKeyRangeImpl) return Promise.reject(new Error('本机持久发送队列不可用'));
    const generation = ++openGeneration;
    const candidate = new Dexie(databaseName, { indexedDB: indexedDBImpl, IDBKeyRange: IDBKeyRangeImpl });
    database = candidate;
    candidate.version(1).stores({
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
      return withDatabase(async (db, assertCurrent) => {
        const rows = await db.submissions.where('principalId').equals(principalId).sortBy('createdAt');
        assertCurrent();
        return rows;
      });
    },
    async restoreDrafts(principalId) {
      if (!principalId) return [];
      return withDatabase(async (db, assertCurrent) => {
        const rows = await db.drafts.where('principalId').equals(principalId).toArray();
        assertCurrent();
        return rows;
      });
    },
    async putMany(principalId, submissions, { authorize } = {}) {
      if (!principalId) throw new TypeError('outbox write requires principal');
      const durable = durableSubmissions(submissions);
      return withDatabase(async (db, assertCurrent) => {
        await db.transaction('rw', db.submissions, () => {
          assertCurrent();
          if (authorize && authorize() !== true) throw new Error('发送授权已变化，未保存到发送队列');
          assertCurrent();
          return db.submissions.bulkPut(durable.map((submission) => ({ ...submission, principalId })));
        });
        return durable;
      });
    },
    async patch(principalId, messageId, expectedStates, change, { authorize, leaseOwner, leaseGuard } = {}) {
      return withDatabase((db, assertCurrent) => db.transaction('rw', db.submissions, async () => {
        assertCurrent();
        const key = [principalId, messageId];
        const current = await db.submissions.get(key);
        assertCurrent();
        if (!current || (expectedStates?.length && !expectedStates.includes(current.state))) return null;
        if (leaseOwner && current.leaseOwner !== leaseOwner) return null;
        // The read above yields. A queued request may lose its exact access or
        // transport owner while waiting behind another IndexedDB writer. Check
        // the phase lease inside this transaction immediately before the first
        // durable mutation; an outer before/after check can only compensate
        // after a stale `transmitting` record has already become crash-visible.
        assertLeaseCurrent(leaseGuard, '发送租约已失效，未推进发送状态');
        if (authorize && authorize() !== true) throw new Error('发送授权已变化，未推进发送状态');
        assertCurrent();
        const next = { ...current, ...change, principalId, messageId, updatedAt: now() };
        await db.submissions.put(next);
        assertLeaseCurrent(leaseGuard, '发送租约已失效，未推进发送状态');
        return next;
      }));
    },
    async remove(principalId, messageId, expectedStates = null) {
      if (!principalId || !messageId) return;
      return withDatabase((db, assertCurrent) => db.transaction('rw', db.submissions, async () => {
        assertCurrent();
        const key = [principalId, messageId];
        const current = await db.submissions.get(key);
        assertCurrent();
        if (!current || (expectedStates?.length && !expectedStates.includes(current.state))) return false;
        assertCurrent();
        await db.submissions.delete(key);
        return true;
      }));
    },
    async writeDraft(principalId, channelId, draft, expectedRevision) {
      if (!principalId || !channelId) throw new TypeError('draft write requires principal and channel');
      const durable = durableDraft(draft);
      return withDatabase((db, assertCurrent) => db.transaction('rw', db.drafts, async () => {
        assertCurrent();
        const key = [principalId, channelId];
        const current = await db.drafts.get(key);
        assertCurrent();
        const revision = Number(current?.revision || 0);
        const hasExpectedRevision = Number.isFinite(expectedRevision);
        const expected = Number(expectedRevision);
        // A write that stores nothing new is not a write. Sending asks for a
        // revision before consuming the draft; with the body gone that ask has
        // nothing to store and must not read as a late rewrite of a consumed
        // draft.
        const unchanged = current !== undefined
          && JSON.stringify(current.draft ?? null)
            === JSON.stringify(meaningfulDraft(durable) ? durable : null);
        if (unchanged) return { conflict: false, record: current };
        const consumed = current?.draft == null && hasExpectedRevision
          && (revision > expected
            || (revision === expected
              && Number(draft?.editorRevision || 0) <= Number(current?.editorRevision || 0)));
        if (hasExpectedRevision && expected !== revision) {
          return {
            conflict: true,
            current,
            ...(consumed ? { reason: 'draft_consumed' } : {}),
          };
        }
        if (consumed) return { conflict: true, current, reason: 'draft_consumed' };
        const next = {
          principalId,
          channelId,
          revision: revision + 1,
          editorRevision: Math.max(0, Number(draft?.editorRevision) || 0),
          draft: meaningfulDraft(durable) ? durable : null,
          updatedAt: now(),
        };
        assertCurrent();
        await db.drafts.put(next);
        return { conflict: false, record: next };
      }));
    },
    async mergeDraftAttachments({ principalId, channelId, attachments, expectedRevision = 0, authorize }) {
      if (!principalId || !channelId) throw new TypeError('draft attachment merge requires principal and channel');
      const durableAttachments = (attachments || [])
        .filter(isDurablyRecoverableAttachment)
        .map(withoutRendererHandles);
      if (durableAttachments.length !== (attachments || []).length) {
        throw new TypeError('附件尚未成为可恢复的频道资源');
      }
      return withDatabase((db, assertCurrent) => db.transaction('rw', db.drafts, async () => {
        assertCurrent();
        if (authorize && authorize() !== true) throw new Error('草稿附件授权已变化');
        const key = [principalId, channelId];
        const current = await db.drafts.get(key);
        assertCurrent();
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
        assertCurrent();
        await db.drafts.put(next);
        return { conflict: false, record: next };
      }));
    },
    async acceptDraft({ principalId, channelId, expectedRevision, editorRevision, submissions, authorize }) {
      if (!principalId || !channelId || !submissions?.length) throw new TypeError('acceptDraft requires draft identity and frames');
      const durable = durableSubmissions(submissions);
      return withDatabase((db, assertCurrent) => db.transaction('rw', db.drafts, db.submissions, async () => {
        assertCurrent();
        if (authorize && authorize() !== true) throw new Error('发送授权已变化，未保存到发送队列');
        const key = [principalId, channelId];
        const current = await db.drafts.get(key);
        assertCurrent();
        const revision = Number(current?.revision || 0);
        const expected = Number(expectedRevision || 0);
        if (revision < expected) return { accepted: false, conflict: current || null };
        // `get` yields. Revalidate inside the same transaction immediately
        // before its first durable submission write so revoke/retire cannot
        // slip between the entry check and bulkPut/consume.
        if (authorize && authorize() !== true) throw new Error('发送授权已变化，未保存到发送队列');
        assertCurrent();
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
        assertCurrent();
        await db.drafts.put(consumed);
        return { accepted: true, consumed: true, record: consumed, submissions: durable };
      }));
    },
    async acquireLease(principalId, messageId, owner, ttlMs = 15_000, { authorize, leaseGuard } = {}) {
      if (!owner) throw new TypeError('outbox lease requires owner');
      return withDatabase((db, assertCurrent) => db.transaction('rw', db.submissions, async () => {
        assertCurrent();
        const key = [principalId, messageId];
        const current = await db.submissions.get(key);
        assertCurrent();
        if (!current) return null;
        const timestamp = now();
        if (current.leaseOwner && current.leaseOwner !== owner && Number(current.leaseUntil || 0) > timestamp) return null;
        assertLeaseCurrent(leaseGuard, '发送租约已失效，未取得发送租约');
        if (authorize && authorize() !== true) throw new Error('发送授权已变化，未取得发送租约');
        const next = { ...current, leaseOwner: owner, leaseUntil: timestamp + ttlMs, updatedAt: timestamp };
        assertCurrent();
        await db.submissions.put(next);
        assertLeaseCurrent(leaseGuard, '发送租约已失效，未取得发送租约');
        return next;
      }));
    },
    async releaseLease(principalId, messageId, owner, { leaseGuard } = {}) {
      if (!owner) return false;
      return withDatabase((db, assertCurrent) => db.transaction('rw', db.submissions, async () => {
        assertCurrent();
        const key = [principalId, messageId];
        const current = await db.submissions.get(key);
        assertCurrent();
        if (!current || current.leaseOwner !== owner) return false;
        assertLeaseCurrent(leaseGuard, '发送租约已失效，未释放发送租约');
        assertCurrent();
        await db.submissions.put({ ...current, leaseOwner: '', leaseUntil: 0, updatedAt: now() });
        assertLeaseCurrent(leaseGuard, '发送租约已失效，未释放发送租约');
        return true;
      }));
    },
    close() {
      if (closed) return;
      closed = true;
      lifetimeGeneration += 1;
      openGeneration += 1;
      closingDatabase = database;
      database = null;
      opened = null;
      if (activeOperations === 0) {
        closingDatabase?.close();
        closingDatabase = null;
      }
    },
  });
}
