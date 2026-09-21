import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createOutboxStore } from '../../model/outbox-store.js';
import {
  assessRequestOwner,
  captureRequestOwner,
  REQUEST_PHASE,
  requestAccessError,
} from '../../model/request-owner.js';
import { createPersistenceEpochFence } from '../../model/sync-session.js';
import {
  assertControlAccess,
  createControlCommand,
  isAgentControlType,
} from '../../model/control-command.js';
import { newId } from '../../util/id.js';
import { createSubmissionCorrelationPort } from './submission-correlation-port.js';

const ACTIVE_STATES = new Set(['queued', 'transmitting', 'accepted', 'delayed', 'uncertain', 'rejected']);
const RETRY_STATES = new Set(['uncertain', 'rejected']);
const ACTIVE_CONTROL_STATES = new Set(['sending', 'accepted', 'uncertain', 'error']);
const CONTROL_RECORD_PREFIX = 'control:';
const NOOP = () => {};
const ZERO_GENERATION = () => 0;
const STALE_SEND_LEASE = 'send_lease_stale';

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

function sameSubmissionFacts(left, right) {
  return Boolean(left && right
    && left.principalId === right.principalId
    && Object.is(left.principalEpoch, right.principalEpoch)
    && left.channelId === right.channelId
    && Object.is(left.worldEpoch, right.worldEpoch)
    && Object.is(left.attemptEpoch, right.attemptEpoch)
    && left.access?.epoch === right.access?.epoch
    && left.access?.relationship === right.access?.relationship
    && left.access?.existence === right.access?.existence
    && left.access?.runtime === right.access?.runtime
    && left.access?.freshness === right.access?.freshness
    && left.access?.unavailable === right.access?.unavailable
    && Object.is(left.transport, right.transport)
    && left.transportEpoch === right.transportEpoch
    && left.transportOpen === right.transportOpen);
}

function sameSubmissionAssessment(left, right) {
  return Boolean(left && right
    && left.current === right.current
    && left.code === right.code);
}

function staleSendLeaseError() {
  const error = new Error('发送租约已失效');
  error.code = STALE_SEND_LEASE;
  return error;
}

function emptyDraft() {
  return { text: '', doc: null, recipients: [], attachments: [], replyTarget: null, editorRevision: 0 };
}

