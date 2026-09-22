import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createOutboxStore, durableDraftBody, durableSubmissions } from '../../model/outbox-store.js';
import {
  assessRequestOwner,
  captureRequestOwner,
  REQUEST_PHASE,
  requestAccessError,
} from '../../model/request-owner.js';
import { TYPES } from '../../protocol/vocab.js';
import { diagnostic } from '../../model/diagnostics.js';
import {
  assertControlAccess,
  createControlCommand,
  isAgentControlType,
} from '../../model/control-command.js';
import { newId } from '../../util/id.js';
import { createSubmissionCorrelationPort } from './submission-correlation-port.js';

const ACTIVE_STATES = new Set(['queued', 'transmitting', 'accepted', 'delayed', 'uncertain', 'rejected']);
// A request this session sent to an Agent is known to be awaiting an answer
// the moment it is handed over. That is a local fact, so Waiting does not have
// to wait for the ledger to grant the request an identity before showing it.
const AWAITING_TYPES = new Set([TYPES.agentAsk, TYPES.agentQueue]);
const RETRY_STATES = new Set(['uncertain', 'rejected']);
const ACTIVE_CONTROL_STATES = new Set(['sending', 'accepted', 'uncertain', 'error']);
const CONTROL_RECORD_PREFIX = 'control:';
const NOOP = () => {};
const ZERO_GENERATION = () => 0;

function submissionEntryID(principalId, messageId) {
  return `${principalId}\u0000${messageId}`;
}

function sendLeaseFor(owner, entryID, attemptID, correlationID) {
  return Object.freeze({
    entryID,
    attemptID,
    principal: Object.freeze({ id: owner.principalId, epoch: owner.principalEpoch }),
    world: owner.worldEpoch,
    accessEpoch: Number(owner.access?.epoch || 0),
    transportGeneration: Object.freeze({
      epoch: Number(owner.transportEpoch || 0),
      transport: owner.transport,
    }),
    correlationID,
  });
}

function sameSendLease(left, right) {
  return Boolean(left && right
    && left.entryID === right.entryID
    && left.attemptID === right.attemptID
    && left.principal?.id === right.principal?.id
    && Object.is(left.principal?.epoch, right.principal?.epoch)
    && Object.is(left.world, right.world)
    && left.accessEpoch === right.accessEpoch
    && left.transportGeneration?.epoch === right.transportGeneration?.epoch
    && Object.is(left.transportGeneration?.transport, right.transportGeneration?.transport)
    && left.correlationID === right.correlationID);
}

function emptyDraft() {
  return { text: '', doc: null, recipients: [], attachments: [], replyTarget: null, editorRevision: 0 };
}

function restoredSubmission(row) {
  if (!row?.messageId || !row?.channelId || !row?.frame || !ACTIVE_STATES.has(row.state)) return null;
  // Rows journaled by the old lease protocol still carry its fields.
  const { leaseOwner: _leaseOwner, leaseUntil: _leaseUntil, ...submission } = row;
  return {
    ...submission,
    state: row.state === 'transmitting' ? 'uncertain' : row.state,
    error: serializedSubmissionError(row.error, row),
  };
}

function wireFailureState(error) {
  if (error?.code === 'timeout' || error?.code === 'closed') return 'uncertain';
  if (error?.code === 'unavailable' || error?.code === 'channel_unavailable') return 'queued';
  return 'rejected';
}

function controlFailureState(error) {
  return error?.code === 'timeout' || error?.code === 'closed' ? 'uncertain' : 'error';
}

function serializedError(error) {
  return error ? {
    code: error.code || 'unknown',
    detail: error.detail || error.message || String(error),
    message: error.message || error.detail || String(error),
  } : null;
}

function serializedControlError(error) {
  if (!error) return null;
  return {
    code: error.code || 'unknown',
    detail: error.detail || error.message || String(error),
  };
}

function isControlSubmission(submission) {
  return submission?.controlSubmission === true;
}

function serializedSubmissionError(error, submission) {
  return isControlSubmission(submission) ? serializedControlError(error) : serializedError(error);
}

function controlRecordId(controlKey) {
  return `${CONTROL_RECORD_PREFIX}${controlKey}`;
}

function controlRecord(principalId, controlKey, value) {
  const updatedAt = Number(value?.updatedAt || Date.now());
  return {
    key: controlRecordId(controlKey),
    messageId: controlRecordId(controlKey),
    kind: 'control',
    controlKey,
    principalId,
    channelId: value.channelId,
    requestId: value.requestId,
    action: value.action || 'cancel',
    state: value.state,
    error: serializedControlError(value.error),
    createdAt: updatedAt,
    updatedAt,
  };
}

function restoredControlState(row, principalId) {
  if (!row || row.kind !== 'control' || !row.controlKey
    || row.principalId !== principalId
    || !row.channelId || !row.requestId || !ACTIVE_CONTROL_STATES.has(row.state)) return null;
  return {
    channelId: row.channelId,
    requestId: row.requestId,
    action: row.action || 'cancel',
    state: row.state === 'sending' ? 'uncertain' : row.state,
    error: serializedControlError(row.error),
  };
}

function feedIDs(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.map((row) => typeof row === 'string' ? row : row?.id).filter(Boolean));
  return new Set();
}

function isLiveLifecycle(lifecycle, generation) {
  return lifecycle.active && lifecycle.generation === generation;
}

