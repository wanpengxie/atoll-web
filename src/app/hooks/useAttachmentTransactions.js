import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { diagnostic } from '../../model/diagnostics.js';
import { normalizeFeatureDirectory } from '../../model/feature-files.js';
import {
  assessRequestOwner,
  captureRequestOwner,
  executeOwnedPhase,
  REQUEST_PHASE,
  requestAccessError,
} from '../../model/request-owner.js';
import { newId } from '../../util/id.js';

const WORLD_FIELD = '_atoll_world_epoch';

function errorText(error) {
  return error?.detail || error?.message || String(error);
}

function availableDefaultStorageDeviceId(channel, devices) {
  const configured = devices.find((row) => row?.defaultStorage === true)?.id
    || channel?.default_storage_device_id
    || 'local-device';
  return devices.some((row) => row?.id === configured) ? configured : '';
}

function projectChannelDevices(observation) {
  return (observation?.items || []).flatMap((item) => {
    const declared = item?.declared || {};
    const id = declared.device_id || item?.key;
    if (!id) return [];
    const measures = Object.fromEntries((item?.actual?.measures || []).map((row) => [row.name, row.unknown ? undefined : row.value]));
    return [{
      id,
      name: declared.name || declared.device_id || item.key,
      defaultStorage: declared.default_storage === true,
      online: measures.online,
    }];
  });
}

function resourcePrefix(channel, device, directory = '') {
  const channelName = String(channel?.qualified_name || channel?.name || channel?.id || '').replace(/^\/+|\/+$/g, '');
  const deviceName = String(device?.name || '').replace(/^\/+|\/+$/g, '');
  const path = normalizeFeatureDirectory(directory).split('/').filter(Boolean).map(encodeURIComponent).join('/');
  if (!channelName || !deviceName) throw new TypeError('文件挂载上下文不完整');
  return `daemon://${deviceName}/${channelName}/${path ? `${path}/` : ''}`;
}

function projectResourceEntries(items, prefix) {
  return (items || []).flatMap((item) => {
    const resourceId = String(item?.id || item?.resource_id || item?.address || '');
    if (!resourceId.startsWith(prefix)) return [];
    const relative = resourceId.slice(prefix.length);
    if (!relative || relative.includes('/')) return [];
    let name = relative;
    try { name = decodeURIComponent(relative); } catch { /* keep the readable resource segment */ }
    const nodeType = String(item?.meta?.node_type || 'regular');
    const kind = nodeType === 'directory' ? 'directory' : 'file';
    return [{
      key: `${kind}:${resourceId}`,
      kind,
      name,
      resourceId,
      ...(kind === 'directory' ? { directory: `${name}/` } : {}),
      ...(item?.meta?.media_type ? { mediaType: String(item.meta.media_type) } : {}),
      ...(Number.isFinite(Number(item?.meta?.size)) ? { size: Number(item.meta.size) } : {}),
      ...(item?.meta?.modified_at || item?.meta?.mtime || item?.updated_at
        ? { modifiedAt: item.meta?.modified_at || item.meta?.mtime || item.updated_at }
        : {}),
    }];
  });
}

function downloadURL(channelId, ticket) {
  return `/files?channel_id=${encodeURIComponent(channelId)}&t=${encodeURIComponent(ticket)}`;
}

function safeUploadName(name) {
  return String(name || 'upload').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+/, '') || 'upload';
}

function availableUploadName(name, occupiedNames) {
  const original = safeUploadName(name);
  const occupied = new Set([...occupiedNames].map((value) => safeUploadName(value).toLocaleLowerCase()));
  if (!occupied.has(original.toLocaleLowerCase())) return original;
  const dot = original.lastIndexOf('.');
  const stem = dot > 0 ? original.slice(0, dot) : original;
  const extension = dot > 0 ? original.slice(dot) : '';
  let index = 2;
  while (occupied.has(`${stem}-${index}${extension}`.toLocaleLowerCase())) index += 1;
  return `${stem}-${index}${extension}`;
}

function channelFileAddress(channel, deviceName, uploadName, directory = '') {
  const channelName = String(channel?.qualified_name || channel?.name || channel?.id || '').replace(/^\/+|\/+$/g, '');
  const device = String(deviceName || '').replace(/^\/+|\/+$/g, '');
  if (!channelName || !device || !uploadName) throw new TypeError('上传上下文不完整');
  const path = normalizeFeatureDirectory(directory).split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `daemon://${device}/${channelName}/${path ? `${path}/` : ''}${encodeURIComponent(uploadName)}`;
}

