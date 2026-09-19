import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createControlState } from '../../model/control-actions.js';
import {
  createSubmission,
  isUncertainWireError,
  reconcileLanded,
  restoreSubmissionRecords,
  transitionSubmission,
} from '../../model/submissions.js';
import { createOutboxStore } from '../../model/outbox-store.js';
import { diagnostic } from '../../model/diagnostics.js';
import { newId } from '../../util/id.js';
import {
  assessRequestOwner,
  captureRequestOwner,
  executeOwnedGroupPhase,
  executeOwnedPhase,
  REQUEST_PHASE,
  requestAccessError,
} from '../../model/request-owner.js';

function emptyDraft() { return { text: '', doc: null, recipients: [] }; }

function queuedAccessRejection(access) {
  if (access?.existence === 'retired') {
    return {
      code: 'channel_not_found',
      detail: '频道已退役，消息未发送；内容仍保留在本机。',
    };
  }
  if (access?.relationship === 'denied') {
    return {
      code: 'forbidden',
      detail: '频道成员权限已撤销，消息未发送；内容仍保留在本机。',
    };
  }
  return null;
}

export function useSubmissions({ principalId, serverWorld = '', activeChannelId, wireState, wireRef, rosterRef, accessRef, accessVersion = 0, stateFor, reconcileIdentity, onError, onNotice, onFeedChanged, onAccessChanged }) {
  const [projection, setProjection] = useState(() => ({ pending: [], drafts: new Map() }));
  const { pending, drafts } = projection;
  const [approvalStates, setApprovalStates] = useState({});
  const [controlStates, setControlStates] = useState({});
  const timersRef = useRef(new Map());
  const transmittingRef = useRef(new Set());
  // The transaction projection may intentionally lead React paint after a
  // durable operation. Pending submissions and drafts share this one owner so
  // no continuation can publish one side from a stale snapshot of the other.
  const projectionRef = useRef(projection);
  const committedPrincipalRef = useRef(principalId);
  const persistedDraftRevisionRef = useRef(new Map());
  const outboxRef = useRef(null);
  const writeTailRef = useRef(Promise.resolve());
  const restoreEpochRef = useRef(0);
  const hydratedPrincipalRef = useRef('');
  const restoreAttemptRef = useRef({ principalId: '', epoch: 0, world: '', attempt: 0, requestSession: '', promise: null });
  const leaseOwnerRef = useRef(`tab:${newId()}`);
  const requestSessionRef = useRef(`request-session:${newId()}`);
  const lifecycleRef = useRef(0);
  const openEpochRef = useRef(0);
  const worldEpochRef = useRef(0);
  const serverWorldRef = useRef(serverWorld);
  const wireStateRef = useRef(wireState);
  const previousWireStateRef = useRef('closed');
  const attemptedOpenEpochRef = useRef(new Map());
  const landedMessageIdsRef = useRef(new Set());
  const reconciledLandedMessageIdsRef = useRef(new Set());
  const durableControlObligationsRef = useRef(new Map());
  if (!outboxRef.current) outboxRef.current = createOutboxStore();
  const publishTransaction = useCallback((reduce, authorize) => {
    if (authorize && authorize() !== true) return null;
    const current = projectionRef.current;
    const next = reduce(current);
    if (!next || next === current) return current;
    if (authorize && authorize() !== true) return null;
    projectionRef.current = next;
    setProjection(next);
    return next;
  }, []);

  useLayoutEffect(() => {
    const principalChanged = committedPrincipalRef.current !== principalId;
    const worldChanged = serverWorldRef.current !== serverWorld;
    committedPrincipalRef.current = principalId;
    if (principalChanged || worldChanged) {
      requestSessionRef.current = `request-session:${newId()}`;
    }
    if (principalChanged) {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      publishTransaction(() => ({ pending: [], drafts: new Map() }));
    }
    wireStateRef.current = wireState;
    serverWorldRef.current = serverWorld;
  }, [principalId, publishTransaction, serverWorld, wireState]);

  const enqueueWrite = useCallback((operation) => {
    const next = writeTailRef.current.catch(() => {}).then(operation);
    writeTailRef.current = next;
    return next;
  }, []);

  const mutatePending = useCallback((reduce, authorize) => publishTransaction((current) => ({
    ...current,
    pending: reduce(current.pending),
  }), authorize), [publishTransaction]);

  const publishDraft = useCallback((channelId, record, authorize) => publishTransaction((current) => {
    const drafts = new Map(current.drafts);
    drafts.set(channelId, record);
    return { ...current, drafts };
  }, authorize), [publishTransaction]);

  const canDurablyOwnChannel = useCallback((channelId) => {
    if (!principalId || !channelId) return false;
    const access = accessRef.current?.state?.(channelId);
    return access?.relationship === 'member' && access.existence !== 'retired';
  }, [accessRef, principalId]);

  const currentOwnerFacts = useCallback((owner) => {
    const access = accessRef.current?.state?.(owner.channelId);
    const draft = projectionRef.current.drafts.get(owner.channelId);
    return {
      principalId: committedPrincipalRef.current,
      principalEpoch: restoreEpochRef.current,
      channelId: owner.channelId,
      worldEpoch: serverWorldRef.current,
      attemptEpoch: worldEpochRef.current,
      access: {
        epoch: Number(access?.authorityEpoch || 0),
        relationship: String(access?.relationship || ''),
        existence: String(access?.existence || ''),
        runtime: String(access?.runtime || ''),
        unavailable: access?.unavailable === true,
      },
      transport: wireRef.current,
      transportEpoch: openEpochRef.current,
      transportOpen: wireStateRef.current === 'open' && Boolean(wireRef.current),
      draft: owner.draft ? Object.fromEntries(
        Object.keys(owner.draft).map((key) => [key, draft?.[key]]),
      ) : null,
    };
  }, [accessRef, wireRef]);

  const ownsDurableDraft = useCallback((owner) => {
    const current = currentOwnerFacts(owner);
    const identity = assessRequestOwner(owner, current, REQUEST_PHASE.settle, {
      requireAccess: false,
      requireTransport: false,
      requireDraft: true,
    });
    return identity.current
      && owner.access.epoch === current.access.epoch
      && current.access.relationship === 'member'
      && current.access.existence !== 'retired';
  }, [currentOwnerFacts]);

  const requestOwner = useCallback((channelId, draft = null) => captureRequestOwner({
    principalId,
    principalEpoch: restoreEpochRef.current,
    channelId,
    worldEpoch: serverWorldRef.current,
    attemptEpoch: worldEpochRef.current,
    accessState: accessRef.current?.state?.(channelId),
    transport: wireRef.current,
    transportEpoch: openEpochRef.current,
    draft,
  }), [accessRef, principalId, wireRef]);

  const submissionAuthority = useCallback((owner) => Object.freeze({
    principalId: owner.principalId,
    channelId: owner.channelId,
    worldEpoch: owner.worldEpoch,
    attemptEpoch: owner.attemptEpoch,
    accessEpoch: owner.access.epoch,
    access: owner.access,
    requestSession: requestSessionRef.current,
    draft: owner.draft,
  }), []);

  const ownerForSubmission = useCallback((submission) => {
    const accessState = accessRef.current?.state?.(submission.channelId);
    const admission = submission.authority;
    const sameRequestSession = admission?.requestSession === requestSessionRef.current;
    return captureRequestOwner({
      principalId: admission?.principalId || principalId,
      principalEpoch: restoreEpochRef.current,
      channelId: admission?.channelId || submission.channelId,
      worldEpoch: admission?.worldEpoch || serverWorldRef.current,
      attemptEpoch: sameRequestSession
        ? Number(admission?.attemptEpoch || 0)
        : worldEpochRef.current,
      accessState: sameRequestSession ? {
        ...accessState,
        authorityEpoch: Number(admission?.accessEpoch || 0),
        relationship: admission?.access?.relationship || accessState?.relationship,
        existence: admission?.access?.existence || accessState?.existence,
        runtime: admission?.access?.runtime || accessState?.runtime,
        unavailable: admission?.access?.unavailable === true,
      } : accessState,
      transport: wireRef.current,
      transportEpoch: openEpochRef.current,
      draft: admission?.draft || null,
    });
  }, [accessRef, principalId, wireRef]);

  const hydratePrincipal = useCallback(() => {
    if (!principalId) return Promise.resolve();
    if (hydratedPrincipalRef.current === principalId) return Promise.resolve();
    const epoch = restoreEpochRef.current;
    const world = serverWorldRef.current;
    const attempt = worldEpochRef.current;
    const requestSession = requestSessionRef.current;
    const active = restoreAttemptRef.current;
    if (active.principalId === principalId
      && active.epoch === epoch
      && active.world === world
      && active.attempt === attempt
      && active.requestSession === requestSession
      && active.promise) return active.promise;
    const restoreCurrent = () => (
      restoreEpochRef.current === epoch
      && committedPrincipalRef.current === principalId
      && serverWorldRef.current === world
      && worldEpochRef.current === attempt
      && requestSessionRef.current === requestSession
    );

    const promise = Promise.all([
      outboxRef.current.restore(principalId),
      outboxRef.current.restoreDrafts(principalId),
    ]).then(async ([records, draftRecords]) => {
      const landedDuringRestore = landedMessageIdsRef.current;
      const submissionRecords = records;
      const removedLanded = new Set();
      for (;;) {
        const newlyLanded = submissionRecords.filter((item) => (
          item?.messageId
          && landedDuringRestore.has(item.messageId)
          && !removedLanded.has(item.messageId)
        ));
        if (!newlyLanded.length) break;
        for (const item of newlyLanded) {
          await outboxRef.current.remove(principalId, item.messageId);
          removedLanded.add(item.messageId);
        }
      }
      const restored = restoreSubmissionRecords(submissionRecords)
        .filter((item) => !landedDuringRestore.has(item.messageId));
      landedDuringRestore.clear();
      if (!restoreCurrent()) {
        const current = restoreAttemptRef.current;
        if (current.promise === promise) restoreAttemptRef.current = { ...current, promise: null };
        return;
      }
      const nextDrafts = new Map(draftRecords.map((record) => [record.channelId, record]));
      for (const [channelId, local] of projectionRef.current.drafts) {
        const restoredDraft = nextDrafts.get(channelId);
        if (!restoredDraft || Number(local?.editorRevision || 0) > Number(restoredDraft?.editorRevision || 0)) {
          nextDrafts.set(channelId, local);
        }
      }
      persistedDraftRevisionRef.current = new Map(draftRecords.map((record) => [record.channelId, Number(record.revision || 0)]));
      hydratedPrincipalRef.current = principalId;
      publishTransaction(() => ({
        pending: restored,
        drafts: nextDrafts,
      }), restoreCurrent);
    }).catch((error) => {
      const current = restoreAttemptRef.current;
      if (current.promise === promise) {
        restoreAttemptRef.current = { ...current, promise: null };
      }
      throw error;
    });
    restoreAttemptRef.current = { principalId, epoch, world, attempt, requestSession, promise };
    return promise;
  }, [principalId, publishTransaction]);

  useEffect(() => {
    const epoch = ++restoreEpochRef.current;
    hydratedPrincipalRef.current = '';
    restoreAttemptRef.current = {
      principalId,
      epoch,
      world: serverWorldRef.current,
      attempt: worldEpochRef.current,
      requestSession: requestSessionRef.current,
      promise: null,
    };
    persistedDraftRevisionRef.current = new Map();
    landedMessageIdsRef.current = new Set();
    reconciledLandedMessageIdsRef.current = new Set();
    publishTransaction(() => ({ pending: [], drafts: new Map() }));
    setControlStates({});
    if (!principalId) return;
    const restore = hydratePrincipal();
    void restore.catch(onError);
  }, [hydratePrincipal, onError, principalId, publishTransaction]);

  useEffect(() => {
    const lifecycle = ++lifecycleRef.current;
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      queueMicrotask(() => {
        if (lifecycleRef.current !== lifecycle) return;
        void writeTailRef.current.catch(() => {}).finally(() => outboxRef.current?.close());
      });
    };
  }, []);

  const updateDraft = useCallback((channelId, draft) => {
    if (!channelId || !principalId) return Promise.resolve(null);
    if (committedPrincipalRef.current !== principalId) return Promise.resolve(null);
    if (!canDurablyOwnChannel(channelId)) return Promise.resolve(null);
    const previous = projectionRef.current.drafts.get(channelId);
    const requestedRevision = Number(draft?.editorRevision);
    if (previous && previous.draft == null
      && Number.isFinite(requestedRevision)
      && requestedRevision <= Number(previous.editorRevision || 0)) {
      return Promise.resolve(previous);
    }
    const editorRevision = Number.isFinite(requestedRevision) && requestedRevision >= 0
      ? Math.max(Number(previous?.editorRevision || 0), requestedRevision)
      : Number(previous?.editorRevision || 0) + 1;
    const optimistic = { ...previous, principalId, channelId, editorRevision, draft };
    publishDraft(channelId, optimistic);
    const owner = requestOwner(channelId, { editorRevision });
    const authorize = () => ownsDurableDraft(owner);
    return enqueueWrite(async () => {
      await hydratePrincipal();
      if (!authorize() || hydratedPrincipalRef.current !== principalId) return null;
      const expected = Number(persistedDraftRevisionRef.current.get(channelId) || 0);
      let result = await outboxRef.current.writeDraft(principalId, channelId, { ...draft, editorRevision }, expected);
      if (!authorize()) return null;
      if (result.conflict) {
        const remote = result.current;
        const preserved = {
          ...draft,
          editorRevision,
          conflicts: [...(draft?.conflicts || []), ...(remote?.draft ? [remote.draft] : [])],
        };
        result = await outboxRef.current.writeDraft(principalId, channelId, preserved, Number(remote?.revision || 0));
        if (!authorize()) return null;
      }
      if (result.conflict || !result.record) throw new Error('草稿版本冲突，请重试');
      persistedDraftRevisionRef.current.set(channelId, result.record.revision);
      const current = projectionRef.current.drafts.get(channelId);
      if (Number(current?.editorRevision || 0) <= editorRevision) publishDraft(channelId, result.record, authorize);
      return result.record;
    });
  }, [canDurablyOwnChannel, enqueueWrite, hydratePrincipal, ownsDurableDraft, principalId, publishDraft, requestOwner]);

  const persistDraftAttachments = useCallback((channelId, attachments, {
    expectedRevision = 0,
    authorize,
  } = {}) => {
    if (!channelId || !principalId) return Promise.resolve(null);
    if (committedPrincipalRef.current !== principalId) return Promise.resolve(null);
    const draft = projectionRef.current.drafts.get(channelId);
    const owner = requestOwner(channelId, { editorRevision: draft?.editorRevision });
    const authorizeCurrent = () => ownsDurableDraft(owner) && (!authorize || authorize() === true);
    return enqueueWrite(async () => {
      await hydratePrincipal();
      if (!authorizeCurrent() || hydratedPrincipalRef.current !== principalId) {
        throw new Error('草稿附件授权已变化');
      }
      const result = await outboxRef.current.mergeDraftAttachments({
        principalId,
        channelId,
        attachments,
        expectedRevision,
        authorize: authorizeCurrent,
      });
      if (result.conflict || !result.record) {
        const error = new Error(result.reason === 'draft_consumed'
          ? '草稿已被发送，已上传资源未自动关联'
          : '草稿版本已变化，已上传资源未自动关联');
        error.code = 'attachment_unassociated';
        error.attachments = attachments;
        throw error;
      }
      if (!authorizeCurrent()) {
        const error = new Error('草稿在附件关联完成前已变化，已上传资源未发布到当前草稿');
        error.code = 'attachment_unassociated';
        error.attachments = attachments;
        throw error;
      }
      persistedDraftRevisionRef.current.set(channelId, result.record.revision);
      publishDraft(channelId, result.record, authorizeCurrent);
      return result.record;
    });
  }, [enqueueWrite, hydratePrincipal, ownsDurableDraft, principalId, publishDraft, requestOwner]);

  const persistTransition = useCallback((next, expectedStates, { authorize } = {}) => {
    if (!principalId || !next?.messageId) return Promise.resolve(null);
    return enqueueWrite(() => outboxRef.current.patch(
      principalId,
      next.messageId,
      expectedStates,
      next,
      { authorize },
    ));
  }, [enqueueWrite, principalId]);

  const clear = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    setApprovalStates({});
    setControlStates({});
    for (const obligation of durableControlObligationsRef.current.values()) {
      if (obligation.retryTimer != null) clearTimeout(obligation.retryTimer);
    }
    durableControlObligationsRef.current.clear();
  }, []);

  const resetWorld = useCallback(() => {
    worldEpochRef.current += 1;
    hydratedPrincipalRef.current = '';
    restoreAttemptRef.current = {
      principalId,
      epoch: restoreEpochRef.current,
      world: serverWorldRef.current,
      attempt: worldEpochRef.current,
      requestSession: requestSessionRef.current,
      promise: null,
    };
    landedMessageIdsRef.current = new Set();
    reconciledLandedMessageIdsRef.current = new Set();
    clear();
    const worldError = { code: 'world_changed', detail: '服务端数据世界已更换，请确认后重新发送' };
    const currentPending = [...projectionRef.current.pending];
    const draftsToClear = [...projectionRef.current.drafts].flatMap(([channelId, record]) => {
      const draft = record?.draft;
      return draft?.attachments?.length || draft?.replyTarget
        ? [[channelId, { ...draft, attachments: [], replyTarget: null }]]
        : [];
    });
    publishTransaction((current) => ({
      pending: current.pending.map((item) => (
        ['landed', 'rejected'].includes(item.state)
          ? item
          : { ...item, state: 'rejected', error: worldError, updatedAt: Date.now(), leaseOwner: '', leaseUntil: 0 }
      )),
      drafts: new Map([...current.drafts].map(([channelId, record]) => {
        const cleared = draftsToClear.find(([id]) => id === channelId)?.[1];
        return [channelId, cleared ? { ...record, draft: cleared } : record];
      })),
    }));
    for (const item of currentPending) {
      if (['landed', 'rejected'].includes(item.state)) continue;
      void enqueueWrite(() => outboxRef.current.patch(principalId, item.messageId, null, {
        state: 'rejected', error: worldError, leaseOwner: '', leaseUntil: 0,
      })).catch(onError);
    }
    for (const [channelId, draft] of draftsToClear) void updateDraft(channelId, draft).catch(onError);
  }, [clear, enqueueWrite, onError, principalId, publishTransaction, updateDraft]);

  const transmit = useCallback(async (submission) => {
    const { channelId, messageId, key } = submission;
    const owner = ownerForSubmission(submission);
    const currentIdentity = () => hydratedPrincipalRef.current === principalId
      && assessRequestOwner(owner, currentOwnerFacts(owner), REQUEST_PHASE.settle).current;
    if (!currentIdentity()) return;
    if (!wireRef.current || wireStateRef.current !== 'open') {
      const queued = transitionSubmission(submission, 'queued');
      mutatePending((current) => current.map((item) => item.key === key ? queued : item));
      await persistTransition(queued).catch(onError);
      return;
    }
    const stopInvalidAttempt = async (invalidation, source = submission) => {
      if (!currentIdentity()) return;
      const accessError = queuedAccessRejection(accessRef.current?.state?.(channelId));
      const transportOnly = ['transport_changed', 'channel_unavailable'].includes(invalidation?.code)
        && !accessError;
      const next = transitionSubmission(
        source,
        transportOnly ? 'queued' : 'rejected',
        accessError || requestAccessError(invalidation),
      );
      const persisted = await persistTransition(next, ['queued', 'transmitting', 'uncertain']).catch((error) => {
        onError(error);
        return null;
      });
      if (!persisted || !currentIdentity()) return;
      mutatePending((current) => current.map((item) => (
        item.key === key && ['queued', 'transmitting', 'uncertain'].includes(item.state) ? next : item
      )));
    };
    const initialAuthority = assessRequestOwner(owner, currentOwnerFacts(owner), REQUEST_PHASE.acquire);
    if (!initialAuthority.current) {
      await stopInvalidAttempt(initialAuthority);
      return;
    }
    if (transmittingRef.current.has(key)) return;
    // Reserve inside this tab before the asynchronous lease transaction. A
    // lease deliberately permits renewal by the same owner, so using it alone
    // would let the send path and the pending-state effect both submit the same
    // immutable frame while the first acquire was still waiting.
    transmittingRef.current.add(key);
    let leasePhase;
    try {
      leasePhase = await executeOwnedPhase({
        owner,
        current: () => currentOwnerFacts(owner),
        phase: REQUEST_PHASE.acquire,
        effect: () => outboxRef.current.acquireLease(principalId, messageId, leaseOwnerRef.current),
      });
    } catch (error) {
      transmittingRef.current.delete(key);
      onError(error);
      return;
    }
    const leased = leasePhase.value;
    if (!leasePhase.started || !leased || !leasePhase.current) {
      if (leased) await outboxRef.current.releaseLease(principalId, messageId, leaseOwnerRef.current).catch(onError);
      transmittingRef.current.delete(key);
      if (leasePhase.invalidation) await stopInvalidAttempt(leasePhase.invalidation);
      return;
    }
    const renewLease = globalThis.setInterval?.(() => {
      if (!assessRequestOwner(owner, currentOwnerFacts(owner), REQUEST_PHASE.submit).current) return;
      void outboxRef.current.acquireLease(principalId, messageId, leaseOwnerRef.current).catch(onError);
    }, 5_000);
    let preparedFrame;
    try {
      preparedFrame = wireRef.current.prepareSubmit(submission.frame);
    } catch (error) {
      if (renewLease != null) globalThis.clearInterval?.(renewLease);
      transmittingRef.current.delete(key);
      await outboxRef.current.releaseLease(principalId, messageId, leaseOwnerRef.current).catch(onError);
      const failed = transitionSubmission(submission, 'rejected', error);
      const persisted = await persistTransition(failed, ['queued', 'uncertain', 'transmitting']).catch(onError);
      if (persisted && assessRequestOwner(owner, currentOwnerFacts(owner), REQUEST_PHASE.settle).current) {
        mutatePending((current) => current.map((item) => (
          item.key === key && ['queued', 'uncertain', 'transmitting'].includes(item.state) ? failed : item
        )));
      }
      diagnostic('warn', 'submission.prepare_rejected', { channelId, messageId, code: error?.code || 'prepare_failed' });
      return;
    }
    attemptedOpenEpochRef.current.set(key, openEpochRef.current);
    const transmitting = transitionSubmission({ ...submission, frame: preparedFrame }, 'transmit');
    let persistPhase;
    try {
      persistPhase = await executeOwnedPhase({
        owner,
        current: () => currentOwnerFacts(owner),
        phase: REQUEST_PHASE.persist,
        effect: () => persistTransition(
          transmitting,
          ['queued', 'uncertain', 'transmitting'],
          { authorize: () => assessRequestOwner(
            owner,
            currentOwnerFacts(owner),
            REQUEST_PHASE.persist,
          ).current },
        ),
      });
    } catch (error) {
      if (renewLease != null) globalThis.clearInterval?.(renewLease);
      transmittingRef.current.delete(key);
      await outboxRef.current.releaseLease(principalId, messageId, leaseOwnerRef.current).catch(onError);
      const queued = transitionSubmission(submission, 'queued', error);
      const persisted = await persistTransition(queued, ['queued', 'uncertain', 'transmitting']).catch(onError);
      if (persisted && assessRequestOwner(owner, currentOwnerFacts(owner), REQUEST_PHASE.settle).current) {
        mutatePending((current) => current.map((item) => (
          item.key === key && ['queued', 'uncertain', 'transmitting'].includes(item.state) ? queued : item
        )));
      }
      onError(error);
      diagnostic('warn', 'submission.transition_persist_failed', { channelId, messageId, phase: 'transmitting', error });
      return;
    }
    if (!persistPhase.started || !persistPhase.value || !persistPhase.current) {
      if (renewLease != null) globalThis.clearInterval?.(renewLease);
      transmittingRef.current.delete(key);
      await outboxRef.current.releaseLease(principalId, messageId, leaseOwnerRef.current).catch(onError);
      if (persistPhase.invalidation) await stopInvalidAttempt(persistPhase.invalidation, transmitting);
      return;
    }
    if (currentIdentity()) mutatePending((current) => current.map((item) => (
      item.key === key && ['queued', 'uncertain', 'transmitting'].includes(item.state) ? transmitting : item
    )));
    diagnostic('debug', 'submission.transmit_started', { channelId, messageId, openEpoch: openEpochRef.current });
    rosterRef.current?.recordSubmission(channelId, messageId);
    const settleCurrent = () => assessRequestOwner(
      owner,
      currentOwnerFacts(owner),
      REQUEST_PHASE.settle,
    ).current;
    try {
      const submitPhase = await executeOwnedPhase({
        owner,
        current: () => currentOwnerFacts(owner),
        phase: REQUEST_PHASE.submit,
        effect: () => owner.transport.submit(transmitting.frame),
      });
      if (!submitPhase.started) {
        await stopInvalidAttempt(submitPhase.invalidation, transmitting);
        return;
      }
      const receipt = submitPhase.value;
      if (receipt.message_id !== messageId) throw new Error(`协议异常：回执消息编号 ${receipt.message_id} 与客户端编号 ${messageId} 不一致`);
      diagnostic('debug', 'submission.receipt_accepted', { channelId, messageId, openEpoch: openEpochRef.current });
      const state = settleCurrent() ? stateFor(channelId) : null;
      const landedEnvelope = state?._envelopesById?.get?.(messageId)
        || [...(state?.rows?.values?.() || [])].find((envelope) => envelope.id === messageId);
      if (landedEnvelope) {
        if (settleCurrent()) {
          const learnedSelf = rosterRef.current?.observeFeed(channelId, landedEnvelope);
          if (learnedSelf) reconcileIdentity(channelId, learnedSelf);
        }
        if (settleCurrent()) mutatePending((current) => current.filter((item) => item.key !== key));
        await outboxRef.current.remove(principalId, messageId, ['transmitting', 'accepted', 'delayed', 'uncertain']);
        if (settleCurrent()) {
          onFeedChanged();
          onAccessChanged();
        }
        return;
      }
      const accepted = transitionSubmission(transmitting, 'accepted');
      try {
        const persisted = await persistTransition(accepted, ['transmitting']);
        if (!persisted) return;
        if (settleCurrent()) mutatePending((current) => current.map((item) => (
          item.key === key && item.state === 'transmitting' ? accepted : item
        )));
      } catch (error) {
        const uncertain = transitionSubmission(transmitting, 'uncertain', {
          code: 'local_persistence',
          detail: '回执已收到，本机发送状态保存失败，需通过账本确认',
        });
        const persisted = await persistTransition(uncertain, ['transmitting']).catch(() => null);
        if (persisted && settleCurrent()) mutatePending((current) => current.map((item) => (
          item.key === key && item.state === 'transmitting' ? uncertain : item
        )));
        onError(error);
        diagnostic('warn', 'submission.transition_persist_failed', { channelId, messageId, phase: 'accepted', error });
        return;
      }
      if (!settleCurrent()) return;
      const timer = setTimeout(() => {
        mutatePending((current) => current.map((item) => {
          if (item.key !== key || item.state !== 'accepted') return item;
          const delayed = transitionSubmission(item, 'delayed');
          void persistTransition(delayed, ['accepted']).catch(onError);
          return delayed;
        }));
      }, 10_000);
      timersRef.current.set(key, timer);
    } catch (error) {
      const continuationCurrent = assessRequestOwner(
        owner,
        currentOwnerFacts(owner),
        REQUEST_PHASE.submit,
      ).current;
      const state = settleCurrent() ? stateFor(channelId) : null;
      const landedEnvelope = state?._envelopesById?.get?.(messageId);
      if (isUncertainWireError(error) && landedEnvelope && settleCurrent()) {
        const learnedSelf = rosterRef.current?.observeFeed(channelId, landedEnvelope);
        if (learnedSelf) reconcileIdentity(channelId, learnedSelf);
        await outboxRef.current.remove(principalId, messageId, ['queued', 'transmitting', 'accepted', 'delayed', 'uncertain']);
        if (settleCurrent()) {
          mutatePending((current) => current.filter((item) => item.key !== key || item.messageId !== messageId || item.channelId !== channelId));
          onFeedChanged();
          onAccessChanged();
        }
        return;
      }
      const retryableUnavailable = ['unavailable', 'channel_unavailable'].includes(error?.code);
      if (continuationCurrent && error?.code === 'forbidden') {
        accessRef.current?.forbidden(channelId);
        rosterRef.current?.clearSelf(channelId);
      } else if (continuationCurrent && error?.code === 'channel_not_found') {
        accessRef.current?.retire?.(channelId, error.code);
      } else if (continuationCurrent && retryableUnavailable) {
        accessRef.current?.unavailable(channelId, error.code);
      }
      if (retryableUnavailable) {
        const queued = transitionSubmission(transmitting, 'queued', error);
        const persisted = await persistTransition(queued, ['transmitting']).catch(onError);
        if (persisted && settleCurrent()) {
          rosterRef.current?.forgetSubmission?.(channelId, messageId);
          mutatePending((current) => current.map((item) => (
            item.key === key && item.state === 'transmitting' ? queued : item
          )));
          onNotice('频道暂不可用，消息已保存在本机；服务恢复后将自动发送。');
        }
        diagnostic('info', 'submission.transmit_deferred', {
          channelId,
          messageId,
          code: error?.code || 'unavailable',
          openEpoch: openEpochRef.current,
        });
        if (continuationCurrent && settleCurrent()) onAccessChanged();
        return;
      }
      const uncertain = isUncertainWireError(error);
      if (!uncertain && settleCurrent()) rosterRef.current?.forgetSubmission?.(channelId, messageId);
      if (uncertain && settleCurrent()) onNotice('发送结果待确认，正在通过重连账本核对。');
      const failed = transitionSubmission(transmitting, uncertain ? 'uncertain' : 'rejected', error);
      const persisted = await persistTransition(failed, ['transmitting']).catch(onError);
      if (persisted && settleCurrent()) mutatePending((current) => current.map((item) => (
        item.key === key && item.state === 'transmitting' ? failed : item
      )));
      diagnostic(uncertain ? 'info' : 'warn', uncertain ? 'submission.transmit_uncertain' : 'submission.transmit_rejected', {
        channelId,
        messageId,
        code: error?.code || 'unknown',
        openEpoch: openEpochRef.current,
      });
      if (continuationCurrent && settleCurrent()) onAccessChanged();
    } finally {
      if (renewLease != null) globalThis.clearInterval?.(renewLease);
      transmittingRef.current.delete(key);
      try {
        await outboxRef.current.releaseLease(principalId, messageId, leaseOwnerRef.current);
      } catch (error) {
        onError(error);
      }
    }
  }, [accessRef, currentOwnerFacts, mutatePending, onAccessChanged, onError, onFeedChanged, onNotice, ownerForSubmission, persistTransition, principalId, reconcileIdentity, rosterRef, stateFor, wireRef, wireState]);

  const send = useCallback(async (request) => {
    const requests = request?.batch?.length ? request.batch : [request];
    const channelId = request?.channelId || requests[0]?.channelId || activeChannelId;
    if (!channelId) return request?.batch ? [] : '';
    if (!principalId) throw new Error('当前身份尚未建立，无法持久保存发送');
    const requestedChannels = new Set(requests.map((item) => item.channelId || channelId));
    if ([...requestedChannels].some((id) => !canDurablyOwnChannel(id))) {
      throw new Error('当前身份没有已确认的频道成员权限，无法保存到发送队列');
    }
    let owners = [...requestedChannels].map((id) => requestOwner(id));
    const acquirePhase = await executeOwnedGroupPhase({
      owners,
      current: currentOwnerFacts,
      phase: REQUEST_PHASE.acquire,
      options: { requireTransport: false },
      effect: async () => {
        await hydratePrincipal();
        await writeTailRef.current.catch(() => {});
        if (hydratedPrincipalRef.current !== principalId) throw new Error('当前身份的发送队列尚未就绪');
      },
    });
    if (!acquirePhase.started || !acquirePhase.current) throw requestAccessError(acquirePhase.invalidation);
    owners = [...requestedChannels].map((id) => requestOwner(id, id === channelId ? {
      revision: Number(request?.draftRevision || 0),
      editorRevision: Number(request?.editorRevision || 0),
    } : null));
    const authorizePersist = () => owners.every((owner) => assessRequestOwner(
      owner,
      currentOwnerFacts(owner),
      REQUEST_PHASE.persist,
      { requireTransport: false },
    ).current);
    const ownerByChannel = new Map(owners.map((owner) => [owner.channelId, owner]));
    const connected = wireStateRef.current === 'open' && Boolean(wireRef.current);
    let submissions = requests.map((item) => {
      const messageId = item.messageId || newId();
      const resolvedChannel = item.channelId || channelId;
      const frame = {
        channel_id: resolvedChannel,
        id: messageId,
        msg_type: item.msgType,
        kind: 'request',
        payload: item.payload || { text: item.text },
        audience: item.audience,
        visibility: 'public',
        ...(item.parentId ? { parent_id: item.parentId } : {}),
        ...(item.expiresAtMs ? { expires_at_ms: item.expiresAtMs } : {}),
      };
      return createSubmission({
        id: messageId,
        channelId: resolvedChannel,
        text: item.text,
        targetLabel: item.targetLabel,
        frame,
        state: 'queued',
        authority: submissionAuthority(ownerByChannel.get(resolvedChannel)),
      });
    });
    if (request?.draftRevision != null) {
      const result = await outboxRef.current.acceptDraft({
        principalId,
        channelId,
        expectedRevision: request.draftRevision,
        editorRevision: request.editorRevision,
        submissions,
        authorize: authorizePersist,
      });
      if (!result.accepted) throw new Error('草稿在发送前已被其他页面修改，请确认内容后重试');
      submissions = result.submissions || submissions;
      if (result.record && authorizePersist()) {
        persistedDraftRevisionRef.current.set(channelId, result.record.revision);
      }
      const current = projectionRef.current.drafts.get(channelId);
      if (result.consumed && Number(current?.editorRevision || 0) === Number(request.editorRevision || 0)) {
        publishDraft(channelId, result.record, authorizePersist);
      }
    } else {
      submissions = await outboxRef.current.putMany(principalId, submissions, { authorize: authorizePersist });
    }
    const ids = new Set(submissions.map((item) => item.messageId));
    if (committedPrincipalRef.current !== principalId || hydratedPrincipalRef.current !== principalId) return request?.batch ? [] : '';
    const published = publishTransaction((current) => ({
      ...current,
      pending: [...current.pending.filter((item) => !ids.has(item.messageId)), ...submissions],
    }), authorizePersist);
    if (!published) return request?.batch ? [] : '';
    diagnostic('debug', 'submission.outbox_accepted', {
      channelId,
      messageIds: submissions.map((item) => item.messageId),
      count: submissions.length,
      connected,
    });
    if (connected) for (const submission of submissions) void transmit(submission);
    const messageIds = submissions.map((item) => item.messageId);
    return request?.batch ? messageIds : messageIds[0];
  }, [activeChannelId, canDurablyOwnChannel, currentOwnerFacts, hydratePrincipal, principalId, publishDraft, publishTransaction, requestOwner, submissionAuthority, transmit, wireRef]);

  const sendDurableControl = useCallback((request, requestedMessageId = '') => {
    const messageId = requestedMessageId || newId();
    let obligation = durableControlObligationsRef.current.get(messageId);
    if (!obligation) {
      obligation = { messageId, principalId, request, inFlight: null, retryTimer: null };
      durableControlObligationsRef.current.set(messageId, obligation);
    }
    const run = () => {
      if (obligation.inFlight) return obligation.inFlight;
      if (committedPrincipalRef.current !== obligation.principalId) {
        durableControlObligationsRef.current.delete(messageId);
        const error = new Error('控制请求的登录身份已变化');
        error.code = 'identity_changed';
        return Promise.reject(error);
      }
      const attempt = send({ ...obligation.request, messageId }).then((acceptedId) => {
        if (!acceptedId) throw new Error('控制请求未进入持久发送队列');
        if (obligation.retryTimer != null) clearTimeout(obligation.retryTimer);
        durableControlObligationsRef.current.delete(messageId);
        return acceptedId;
      }).catch((error) => {
        const access = accessRef.current?.state?.(obligation.request.channelId);
        if (durableControlObligationsRef.current.get(messageId) === obligation
          && wireStateRef.current === 'open'
          && access?.relationship === 'member'
          && access?.existence !== 'retired'
          && obligation.retryTimer == null) {
          obligation.retryTimer = setTimeout(() => {
            obligation.retryTimer = null;
            void run().catch((retryError) => {
              diagnostic('warn', 'submission.durable_control_retry_failed', {
                channelId: obligation.request.channelId,
                messageId,
                error: retryError,
              });
            });
          }, 2_000);
        }
        throw error;
      }).finally(() => {
        if (obligation.inFlight === attempt) obligation.inFlight = null;
      });
      obligation.inFlight = attempt;
      return attempt;
    };
    obligation.run = run;
    return run();
  }, [accessRef, principalId, send]);

  useEffect(() => {
    if (wireState !== 'open') return;
    for (const obligation of durableControlObligationsRef.current.values()) {
      if (obligation.inFlight) continue;
      const access = accessRef.current?.state?.(obligation.request.channelId);
      if (access?.relationship !== 'member' || access?.existence === 'retired') continue;
      void obligation.run?.().catch((error) => {
        diagnostic('warn', 'submission.durable_control_retry_failed', {
          channelId: obligation.request.channelId,
          messageId: obligation.messageId,
          error,
        });
      });
    }
  }, [accessRef, accessVersion, wireState]);

  useEffect(() => {
    const opened = wireState === 'open' && previousWireStateRef.current !== 'open';
    previousWireStateRef.current = wireState;
    if (opened) openEpochRef.current += 1;
    const liveKeys = new Set(pending.map((submission) => submission.key));
    for (const key of attemptedOpenEpochRef.current.keys()) {
      if (!liveKeys.has(key)) attemptedOpenEpochRef.current.delete(key);
    }
    const rejectedQueued = pending.flatMap((submission) => {
      if (submission.state !== 'queued') return [];
      const error = queuedAccessRejection(accessRef.current?.state?.(submission.channelId));
      if (!error) return [];
      return [{ current: submission, next: transitionSubmission(submission, 'rejected', error) }];
    });
    if (rejectedQueued.length) {
      const byKey = new Map(rejectedQueued.map((entry) => [entry.current.key, entry.next]));
      mutatePending((current) => current.map((item) => (
        item.state === 'queued' && byKey.has(item.key) ? byKey.get(item.key) : item
      )));
      for (const { current, next } of rejectedQueued) {
        rosterRef.current?.forgetSubmission?.(current.channelId, current.messageId);
        void persistTransition(next, ['queued']).catch(onError);
        diagnostic('warn', 'submission.queued_access_rejected', {
          channelId: current.channelId,
          messageId: current.messageId,
          code: next.error?.code || 'forbidden',
        });
      }
      return;
    }
    if (wireState !== 'open' || !wireRef.current) return;
    for (const submission of pending) {
      if (submission.state === 'queued') {
        void transmit(submission);
        continue;
      }
      if (submission.state === 'uncertain'
        && Number(attemptedOpenEpochRef.current.get(submission.key) ?? -1) < openEpochRef.current) {
        void transmit(submission);
      }
    }
  }, [accessRef, accessVersion, mutatePending, onError, pending, persistTransition, rosterRef, transmit, wireRef, wireState]);

  const retry = useCallback(async (submission) => {
    const owner = requestOwner(submission.channelId);
    const authority = assessRequestOwner(owner, currentOwnerFacts(owner), REQUEST_PHASE.persist);
    if (!authority.current) return false;
    const next = {
      ...transitionSubmission(submission, 'retry'),
      authority: submissionAuthority(owner),
    };
    if (next === submission) return false;
    const timer = timersRef.current.get(submission.key);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(submission.key);
    diagnostic('info', 'submission.retry_requested', {
      channelId: submission.channelId,
      messageId: submission.messageId,
      previousState: submission.state,
    });
    const persisted = await persistTransition(next, ['uncertain', 'rejected'], {
      authorize: () => assessRequestOwner(
        owner,
        currentOwnerFacts(owner),
        REQUEST_PHASE.persist,
      ).current,
    });
    if (!persisted) return false;
    mutatePending((current) => current.map((item) => (
      item.key === next.key && ['uncertain', 'rejected'].includes(item.state) ? next : item
    )));
    await transmit(next);
    return true;
  }, [currentOwnerFacts, mutatePending, persistTransition, requestOwner, submissionAuthority, transmit]);

  const resolve = useCallback(async (channelId, reqId, decision, payload) => {
    setApprovalStates((current) => ({ ...current, [reqId]: 'sending' }));
    const owner = requestOwner(channelId);
    try {
      const frame = { channel_id: channelId, req_id: reqId };
      if (decision) frame.decision = decision;
      if (typeof payload?.text === 'string') frame.text = payload.text;
      if (typeof payload?.note === 'string' && payload.note) frame.note = payload.note;
      const phase = await executeOwnedPhase({
        owner,
        current: () => currentOwnerFacts(owner),
        phase: REQUEST_PHASE.submit,
        effect: () => owner.transport.resolve(frame),
      });
      if (!phase.started) throw requestAccessError(phase.invalidation);
      const settled = assessRequestOwner(owner, currentOwnerFacts(owner), REQUEST_PHASE.settle);
      if (settled.current) setApprovalStates((current) => ({ ...current, [reqId]: 'resolved' }));
    } catch (error) {
      const settled = assessRequestOwner(owner, currentOwnerFacts(owner), REQUEST_PHASE.settle);
      if (settled.current) setApprovalStates((current) => ({ ...current, [reqId]: { error } }));
      onAccessChanged();
    }
  }, [currentOwnerFacts, onAccessChanged, requestOwner]);

  const cancel = useCallback(async (channelId, reqId) => {
    const key = `${channelId}:${reqId}:cancel`;
    setControlStates((current) => ({ ...current, [key]: createControlState('sending') }));
    const owner = requestOwner(channelId);
    try {
      const phase = await executeOwnedPhase({
        owner,
        current: () => currentOwnerFacts(owner),
        phase: REQUEST_PHASE.submit,
        effect: () => owner.transport.cancel({ channel_id: channelId, req_id: reqId }),
      });
      if (!phase.started) throw requestAccessError(phase.invalidation);
      const settled = assessRequestOwner(owner, currentOwnerFacts(owner), REQUEST_PHASE.settle);
      if (!settled.current) return;
      const terminal = stateFor(channelId)?.turns.get(reqId)?.terminal;
      setControlStates((current) => {
        if (!terminal) return { ...current, [key]: createControlState('accepted') };
        const next = { ...current }; delete next[key]; return next;
      });
    } catch (error) {
      const settled = assessRequestOwner(owner, currentOwnerFacts(owner), REQUEST_PHASE.settle);
      if (!settled.current) return;
      const uncertain = isUncertainWireError(error);
      setControlStates((current) => ({ ...current, [key]: createControlState(uncertain ? 'uncertain' : 'error', error) }));
      onAccessChanged();
    }
  }, [currentOwnerFacts, onAccessChanged, requestOwner, stateFor]);

  const reconcileFeed = useCallback((landedMessageIds, closedRequestIds) => {
    if (committedPrincipalRef.current !== principalId) return;
    if (landedMessageIds.size) {
      const landedForPrincipal = landedMessageIdsRef.current;
      const hydrating = hydratedPrincipalRef.current !== principalId;
      const pendingMessageIds = new Set(projectionRef.current.pending.map((item) => item.messageId));
      for (const messageId of landedMessageIds) {
        if (hydrating || pendingMessageIds.has(messageId)) landedMessageIdsRef.current.add(messageId);
      }
      const landed = projectionRef.current.pending.filter((item) => (
        item.messageId
        && landedMessageIds.has(item.messageId)
        && !reconciledLandedMessageIdsRef.current.has(item.messageId)
      ));
      if (landed.length) {
        for (const item of landed) reconciledLandedMessageIdsRef.current.add(item.messageId);
        if (landed.some((item) => item.state === 'uncertain')) onNotice('此前发送结果待确认，现已通过频道账本确认。');
        for (const item of landed) {
          const timer = timersRef.current.get(item.key);
          if (timer) clearTimeout(timer);
          timersRef.current.delete(item.key);
          void enqueueWrite(() => outboxRef.current.remove(principalId, item.messageId))
            .catch(onError)
            .finally(() => landedForPrincipal.delete(item.messageId));
        }
        diagnostic('debug', 'submission.feed_landed', {
          messageIds: landed.map((item) => item.messageId),
          previousStates: landed.map((item) => item.state),
        });
      }
      mutatePending((current) => reconcileLanded(current, landedMessageIds));
    }
    if (closedRequestIds.size) setControlStates((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !closedRequestIds.has(key))));
  }, [enqueueWrite, mutatePending, onError, onNotice, principalId]);

  return {
    pending,
    drafts,
    draftFor: (channelId) => {
      const record = drafts.get(channelId);
      return record?.draft ? { ...record.draft, editorRevision: record.editorRevision } : emptyDraft();
    },
    updateDraft,
    persistDraftAttachments,
    approvalStates,
    controlStates,
    send,
    sendDurableControl,
    retry,
    resolve,
    cancel,
    reconcileFeed,
    clear,
    resetWorld,
  };
}