export function useComposerSubmissionRuntime({
  activeChannelId = '',
  principalId = '',
  wireState = 'closed',
  wireRef,
  accessRef,
  producerOwnerToken = 0,
  generationFor = ZERO_GENERATION,
  serverWorld = '',
  onError = NOOP,
  onNotice = NOOP,
  onFeedChanged = NOOP,
  onAccessChanged = NOOP,
  outboxFactory = createOutboxStore,
} = {}) {
  const outboxRef = useRef(null);
  if (!outboxRef.current) outboxRef.current = outboxFactory();
  // IndexedDB is a journal behind memory, never a gate in front of the wire.
  // Writes are chained only so a later snapshot of the same row cannot land
  // before an earlier one; nothing awaits the chain.
  const journalTailRef = useRef(Promise.resolve());
  const attemptSequenceRef = useRef(`composer:${newId()}`);
  const attemptEpochRef = useRef(0);
  const hydrationRef = useRef(0);
  const transmittingRef = useRef(new Set());
  const automaticReconnectRetryRef = useRef(new Set());
  const lifecycleRef = useRef({ generation: 0, active: true });
  const lifecycleEffectTokenRef = useRef(0);
  const retryPrincipalRef = useRef(principalId);
  const acceptingRef = useRef(new Map());
  const landedRef = useRef(new Set());
  // The channel notice is a projection of one concrete submission attempt.
  // Keep its durable identity and correlation so a late settlement cannot
  // clear a newer notice for the same message id.
  const submissionNoticeRef = useRef(null);
  const submissionCorrelationPortRef = useRef(null);
  // SendLease is the sole in-memory CAS owner for a submission attempt. Its
  // authority and correlation facts never enter the durable outbox row.
  const sendLeaseRef = useRef(new Map());
  const leaseAttemptSequenceRef = useRef(0);
  const correlationSequenceRef = useRef(0);
  const ownedControlRequestsRef = useRef(new WeakSet());
  if (!submissionCorrelationPortRef.current) {
    submissionCorrelationPortRef.current = createSubmissionCorrelationPort();
  }
  const correlationPrincipalRef = useRef(principalId);
  const authorityRef = useRef(null);
  const pendingRef = useRef([]);
  const draftsRef = useRef(new Map());
  const controlStatesRef = useRef({});
  const [pending, setPending] = useState([]);
  const [drafts, setDrafts] = useState(() => new Map());
  const [approvalStates, setApprovalStates] = useState({});
  const [controlStates, setControlStates] = useState({});
  const [acceptingChannels, setAcceptingChannels] = useState(() => new Set());

  useLayoutEffect(() => {
    const authority = Object.freeze({
      principalId,
      producerOwnerToken: producerOwnerToken || principalId,
      serverWorld,
      wireState,
      generationFor,
    });
    authorityRef.current = authority;
    return () => {
      if (authorityRef.current === authority) authorityRef.current = null;
    };
  }, [generationFor, principalId, producerOwnerToken, serverWorld, wireState]);

  // Only this session's own hand-offs enter here. History and cache replay
  // never add to it: a replayed request carries no evidence about whether it
  // is still outstanding, and treating it as awaiting would resurrect turns
  // that finished long ago.
  const awaitingRef = useRef([]);
  const [awaiting, setAwaiting] = useState([]);
  const publishAwaiting = useCallback((next) => {
    const value = typeof next === 'function' ? next(awaitingRef.current) : next;
    awaitingRef.current = value;
    setAwaiting(value);
    return value;
  }, []);
  const forgetAwaiting = useCallback((ids) => {
    const gone = ids instanceof Set ? ids : new Set([ids].flat().filter(Boolean));
    if (!gone.size) return;
    publishAwaiting((rows) => (rows.some((row) => gone.has(row.messageId))
      ? rows.filter((row) => !gone.has(row.messageId))
      : rows));
  }, [publishAwaiting]);

  const publishPending = useCallback((next) => {
    const value = typeof next === 'function' ? next(pendingRef.current) : next;
    pendingRef.current = value;
    setPending(value);
    return value;
  }, []);

  const publishDrafts = useCallback((next) => {
    const value = typeof next === 'function' ? next(draftsRef.current) : next;
    draftsRef.current = value;
    setDrafts(value);
    return value;
  }, []);

  const publishControlStates = useCallback((next) => {
    const value = typeof next === 'function' ? next(controlStatesRef.current) : next;
    controlStatesRef.current = value;
    setControlStates(value);
    return value;
  }, []);

  const journal = useCallback((write) => {
    const run = journalTailRef.current.then(write).catch((error) => {
      if (error?.code === 'outbox_closed') return;
      diagnostic('warn', 'outbox.journal_failed', { error });
    });
    journalTailRef.current = run;
  }, []);
  const journalSubmission = useCallback((principal, row) => {
    if (!principal || !row?.messageId) return;
    journal(() => outboxRef.current.putSubmission(principal, row));
  }, [journal]);
  const journalRemove = useCallback((principal, messageId) => {
    if (!principal || !messageId) return;
    journal(() => outboxRef.current.remove(principal, messageId));
  }, [journal]);
  const journalDraft = useCallback((principal, channelId, record) => {
    if (!principal || !channelId) return;
    journal(() => outboxRef.current.putDraft(principal, channelId, record));
  }, [journal]);

  const persistControlState = useCallback((controlKey, value) => {
    if (!principalId || !value || !ACTIVE_CONTROL_STATES.has(value.state)) return;
    journalSubmission(principalId, controlRecord(principalId, controlKey, value));
  }, [journalSubmission, principalId]);

  const removePersistedControl = useCallback((controlKey) => {
    if (!principalId || !controlKey) return;
    journalRemove(principalId, controlRecordId(controlKey));
  }, [journalRemove, principalId]);

  const accessState = useCallback((channelId) => accessRef?.current?.state?.(channelId) || null, [accessRef]);

  const currentFacts = useCallback((owner) => {
    const authority = authorityRef.current;
    const observedAccess = accessState(owner.channelId);
    return {
      principalId: authority?.principalId || '',
      principalEpoch: authority?.producerOwnerToken || '',
      channelId: owner.channelId,
      worldEpoch: authority?.serverWorld || '',
      attemptEpoch: attemptEpochRef.current,
      access: {
        epoch: Number(observedAccess?.authorityEpoch || 0),
        relationship: String(observedAccess?.relationship || ''),
        existence: String(observedAccess?.existence || ''),
        runtime: String(observedAccess?.runtime || ''),
        freshness: String(observedAccess?.freshness || ''),
        unavailable: observedAccess?.unavailable === true,
      },
      transport: wireRef?.current || null,
      transportEpoch: Number(authority?.generationFor?.(owner.channelId) || 0),
      transportOpen: authority?.wireState === 'open' && Boolean(wireRef?.current),
      draft: { editorRevision: Number(draftsRef.current.get(owner.channelId)?.editorRevision || 0) },
    };
  }, [accessState, wireRef]);

  const captureOwner = useCallback((channelId, draft = null) => {
    const authority = authorityRef.current;
    if (!authority?.principalId || !channelId) throw new TypeError('发送 owner 尚未建立');
    return captureRequestOwner({
      principalId: authority.principalId,
      principalEpoch: authority.producerOwnerToken,
      channelId,
      worldEpoch: authority.serverWorld,
      attemptEpoch: attemptEpochRef.current,
      accessState: accessState(channelId),
      transport: wireRef?.current || null,
      transportEpoch: Number(authority.generationFor?.(channelId) || 0),
      draft,
    });
  }, [accessState, wireRef]);

  const authorize = useCallback((owner, phase, options = {}) => {
    const assessment = assessRequestOwner(owner, currentFacts(owner), phase, options);
    if (!assessment.current) throw requestAccessError(assessment);
    return true;
  }, [currentFacts]);

  // A member can remain the same request owner while the physical channel
  // runtime is temporarily unavailable.  The transport/access projection may
  // advance its observation epoch for that transient, but this lease must
  // still return to queued; only a definitive membership/world transition is
  // allowed to reject it.
  const assessSubmissionOwner = useCallback((owner, facts = currentFacts(owner)) => {
    const assessment = assessRequestOwner(owner, facts, REQUEST_PHASE.submit);
    if (assessment.code === 'access_changed'
      && facts.access?.relationship === 'member'
      && facts.access?.existence !== 'retired'
      && (facts.access?.unavailable === true || facts.access?.runtime === 'closed')) {
      return Object.freeze({ current: false, code: 'channel_unavailable', detail: '频道暂不可用' });
    }
    return assessment;
  }, [currentFacts]);

  const registerCorrelation = useCallback((owner, messageId, replace = false) => {
    const entryID = submissionEntryID(owner.principalId, messageId);
    const current = sendLeaseRef.current.get(entryID);
    if (!replace && current?.correlationID) return current.correlationID;
    const correlationID = `${entryID}:${++correlationSequenceRef.current}`;
    sendLeaseRef.current.set(entryID, sendLeaseFor(
      owner,
      entryID,
      `correlation:${correlationID}`,
      correlationID,
    ));
    return correlationID;
  }, []);

  const beginSendLease = useCallback((owner, messageId) => {
    const entryID = submissionEntryID(owner.principalId, messageId);
    const current = sendLeaseRef.current.get(entryID);
    const correlationID = current?.correlationID || registerCorrelation(owner, messageId);
    const lease = sendLeaseFor(
      owner,
      entryID,
      `${attemptSequenceRef.current}:${++leaseAttemptSequenceRef.current}`,
      correlationID,
    );
    sendLeaseRef.current.set(entryID, lease);
    return lease;
  }, [registerCorrelation]);

  const currentSendLease = useCallback((lease) => sameSendLease(
    sendLeaseRef.current.get(lease?.entryID),
    lease,
  ), []);

  const forgetLeaseCorrelation = useCallback((lease, identity) => {
    if (!currentSendLease(lease)) return false;
    const forgotten = submissionCorrelationPortRef.current.forget(identity);
    if (currentSendLease(lease)) sendLeaseRef.current.delete(lease.entryID);
    return forgotten;
  }, [currentSendLease]);

  const publishUncertainNotice = useCallback((lease, submission) => {
    if (!currentSendLease(lease)) return false;
    const notice = Object.freeze({
      channelId: submission.channelId,
      messageId: submission.messageId,
      correlationID: lease.correlationID,
    });
    submissionNoticeRef.current = notice;
    onNotice('发送结果待确认，正在通过重连账本核对。');
    return true;
  }, [currentSendLease, onNotice]);

  const clearSubmissionNotice = useCallback((lease, submission) => {
    if (!currentSendLease(lease)) return false;
    const notice = submissionNoticeRef.current;
    if (!notice
      || notice.channelId !== submission.channelId
      || notice.messageId !== submission.messageId
      || notice.correlationID !== lease.correlationID) return false;
    submissionNoticeRef.current = null;
    onNotice('');
    return true;
  }, [currentSendLease, onNotice]);

  // Memory is the owner of every submission and draft. The journal is read
  // once per principal to resume what a previous page left unsent, and what it
  // returns is merged under whatever this page already holds: a send made
  // while the read was in flight is never replaced by an older snapshot.
  useEffect(() => {
    const generation = ++hydrationRef.current;
    const lifecycleGeneration = lifecycleRef.current.generation;
    if (correlationPrincipalRef.current !== principalId) {
      // A different principal is a different owner, not a newer view of the
      // same facts: its predecessor's rows are not this principal's to show.
      correlationPrincipalRef.current = principalId;
      attemptEpochRef.current += 1;
      transmittingRef.current.clear();
      acceptingRef.current.clear();
      landedRef.current.clear();
      sendLeaseRef.current.clear();
      submissionCorrelationPortRef.current.reset();
      setAcceptingChannels(new Set());
      setApprovalStates({});
      publishControlStates({});
      publishPending([]);
      publishAwaiting([]);
      publishDrafts(new Map());
    }
    if (retryPrincipalRef.current !== principalId) {
      automaticReconnectRetryRef.current.clear();
      retryPrincipalRef.current = principalId;
    }
    if (!principalId) return undefined;
    let alive = true;
    const current = () => alive && isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)
      && generation === hydrationRef.current && authorityRef.current?.principalId === principalId;
    void Promise.all([
      outboxRef.current.restore(principalId),
      outboxRef.current.restoreDrafts(principalId),
    ]).then(([submissionRows, draftRows]) => {
      if (!current()) return;
      const allRestored = submissionRows.map(restoredSubmission).filter(Boolean);
      // A frame that states its own deadline stops being worth sending once
      // that instant passes. Restoring one keeps a row the transport will
      // always refuse, so drop it here rather than waiting for a retry pass
      // that only visits some states.
      const expiredRows = allRestored.filter((row) => {
        const expiresAt = Number(row.frame?.expires_at_ms || 0);
        return expiresAt > 0 && expiresAt <= Date.now();
      });
      for (const row of expiredRows) journalRemove(principalId, row.messageId);
      const held = new Set(pendingRef.current.map((row) => row.messageId));
      const restoredRows = allRestored.filter((row) => !expiredRows.includes(row) && !held.has(row.messageId));
      const restoredControls = Object.fromEntries(submissionRows
        .map((row) => restoredControlState(row, principalId))
        .filter(Boolean)
        .map((state) => [`${state.channelId}:${state.requestId}:${state.action}`, state]));
      for (const row of restoredRows) {
        const identity = { channelId: row.channelId, messageId: row.messageId };
        registerCorrelation(captureOwner(row.channelId), row.messageId);
        if (landedRef.current.has(row.messageId)) {
          submissionCorrelationPortRef.current.markLanded(identity);
          journalRemove(principalId, row.messageId);
        } else if (row.state !== 'rejected') {
          submissionCorrelationPortRef.current.record(identity);
        }
      }
      const restored = restoredRows.filter((row) => !landedRef.current.has(row.messageId));
      if (restored.length) publishPending((rows) => [...rows, ...restored]);
      if (draftRows.length) {
        publishDrafts((rows) => {
          const next = new Map(rows);
          for (const row of draftRows) if (row?.channelId && !next.has(row.channelId)) next.set(row.channelId, row);
          return next;
        });
      }
      if (Object.keys(restoredControls).length) {
        publishControlStates((rows) => ({ ...restoredControls, ...rows }));
      }
      if (authorityRef.current?.wireState === 'open' && wireRef?.current) {
        for (const row of restored) {
          if (row.state === 'queued' || row.state === 'uncertain') void transmitRef.current?.(row);
        }
      }
    }).catch((error) => {
      // An unreadable journal only means there is nothing to resume.
      if (current() && error?.code !== 'outbox_closed') diagnostic('warn', 'outbox.restore_failed', { error });
    });
    return () => { alive = false; };
  }, [captureOwner, journalRemove, principalId, publishAwaiting, publishControlStates, publishDrafts, publishPending, registerCorrelation, wireRef]);

  useEffect(() => {
    // React.StrictMode probes effects with a setup -> cleanup -> setup cycle
    // while retaining the mounted hook state.  The logical fence is
    // synchronous: an in-flight receipt must fail closed as soon as this
    // owner is really gone.  Only the physical IndexedDB close is deferred so
    // the probe's second setup can cancel it.
    const effectToken = ++lifecycleEffectTokenRef.current;
    lifecycleRef.current.active = true;
    return () => {
      lifecycleRef.current.active = false;
      lifecycleRef.current.generation += 1;
      hydrationRef.current += 1;
      attemptEpochRef.current += 1;
      sendLeaseRef.current.clear();
      automaticReconnectRetryRef.current.clear();
      // Close only after the journal has taken every copy already handed to
      // it; the page's last state is what a reload resumes.
      void journalTailRef.current.then(() => {
        if (lifecycleEffectTokenRef.current !== effectToken) return;
        outboxRef.current?.close();
      });
    };
  }, []);

  const draftFor = useCallback((channelId) => {
    const record = draftsRef.current.get(channelId);
    return record?.draft
      ? { ...record.draft, editorRevision: Number(record.editorRevision || record.draft.editorRevision || 0), revision: Number(record.revision || 0) }
      : emptyDraft();
  }, []);

  // A draft write is a memory write. The unsent body stays with the editor;
  // the record keeps what a reload could use, and the journal copies it.
  const writeDraftRecord = useCallback((owner, channelId, draft, editorRevision, extra = {}) => {
    const previous = draftsRef.current.get(channelId);
    const record = {
      principalId: owner.principalId,
      channelId,
      revision: Number(previous?.revision || 0) + 1,
      editorRevision,
      draft: draft ? durableDraftBody(draft) : null,
      updatedAt: Date.now(),
      ...extra,
    };
    publishDrafts((rows) => new Map(rows).set(channelId, record));
    journalDraft(owner.principalId, channelId, record);
    return record;
  }, [journalDraft, publishDrafts]);

  const updateDraft = useCallback((channelId, nextDraft, { preserveEditorRevision = false } = {}) => {
    const owner = captureOwner(channelId);
    authorize(owner, REQUEST_PHASE.persist, { requireTransport: false });
    const previous = draftsRef.current.get(channelId);
    const requestedRevision = Number(nextDraft?.editorRevision);
    const previousEditorRevision = Number(previous?.editorRevision || 0);
    const editorRevision = preserveEditorRevision && Number.isFinite(requestedRevision)
      ? Math.max(previousEditorRevision, requestedRevision)
      : Number.isFinite(requestedRevision)
        ? Math.max(previousEditorRevision + 1, requestedRevision)
        : previousEditorRevision + 1;
    if (previous?.consumedAt && previous.draft == null && editorRevision <= previousEditorRevision) {
      // A snapshot taken before the send that consumed this draft. With
      // nothing durable in it the write is a no-op; with recipients,
      // attachments or a reply target it would resurrect what was just sent.
      if (!durableDraftBody(nextDraft)) return Promise.resolve(previous);
      const error = new Error('草稿已被发送，请重新编辑后再保存');
      error.code = 'draft_consumed';
      return Promise.reject(error);
    }
    return Promise.resolve(writeDraftRecord(owner, channelId, { ...nextDraft, editorRevision }, editorRevision));
  }, [authorize, captureOwner, writeDraftRecord]);

  const persistDraftAttachments = useCallback((channelId, attachments, { expectedRevision = 0, authorize: authorizeAttachment } = {}) => {
    try {
      const current = draftsRef.current.get(channelId);
      const owner = captureOwner(channelId, { editorRevision: Number(current?.editorRevision || 0) });
      authorize(owner, REQUEST_PHASE.persist, { requireTransport: false, requireDraft: true });
      if (authorizeAttachment && authorizeAttachment() !== true) throw new Error('草稿附件授权已变化');
      // An upload captured before a send may not recreate the draft that send
      // consumed.
      if (current?.consumedAt && current.draft == null && Number(current.revision || 0) > Number(expectedRevision || 0)) {
        const error = new Error('草稿已被发送，附件未关联');
        error.code = 'attachment_unassociated';
        error.attachments = attachments;
        throw error;
      }
      const base = current?.draft || {};
      const merged = [...(base.attachments || [])];
      for (const attachment of attachments || []) {
        const index = merged.findIndex((row) => row.resource_id === attachment.resource_id);
        if (index >= 0) merged[index] = attachment;
        else merged.push(attachment);
      }
      return Promise.resolve(writeDraftRecord(owner, channelId, { ...base, attachments: merged },
        Number(current?.editorRevision || 0) + 1));
    } catch (error) {
      return Promise.reject(error);
    }
  }, [authorize, captureOwner, writeDraftRecord]);

  // Sending consumes the draft it was made from. A draft written after the
  // send captured its revision is newer than the send and stays.
  const consumeDraft = useCallback((owner, channelId, draftRevision, editorRevision) => {
    const current = draftsRef.current.get(channelId);
    if (current && Number(current.revision || 0) !== Number(draftRevision || 0)) return current;
    return writeDraftRecord(owner, channelId, null, Math.max(0, Number(editorRevision) || 0), { consumedAt: Date.now() });
  }, [writeDraftRecord]);

  const transmitRef = useRef(null);
  const transmit = useCallback(async (submission) => {
    const key = submission.key || submission.messageId;
    if (!key || transmittingRef.current.has(key)) return false;
    // A frame carrying an absolute deadline (an Agent capability probe) states
    // when it stops being worth asking. The outbox is built to keep retrying
    // under the original id, so once that instant passes the two contracts
    // fight: every retry is refused for `expires_at <= ts` and re-queued, and
    // the row can never leave. The deadline wins — it is the whole reason the
    // caller set one.
    const expiresAt = Number(submission.frame?.expires_at_ms || 0);
    if (expiresAt > 0 && expiresAt <= Date.now()) {
      publishPending((rows) => rows.filter((row) => row.messageId !== submission.messageId));
      journalRemove(authorityRef.current?.principalId || principalId, submission.messageId);
      return false;
    }
    const lifecycleGeneration = lifecycleRef.current.generation;
    const isLive = () => isLiveLifecycle(lifecycleRef.current, lifecycleGeneration);
    if (!isLive()) return false;
    const owner = captureOwner(submission.channelId);
    const lease = beginSendLease(owner, submission.messageId);
    const isLeaseCurrent = () => isLive() && currentSendLease(lease);
    transmittingRef.current.add(key);
    let wireStarted = false;
    // Every state change is decided in memory, published, then copied to the
    // journal. The copy never gates the next step.
    const commit = (expectedStates, change) => {
      const current = pendingRef.current.find((row) => row.messageId === submission.messageId);
      if (!current || (expectedStates && !expectedStates.includes(current.state))) return null;
      const next = { ...current, ...change, updatedAt: Date.now() };
      publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? next : row));
      journalSubmission(owner.principalId, next);
      return next;
    };
    const settleBeforeWire = (assessment, expectedStates) => {
      if (!isLeaseCurrent()) return false;
      const retryable = assessment.code === 'channel_unavailable' || assessment.code === 'transport_changed';
      const changed = commit(expectedStates, {
        state: retryable ? 'queued' : 'rejected',
        error: serializedSubmissionError(requestAccessError(assessment), submission),
      });
      if (!changed) return false;
      if (!retryable) {
        forgetLeaseCorrelation(lease, {
          channelId: submission.channelId,
          messageId: submission.messageId,
        });
      }
      onAccessChanged();
      return false;
    };
    try {
      const transportAssessment = assessSubmissionOwner(owner, currentFacts(owner));
      if (!transportAssessment.current) {
        // A queued row that wakes on a replacement connection must settle
        // against the authority observed by this lease.  Returning early
        // leaves a revoked row queued, where a later grant can replay it.
        // Restored uncertain rows retain their evidence until a current owner
        // reconciles them; revoke cannot turn that evidence into rejection.
        if (submission.state === 'uncertain' && transportAssessment.code !== 'channel_unavailable') return false;
        return settleBeforeWire(transportAssessment, ['queued', 'uncertain']);
      }
      const held = pendingRef.current.find((row) => row.messageId === submission.messageId) || submission;
      // The wire may add connection-local provenance (the current session id).
      // It is stamped once and kept on the row, so a retry after a dropped
      // receipt submits the exact same business frame under the same id —
      // the ledger answers that retry with the row it already holds.
      const frame = typeof owner.transport?.prepareSubmit === 'function'
        ? owner.transport.prepareSubmit(held.frame)
        : held.frame;
      if (!isLeaseCurrent()) return false;
      const transmitting = commit(['queued', 'uncertain', 'rejected', 'transmitting'], {
        state: 'transmitting',
        error: null,
        frame,
      });
      if (!transmitting) return false;
      wireStarted = true;
      const receipt = await owner.transport.submit(frame);
      if (!isLeaseCurrent()) return false;
      authorize(owner, REQUEST_PHASE.settle, { requireTransport: false, requireAccess: false });
      if (receipt?.message_id && receipt.message_id !== submission.messageId) {
        const error = new Error('服务端返回了不同的消息编号');
        error.code = 'message_id_mismatch';
        throw error;
      }
      if (landedRef.current.has(submission.messageId)) {
        clearSubmissionNotice(lease, submission);
        submissionCorrelationPortRef.current.markLanded({
          channelId: submission.channelId,
          messageId: submission.messageId,
        });
        publishPending((rows) => rows.filter((row) => row.messageId !== submission.messageId));
        journalRemove(owner.principalId, submission.messageId);
      } else if (commit(['transmitting'], { state: 'accepted', error: null })) {
        clearSubmissionNotice(lease, submission);
      }
      onFeedChanged(submission.channelId);
      return true;
    } catch (error) {
      if (!isLive() || !currentSendLease(lease)) return false;
      if (!wireStarted) {
        const prewire = assessSubmissionOwner(owner, currentFacts(owner));
        if (!prewire.current) {
          if (submission.state === 'uncertain' && prewire.code !== 'channel_unavailable') return false;
          return settleBeforeWire(prewire, ['queued', 'uncertain', 'transmitting']);
        }
      }
      const settlement = assessRequestOwner(owner, currentFacts(owner), REQUEST_PHASE.settle, {
        requireAccess: false,
        requireTransport: false,
      });
      if (!settlement.current) return false;
      const state = wireFailureState(error);
      const failed = commit(['queued', 'transmitting', 'uncertain', 'rejected'], {
        state,
        error: serializedSubmissionError(error, submission),
      });
      if (failed) forgetAwaiting(submission.messageId);
      if (state === 'uncertain' && failed) publishUncertainNotice(lease, submission);
      if (state === 'rejected') {
        // A prior transport close may have published an uncertain notice for
        // this same intent.  Once the backend gives its definitive rejection,
        // that transient projection is no longer truthful; the Composer's
        // rejected row is the single public failure surface.
        clearSubmissionNotice(lease, submission);
        forgetLeaseCorrelation(lease, {
          channelId: submission.channelId,
          messageId: submission.messageId,
        });
      }
      onAccessChanged();
      return false;
    } finally {
      transmittingRef.current.delete(key);
    }
  }, [assessSubmissionOwner, authorize, beginSendLease, captureOwner, clearSubmissionNotice, currentFacts, currentSendLease, forgetAwaiting, forgetLeaseCorrelation, journalRemove, journalSubmission, onAccessChanged, onFeedChanged, principalId, publishPending, publishUncertainNotice]);
  transmitRef.current = transmit;

  const sendOnce = useCallback(async (request = {}) => {
    const requests = request.batch?.length ? request.batch : [request];
    const agentControls = requests.filter((row) => isAgentControlType(row?.msgType || row?.type));
    if (agentControls.some((row) => !ownedControlRequestsRef.current.has(row))) {
      const error = new TypeError('Agent 控制命令必须经过 control owner');
      error.code = 'control_owner_required';
      throw error;
    }
    const channelId = request.channelId || requests[0]?.channelId || activeChannelId;
    if (!channelId) throw new TypeError('请先选择频道');
    const channels = new Set(requests.map((row) => row.channelId || channelId));
    const owners = [...channels].map((id) => captureOwner(id));
    for (const owner of owners) {
      authorize(owner, REQUEST_PHASE.persist, { requireTransport: false });
      for (const command of agentControls.filter((row) => (row.channelId || channelId) === owner.channelId)) {
        assertControlAccess(command, currentFacts(owner));
      }
    }
    const timestamp = Date.now();
    let submissions = requests.map((row) => {
      const id = row.messageId || newId();
      const resolvedChannel = row.channelId || channelId;
      return {
        key: id,
        messageId: id,
        channelId: resolvedChannel,
        ...(ownedControlRequestsRef.current.has(row) ? { controlSubmission: true } : {}),
        text: row.text || '',
        targetLabel: row.targetLabel || '',
        frame: {
          channel_id: resolvedChannel,
          id,
          msg_type: row.msgType,
          kind: 'request',
          payload: row.payload || { text: row.text || '' },
          audience: row.audience,
          visibility: 'public',
          ...(row.parentId ? { parent_id: row.parentId } : {}),
          ...(row.expiresAtMs ? { expires_at_ms: row.expiresAtMs } : {}),
        },
        state: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
        error: null,
      };
    });
    // The frame is final here: a resource the wire cannot resolve is refused
    // now, not after a journal write.
    submissions = durableSubmissions(submissions);
    if (request.draftRevision != null) {
      consumeDraft(owners[0], channelId, request.draftRevision, request.editorRevision);
    }
    const ids = new Set(submissions.map((row) => row.messageId));
    ids.forEach((id) => automaticReconnectRetryRef.current.delete(id));
    for (const row of submissions) {
      const owner = owners.find((candidate) => candidate.channelId === row.channelId) || owners[0];
      registerCorrelation(owner, row.messageId, true);
      const identity = { channelId: row.channelId, messageId: row.messageId };
      if (landedRef.current.has(row.messageId)) {
        submissionCorrelationPortRef.current.markLanded(identity);
      } else if (row.state !== 'rejected') {
        submissionCorrelationPortRef.current.record(identity);
      }
    }
    const outstanding = submissions.filter((row) => !landedRef.current.has(row.messageId));
    publishPending((rows) => [...rows.filter((row) => !ids.has(row.messageId)), ...outstanding]);
    const handedToAgent = submissions.filter((row) => row.state !== 'rejected'
      && AWAITING_TYPES.has(row.frame?.msg_type));
    if (handedToAgent.length) {
      publishAwaiting((rows) => [
        ...rows.filter((row) => !ids.has(row.messageId)),
        ...handedToAgent.map((row) => ({
          messageId: row.messageId,
          channelId: row.channelId,
          frame: row.frame,
          state: row.state,
          createdAt: row.createdAt,
        })),
      ]);
    }
    for (const row of outstanding) journalSubmission(owners[0].principalId, row);
    if (authorityRef.current?.wireState === 'open' && wireRef?.current) {
      for (const row of outstanding) void transmitRef.current(row);
    }
    const values = submissions.map((row) => row.messageId);
    return request.batch?.length ? values : values[0];
  }, [activeChannelId, authorize, captureOwner, consumeDraft, currentFacts, journalSubmission, publishAwaiting, publishPending, registerCorrelation, wireRef]);

  const send = useCallback((request = {}) => {
    if (request.draftRevision == null) return sendOnce(request);
    const channelId = request.channelId || request.batch?.[0]?.channelId || activeChannelId;
    const key = `${channelId}:${Number(request.draftRevision || 0)}:${Number(request.editorRevision || 0)}`;
    const existing = acceptingRef.current.get(key);
    if (existing) return existing;
    setAcceptingChannels((current) => new Set(current).add(channelId));
    const operation = sendOnce(request).finally(() => {
      if (acceptingRef.current.get(key) === operation) acceptingRef.current.delete(key);
      if (![...acceptingRef.current.keys()].some((row) => row.startsWith(`${channelId}:`))) {
        setAcceptingChannels((current) => {
          const next = new Set(current);
          next.delete(channelId);
          return next;
        });
      }
    });
    acceptingRef.current.set(key, operation);
    return operation;
  }, [activeChannelId, sendOnce]);

  // All control callers converge here.  The canonical request is retained in
  // a private WeakSet so a copied request cannot re-enter through `send` and
  // bypass control-specific authorization.
  const control = useCallback((request = {}) => {
    const command = createControlCommand(request);
    ownedControlRequestsRef.current.add(command);
    return send(command);
  }, [send]);

  const retry = useCallback(async (value) => {
    const submission = typeof value === 'string'
      ? pendingRef.current.find((row) => row.messageId === value)
      : value;
    if (!submission || !RETRY_STATES.has(submission.state)) return false;
    automaticReconnectRetryRef.current.delete(submission.messageId);
    const owner = captureOwner(submission.channelId);
    authorize(owner, REQUEST_PHASE.persist, { requireTransport: false });
    const held = pendingRef.current.find((row) => row.messageId === submission.messageId);
    if (!held || !RETRY_STATES.has(held.state)) return false;
    const queued = { ...held, state: 'queued', error: null, updatedAt: Date.now() };
    registerCorrelation(owner, queued.messageId);
    submissionCorrelationPortRef.current.record({
      channelId: queued.channelId,
      messageId: queued.messageId,
    });
    publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? queued : row));
    journalSubmission(owner.principalId, queued);
    if (authorityRef.current?.wireState === 'open') return transmitRef.current(queued);
    return true;
  }, [authorize, captureOwner, journalSubmission, publishPending, registerCorrelation]);

  useEffect(() => {
    if (wireState !== 'open' || !wireRef?.current) return;
    for (const row of pendingRef.current) {
      if (row.state === 'queued') {
        void transmitRef.current(row);
        continue;
      }
      if (row.state === 'uncertain' && !automaticReconnectRetryRef.current.has(row.messageId)) {
        automaticReconnectRetryRef.current.add(row.messageId);
        void transmitRef.current(row);
      }
    }
  }, [wireRef, wireState]);

  const reconcileFeed = useCallback((landedValue, closedValue = new Set(), ownerToken) => {
    if (!ownerToken || ownerToken !== authorityRef.current?.producerOwnerToken) return false;
    const landed = feedIDs(landedValue);
    const closed = feedIDs(closedValue);
    if (landed.size) {
      for (const id of landed) landedRef.current.add(id);
      const removed = pendingRef.current.filter((row) => landed.has(row.messageId));
      publishPending((rows) => rows.filter((row) => !landed.has(row.messageId)));
      for (const row of removed) {
        const lease = sendLeaseRef.current.get(submissionEntryID(
          authorityRef.current?.principalId || principalId,
          row.messageId,
        ));
        clearSubmissionNotice(lease, row);
        submissionCorrelationPortRef.current.markLanded({
          channelId: row.channelId,
          messageId: row.messageId,
        });
        journalRemove(authorityRef.current?.principalId || principalId, row.messageId);
      }
    }
    if (closed.size) {
      forgetAwaiting(closed);
      const removedKeys = Object.entries(controlStatesRef.current)
        .filter(([, state]) => closed.has(state?.requestId))
        .map(([key]) => key);
      publishControlStates((current) => Object.fromEntries(
        Object.entries(current).filter(([, state]) => !closed.has(state?.requestId)),
      ));
      for (const key of removedKeys) removePersistedControl(key);
    }
    return true;
  }, [clearSubmissionNotice, forgetAwaiting, journalRemove, principalId, publishControlStates, publishPending, removePersistedControl]);

  const ownedWireCommand = useCallback(async (kind, channelId, reqId, decision, payload) => {
    const owner = captureOwner(channelId);
    authorize(owner, REQUEST_PHASE.submit);
    let result;
    if (kind === 'resolve') {
      result = await owner.transport.resolve({
        channel_id: channelId,
        req_id: reqId,
        ...(decision ? { decision } : {}),
        ...(typeof payload?.text === 'string' ? { text: payload.text } : {}),
        ...(payload?.note ? { note: payload.note } : {}),
      });
    } else {
      result = await owner.transport.cancel({ channel_id: channelId, req_id: reqId });
    }
    authorize(owner, REQUEST_PHASE.settle, { requireAccess: false, requireTransport: false });
    return result;
  }, [authorize, captureOwner]);

  const resolve = useCallback(async (channelId, reqId, decision, payload) => {
    const lifecycleGeneration = lifecycleRef.current.generation;
    const attemptEpoch = attemptEpochRef.current;
    const isCurrentAttempt = () => attemptEpochRef.current === attemptEpoch
      && isLiveLifecycle(lifecycleRef.current, lifecycleGeneration);
    setApprovalStates((current) => ({ ...current, [reqId]: 'sending' }));
    try {
      const value = await ownedWireCommand('resolve', channelId, reqId, decision, payload);
      if (isCurrentAttempt()) setApprovalStates((current) => ({ ...current, [reqId]: 'resolved' }));
      return value;
    } catch (error) {
      if (isCurrentAttempt()) {
        setApprovalStates((current) => ({
          ...current,
          [reqId]: { error: serializedControlError(error) },
        }));
      }
      throw error;
    }
  }, [ownedWireCommand]);

  const cancel = useCallback(async (channelId, reqId) => {
    const key = `${channelId}:${reqId}:cancel`;
    const lifecycleGeneration = lifecycleRef.current.generation;
    const attemptEpoch = attemptEpochRef.current;
    const isCurrentAttempt = () => attemptEpochRef.current === attemptEpoch
      && isLiveLifecycle(lifecycleRef.current, lifecycleGeneration);
    const identity = { channelId, requestId: reqId, action: 'cancel' };
    const sending = { ...identity, state: 'sending', error: null, updatedAt: Date.now() };
    publishControlStates((current) => ({ ...current, [key]: sending }));
    // The journal copy lets a remount downgrade a lost in-flight cancel to
    // `uncertain`; the cancel itself does not wait for that copy.
    persistControlState(key, sending);
    try {
      const value = await ownedWireCommand('cancel', channelId, reqId);
      if (isCurrentAttempt()) {
        const accepted = { ...identity, state: 'accepted', error: null, updatedAt: Date.now() };
        publishControlStates((current) => ({ ...current, [key]: accepted }));
        persistControlState(key, accepted);
      }
      return value;
    } catch (error) {
      if (isCurrentAttempt()) {
        const failed = {
          ...identity,
          state: controlFailureState(error),
          error: serializedControlError(error),
          updatedAt: Date.now(),
        };
        publishControlStates((current) => ({ ...current, [key]: failed }));
        persistControlState(key, failed);
      }
      throw error;
    }
  }, [ownedWireCommand, persistControlState, publishControlStates]);

  const clear = useCallback(() => {
    setApprovalStates({});
    const controlKeys = Object.keys(controlStatesRef.current);
    publishControlStates({});
    for (const key of controlKeys) removePersistedControl(key);
  }, [publishControlStates, removePersistedControl]);

  const resetWorld = useCallback(() => {
    attemptEpochRef.current += 1;
    hydrationRef.current += 1;
    transmittingRef.current.clear();
    acceptingRef.current.clear();
    landedRef.current.clear();
    sendLeaseRef.current.clear();
    submissionCorrelationPortRef.current.reset();
    setAcceptingChannels(new Set());
    const worldError = Object.assign(new Error('服务端数据世界已更换，请确认后重新发送'), { code: 'world_changed' });
    const rejected = pendingRef.current.map((row) => ['rejected'].includes(row.state)
      ? row
      : {
        ...row,
        state: 'rejected',
        error: serializedSubmissionError(worldError, row),
        updatedAt: Date.now(),
      });
    publishPending(rejected);
    const principal = authorityRef.current?.principalId || principalId;
    for (const row of rejected) {
      if (row.error?.code !== 'world_changed') continue;
      journalSubmission(principal, row);
    }
    const cleanedDrafts = new Map([...draftsRef.current].map(([channelId, record]) => [channelId, record?.draft
      ? { ...record, draft: { ...record.draft, attachments: [], replyTarget: null } }
      : record]));
    publishDrafts(cleanedDrafts);
    for (const [channelId, record] of cleanedDrafts) {
      if (!record?.draft) continue;
      journalDraft(principal, channelId, record);
    }
    setApprovalStates({});
    const controlKeys = Object.keys(controlStatesRef.current);
    publishControlStates({});
    for (const key of controlKeys) removePersistedControl(key);
  }, [journalDraft, journalSubmission, principalId, publishControlStates, publishDrafts, publishPending, removePersistedControl]);

  const submissionCorrelationPort = submissionCorrelationPortRef.current;
  return useMemo(() => Object.freeze({
    pending,
    submissionCorrelationPort,
    drafts,
    draftFor,
    updateDraft,
    persistDraftAttachments,
    approvalStates,
    controlStates,
    send,
    control,
    retry,
    resolve,
    cancel,
    reconcileFeed,
    resetWorld,
    clear,
    awaiting,
    accepting: acceptingChannels.has(activeChannelId),
  }), [activeChannelId, acceptingChannels, approvalStates, awaiting, cancel, clear, control, controlStates, draftFor, drafts, pending, persistDraftAttachments, reconcileFeed, resetWorld, resolve, retry, send, submissionCorrelationPort, updateDraft]);
}