function restoredSubmission(row) {
  if (!row?.messageId || !row?.channelId || !row?.frame || !ACTIVE_STATES.has(row.state)) return null;
  return {
    ...row,
    state: row.state === 'transmitting' ? 'uncertain' : row.state,
    leaseOwner: '',
    leaseUntil: 0,
    error: row.error || null,
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
  const fenceRef = useRef(null);
  if (!fenceRef.current) fenceRef.current = createPersistenceEpochFence();
  const leaseOwnerRef = useRef(`composer:${newId()}`);
  const attemptEpochRef = useRef(0);
  const hydrationRef = useRef(0);
  const transmittingRef = useRef(new Set());
  const automaticReconnectRetryRef = useRef(new Set());
  const lifecycleRef = useRef({ generation: 0, active: true });
  const lifecycleEffectTokenRef = useRef(0);
  const retryPrincipalRef = useRef(principalId);
  const acceptingRef = useRef(new Map());
  const landedRef = useRef(new Set());
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
  const persistedDraftRevisionRef = useRef(new Map());
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

  const persistControlState = useCallback((controlKey, value, lifecycleGeneration = null) => {
    if (!principalId || !value || !ACTIVE_CONTROL_STATES.has(value.state)) return Promise.resolve(false);
    return fenceRef.current.run(async () => {
      if (lifecycleGeneration !== null && !isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)) return false;
      const row = controlRecord(principalId, controlKey, value);
      await outboxRef.current.putMany(principalId, [row], {
        authorize: () => lifecycleGeneration === null
          || isLiveLifecycle(lifecycleRef.current, lifecycleGeneration),
      });
      return true;
    });
  }, [principalId]);

  const removePersistedControl = useCallback((controlKey, lifecycleGeneration = null) => {
    if (!principalId || !controlKey) return Promise.resolve(false);
    return fenceRef.current.run(async () => {
      if (lifecycleGeneration !== null && !isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)) return false;
      return outboxRef.current.remove(principalId, controlRecordId(controlKey));
    });
  }, [principalId]);

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

  const authorizeSubmission = useCallback((owner) => {
    const assessment = assessSubmissionOwner(owner);
    if (!assessment.current) throw requestAccessError(assessment);
    return true;
  }, [assessSubmissionOwner]);

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
      `${leaseOwnerRef.current}:${++leaseAttemptSequenceRef.current}`,
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

  useEffect(() => {
    const generation = ++hydrationRef.current;
    const lifecycleGeneration = lifecycleRef.current.generation;
    attemptEpochRef.current += 1;
    transmittingRef.current.clear();
    acceptingRef.current.clear();
    persistedDraftRevisionRef.current.clear();
    if (correlationPrincipalRef.current !== principalId) {
      correlationPrincipalRef.current = principalId;
      landedRef.current.clear();
      sendLeaseRef.current.clear();
      submissionCorrelationPortRef.current.reset();
    }
    if (retryPrincipalRef.current !== principalId) {
      automaticReconnectRetryRef.current.clear();
      retryPrincipalRef.current = principalId;
    }
    setAcceptingChannels(new Set());
    setApprovalStates({});
    controlStatesRef.current = {};
    setControlStates({});
    if (!principalId) {
      sendLeaseRef.current.clear();
      submissionCorrelationPortRef.current.reset();
      publishPending([]);
      publishDrafts(new Map());
      return undefined;
    }
    let alive = true;
    void fenceRef.current.select(async () => {
      let submissionRows;
      let draftRows;
      try {
        [submissionRows, draftRows] = await Promise.all([
          outboxRef.current.restore(principalId),
          outboxRef.current.restoreDrafts(principalId),
        ]);
      } catch (error) {
        if (alive && isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)) onError(error);
        return;
      }
      if (!alive || !isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)
        || generation !== hydrationRef.current || authorityRef.current?.principalId !== principalId) return;
      const restoredRows = submissionRows.map(restoredSubmission).filter(Boolean);
      const restoredControls = Object.fromEntries(submissionRows
        .map((row) => restoredControlState(row, principalId))
        .filter(Boolean)
        .map((state) => [`${state.channelId}:${state.requestId}:${state.action}`, state]));
      for (const row of restoredRows) {
        const identity = { channelId: row.channelId, messageId: row.messageId };
        registerCorrelation(captureOwner(row.channelId), row.messageId);
        if (landedRef.current.has(row.messageId)) {
          submissionCorrelationPortRef.current.markLanded(identity);
        } else if (row.state !== 'rejected') {
          submissionCorrelationPortRef.current.record(identity);
        }
      }
      const landed = restoredRows.filter((row) => landedRef.current.has(row.messageId));
      if (landed.length) {
        await Promise.all(landed.map((row) => outboxRef.current.remove(principalId, row.messageId)
          .catch((error) => {
            if (isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)) onError(error);
            return null;
          })));
        if (!alive || !isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)
          || generation !== hydrationRef.current) return;
      }
      const restored = restoredRows.filter((row) => !landedRef.current.has(row.messageId));
      persistedDraftRevisionRef.current = new Map(draftRows
        .filter((row) => row?.channelId)
        .map((row) => [row.channelId, Number(row.revision || 0)]));
      controlStatesRef.current = restoredControls;
      publishPending(restored);
      publishDrafts(new Map(draftRows.filter((row) => row?.channelId).map((row) => [row.channelId, row])));
      setControlStates(restoredControls);
      if (authorityRef.current?.wireState === 'open' && wireRef?.current) {
        for (const row of restored) {
          if (row.state === 'queued' || row.state === 'uncertain') void transmitRef.current?.(row);
        }
      }
    }).catch((error) => {
      if (alive && isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)) onError(error);
    });
    return () => { alive = false; };
  }, [captureOwner, onError, principalId, publishDrafts, publishPending, registerCorrelation, wireRef]);

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
      queueMicrotask(() => {
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
      : Number(previous?.editorRevision || 0) + 1;
    const optimistic = {
      ...previous,
      principalId: owner.principalId,
      channelId,
      editorRevision,
      draft: { ...nextDraft, editorRevision },
    };
    publishDrafts((current) => new Map(current).set(channelId, optimistic));
    return fenceRef.current.run(async () => {
      authorize(owner, REQUEST_PHASE.persist, { requireTransport: false });
      const expectedRevision = Number(persistedDraftRevisionRef.current.get(channelId) || 0);
      let result = await outboxRef.current.writeDraft(
        owner.principalId,
        channelId,
        optimistic.draft,
        expectedRevision,
      );
      if (result.conflict) {
        if (result.reason === 'draft_consumed') {
          const consumed = result.current;
          persistedDraftRevisionRef.current.set(channelId, Number(consumed?.revision || 0));
          if (consumed) {
            publishDrafts((rows) => new Map(rows).set(channelId, consumed));
          }
          const error = new Error('草稿已被发送，请重新编辑后再保存');
          error.code = 'draft_consumed';
          throw error;
        }
        const conflicts = result.current?.draft ? [result.current.draft] : [];
        result = await outboxRef.current.writeDraft(owner.principalId, channelId, {
          ...optimistic.draft,
          conflicts: [...(optimistic.draft.conflicts || []), ...conflicts],
        }, Number(result.current?.revision || 0));
      }
      authorize(owner, REQUEST_PHASE.settle, { requireTransport: false, requireAccess: false });
      if (result.conflict || !result.record) throw new Error('草稿版本冲突，请重试');
      persistedDraftRevisionRef.current.set(channelId, Number(result.record.revision || 0));
      const current = draftsRef.current.get(channelId);
      if (Number(current?.editorRevision || 0) <= editorRevision) {
        publishDrafts((rows) => new Map(rows).set(channelId, result.record));
      }
      return result.record;
    });
  }, [authorize, captureOwner, publishDrafts]);

  const persistDraftAttachments = useCallback((channelId, attachments, { expectedRevision = 0, authorize: authorizeAttachment } = {}) => {
    const current = draftsRef.current.get(channelId);
    const owner = captureOwner(channelId, { editorRevision: Number(current?.editorRevision || 0) });
    const authorizePersist = () => {
      authorize(owner, REQUEST_PHASE.persist, { requireTransport: false, requireDraft: true });
      if (authorizeAttachment && authorizeAttachment() !== true) throw new Error('草稿附件授权已变化');
      return true;
    };
    return fenceRef.current.run(async () => {
      authorizePersist();
      const result = await outboxRef.current.mergeDraftAttachments({
        principalId: owner.principalId,
        channelId,
        attachments,
        expectedRevision,
        authorize: authorizePersist,
      });
      if (result.conflict || !result.record) {
        const error = new Error(result.reason === 'draft_consumed' ? '草稿已被发送，附件未关联' : '草稿版本已变化，附件未关联');
        error.code = 'attachment_unassociated';
        error.attachments = attachments;
        throw error;
      }
      authorize(owner, REQUEST_PHASE.settle, { requireTransport: false, requireAccess: false });
      persistedDraftRevisionRef.current.set(channelId, Number(result.record.revision || 0));
      publishDrafts((rows) => new Map(rows).set(channelId, result.record));
      return result.record;
    });
  }, [authorize, captureOwner, publishDrafts]);

  const transmitRef = useRef(null);
  const transmit = useCallback(async (submission) => {
    const key = submission.key || submission.messageId;
    if (!key || transmittingRef.current.has(key)) return false;
    const lifecycleGeneration = lifecycleRef.current.generation;
    const isLive = () => isLiveLifecycle(lifecycleRef.current, lifecycleGeneration);
    if (!isLive()) return false;
    const owner = captureOwner(submission.channelId);
    const lease = beginSendLease(owner, submission.messageId);
    const isLeaseCurrent = () => isLive() && currentSendLease(lease);
    const leaseGuard = () => {
      if (!isLeaseCurrent()) throw staleSendLeaseError();
      return true;
    };
    transmittingRef.current.add(key);
    let leased = null;
    let wireStarted = false;
    const settleBeforeWire = async (assessment, expectedStates, hasLease = false, assessmentFacts = null) => {
      if (!isLeaseCurrent()) return false;
      const retryable = assessment.code === 'channel_unavailable' || assessment.code === 'transport_changed';
      const settledFacts = assessmentFacts || currentFacts(owner);
      const options = {
        authorize: () => {
          if (!isLeaseCurrent()) throw staleSendLeaseError();
          const currentFactsValue = currentFacts(owner);
          const currentAssessment = assessSubmissionOwner(owner, currentFactsValue);
          if (!sameSubmissionFacts(settledFacts, currentFactsValue)
            || !sameSubmissionAssessment(assessment, currentAssessment)) {
            throw staleSendLeaseError();
          }
          return true;
        },
        leaseGuard,
      };
      if (hasLease) options.leaseOwner = leaseOwnerRef.current;
      let changed;
      try {
        changed = await outboxRef.current.patch(
          owner.principalId,
          submission.messageId,
          expectedStates,
          {
            state: retryable ? 'queued' : 'rejected',
            error: serializedError(requestAccessError(assessment)),
            leaseOwner: '',
            leaseUntil: 0,
          },
          options,
        );
      } catch (error) {
        if (error?.code !== STALE_SEND_LEASE && isLive()) onError(error);
        return false;
      }
      if (!changed || !isLeaseCurrent()) return false;
      publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? changed : row));
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
      const transportFacts = currentFacts(owner);
      const transportAssessment = assessSubmissionOwner(owner, transportFacts);
      if (!transportAssessment.current) {
        // A queued row that wakes on a replacement connection must settle
        // against the authority observed by this lease.  Returning early
        // leaves a revoked row queued, where a later grant can replay it.
        // Restored uncertain rows retain their evidence until a current owner
        // reconciles them; revoke cannot turn that evidence into rejection.
        if (submission.state === 'uncertain' && transportAssessment.code !== 'channel_unavailable') return false;
        await settleBeforeWire(transportAssessment, ['queued', 'uncertain'], false, transportFacts);
        return false;
      }
      try {
        leased = await outboxRef.current.acquireLease(
          owner.principalId,
          submission.messageId,
          leaseOwnerRef.current,
          15_000,
          {
            authorize: () => {
              if (!isLeaseCurrent()) throw staleSendLeaseError();
              const assessment = assessSubmissionOwner(owner);
              if (!assessment.current) throw requestAccessError(assessment);
              return true;
            },
            leaseGuard,
          },
        );
      } catch (error) {
        if (error?.code === STALE_SEND_LEASE) return false;
        throw error;
      }
      if (!isLeaseCurrent()) return false;
      if (!leased) return false;
      authorizeSubmission(owner);
      const transmitting = await outboxRef.current.patch(owner.principalId, submission.messageId,
        ['queued', 'uncertain', 'rejected', 'transmitting'],
        { state: 'transmitting', error: null },
        {
          leaseOwner: leaseOwnerRef.current,
          authorize: () => {
            if (!isLeaseCurrent()) throw staleSendLeaseError();
            const assessment = assessSubmissionOwner(owner);
            if (!assessment.current) throw requestAccessError(assessment);
            return true;
          },
          leaseGuard,
        });
      if (!isLeaseCurrent()) return false;
      if (!transmitting) return false;
      const beforeWireFacts = currentFacts(owner);
      const beforeWire = assessSubmissionOwner(owner, beforeWireFacts);
      if (!beforeWire.current) {
        // A restored uncertain row may have crossed the network before this
        // runtime existed. An access transition cannot turn that evidence into
        // a definitive rejection; leave it for a current owner to reconcile.
        if (submission.state === 'uncertain' && beforeWire.code !== 'channel_unavailable') return false;
        await settleBeforeWire(beforeWire, ['transmitting'], true, beforeWireFacts);
        return false;
      }
      if (!isLeaseCurrent()) return false;
      wireStarted = true;
      publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? transmitting : row));
      const receipt = await owner.transport.submit(transmitting.frame);
      if (!isLeaseCurrent()) return false;
      authorize(owner, REQUEST_PHASE.settle, { requireTransport: false, requireAccess: false });
      if (receipt?.message_id && receipt.message_id !== submission.messageId) {
        const error = new Error('服务端返回了不同的消息编号');
        error.code = 'message_id_mismatch';
        throw error;
      }
      const accepted = await outboxRef.current.patch(owner.principalId, submission.messageId,
        ['transmitting'], { state: 'accepted', error: null }, {
          leaseOwner: leaseOwnerRef.current,
          authorize: () => isLeaseCurrent(),
          leaseGuard,
        });
      if (!isLeaseCurrent()) return false;
      if (landedRef.current.has(submission.messageId)) {
        submissionCorrelationPortRef.current.markLanded({
          channelId: submission.channelId,
          messageId: submission.messageId,
        });
        await outboxRef.current.remove(owner.principalId, submission.messageId);
        publishPending((rows) => rows.filter((row) => row.messageId !== submission.messageId));
      } else if (accepted) {
        publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? accepted : row));
      }
      onFeedChanged(submission.channelId);
      return true;
    } catch (error) {
      if (error?.code === STALE_SEND_LEASE || !isLive() || !currentSendLease(lease)) return false;
      if (!wireStarted) {
        const prewireFacts = currentFacts(owner);
        const prewire = assessSubmissionOwner(owner, prewireFacts);
        if (!prewire.current) {
          if (submission.state === 'uncertain' && prewire.code !== 'channel_unavailable') return false;
          await settleBeforeWire(prewire, leased ? ['transmitting'] : ['queued', 'uncertain'], Boolean(leased), prewireFacts);
          return false;
        }
      }
      const settlement = assessRequestOwner(owner, currentFacts(owner), REQUEST_PHASE.settle, {
        requireAccess: false,
        requireTransport: false,
      });
      if (!settlement.current) return false;
      const state = wireFailureState(error);
      const patchOptions = {
        authorize: () => isLeaseCurrent(),
        leaseGuard,
      };
      if (leased) patchOptions.leaseOwner = leaseOwnerRef.current;
      const failed = await outboxRef.current.patch(owner.principalId, submission.messageId,
        ['queued', 'transmitting', 'uncertain', 'rejected'],
        { state, error: serializedError(error) }, {
          ...patchOptions,
        }).catch((persistError) => {
          if (persistError?.code !== STALE_SEND_LEASE && isLive()) onError(persistError);
          return null;
        });
      if (!isLeaseCurrent()) return false;
      if (failed) publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? failed : row));
      if (state === 'uncertain') onNotice('发送结果待确认，正在通过重连账本核对。');
      if (state === 'rejected') {
        forgetLeaseCorrelation(lease, {
          channelId: submission.channelId,
          messageId: submission.messageId,
        });
      }
      onAccessChanged();
      return false;
    } finally {
      transmittingRef.current.delete(key);
      if (leased && isLive() && currentSendLease(lease)) {
        try {
          await outboxRef.current.releaseLease(owner.principalId, submission.messageId, leaseOwnerRef.current, {
            leaseGuard,
          });
        } catch (error) {
          if (error?.code !== STALE_SEND_LEASE && isLive()) onError(error);
        }
      }
    }
  }, [assessSubmissionOwner, authorizeSubmission, beginSendLease, captureOwner, currentFacts, currentSendLease, forgetLeaseCorrelation, onAccessChanged, onError, onFeedChanged, onNotice, publishPending]);
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
    const authorizePersist = () => {
      for (const owner of owners) authorize(owner, REQUEST_PHASE.persist, { requireTransport: false });
      return true;
    };
    if (request.draftRevision != null) {
      const result = await fenceRef.current.run(() => outboxRef.current.acceptDraft({
        principalId: owners[0].principalId,
        channelId,
        expectedRevision: request.draftRevision,
        editorRevision: request.editorRevision,
        submissions,
        authorize: authorizePersist,
      }));
      if (!result.accepted) throw new Error('草稿在发送前已被其他页面修改，请确认内容后重试');
      submissions = result.submissions || submissions;
      if (result.record) {
        persistedDraftRevisionRef.current.set(channelId, Number(result.record.revision || 0));
        publishDrafts((rows) => new Map(rows).set(channelId, result.record));
      }
    } else {
      submissions = await fenceRef.current.run(() => outboxRef.current.putMany(
        owners[0].principalId,
        submissions,
        { authorize: authorizePersist },
      ));
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
    const alreadyLanded = submissions.filter((row) => landedRef.current.has(row.messageId));
    publishPending((rows) => [...rows.filter((row) => !ids.has(row.messageId)), ...outstanding]);
    for (const row of alreadyLanded) {
      void outboxRef.current.remove(owners[0].principalId, row.messageId).catch(onError);
    }
    if (authorityRef.current?.wireState === 'open' && wireRef?.current) {
      for (const row of outstanding) void transmitRef.current(row);
    }
    const values = submissions.map((row) => row.messageId);
    return request.batch?.length ? values : values[0];
  }, [activeChannelId, authorize, captureOwner, currentFacts, onError, publishDrafts, publishPending, registerCorrelation, wireRef]);

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
    if (isAgentControlType(command.msgType)) ownedControlRequestsRef.current.add(command);
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
    const queued = await outboxRef.current.patch(owner.principalId, submission.messageId,
      [...RETRY_STATES], { state: 'queued', error: null },
      { authorize: () => assessRequestOwner(owner, currentFacts(owner), REQUEST_PHASE.persist, { requireTransport: false }).current });
    if (!queued) return false;
    registerCorrelation(owner, queued.messageId);
    submissionCorrelationPortRef.current.record({
      channelId: queued.channelId,
      messageId: queued.messageId,
    });
    publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? queued : row));
    if (authorityRef.current?.wireState === 'open') return transmitRef.current(queued);
    return true;
  }, [authorize, captureOwner, currentFacts, publishPending, registerCorrelation]);

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
        submissionCorrelationPortRef.current.markLanded({
          channelId: row.channelId,
          messageId: row.messageId,
        });
        void outboxRef.current.remove(authorityRef.current?.principalId || principalId, row.messageId).catch(onError);
      }
    }
    if (closed.size) {
      const removedKeys = Object.entries(controlStatesRef.current)
        .filter(([, state]) => closed.has(state?.requestId))
        .map(([key]) => key);
      publishControlStates((current) => Object.fromEntries(
        Object.entries(current).filter(([, state]) => !closed.has(state?.requestId)),
      ));
      for (const key of removedKeys) void removePersistedControl(key).catch(onError);
    }
    return true;
  }, [onError, principalId, publishControlStates, publishPending, removePersistedControl]);

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
    setApprovalStates((current) => ({ ...current, [reqId]: 'sending' }));
    try {
      const value = await ownedWireCommand('resolve', channelId, reqId, decision, payload);
      setApprovalStates((current) => ({ ...current, [reqId]: 'resolved' }));
      return value;
    } catch (error) {
      setApprovalStates((current) => ({ ...current, [reqId]: { error } }));
      throw error;
    }
  }, [ownedWireCommand]);

  const cancel = useCallback(async (channelId, reqId) => {
    const key = `${channelId}:${reqId}:cancel`;
    const lifecycleGeneration = lifecycleRef.current.generation;
    const identity = { channelId, requestId: reqId, action: 'cancel' };
    const sending = { ...identity, state: 'sending', error: null, updatedAt: Date.now() };
    publishControlStates((current) => ({ ...current, [key]: sending }));
    // The in-flight marker is durable before the external cancel crosses the
    // wire. A real remount can therefore downgrade it to `uncertain` instead
    // of presenting a lost action as though it never existed.
    await persistControlState(key, sending, lifecycleGeneration);
    try {
      const value = await ownedWireCommand('cancel', channelId, reqId);
      if (isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)) {
        const accepted = { ...identity, state: 'accepted', error: null, updatedAt: Date.now() };
        publishControlStates((current) => ({ ...current, [key]: accepted }));
        await persistControlState(key, accepted, lifecycleGeneration).catch(onError);
      }
      return value;
    } catch (error) {
      if (isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)) {
        const failed = {
          ...identity,
          state: controlFailureState(error),
          error: serializedControlError(error),
          updatedAt: Date.now(),
        };
        publishControlStates((current) => ({ ...current, [key]: failed }));
        await persistControlState(key, failed, lifecycleGeneration).catch(onError);
      }
      throw error;
    }
  }, [onError, ownedWireCommand, persistControlState, publishControlStates]);

  const clear = useCallback(() => {
    setApprovalStates({});
    const controlKeys = Object.keys(controlStatesRef.current);
    publishControlStates({});
    for (const key of controlKeys) void removePersistedControl(key).catch(onError);
  }, [onError, publishControlStates, removePersistedControl]);

  const resetWorld = useCallback(() => {
    attemptEpochRef.current += 1;
    hydrationRef.current += 1;
    transmittingRef.current.clear();
    acceptingRef.current.clear();
    landedRef.current.clear();
    sendLeaseRef.current.clear();
    submissionCorrelationPortRef.current.reset();
    persistedDraftRevisionRef.current.clear();
    setAcceptingChannels(new Set());
    const worldError = serializedError(Object.assign(new Error('服务端数据世界已更换，请确认后重新发送'), { code: 'world_changed' }));
    const rejected = pendingRef.current.map((row) => ['rejected'].includes(row.state)
      ? row
      : { ...row, state: 'rejected', error: worldError, leaseOwner: '', leaseUntil: 0, updatedAt: Date.now() });
    publishPending(rejected);
    const principal = authorityRef.current?.principalId || principalId;
    for (const row of rejected) {
      if (row.error?.code !== 'world_changed') continue;
      void outboxRef.current.patch(principal, row.messageId, null, row).catch(onError);
    }
    const cleanedDrafts = new Map([...draftsRef.current].map(([channelId, record]) => [channelId, record?.draft
      ? { ...record, draft: { ...record.draft, attachments: [], replyTarget: null } }
      : record]));
    publishDrafts(cleanedDrafts);
    for (const [channelId, record] of cleanedDrafts) {
      if (!record?.draft) continue;
      void outboxRef.current.writeDraft(principal, channelId, record.draft, Number(record.revision || 0)).then((result) => {
        if (result?.record) persistedDraftRevisionRef.current.set(channelId, Number(result.record.revision || 0));
      }).catch(onError);
    }
    setApprovalStates({});
    const controlKeys = Object.keys(controlStatesRef.current);
    publishControlStates({});
    for (const key of controlKeys) void removePersistedControl(key).catch(onError);
  }, [onError, principalId, publishControlStates, publishDrafts, publishPending, removePersistedControl]);

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
    accepting: acceptingChannels.has(activeChannelId),
  }), [activeChannelId, acceptingChannels, approvalStates, cancel, clear, control, controlStates, draftFor, drafts, pending, persistDraftAttachments, reconcileFeed, resetWorld, resolve, retry, send, submissionCorrelationPort, updateDraft]);
}
