import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createOutboxStore } from '../../model/outbox-store.js';
import {
  assessRequestOwner,
  captureRequestOwner,
  REQUEST_PHASE,
  requestAccessError,
} from '../../model/request-owner.js';
import { createPersistenceEpochFence } from '../../model/sync-session.js';
import { newId } from '../../util/id.js';

const ACTIVE_STATES = new Set(['queued', 'transmitting', 'accepted', 'delayed', 'uncertain', 'rejected']);
const RETRY_STATES = new Set(['uncertain', 'rejected']);
const NOOP = () => {};
const ZERO_GENERATION = () => 0;

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

function serializedError(error) {
  return error ? {
    code: error.code || 'unknown',
    detail: error.detail || error.message || String(error),
    message: error.message || error.detail || String(error),
  } : null;
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
  rosterRef,
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
  const retryPrincipalRef = useRef(principalId);
  const acceptingRef = useRef(new Map());
  const landedRef = useRef(new Set());
  const persistedDraftRevisionRef = useRef(new Map());
  const authorityRef = useRef(null);
  const pendingRef = useRef([]);
  const draftsRef = useRef(new Map());
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

  useEffect(() => {
    const generation = ++hydrationRef.current;
    const lifecycleGeneration = lifecycleRef.current.generation;
    attemptEpochRef.current += 1;
    transmittingRef.current.clear();
    acceptingRef.current.clear();
    persistedDraftRevisionRef.current.clear();
    if (retryPrincipalRef.current !== principalId) {
      automaticReconnectRetryRef.current.clear();
      retryPrincipalRef.current = principalId;
    }
    setAcceptingChannels(new Set());
    setApprovalStates({});
    setControlStates({});
    if (!principalId) {
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
      publishPending(restored);
      publishDrafts(new Map(draftRows.filter((row) => row?.channelId).map((row) => [row.channelId, row])));
      if (authorityRef.current?.wireState === 'open' && wireRef?.current) {
        for (const row of restored) {
          if (row.state === 'queued' || row.state === 'uncertain') void transmitRef.current?.(row);
        }
      }
    }).catch((error) => {
      if (alive && isLiveLifecycle(lifecycleRef.current, lifecycleGeneration)) onError(error);
    });
    return () => { alive = false; };
  }, [onError, principalId, publishDrafts, publishPending, wireRef]);

  useEffect(() => () => {
    lifecycleRef.current.active = false;
    lifecycleRef.current.generation += 1;
    hydrationRef.current += 1;
    attemptEpochRef.current += 1;
    automaticReconnectRetryRef.current.clear();
    outboxRef.current?.close();
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
    const transportAssessment = assessRequestOwner(owner, currentFacts(owner), REQUEST_PHASE.submit);
    if (!transportAssessment.current) return false;
    transmittingRef.current.add(key);
    let leased = null;
    try {
      leased = await outboxRef.current.acquireLease(owner.principalId, submission.messageId, leaseOwnerRef.current);
      if (!isLive()) return false;
      if (!leased) return false;
      authorize(owner, REQUEST_PHASE.submit);
      const transmitting = await outboxRef.current.patch(owner.principalId, submission.messageId,
        ['queued', 'uncertain', 'rejected', 'transmitting'],
        { state: 'transmitting', error: null },
        {
          leaseOwner: leaseOwnerRef.current,
          authorize: () => isLive() && assessRequestOwner(owner, currentFacts(owner), REQUEST_PHASE.submit).current,
        });
      if (!isLive()) return false;
      if (!transmitting) return false;
      publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? transmitting : row));
      rosterRef?.current?.recordSubmission?.(submission.channelId, submission.messageId);
      const receipt = await owner.transport.submit(transmitting.frame);
      if (!isLive()) return false;
      authorize(owner, REQUEST_PHASE.settle, { requireTransport: false, requireAccess: false });
      if (receipt?.message_id && receipt.message_id !== submission.messageId) {
        const error = new Error('服务端返回了不同的消息编号');
        error.code = 'message_id_mismatch';
        throw error;
      }
      const accepted = await outboxRef.current.patch(owner.principalId, submission.messageId,
        ['transmitting'], { state: 'accepted', error: null }, {
          leaseOwner: leaseOwnerRef.current,
          authorize: () => isLive(),
        });
      if (!isLive()) return false;
      if (landedRef.current.has(submission.messageId)) {
        await outboxRef.current.remove(owner.principalId, submission.messageId);
        publishPending((rows) => rows.filter((row) => row.messageId !== submission.messageId));
      } else if (accepted) {
        publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? accepted : row));
      }
      onFeedChanged(submission.channelId);
      return true;
    } catch (error) {
      const settlement = assessRequestOwner(owner, currentFacts(owner), REQUEST_PHASE.settle, {
        requireAccess: false,
        requireTransport: false,
      });
      if (!isLive() || !settlement.current) return false;
      const state = wireFailureState(error);
      const failed = await outboxRef.current.patch(owner.principalId, submission.messageId,
        ['queued', 'transmitting', 'uncertain', 'rejected'],
        { state, error: serializedError(error) }, {
          leaseOwner: leaseOwnerRef.current,
          authorize: () => isLive(),
        }).catch((persistError) => {
          if (isLive()) onError(persistError);
          return null;
        });
      if (!isLive()) return false;
      if (failed) publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? failed : row));
      if (state === 'uncertain') onNotice('发送结果待确认，正在通过重连账本核对。');
      if (state === 'rejected') rosterRef?.current?.forgetSubmission?.(submission.channelId, submission.messageId);
      onAccessChanged();
      return false;
    } finally {
      transmittingRef.current.delete(key);
      if (leased && isLive()) {
        try {
          await outboxRef.current.releaseLease(owner.principalId, submission.messageId, leaseOwnerRef.current);
        } catch (error) {
          if (isLive()) onError(error);
        }
      }
    }
  }, [authorize, captureOwner, currentFacts, onAccessChanged, onError, onFeedChanged, onNotice, publishPending, rosterRef]);
  transmitRef.current = transmit;

  const sendOnce = useCallback(async (request = {}) => {
    const requests = request.batch?.length ? request.batch : [request];
    const channelId = request.channelId || requests[0]?.channelId || activeChannelId;
    if (!channelId) throw new TypeError('请先选择频道');
    const channels = new Set(requests.map((row) => row.channelId || channelId));
    const owners = [...channels].map((id) => captureOwner(id));
    for (const owner of owners) authorize(owner, REQUEST_PHASE.persist, { requireTransport: false });
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
  }, [activeChannelId, authorize, captureOwner, onError, publishDrafts, publishPending, wireRef]);

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
    publishPending((rows) => rows.map((row) => row.messageId === submission.messageId ? queued : row));
    if (authorityRef.current?.wireState === 'open') return transmitRef.current(queued);
    return true;
  }, [authorize, captureOwner, currentFacts, publishPending]);

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
        rosterRef?.current?.forgetSubmission?.(row.channelId, row.messageId);
        void outboxRef.current.remove(authorityRef.current?.principalId || principalId, row.messageId).catch(onError);
      }
    }
    if (closed.size) {
      setControlStates((current) => Object.fromEntries(Object.entries(current).filter(([, state]) => !closed.has(state?.requestId))));
    }
    return true;
  }, [onError, principalId, publishPending, rosterRef]);

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
    const identity = { channelId, requestId: reqId };
    setControlStates((current) => ({ ...current, [key]: { ...identity, state: 'sending' } }));
    try {
      const value = await ownedWireCommand('cancel', channelId, reqId);
      setControlStates((current) => ({ ...current, [key]: { ...identity, state: 'accepted' } }));
      return value;
    } catch (error) {
      setControlStates((current) => ({ ...current, [key]: { ...identity, state: wireFailureState(error), error } }));
      throw error;
    }
  }, [ownedWireCommand]);

  const clear = useCallback(() => {
    setApprovalStates({});
    setControlStates({});
  }, []);

  const resetWorld = useCallback(() => {
    attemptEpochRef.current += 1;
    hydrationRef.current += 1;
    transmittingRef.current.clear();
    acceptingRef.current.clear();
    landedRef.current.clear();
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
    setControlStates({});
  }, [onError, principalId, publishDrafts, publishPending]);

  return useMemo(() => Object.freeze({
    pending,
    drafts,
    draftFor,
    updateDraft,
    persistDraftAttachments,
    approvalStates,
    controlStates,
    send,
    control: send,
    retry,
    resolve,
    cancel,
    reconcileFeed,
    resetWorld,
    clear,
    accepting: acceptingChannels.has(activeChannelId),
  }), [activeChannelId, acceptingChannels, approvalStates, cancel, clear, controlStates, draftFor, drafts, pending, persistDraftAttachments, reconcileFeed, resetWorld, resolve, retry, send, updateDraft]);
}