async function uploadChannelFile({ file, channel, deviceName, uploadName, directory, onResource, signal, authorize }) {
  authorize?.('acquire');
  const storedName = safeUploadName(uploadName || file?.name);
  const address = channelFileAddress(channel, deviceName, storedName, directory);
  const ticket = await onResource({ channel_id: channel.id, op: 'create', address, with_content: true });
  if (!ticket?.ticket) throw new TypeError('服务端没有返回上传凭据');
  authorize?.('persist');
  authorize?.('submit');
  const response = await fetch(`/files?channel_id=${encodeURIComponent(channel.id)}&t=${encodeURIComponent(ticket.ticket)}`, {
    method: 'PUT',
    credentials: 'include',
    body: file,
    signal,
  });
  if (!response.ok) throw new TypeError(`上传失败 (${response.status})`);
  const attachment = {
    resource_id: String(ticket.resource_id || address),
    address,
    name: uploadName || file.name,
    media_type: file.type || 'application/octet-stream',
    size: Number(file.size || 0),
  };
  try { authorize?.('settle'); } catch (error) { error.completedAttachment = attachment; throw error; }
  return attachment;
}

export function useAttachmentTransactions({
  activeChannel,
  activeChannelId,
  activeChannelRef,
  accessRef,
  obsRef,
  directoryVersion,
  draftFor,
  drafts,
  updateDraft,
  onNotice,
  onOpenDynamic,
  persistDraftAttachments,
  principalId,
  producerOwnerToken,
  generationFor,
  serverWorld,
  wireRef,
  wireState,
}) {
  const [devices, setDevices] = useState([]);
  const [directory, setDirectory] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [entries, setEntries] = useState([]);
  const [filesBusy, setFilesBusy] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState(null);
  const worldRevisionRef = useRef(0);
  const uploadQueuesRef = useRef(new Map());
  const activeUploadsRef = useRef(new Map());
  const activeFileOperationsRef = useRef(new Map());
  const deviceRequestRef = useRef({ generation: 0, request: null });
  const directoryRequestRef = useRef({ generation: 0, request: null });
  const committedOwnerRef = useRef(null);
  const serverWorldCommittedRef = useRef(serverWorld);
  const wireStateCommittedRef = useRef(wireState);
  useLayoutEffect(() => {
    const owner = Object.freeze({ principalId, producerOwnerToken, generationFor });
    committedOwnerRef.current = owner;
    serverWorldCommittedRef.current = serverWorld;
    wireStateCommittedRef.current = wireState;
    return () => {
      if (committedOwnerRef.current === owner) committedOwnerRef.current = null;
    };
  }, [generationFor, principalId, producerOwnerToken, serverWorld, wireState]);
  const sendResource = useCallback((payload) => {
    if (!wireRef.current) throw new TypeError('连接尚未就绪');
    return wireRef.current.resource(payload);
  }, [wireRef]);

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

  const beginRequest = useCallback((requestRef, channelId) => {
    requestRef.current.request?.controller.abort();
    const request = {
      channelId,
      controller: new AbortController(),
      generation: requestRef.current.generation + 1,
    };
    requestRef.current = { generation: request.generation, request };
    return request;
  }, []);

  const finishRequest = useCallback((requestRef, request) => {
    if (requestRef.current.request !== request) return false;
    requestRef.current = { generation: request.generation, request: null };
    return !request.controller.signal.aborted;
  }, []);

  const abortRequest = useCallback((requestRef, channelId = '') => {
    const current = requestRef.current;
    if (channelId && current.request?.channelId !== channelId) return;
    current.request?.controller.abort();
    requestRef.current = { generation: current.generation + 1, request: null };
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
      draft: { editorRevision: Number(drafts.get(owner.channelId)?.editorRevision || 0) },
    };
  }, [accessRef, committedOwnerRef, drafts, serverWorldCommittedRef, wireRef, wireStateCommittedRef]);

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
      draft: { editorRevision: Number(drafts.get(channelId)?.editorRevision || 0) },
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
        resource: (payload) => ownedAwait(REQUEST_PHASE.submit, () => sendResource(payload)),
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
  }, [accessRef, assessFileOperation, committedOwnerRef, drafts, sendResource, serverWorldCommittedRef, wireRef]);

  const refreshDevices = useCallback(async (channelId = activeChannelRef.current) => {
    if (!channelId || !obsRef?.current) return [];
    const request = beginRequest(deviceRequestRef, channelId);
    try {
      const rows = projectChannelDevices(await obsRef.current.channelDevices(channelId));
      if (deviceRequestRef.current.request !== request || request.controller.signal.aborted) return [];
      if (activeChannelRef.current !== channelId) return [];
      setDevices(rows);
      setDeviceId((current) => rows.some((row) => row.id === current)
        ? current
        : availableDefaultStorageDeviceId(activeChannel, rows));
      return rows;
    } catch (error) {
      if (
        deviceRequestRef.current.request === request
        && !request.controller.signal.aborted
        && activeChannelRef.current === channelId
        && error?.status !== 401
      ) setFilesError(errorText(error));
      return [];
    } finally {
      finishRequest(deviceRequestRef, request);
    }
  }, [activeChannel, activeChannelRef, beginRequest, finishRequest, obsRef]);

  const refreshDirectory = useCallback(async ({
    channelId = activeChannelRef.current,
    targetDirectory = directory,
    targetDeviceId = deviceId,
  } = {}) => {
    if (!channelId) return [];
    const request = beginRequest(directoryRequestRef, channelId);
    const channel = channelId === activeChannel?.id ? activeChannel : null;
    const device = devices.find((row) => row.id === targetDeviceId);
    if (!channel || !device) {
      if (directoryRequestRef.current.request === request && activeChannelRef.current === channelId) setEntries([]);
      finishRequest(directoryRequestRef, request);
      return [];
    }
    const normalized = normalizeFeatureDirectory(targetDirectory);
    setFilesBusy(true);
    setFilesError('');
    try {
      const prefix = resourcePrefix(channel, device, normalized);
      const receipt = await runFileOperation({ channelId, access: 'read', signal: request.controller.signal }, (operation) => operation.resource({
        channel_id: channelId,
        op: 'list',
        query: { prefix, limit: 200 },
      }));
      const rows = projectResourceEntries(receipt?.items, prefix);
      if (
        directoryRequestRef.current.request === request
        && !request.controller.signal.aborted
        && activeChannelRef.current === channelId
      ) {
        setDirectory(normalized);
        setDeviceId(targetDeviceId);
        setEntries(rows);
      }
      return rows;
    } catch (error) {
      if (
        directoryRequestRef.current.request === request
        && !request.controller.signal.aborted
        && activeChannelRef.current === channelId
      ) setFilesError(errorText(error));
      return [];
    } finally {
      if (finishRequest(directoryRequestRef, request) && activeChannelRef.current === channelId) setFilesBusy(false);
    }
  }, [activeChannel, activeChannelRef, beginRequest, deviceId, devices, directory, finishRequest, runFileOperation]);

  useEffect(() => {
    abortRequest(deviceRequestRef);
    abortRequest(directoryRequestRef);
    setDevices([]);
    setDeviceId('');
    setDirectory('');
    setEntries([]);
    setFilesBusy(false);
    setSelectedArtifact(null);
    setFilesError('');
    if (!activeChannelId || wireState !== 'open') return;
    void refreshDevices(activeChannelId);
  }, [abortRequest, activeChannelId, refreshDevices, serverWorld, wireState]);

  useEffect(() => {
    if (!activeChannelId || !deviceId || wireState !== 'open') return;
    void refreshDirectory({ channelId: activeChannelId, targetDirectory: directory, targetDeviceId: deviceId });
  }, [activeChannelId, deviceId, directory, refreshDirectory, wireState]);

  const navigateFiles = useCallback((value) => setDirectory(normalizeFeatureDirectory(value)), []);
  const selectDevice = useCallback((value) => {
    setDeviceId(String(value || ''));
    setDirectory('');
  }, []);
  const createDirectory = useCallback(async ({ name, directory: requestedDirectory = directory, deviceId: requestedDeviceId = deviceId }) => {
    const channel = activeChannel;
    const device = devices.find((row) => row.id === requestedDeviceId);
    const safeName = safeUploadName(name);
    if (!channel?.id || !device || safeName !== String(name || '').trim()) throw new TypeError('文件夹名称无效');
    const address = `${resourcePrefix(channel, device, requestedDirectory)}${encodeURIComponent(safeName)}`;
    await runFileOperation({ channelId: channel.id, access: 'write' }, (operation) => operation.resource({ channel_id: channel.id, op: 'create', address, node_type: 'directory' }));
    return refreshDirectory({ channelId: channel.id, targetDirectory: requestedDirectory, targetDeviceId: requestedDeviceId });
  }, [activeChannel, deviceId, devices, directory, refreshDirectory, runFileOperation]);
  const removeFile = useCallback(async (entry) => {
    if (!activeChannelId || !entry?.resourceId) return;
    await runFileOperation({ channelId: activeChannelId, access: 'write' }, (operation) => operation.resource({ channel_id: activeChannelId, op: 'delete', resource_id: entry.resourceId }));
    await refreshDirectory();
  }, [activeChannelId, refreshDirectory, runFileOperation]);
  const downloadFile = useCallback(async (entry) => {
    if (!activeChannelId || !entry?.resourceId) return;
    const blob = await runFileOperation({ channelId: activeChannelId, access: 'read' }, async (operation) => {
      const receipt = await operation.resource({ channel_id: activeChannelId, op: 'read', resource_id: entry.resourceId, with_content: true });
      if (!receipt?.ticket) throw new TypeError('服务端没有返回下载凭据');
      const response = await operation.fetch(downloadURL(activeChannelId, receipt.ticket), { credentials: 'include' });
      if (!response.ok) throw new TypeError(`下载失败 (${response.status})`);
      return response.blob();
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = entry.name || 'download';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [activeChannelId, runFileOperation]);

  useEffect(() => {
    for (const [key, active] of activeUploadsRef.current) {
      const assessment = assessRequestOwner(active.owner, ownerFacts(active.owner), REQUEST_PHASE.submit, {
        requireDraft: active.requireDraft,
      });
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
    if (!worldEpoch) return [];
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
    readDraft(channelId).attachments || [],
  ), [draftFor, inCurrentWorld]);

  const activeDraftRecord = drafts.get(activeChannelId);
  const activeDurableDraft = activeDraftRecord?.draft || activeDraftRecord;
  const activeRows = activeDurableDraft?.attachments || [];
  const composerAttachments = useMemo(
    () => inCurrentWorld(activeRows, serverWorld).map(stripWorld),
    [activeRows, inCurrentWorld, serverWorld, stripWorld],
  );

  const mutate = useCallback((channelId, mutateRows, readDraft = draftFor) => {
    const current = readDraft(channelId);
    const attachments = mutateRows([...currentDraftAttachments(channelId, readDraft)]);
    return updateDraft(channelId, { ...current, attachments: tagForCurrentWorld(attachments) });
  }, [currentDraftAttachments, draftFor, tagForCurrentWorld, updateDraft]);
  const clear = useCallback((channelId) => {
    abortUploads(channelId);
    return mutate(channelId, () => []);
  }, [abortUploads, mutate]);

  const attach = useCallback(async (attachment, requestedChannelId = activeChannelRef.current) => {
    const channelId = String(requestedChannelId || '');
    const capturedDraftRevision = Number(drafts.get(channelId)?.revision || 0);
    return runFileOperation({ channelId, access: 'write', requireDraft: true }, async (operation) => {
      const tagged = { ...attachment, [WORLD_FIELD]: operation.owner.worldEpoch };
      await operation.persist(() => persistDraftAttachments(channelId, [tagged], {
        expectedRevision: capturedDraftRevision,
        authorize: () => operation.authorize(REQUEST_PHASE.persist, { requireTransport: false }),
      }));
      operation.authorize(REQUEST_PHASE.persist, { requireTransport: false });
      if (activeChannelRef.current === channelId) onOpenDynamic();
      return stripWorld(tagged);
    });
  }, [activeChannelRef, drafts, onOpenDynamic, persistDraftAttachments, runFileOperation, stripWorld]);

  const uploadFiles = useCallback(async (files, {
    associateDraft = false,
    directory: uploadDirectory = '',
    deviceId: uploadDeviceId = '',
  } = {}) => {
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
      draft: { editorRevision: Number(drafts.get(channel.id)?.editorRevision || 0) },
    });
    const capturedDraftRevision = Number(drafts.get(channel.id)?.revision || 0);
    const assessUpload = (phase, options = {}) => assessRequestOwner(
      owner,
      ownerFacts(owner),
      phase,
      { requireDraft: associateDraft, ...options },
    );
    const previous = uploadQueuesRef.current.get(channel.id) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const acquire = await executeOwnedPhase({
        owner,
        current: () => ownerFacts(owner),
        phase: REQUEST_PHASE.acquire,
        options: { requireDraft: associateDraft },
        effect: () => refreshDevices(channel.id),
      });
      if (!acquire.started || !acquire.current) throw requestAccessError(acquire.invalidation);
      const devices = acquire.value || [];
      const daemonId = uploadDeviceId || availableDefaultStorageDeviceId(channel, devices);
      const daemon = devices.find((row) => row.id === daemonId);
      if (!daemon) throw new TypeError('频道没有可用的默认文件存储设备');
      if (daemon.online === false) throw new TypeError(`频道默认文件存储设备 ${daemon.name || daemon.id} 当前离线`);
      const uploaded = [];
      let uploadFailure = null;
      const occupiedNames = new Set((associateDraft
        ? currentDraftAttachments(channel.id)
        : entries.filter((row) => row.kind === 'file' && uploadDirectory === directory && uploadDeviceId === deviceId)
      ).map((row) => row.name));
      try {
        for (const file of files) {
          const uploadName = availableUploadName(file.name, occupiedNames);
          occupiedNames.add(uploadName);
          const controller = new AbortController();
          const uploadKey = `${channel.id}:${newId()}`;
          activeUploadsRef.current.set(uploadKey, { owner, controller, requireDraft: associateDraft });
          try {
            const submitted = await executeOwnedPhase({
              owner,
              current: () => ownerFacts(owner),
              phase: REQUEST_PHASE.submit,
              options: { requireDraft: associateDraft },
              effect: () => uploadChannelFile({
                file,
                channel,
                deviceName: daemon.name,
                uploadName,
                directory: uploadDirectory,
                onResource: sendResource,
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
      if (associateDraft && uploaded.length) {
        const authorizeAssociation = () => assessUpload(REQUEST_PHASE.persist, { requireTransport: false }).current;
        try {
          await persistDraftAttachments(channel.id, uploaded, {
            expectedRevision: capturedDraftRevision,
            authorize: authorizeAssociation,
          });
          if (!authorizeAssociation()) {
            const stale = new Error('草稿在附件关联完成前已变化');
            stale.code = 'attachment_unassociated';
            throw stale;
          }
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
  }, [accessRef, activeChannel, committedOwnerRef, currentDraftAttachments, deviceId, directory, drafts, entries, onNotice, ownerFacts, persistDraftAttachments, refreshDevices, sendResource, serverWorldCommittedRef, stripWorld, wireRef]);

  const uploadChannelFiles = useCallback((files, options = {}) => uploadFiles(files, {
    ...options,
    associateDraft: false,
  }), [uploadFiles]);

  const uploadComposerAttachments = useCallback((files, options = {}) => uploadFiles(files, {
    ...options,
    associateDraft: true,
  }), [uploadFiles]);

  const reset = useCallback(() => {
    worldRevisionRef.current += 1;
    abortRequest(deviceRequestRef);
    abortRequest(directoryRequestRef);
    abortUploads();
    abortFileOperations();
    uploadQueuesRef.current.clear();
    setDevices([]);
    setDeviceId('');
    setDirectory('');
    setEntries([]);
    setFilesBusy(false);
    setFilesError('');
    setSelectedArtifact(null);
  }, [abortFileOperations, abortRequest, abortUploads]);

  useEffect(() => () => {
    abortRequest(deviceRequestRef);
    abortRequest(directoryRequestRef);
    abortUploads();
    abortFileOperations();
    uploadQueuesRef.current.clear();
  }, [abortFileOperations, abortRequest, abortUploads]);

  return {
    attach,
    clear,
    composerAttachments,
    createDirectory,
    deviceId,
    devices,
    directory,
    downloadFile,
    entries,
    filesBusy,
    filesError,
    mutate,
    navigateFiles,
    refreshDirectory,
    removeFile,
    reset,
    selectDevice,
    selectedArtifact,
    setSelectedArtifact,
    uploadChannelFiles,
    uploadComposerAttachments,
  };
}
