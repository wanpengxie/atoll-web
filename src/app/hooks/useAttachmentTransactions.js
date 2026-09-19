import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { availableDefaultStorageDeviceId } from '../../model/channel-files.js';
import { availableUploadName, uploadChannelFile } from '../../model/channel-file-transfer.js';
import { diagnostic } from '../../model/diagnostics.js';
import {
  assessRequestOwner,
  captureRequestOwner,
  executeOwnedPhase,
  REQUEST_PHASE,
  requestAccessError,
} from '../../model/request-owner.js';
import { newId } from '../../util/id.js';

const WORLD_FIELD = '_atoll_world_epoch';

export function useAttachmentTransactions({
  activeChannel,
  activeChannelId,
  activeChannelRef,
  accessRef,
  channelDevices,
  committedOwnerRef,
  deviceActionsRef,
  directoryVersion,
  draftFor,
  drafts,
  onNotice,
  onOpenDynamic,
  onResource,
  persistDraftAttachments,
  serverWorld,
  serverWorldCommittedRef,
  wireRef,
  wireState,
  wireStateCommittedRef,
}) {
  const [, setRevision] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const ledgerRef = useRef(new Map());
  const draftEpochsRef = useRef(new Map());
  const worldRevisionRef = useRef(0);
  const uploadQueuesRef = useRef(new Map());
  const activeUploadsRef = useRef(new Map());
  const activeFileOperationsRef = useRef(new Map());
  const composerEditRef = useRef(null);

  const abortUploads = useCallback((channelId = '') => {
    for (const [key, active] of activeUploadsRef.current) {
      if (channelId && active.owner.channelId !== channelId) continue;
      active.controller.abort();
      activeUploadsRef.current.delete(key);
    }
  }, []);

  const abortFileOperations = useCallback((channelId = '') => {
    for (const [key, active] of activeFileOperationsRef.current) {
      if (channelId && active.owner.channelId !== channelId) continue;
      active.controller.abort();
      activeFileOperationsRef.current.delete(key);
    }
  }, []);

  const ownerFacts = useCallback((owner) => {
    const committed = committedOwnerRef.current;
    const access = accessRef.current?.state?.(owner.channelId);
    return {
      principalId: committed?.principalId || '',
      principalEpoch: committed?.producerOwnerToken || null,
      channelId: owner.channelId,
      worldEpoch: serverWorldCommittedRef.current,
      attemptEpoch: worldRevisionRef.current,
      access: {
        epoch: Number(access?.authorityEpoch || 0),
        relationship: String(access?.relationship || ''),
        existence: String(access?.existence || ''),
        runtime: String(access?.runtime || ''),
        unavailable: access?.unavailable === true,
      },
      transport: wireRef.current,
      transportEpoch: Number(committed?.generationFor?.(owner.channelId) || 0),
      transportOpen: wireStateCommittedRef.current === 'open' && Boolean(wireRef.current),
      draft: { epoch: Number(draftEpochsRef.current.get(owner.channelId) || 0) },
    };
  }, [accessRef, committedOwnerRef, serverWorldCommittedRef, wireRef, wireStateCommittedRef]);

  const assessFileOperation = useCallback((active, phase, { requireTransport = phase !== REQUEST_PHASE.settle } = {}) => {
    const current = { ...ownerFacts(active.owner), channelId: activeChannelRef.current || '' };
    const base = assessRequestOwner(active.owner, current, phase, {
      requireAccess: false,
      requireTransport,
      requireDraft: active.requireDraft,
    });
    if (!base.current) return base;
    if (active.owner.access.epoch !== Number(current.access?.epoch || 0)) {
      return { current: false, code: 'access_changed', detail: '频道授权事实已变化' };
    }
    const relationship = String(current.access?.relationship || '');
    const allowed = active.access === 'read'
      ? relationship === 'member' || relationship === 'observer'
      : relationship === 'member';
    if (!allowed) return { current: false, code: 'forbidden', detail: '当前频道权限不允许这项文件操作' };
    if (current.access?.existence === 'retired') return { current: false, code: 'channel_not_found', detail: '频道已退役' };
    if (current.access?.unavailable || current.access?.runtime === 'closed') {
      return { current: false, code: 'channel_unavailable', detail: '频道暂不可用' };
    }
    return base;
  }, [activeChannelRef, ownerFacts]);

  const runFileOperation = useCallback(async ({ channelId, access = 'read', requireDraft = false, signal: externalSignal } = {}, effect) => {
    if (!channelId || typeof effect !== 'function') throw new TypeError('文件操作上下文不完整');
    const committed = committedOwnerRef.current;
    if (!committed?.producerOwnerToken) throw new TypeError('文件操作会话尚未提交');
    const owner = captureRequestOwner({
      principalId: committed.principalId,
      principalEpoch: committed.producerOwnerToken,
      channelId,
      worldEpoch: serverWorldCommittedRef.current,
      attemptEpoch: worldRevisionRef.current,
      accessState: accessRef.current?.state?.(channelId),
      transport: wireRef.current,
      transportEpoch: Number(committed.generationFor?.(channelId) || 0),
      draft: { epoch: Number(draftEpochsRef.current.get(channelId) || 0) },
    });
    const controller = new AbortController();
    const operationKey = `${channelId}:${newId()}`;
    const active = { owner, controller, access, requireDraft };
    activeFileOperationsRef.current.set(operationKey, active);
    const abortFromCaller = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener?.('abort', abortFromCaller, { once: true });
    const authorize = (phase = REQUEST_PHASE.submit, options = {}) => {
      const assessment = assessFileOperation(active, phase, options);
      if (!assessment.current) throw requestAccessError(assessment);
      if (controller.signal.aborted) throw new DOMException('文件操作已取消', 'AbortError');
      return true;
    };
    const ownedAwait = async (phase, work, options) => {
      authorize(phase, options);
      const value = await work();
      authorize(phase, options);
      return value;
    };
    try {
      authorize(REQUEST_PHASE.acquire);
      const value = await effect(Object.freeze({
        owner,
        signal: controller.signal,
        authorize,
        resource: (payload) => ownedAwait(REQUEST_PHASE.submit, () => onResource(payload)),
        fetch: (input, init = {}) => ownedAwait(
          REQUEST_PHASE.submit,
          () => fetch(input, { ...init, signal: controller.signal }),
          { requireTransport: false },
        ),
        persist: (work) => ownedAwait(REQUEST_PHASE.persist, work, { requireTransport: false }),
      }));
      authorize(REQUEST_PHASE.settle, { requireTransport: false });
      return value;
    } finally {
      externalSignal?.removeEventListener?.('abort', abortFromCaller);
      if (activeFileOperationsRef.current.get(operationKey) === active) activeFileOperationsRef.current.delete(operationKey);
    }
  }, [accessRef, assessFileOperation, committedOwnerRef, onResource, serverWorldCommittedRef, wireRef]);

  useEffect(() => {
    for (const [key, active] of activeUploadsRef.current) {
      const assessment = assessRequestOwner(active.owner, ownerFacts(active.owner), REQUEST_PHASE.submit, { requireDraft: true });
      if (assessment.current) continue;
      active.controller.abort();
      activeUploadsRef.current.delete(key);
    }
  }, [directoryVersion, ownerFacts, serverWorld, wireState]);

  useEffect(() => {
    for (const [key, active] of activeFileOperationsRef.current) {
      const assessment = assessFileOperation(active, REQUEST_PHASE.submit, { requireTransport: false });
      if (assessment.current) continue;
      active.controller.abort();
      activeFileOperationsRef.current.delete(key);
    }
  }, [activeChannelId, assessFileOperation, directoryVersion, serverWorld, wireState]);

  const inCurrentWorld = useCallback((rows, worldEpoch = serverWorldCommittedRef.current) => {
    // A server that does not publish a boot id has no world boundary to
    // compare against. In that supported mode the committed draft ledger is
    // authoritative as-is; treating the missing boundary as a mismatch drops
    // both existing names and the result of an upload captured for that same
    // channel. Once a boot id exists, keep the strict epoch fence.
    if (!worldEpoch) return rows || [];
    return (rows || []).filter((row) => row?.[WORLD_FIELD] === worldEpoch);
  }, [serverWorldCommittedRef]);
  const stripWorld = useCallback((row) => {
    const { [WORLD_FIELD]: _worldEpoch, ...attachment } = row;
    return attachment;
  }, []);
  const tagForCurrentWorld = useCallback((rows) => (rows || []).map((row) => ({
    ...row,
    [WORLD_FIELD]: serverWorldCommittedRef.current,
  })), [serverWorldCommittedRef]);
  const currentDraftAttachments = useCallback((channelId, readDraft = draftFor) => inCurrentWorld(
    ledgerRef.current.has(channelId)
      ? ledgerRef.current.get(channelId)
      : (readDraft(channelId).attachments || []),
  ), [draftFor, inCurrentWorld]);

  const activeDraftRecord = drafts.get(activeChannelId);
  const activeDurableDraft = activeDraftRecord?.draft || activeDraftRecord;
  const activeRows = ledgerRef.current.has(activeChannelId)
    ? ledgerRef.current.get(activeChannelId)
    : (activeDurableDraft?.attachments || []);
  const composerAttachments = useMemo(
    () => inCurrentWorld(activeRows, serverWorld).map(stripWorld),
    [activeRows, inCurrentWorld, serverWorld, stripWorld],
  );
  const composerDraft = useMemo(() => {
    const draft = draftFor(activeChannelId);
    return { ...draft, attachments: inCurrentWorld(draft.attachments, serverWorld).map(stripWorld) };
  }, [activeChannelId, activeDraftRecord, draftFor, inCurrentWorld, serverWorld, stripWorld]);

  const commit = useCallback((channelId, rows) => {
    const nextRows = inCurrentWorld(rows);
    ledgerRef.current.set(channelId, nextRows);
    setRevision((current) => current + 1);
    return nextRows;
  }, [inCurrentWorld]);
  const mutate = useCallback((channelId, mutateRows, readDraft = draftFor) => (
    commit(channelId, mutateRows([...currentDraftAttachments(channelId, readDraft)]))
  ), [commit, currentDraftAttachments, draftFor]);
  const clear = useCallback((channelId) => {
    abortUploads(channelId);
    draftEpochsRef.current.set(channelId, Number(draftEpochsRef.current.get(channelId) || 0) + 1);
    return commit(channelId, []);
  }, [abortUploads, commit]);

  const publishComposerEdit = useCallback((value) => {
    const entering = Boolean(value) && !composerEditRef.current;
    composerEditRef.current = value;
    if (!entering) return;
    const channelId = activeChannelRef.current;
    if (channelId) {
      abortUploads(channelId);
      draftEpochsRef.current.set(channelId, Number(draftEpochsRef.current.get(channelId) || 0) + 1);
    }
    setPickerOpen(false);
  }, [abortUploads, activeChannelRef]);

  const attach = useCallback(async (attachment, requestedChannelId = activeChannelRef.current) => {
    const channelId = String(requestedChannelId || '');
    if (composerEditRef.current) throw new TypeError('编辑已有消息时不能附加频道文件；请先完成或取消编辑');
    const capturedDraftRevision = Number(drafts.get(channelId)?.revision || 0);
    return runFileOperation({ channelId, access: 'write', requireDraft: true }, async (operation) => {
      const tagged = { ...attachment, [WORLD_FIELD]: operation.owner.worldEpoch };
      const record = await operation.persist(() => persistDraftAttachments(channelId, [tagged], {
        expectedRevision: capturedDraftRevision,
        authorize: () => operation.authorize(REQUEST_PHASE.persist, { requireTransport: false }),
      }));
      operation.authorize(REQUEST_PHASE.persist, { requireTransport: false });
      commit(channelId, record?.draft?.attachments || []);
      if (activeChannelRef.current === channelId) onOpenDynamic();
      return stripWorld(tagged);
    });
  }, [activeChannelRef, commit, drafts, onOpenDynamic, persistDraftAttachments, runFileOperation, stripWorld]);

  const upload = useCallback(async (files) => {
    if (composerEditRef.current) throw new TypeError('编辑已有消息时不能上传普通草稿附件；请先完成或取消编辑');
    const channel = activeChannel;
    if (!channel?.id) throw new TypeError('请先选择频道');
    const committed = committedOwnerRef.current;
    if (!committed?.producerOwnerToken) throw new TypeError('上传会话尚未提交');
    const owner = captureRequestOwner({
      principalId: committed.principalId,
      principalEpoch: committed.producerOwnerToken,
      channelId: channel.id,
      worldEpoch: serverWorldCommittedRef.current,
      attemptEpoch: worldRevisionRef.current,
      accessState: accessRef.current?.state?.(channel.id),
      transport: wireRef.current,
      transportEpoch: Number(committed.generationFor?.(channel.id) || 0),
      draft: { epoch: Number(draftEpochsRef.current.get(channel.id) || 0) },
    });
    const capturedDraftRevision = Number(drafts.get(channel.id)?.revision || 0);
    const assessUpload = (phase, options = {}) => assessRequestOwner(
      owner,
      ownerFacts(owner),
      phase,
      { requireDraft: true, ...options },
    );
    const previous = uploadQueuesRef.current.get(channel.id) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const acquire = await executeOwnedPhase({
        owner,
        current: () => ownerFacts(owner),
        phase: REQUEST_PHASE.acquire,
        options: { requireDraft: true },
        effect: () => channelDevices.length
          ? channelDevices
          : deviceActionsRef.current.refresh?.(channel.id),
      });
      if (!acquire.started || !acquire.current) throw requestAccessError(acquire.invalidation);
      const devices = acquire.value || [];
      const daemonId = availableDefaultStorageDeviceId(channel, devices);
      const daemon = devices.find((row) => row.id === daemonId);
      if (!daemon) throw new TypeError('频道没有可用的默认文件存储设备');
      if (daemon.online === false) throw new TypeError(`频道默认文件存储设备 ${daemon.name || daemon.id} 当前离线`);
      const uploaded = [];
      let uploadFailure = null;
      const occupiedNames = new Set(currentDraftAttachments(channel.id).map((row) => row.name));
      try {
        for (const file of files) {
          const uploadName = availableUploadName(file.name, occupiedNames);
          occupiedNames.add(uploadName);
          const controller = new AbortController();
          const uploadKey = `${channel.id}:${newId()}`;
          activeUploadsRef.current.set(uploadKey, { owner, controller });
          try {
            const submitted = await executeOwnedPhase({
              owner,
              current: () => ownerFacts(owner),
              phase: REQUEST_PHASE.submit,
              options: { requireDraft: true },
              effect: () => uploadChannelFile({
                file,
                channel,
                deviceName: daemon.name,
                uploadName,
                onResource,
                signal: controller.signal,
                authorize: (phase) => {
                  const assessment = assessUpload(phase === 'settle' ? REQUEST_PHASE.submit : phase);
                  if (!assessment.current) throw requestAccessError(assessment);
                },
              }),
            });
            if (submitted.started && submitted.value) uploaded.push({ ...submitted.value, [WORLD_FIELD]: owner.worldEpoch });
            if (!submitted.started || !submitted.current) throw requestAccessError(submitted.invalidation);
          } finally {
            activeUploadsRef.current.delete(uploadKey);
          }
        }
      } catch (error) {
        if (error.completedAttachment && !uploaded.some((row) => row.resource_id === error.completedAttachment.resource_id)) {
          uploaded.push({ ...error.completedAttachment, [WORLD_FIELD]: owner.worldEpoch });
        }
        uploadFailure = error;
      }
      if (uploaded.length) {
        const authorizeAssociation = () => assessUpload(REQUEST_PHASE.persist, { requireTransport: false }).current;
        try {
          const record = await persistDraftAttachments(channel.id, uploaded, {
            expectedRevision: capturedDraftRevision,
            authorize: authorizeAssociation,
          });
          if (!authorizeAssociation()) {
            const stale = new Error('草稿在附件关联完成前已变化');
            stale.code = 'attachment_unassociated';
            throw stale;
          }
          commit(channel.id, record?.draft?.attachments || []);
        } catch (error) {
          error.code ||= 'attachment_unassociated';
          error.attachments = uploaded.map(stripWorld);
          const detail = `${error.message || '附件关联失败'}；已上传但未关联的资源：${uploaded.map((row) => row.resource_id).join('、')}`;
          error.detail = detail;
          error.message = detail;
          diagnostic('warn', 'attachment.resources_unassociated', { channelId: channel.id, resources: uploaded.map((row) => row.resource_id), error });
          const invalidation = assessUpload(REQUEST_PHASE.persist, { requireTransport: false });
          if (!invalidation.current) {
            if (invalidation.code !== 'identity_changed') onNotice(detail);
            return [];
          }
          throw error;
        }
      }
      if (uploadFailure) {
        uploadFailure.attachments = uploaded.map(stripWorld);
        throw uploadFailure;
      }
      return uploaded.map(stripWorld);
    });
    uploadQueuesRef.current.set(channel.id, task);
    try {
      return await task;
    } finally {
      if (uploadQueuesRef.current.get(channel.id) === task) uploadQueuesRef.current.delete(channel.id);
    }
  }, [accessRef, activeChannel, channelDevices, commit, committedOwnerRef, currentDraftAttachments, deviceActionsRef, drafts, onNotice, onResource, ownerFacts, persistDraftAttachments, serverWorldCommittedRef, stripWorld, wireRef]);

  const reset = useCallback(() => {
    worldRevisionRef.current += 1;
    abortUploads();
    abortFileOperations();
    draftEpochsRef.current.clear();
    ledgerRef.current.clear();
    uploadQueuesRef.current.clear();
    composerEditRef.current = null;
    setPickerOpen(false);
    setRevision((current) => current + 1);
  }, [abortFileOperations, abortUploads]);

  const abortChannel = useCallback((channelId) => {
    abortUploads(channelId);
    abortFileOperations(channelId);
  }, [abortFileOperations, abortUploads]);

  return {
    abortChannel,
    attach,
    clear,
    composerAttachments,
    composerDraft,
    mutate,
    pickerOpen,
    publishComposerEdit,
    reset,
    resource: onResource,
    runFileOperation,
    setPickerOpen,
    tagForCurrentWorld,
    upload,
  };
}
