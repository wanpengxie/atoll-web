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

// The part of a draft that a reload can use: null when nothing in it survives.
export function durableDraftBody(draft) {
  const durable = durableDraft(draft);
  return meaningfulDraft(durable) ? durable : null;
}

export function durableSubmissions(submissions) {
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
    // Blind upserts of what memory already decided. The journal mirrors the
    // in-memory submission/draft rows so a reload can resume them; no flow
    // waits for these writes and none of them re-decides anything.
    async putSubmission(principalId, submission) {
      if (!principalId || !submission?.messageId) return false;
      const [durable] = durableSubmissions([submission]);
      return withDatabase(async (db) => {
        await db.submissions.put({ ...durable, principalId });
        return true;
      });
    },
    async putDraft(principalId, channelId, record) {
      if (!principalId || !channelId) return false;
      const draft = durableDraft(record?.draft);
      return withDatabase(async (db) => {
        await db.drafts.put({
          principalId,
          channelId,
          revision: Number(record?.revision || 0),
          editorRevision: Number(record?.editorRevision || 0),
          draft: meaningfulDraft(draft) ? draft : null,
          ...(record?.consumedAt ? { consumedAt: record.consumedAt } : {}),
          updatedAt: now(),
        });
        return true;
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
