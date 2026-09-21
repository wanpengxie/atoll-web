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
const FILE_READING_HISTORY_LIMIT = 24;
const FILE_PREVIEW_STACK_LIMIT = 20;
const FILE_READING_HISTORY_PREFIX = 'atoll.web.file-reading-history.v1.';
const PREVIEW_LIMITS = Object.freeze({
  text: 512 * 1024,
  image: 20 * 1024 * 1024,
  media: 50 * 1024 * 1024,
  inline: 25 * 1024 * 1024,
});

const TEXT_EXTENSIONS = new Set([
  'c', 'cc', 'conf', 'cpp', 'css', 'csv', 'go', 'h', 'hpp', 'html', 'ini', 'java',
  'js', 'json', 'jsx', 'log', 'mjs', 'py', 'rb', 'rs', 'sh', 'sql', 'toml', 'ts',
  'tsx', 'txt', 'xml', 'yaml', 'yml',
]);

function previewDescriptor(entry) {
  const mediaType = String(entry?.mediaType || entry?.media_type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const extension = String(entry?.name || '').split('.').pop()?.toLowerCase() || '';
  if (mediaType.startsWith('image/')) return { kind: 'image', mediaType };
  if (mediaType.startsWith('video/')) return { kind: 'video', mediaType };
  if (mediaType.startsWith('audio/')) return { kind: 'audio', mediaType };
  if (mediaType === 'application/pdf' || extension === 'pdf') return { kind: 'pdf', mediaType };
  if (['text/markdown', 'text/x-markdown'].includes(mediaType) || ['md', 'markdown', 'mdown'].includes(extension)) {
    return { kind: 'markdown', mediaType };
  }
  if (
    mediaType.startsWith('text/')
    || ['application/json', 'application/ld+json', 'application/xml', 'application/yaml'].includes(mediaType)
    || mediaType.endsWith('+json')
    || mediaType.endsWith('+xml')
    || TEXT_EXTENSIONS.has(extension)
  ) return { kind: 'text', mediaType };
  return { kind: 'unsupported', mediaType };
}

async function sniffText(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function readBoundedText(response, limit, signal) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > limit) throw new RangeError(previewSizeError(limit));
  if (!response.body?.getReader) {
    const value = await response.text();
    if (new TextEncoder().encode(value).byteLength > limit) throw new RangeError(previewSizeError(limit));
    return value;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('预览已取消', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new RangeError(previewSizeError(limit));
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
}

function previewLimit(kind) {
  if (['markdown', 'text', 'unsupported'].includes(kind)) return PREVIEW_LIMITS.text;
  if (kind === 'image') return PREVIEW_LIMITS.image;
  if (['audio', 'video'].includes(kind)) return PREVIEW_LIMITS.media;
  if (kind === 'pdf') return PREVIEW_LIMITS.inline;
  return 0;
}

function previewSizeError(limit) {
  const mib = limit / 1024 / 1024;
  return `文件超过站内预览上限（${Number.isInteger(mib) ? mib : mib.toFixed(1)} MB），请下载后打开。`;
}

function safeRecentFile(value) {
  if (!value || typeof value !== 'object' || !value.channelId || !(value.resourceId || value.resource_id)) return null;
  const resourceId = String(value.resourceId || value.resource_id);
  const size = Number(value.size);
  const line = Number(value.line);
  return {
    key: String(value.key || `recent-file:${value.channelId}:${resourceId}`),
    channelId: String(value.channelId),
    resourceId,
    name: String(value.name || resourceId),
    mediaType: String(value.mediaType || value.media_type || 'application/octet-stream'),
    ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
    ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
    lastOpenedAt: Number.isFinite(Number(value.lastOpenedAt)) ? Number(value.lastOpenedAt) : 0,
  };
}

function historyStorageKey(principalId, worldEpoch) {
  return `${FILE_READING_HISTORY_PREFIX}${encodeURIComponent(String(principalId || ''))}.${encodeURIComponent(String(worldEpoch || ''))}`;
}

function readRecentFiles(principalId, worldEpoch) {
  if (!principalId || !worldEpoch) return [];
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(historyStorageKey(principalId, worldEpoch)) || '[]');
    return (Array.isArray(value) ? value : []).map(safeRecentFile).filter(Boolean).slice(0, FILE_READING_HISTORY_LIMIT);
  } catch { return []; }
}

function writeRecentFiles(principalId, worldEpoch, rows) {
  if (!principalId || !worldEpoch) return;
  try { globalThis.localStorage?.setItem(historyStorageKey(principalId, worldEpoch), JSON.stringify(rows)); } catch { /* in-memory state remains usable */ }
}

function samePreview(left, right) {
  return left?.channelId === right?.channelId
    && String(left?.resourceId || left?.resource_id || '') === String(right?.resourceId || right?.resource_id || '')
    && Number(left?.line || 0) === Number(right?.line || 0);
}

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

function projectResourceEntries(items, prefix, directory = '') {
  return (items || []).flatMap((item) => {
    const resourceId = String(item?.id || item?.resource_id || item?.address || '');
    if (!resourceId.startsWith(prefix)) return [];
    const relative = resourceId.slice(prefix.length);
    if (!relative || relative.includes('/')) return [];
    let name = relative;
    try { name = decodeURIComponent(relative); } catch { /* keep the readable resource segment */ }
    const nodeType = String(item?.meta?.node_type || 'regular');
    const kind = nodeType === 'directory' ? 'directory' : nodeType === 'regular' ? 'file' : 'other';
    return [{
      key: `${kind}:${resourceId}`,
      kind,
      name,
      resourceId,
      ...(kind === 'directory' ? { directory: `${normalizeFeatureDirectory(directory)}${name}/` } : {}),
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
  const [filesNext, setFilesNext] = useState('');
  const [filesBusy, setFilesBusy] = useState(false);
  const [filesUploading, setFilesUploading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [directoryReceipt, setDirectoryReceipt] = useState(() => Object.freeze({
    epoch: 0,
    channelId: '',
    deviceId: '',
    directory: '',
    phase: 'idle',
    error: '',
  }));
  const [selectedKey, setSelectedKey] = useState('');
  const [filesScrollTop, setFilesScrollTop] = useState(0);
  const [selectedArtifact, setSelectedArtifactState] = useState(null);
  const [artifactPreview, setArtifactPreview] = useState({ status: 'idle' });
  const [previewStack, setPreviewStack] = useState([]);
  const [recentFiles, setRecentFiles] = useState(() => readRecentFiles(principalId, serverWorld));
  const worldRevisionRef = useRef(0);
  const uploadQueuesRef = useRef(new Map());
  const activeUploadsRef = useRef(new Map());
  const activeFileOperationsRef = useRef(new Map());
  const deviceRequestRef = useRef({ generation: 0, request: null });
  const directoryRequestRef = useRef({ generation: 0, request: null });
  const previewRequestRef = useRef({ generation: 0, request: null });
  const previewObjectURLRef = useRef('');
  const fileSessionsRef = useRef(new Map());
  const activeFileChannelRef = useRef(activeChannelId || '');
  const pendingDeviceIdRef = useRef('');
  const skipChannelDirectoryEffectRef = useRef('');
  const restoredDirectoryRef = useRef('');
  const committedOwnerRef = useRef(null);
  const serverWorldCommittedRef = useRef(serverWorld);
  const wireStateCommittedRef = useRef(wireState);
  const currentDirectoryRef = useRef(directory);
  const currentDeviceIdRef = useRef(deviceId);
  currentDirectoryRef.current = directory;
  currentDeviceIdRef.current = deviceId;
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

  const publishArtifactPreview = useCallback((preview) => {
    const nextURL = preview?.url || '';
    if (previewObjectURLRef.current && previewObjectURLRef.current !== nextURL) {
      URL.revokeObjectURL(previewObjectURLRef.current);
    }
    previewObjectURLRef.current = nextURL;
    setArtifactPreview(preview || { status: 'idle' });
  }, []);

  const selectArtifact = useCallback((entry) => {
    abortRequest(previewRequestRef);
    setSelectedKey(entry?.key || '');
    setSelectedArtifactState(entry || null);
    if (!entry) setPreviewStack([]);
    publishArtifactPreview({ status: 'idle' });
  }, [abortRequest, publishArtifactPreview]);

  const rememberRecentFile = useCallback((entry, channelId) => {
    const recent = safeRecentFile({ ...entry, channelId, lastOpenedAt: Date.now() });
    if (!recent) return;
    setRecentFiles((current) => {
      const next = [recent, ...current.filter((row) => row.channelId !== recent.channelId || row.resourceId !== recent.resourceId)]
        .slice(0, FILE_READING_HISTORY_LIMIT);
      writeRecentFiles(principalId, serverWorldCommittedRef.current, next);
      return next;
    });
  }, [principalId]);

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

  // The resource frame is still owned by this hook even when the caller is a
  // KV/resource tool rather than the Files surface. Keep the same channel,
  // authority, world and transport fences as file operations; exposing the
  // method does not create a second resource store or a raw wire escape hatch.
  const resource = useCallback((payload = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return Promise.reject(new TypeError('资源操作请求格式不正确'));
    }
    const requestedChannelId = String(payload.channel_id || '');
    const channelId = requestedChannelId || String(activeChannelRef.current || '');
    if (!channelId || (requestedChannelId && requestedChannelId !== String(activeChannelRef.current || ''))) {
      return Promise.reject(new TypeError('资源操作频道已切换'));
    }
    const operation = String(payload.op || '');
    const access = ['create', 'write', 'delete'].includes(operation) ? 'write' : 'read';
    return runFileOperation({ channelId, access }, (request) => request.resource({
      ...payload,
      channel_id: channelId,
    }));
  }, [activeChannelRef, runFileOperation]);

  const refreshDevices = useCallback(async (channelId = activeChannelRef.current) => {
    if (!channelId || !obsRef?.current) return [];
    const request = beginRequest(deviceRequestRef, channelId);
    try {
      const rows = projectChannelDevices(await obsRef.current.channelDevices(channelId));
      if (deviceRequestRef.current.request !== request || request.controller.signal.aborted) return [];
      if (activeChannelRef.current !== channelId) return [];
      setDevices(rows);
      setDeviceId((current) => {
        const preferred = current || pendingDeviceIdRef.current;
        const next = rows.some((row) => row.id === preferred)
          ? preferred
          : availableDefaultStorageDeviceId(activeChannel, rows);
        pendingDeviceIdRef.current = '';
        return next;
      });
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
    cursor = '',
    append = false,
    clearError = true,
  } = {}) => {
    if (!channelId) return [];
    const request = beginRequest(directoryRequestRef, channelId);
    const channel = channelId === activeChannel?.id ? activeChannel : null;
    const device = devices.find((row) => row.id === targetDeviceId);
    const normalized = normalizeFeatureDirectory(targetDirectory);
    setDirectoryReceipt(Object.freeze({
      epoch: request.generation,
      channelId,
      deviceId: String(targetDeviceId || ''),
      directory: normalized,
      phase: 'pending',
      error: '',
    }));
    if (!channel || !device) {
      if (directoryRequestRef.current.request === request && activeChannelRef.current === channelId) {
        setEntries([]);
        setFilesNext('');
        setDirectoryReceipt(Object.freeze({
          epoch: request.generation,
          channelId,
          deviceId: String(targetDeviceId || ''),
          directory: normalized,
          phase: 'settled',
          error: '',
        }));
      }
      finishRequest(directoryRequestRef, request);
      return [];
    }
    setFilesBusy(true);
    if (clearError) setFilesError('');
    try {
      const prefix = resourcePrefix(channel, device, normalized);
      const receipt = await runFileOperation({ channelId, access: 'read', signal: request.controller.signal }, (operation) => operation.resource({
        channel_id: channelId,
        op: 'list',
        query: { prefix, limit: 100, ...(cursor ? { cursor } : {}) },
      }));
      const rows = projectResourceEntries(receipt?.items, prefix, normalized);
      if (
        directoryRequestRef.current.request === request
        && !request.controller.signal.aborted
        && activeChannelRef.current === channelId
      ) {
        setDirectory(normalized);
        setDeviceId(targetDeviceId);
        setEntries((current) => {
          if (!append) return rows;
          const merged = new Map(current.map((row) => [row.resourceId, row]));
          for (const row of rows) merged.set(row.resourceId, row);
          return [...merged.values()];
        });
        setFilesNext(String(receipt?.next || ''));
        restoredDirectoryRef.current = '';
        setDirectoryReceipt(Object.freeze({
          epoch: request.generation,
          channelId,
          deviceId: String(targetDeviceId || ''),
          directory: normalized,
          phase: 'settled',
          error: '',
        }));
      }
      return rows;
    } catch (error) {
      if (
        directoryRequestRef.current.request === request
        && !request.controller.signal.aborted
        && activeChannelRef.current === channelId
      ) {
        const restored = Boolean(restoredDirectoryRef.current && normalized === restoredDirectoryRef.current);
        if (restored) {
          restoredDirectoryRef.current = '';
          setDirectory('');
        } else setFilesError(errorText(error));
        setDirectoryReceipt(Object.freeze({
          epoch: request.generation,
          channelId,
          deviceId: String(targetDeviceId || ''),
          directory: normalized,
          phase: 'settled',
          error: restored ? '' : errorText(error),
        }));
      }
      return [];
    } finally {
      if (finishRequest(directoryRequestRef, request) && activeChannelRef.current === channelId) setFilesBusy(false);
    }
  }, [activeChannel, activeChannelRef, beginRequest, deviceId, devices, directory, finishRequest, runFileOperation]);

  useEffect(() => {
    const previousChannelId = activeFileChannelRef.current;
    const changingChannel = previousChannelId !== activeChannelId;
    if (previousChannelId && changingChannel) {
      fileSessionsRef.current.set(previousChannelId, {
        deviceId, directory, selectedKey, selectedArtifact, previewStack, scrollTop: filesScrollTop,
      });
    }
    if (changingChannel) skipChannelDirectoryEffectRef.current = activeChannelId || '';
    activeFileChannelRef.current = activeChannelId || '';
    const restored = previousChannelId === activeChannelId
      ? { deviceId, directory, selectedKey, selectedArtifact, previewStack, scrollTop: filesScrollTop }
      : fileSessionsRef.current.get(activeChannelId) || null;
    pendingDeviceIdRef.current = changingChannel ? (restored?.deviceId || '') : '';
    abortRequest(deviceRequestRef);
    abortRequest(directoryRequestRef);
    abortRequest(previewRequestRef);
    setDirectoryReceipt(Object.freeze({
      epoch: directoryRequestRef.current.generation,
      channelId: activeChannelId || '',
      deviceId: String(restored?.deviceId || ''),
      directory: normalizeFeatureDirectory(restored?.directory || ''),
      phase: 'idle',
      error: '',
    }));
    setDevices([]);
    setDeviceId(changingChannel ? '' : (restored?.deviceId || ''));
    setDirectory(restored?.directory || '');
    restoredDirectoryRef.current = restored?.directory || '';
    setEntries([]);
    setFilesNext('');
    setFilesBusy(false);
    setSelectedKey(restored?.selectedKey || '');
    setSelectedArtifactState(restored?.selectedArtifact || null);
    setPreviewStack(restored?.previewStack || []);
    setFilesScrollTop(Number(restored?.scrollTop || 0));
    publishArtifactPreview({ status: 'idle' });
    setFilesError('');
    if (!activeChannelId || wireState !== 'open') {
      skipChannelDirectoryEffectRef.current = '';
      return;
    }
    void refreshDevices(activeChannelId);
  // Switching channels is the ownership boundary. The values intentionally
  // come from the last committed channel render, not from dependencies that
  // would make ordinary directory navigation reset the browser.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannelId, serverWorld, wireState]);

  useEffect(() => {
    setRecentFiles(readRecentFiles(principalId, serverWorld));
  }, [principalId, serverWorld]);

  useEffect(() => {
    if (!activeChannelId || !deviceId || wireState !== 'open') return;
    if (skipChannelDirectoryEffectRef.current === activeChannelId) {
      skipChannelDirectoryEffectRef.current = '';
      return;
    }
    void refreshDirectory({ channelId: activeChannelId, targetDirectory: directory, targetDeviceId: deviceId, clearError: false });
  }, [activeChannelId, deviceId, directory, refreshDirectory, wireState]);

  const navigateFiles = useCallback((value) => {
    setDirectory(normalizeFeatureDirectory(value));
    setSelectedKey('');
    setFilesScrollTop(0);
  }, []);
  const selectDevice = useCallback((value) => {
    setDeviceId(String(value || ''));
    setDirectory('');
    setSelectedKey('');
    setFilesScrollTop(0);
  }, []);
  const createDirectory = useCallback(async ({ name, directory: requestedDirectory = directory, deviceId: requestedDeviceId = deviceId }) => {
    const channel = activeChannel;
    const device = devices.find((row) => row.id === requestedDeviceId);
    const safeName = safeUploadName(name);
    if (!channel?.id || !device || safeName !== String(name || '').trim()) throw new TypeError('文件夹名称无效');
    const address = `${resourcePrefix(channel, device, requestedDirectory)}${encodeURIComponent(safeName)}`;
    setFilesBusy(true);
    setFilesError('');
    try {
      await runFileOperation({ channelId: channel.id, access: 'write' }, (operation) => operation.resource({ channel_id: channel.id, op: 'create', address, node_type: 'directory' }));
      return await refreshDirectory({ channelId: channel.id, targetDirectory: requestedDirectory, targetDeviceId: requestedDeviceId });
    } catch (error) {
      if (activeChannelRef.current === channel.id) setFilesError(errorText(error));
      throw error;
    } finally {
      if (activeChannelRef.current === channel.id) setFilesBusy(false);
    }
  }, [activeChannel, activeChannelRef, deviceId, devices, directory, refreshDirectory, runFileOperation]);
  const removeFile = useCallback(async (entry) => {
    if (!activeChannelId || !entry?.resourceId) return;
    const channelId = activeChannelId;
    const targetDirectory = currentDirectoryRef.current;
    const targetDeviceId = currentDeviceIdRef.current;
    setFilesBusy(true);
    setFilesError('');
    try {
      await runFileOperation({ channelId, access: 'write' }, (operation) => operation.resource({ channel_id: channelId, op: 'delete', resource_id: entry.resourceId }));
      if (
        activeChannelRef.current === channelId
        && currentDirectoryRef.current === targetDirectory
        && currentDeviceIdRef.current === targetDeviceId
      ) {
        setSelectedKey('');
        await refreshDirectory({ channelId, targetDirectory, targetDeviceId });
      }
    } catch (error) {
      if (activeChannelRef.current === channelId) setFilesError(errorText(error));
      throw error;
    } finally {
      if (activeChannelRef.current === channelId) setFilesBusy(false);
    }
  }, [activeChannelId, activeChannelRef, refreshDirectory, runFileOperation]);
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

  const previewArtifact = useCallback(async (entry, requestedChannelId = activeChannelRef.current, historyMode = 'push') => {
    const channelId = String(requestedChannelId || '');
    const resourceId = String(entry?.resourceId || entry?.resource_id || '');
    const descriptor = previewDescriptor(entry);
    const request = beginRequest(previewRequestRef, channelId);
    const artifact = entry ? { ...entry, channelId, resourceId } : null;
    setSelectedKey(entry?.key || '');
    setSelectedArtifactState(artifact);
    if (artifact) {
      rememberRecentFile(artifact, channelId);
      if (historyMode === 'push') setPreviewStack((current) => {
        if (samePreview(current.at(-1), artifact)) return [...current.slice(0, -1), artifact];
        return [...current, artifact].slice(-FILE_PREVIEW_STACK_LIMIT);
      });
    }
    publishArtifactPreview(entry ? { ...descriptor, status: 'loading' } : { status: 'idle' });
    if (!entry || !channelId || !resourceId) {
      if (previewRequestRef.current.request === request) {
        publishArtifactPreview({ status: 'error', error: '文件资源标识为空' });
      }
      finishRequest(previewRequestRef, request);
      return null;
    }
    const declaredLimit = previewLimit(descriptor.kind);
    if (declaredLimit && Number(entry.size || 0) > declaredLimit) {
      if (previewRequestRef.current.request === request) {
        publishArtifactPreview({
          ...descriptor,
          status: descriptor.kind === 'unsupported' ? 'unsupported' : 'error',
          reason: descriptor.kind === 'unsupported'
            ? `不支持预览 ${descriptor.mediaType || '未知媒体类型'} 文件`
            : previewSizeError(declaredLimit),
          ...(descriptor.kind === 'unsupported' ? {} : { error: previewSizeError(declaredLimit) }),
        });
      }
      finishRequest(previewRequestRef, request);
      return null;
    }
    try {
      const preview = await runFileOperation({ channelId, access: 'read', signal: request.controller.signal }, async (operation) => {
        const receipt = await operation.resource({ channel_id: channelId, op: 'read', resource_id: resourceId, with_content: true });
        if (!receipt?.ticket) throw new TypeError('服务端没有返回预览凭据');
        const response = await operation.fetch(downloadURL(channelId, receipt.ticket), { credentials: 'include' });
        if (!response.ok) throw new TypeError(`预览读取失败 (${response.status})`);
        const responseMediaType = response.headers?.get?.('content-type')?.split(';')[0]?.trim() || '';
        const responseDescriptor = responseMediaType
          ? previewDescriptor({ ...entry, mediaType: responseMediaType })
          : descriptor;
        const resolved = descriptor.kind === 'unsupported' ? responseDescriptor : descriptor;
        const limit = previewLimit(resolved.kind || descriptor.kind);
        const responseLength = Number(response.headers?.get?.('content-length') || 0);
        if (limit && responseLength > limit) throw new RangeError(previewSizeError(limit));
        if (['markdown', 'text'].includes(resolved.kind)) {
          return { ...resolved, status: 'ready', text: await readBoundedText(response, PREVIEW_LIMITS.text, operation.signal) };
        }
        const blob = await response.blob();
        if (resolved.kind === 'unsupported') {
          if (blob.size > PREVIEW_LIMITS.text) return {
            ...resolved,
            status: 'unsupported',
            reason: `不支持预览 ${resolved.mediaType || '未知媒体类型'} 文件`,
          };
          const text = await sniffText(blob);
          return text === null
            ? { ...resolved, status: 'unsupported', reason: `不支持预览 ${resolved.mediaType || '未知媒体类型'} 文件` }
            : { ...resolved, kind: 'text', status: 'ready', text, sniffed: true };
        }
        if (limit && blob.size > limit) throw new RangeError(previewSizeError(limit));
        const declaredType = String(blob.type || '').toLowerCase();
        const wantedType = resolved.kind === 'pdf' ? 'application/pdf' : resolved.mediaType;
        const previewBlob = wantedType && (!declaredType || declaredType === 'application/octet-stream')
          ? new Blob([blob], { type: wantedType }) : blob;
        return { ...resolved, status: 'ready', url: URL.createObjectURL(previewBlob) };
      });
      if (previewRequestRef.current.request !== request || request.controller.signal.aborted) {
        if (preview?.url) URL.revokeObjectURL(preview.url);
        return null;
      }
      publishArtifactPreview(preview);
      return preview;
    } catch (error) {
      if (previewRequestRef.current.request === request && !request.controller.signal.aborted) {
        publishArtifactPreview({ ...descriptor, status: 'error', error: errorText(error) });
      }
      return null;
    } finally {
      finishRequest(previewRequestRef, request);
    }
  }, [activeChannelRef, beginRequest, finishRequest, publishArtifactPreview, rememberRecentFile, runFileOperation]);

  const backArtifactPreview = useCallback(() => {
    const previous = previewStack.at(-2);
    if (!previous) return false;
    setPreviewStack((current) => current.slice(0, -1));
    void previewArtifact(previous, previous.channelId, 'back');
    return true;
  }, [previewArtifact, previewStack]);

  const rememberFilesScroll = useCallback((value) => {
    const next = Math.max(0, Number(value) || 0);
    setFilesScrollTop(next);
    const channelId = activeChannelRef.current;
    if (!channelId) return;
    const current = fileSessionsRef.current.get(channelId) || {};
    fileSessionsRef.current.set(channelId, { ...current, scrollTop: next });
  }, [activeChannelRef]);

  const loadMoreDirectory = useCallback((cursor = filesNext) => {
    if (!cursor) return Promise.resolve([]);
    return refreshDirectory({ cursor, append: true });
  }, [filesNext, refreshDirectory]);

  const refreshDirectoryReceipt = useCallback((options = {}) => {
    const epoch = directoryRequestRef.current.generation + 1;
    return refreshDirectory(options).then((rows) => ({
      epoch,
      rows,
    }));
  }, [refreshDirectory]);

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
    try {
      return await runFileOperation({ channelId, access: 'write', requireDraft: true }, async (operation) => {
        const tagged = { ...attachment, [WORLD_FIELD]: operation.owner.worldEpoch };
        await operation.persist(() => persistDraftAttachments(channelId, [tagged], {
          expectedRevision: capturedDraftRevision,
          authorize: () => operation.authorize(REQUEST_PHASE.persist, { requireTransport: false }),
        }));
        operation.authorize(REQUEST_PHASE.persist, { requireTransport: false });
        if (activeChannelRef.current === channelId) onOpenDynamic();
        return stripWorld(tagged);
      });
    } catch (error) {
      if (activeChannelRef.current === channelId) setFilesError(errorText(error));
      throw error;
    }
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

  const uploadChannelFiles = useCallback(async (files, options = {}) => {
    const channelId = activeChannelRef.current;
    setFilesUploading(true);
    setFilesError('');
    try {
      return await uploadFiles(files, { ...options, associateDraft: false });
    } catch (error) {
      if (activeChannelRef.current === channelId) setFilesError(errorText(error));
      throw error;
    } finally {
      if (activeChannelRef.current === channelId) setFilesUploading(false);
    }
  }, [activeChannelRef, uploadFiles]);

  const uploadComposerAttachments = useCallback((files, options = {}) => uploadFiles(files, {
    ...options,
    associateDraft: true,
  }), [uploadFiles]);

  const reset = useCallback(() => {
    worldRevisionRef.current += 1;
    abortRequest(deviceRequestRef);
    abortRequest(directoryRequestRef);
    abortRequest(previewRequestRef);
    abortUploads();
    abortFileOperations();
    uploadQueuesRef.current.clear();
    setDevices([]);
    setDeviceId('');
    setDirectory('');
    setEntries([]);
    setFilesNext('');
    setFilesBusy(false);
    setFilesUploading(false);
    setFilesError('');
    setDirectoryReceipt(Object.freeze({
      epoch: directoryRequestRef.current.generation,
      channelId: '',
      deviceId: '',
      directory: '',
      phase: 'idle',
      error: '',
    }));
    setSelectedKey('');
    setFilesScrollTop(0);
    setSelectedArtifactState(null);
    setPreviewStack([]);
    fileSessionsRef.current.clear();
    publishArtifactPreview({ status: 'idle' });
  }, [abortFileOperations, abortRequest, abortUploads, publishArtifactPreview]);

  useEffect(() => () => {
    abortRequest(deviceRequestRef);
    abortRequest(directoryRequestRef);
    abortRequest(previewRequestRef);
    abortUploads();
    abortFileOperations();
    uploadQueuesRef.current.clear();
    if (previewObjectURLRef.current) URL.revokeObjectURL(previewObjectURLRef.current);
    previewObjectURLRef.current = '';
  }, [abortFileOperations, abortRequest, abortUploads]);

  return {
    attach,
    artifactPreview,
    backArtifactPreview,
    canGoBack: previewStack.length > 1,
    clear,
    composerAttachments,
    createDirectory,
    deviceId,
    devices,
    directory,
    directoryReceipt,
    downloadFile,
    entries,
    filesBusy,
    filesError,
    filesNext,
    filesScrollTop,
    filesUploading,
    loadMoreDirectory,
    mutate,
    navigateFiles,
    previewArtifact,
    recentFiles: recentFiles.filter((row) => row.channelId === activeChannelId),
    refreshDirectory,
    refreshDirectoryReceipt,
    rememberFilesScroll,
    removeFile,
    resource,
    reset,
    selectDevice,
    selectedArtifact,
    selectedKey,
    setSelectedArtifact: selectArtifact,
    uploadChannelFiles,
    uploadComposerAttachments,
  };
}
