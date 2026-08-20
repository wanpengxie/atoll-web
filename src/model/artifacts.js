import { argsOf } from '../protocol/envelope.js';

const ARTIFACT_KINDS = new Set(['file', 'document', 'image', 'audio', 'video', 'table', 'list', 'report', 'structured']);
const artifactIndexCache = new WeakMap();

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sourceRef(channelId, envelope, seq, objectType = 'entry', objectId = envelope?.id) {
  const requestId = envelope?.kind === 'request' ? envelope.id : envelope?.parent_id || envelope?.correlation_id;
  return {
    channelId,
    view: 'dynamic',
    objectType,
    objectId,
    seq,
    ...(requestId ? { requestId } : {}),
    ...(envelope?.id ? { envelopeId: envelope.id } : {}),
  };
}

function attachmentFact(value) {
  if (!value || typeof value !== 'object' || !text(value.resource_id)) return null;
  return {
    resourceId: text(value.resource_id),
    name: text(value.name) || text(value.resource_id),
    mediaType: text(value.media_type) || 'application/octet-stream',
    size: Number.isFinite(Number(value.size)) && Number(value.size) >= 0 ? Number(value.size) : undefined,
    address: text(value.address),
    kind: ARTIFACT_KINDS.has(value.artifact_kind) ? value.artifact_kind : undefined,
    versionOf: text(value.version_of),
    derivedFrom: Array.isArray(value.derived_from) ? value.derived_from.map(text).filter(Boolean) : [],
  };
}

export function previewForMediaType(mediaType = '') {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('audio/') || mediaType.startsWith('video/')) return 'media';
  if (mediaType === 'application/pdf') return 'inline';
  if (mediaType.startsWith('text/') || ['application/json', 'text/markdown'].includes(mediaType)) return 'text';
  if (/officedocument|msword|ms-excel|ms-powerpoint/.test(mediaType)) return 'download_only';
  return 'unsupported';
}

export function artifactKindForMediaType(mediaType = '') {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('audio/')) return 'audio';
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType === 'application/pdf' || mediaType.startsWith('text/')) return 'document';
  return 'file';
}

function registeredArtifact(payload, adapters, envelopeType) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.artifact && typeof payload.artifact === 'object') return payload.artifact;
  const adapter = adapters?.get?.(envelopeType) || adapters?.get?.(payload.type_id || payload.type || '');
  if (!adapter) return null;
  const id = text(adapter.idSelector?.(payload));
  const kind = adapter.kind;
  if (!id || !ARTIFACT_KINDS.has(kind)) return null;
  return { resource_id: id, name: adapter.nameSelector?.(payload) || id, artifact_kind: kind, media_type: adapter.mediaType };
}

function factsFromEnvelope(envelope, adapters) {
  const payload = envelope?.payload;
  if (!payload || typeof payload !== 'object') return [];
  const facts = [];
  const terminal = envelope.kind === 'response' && ['completed', 'failed', 'cancelled'].includes(payload.status);
  // 请求的附件在 `body` 里，响应的在顶层；argsOf 把这个差别吃掉。
  const args = argsOf(envelope);
  if ((envelope.kind === 'request' || terminal) && Array.isArray(args.attachments)) facts.push(...args.attachments.map(attachmentFact).filter(Boolean));
  if (terminal) {
    const single = attachmentFact(payload.attachment);
    if (single) facts.push(single);
    const artifact = attachmentFact(registeredArtifact(payload, adapters, envelope.type));
    if (artifact) {
      artifact.kind ||= ARTIFACT_KINDS.has(payload.artifact?.artifact_kind) ? payload.artifact.artifact_kind : undefined;
      artifact.versionOf ||= text(payload.version_of);
      if (!artifact.derivedFrom.length && Array.isArray(payload.derived_from)) artifact.derivedFrom = payload.derived_from.map(text).filter(Boolean);
      facts.push(artifact);
    }
  }
  return facts;
}

function relationKey(channelId, resourceId) {
  return resourceId ? `artifact:${channelId}:${resourceId}` : undefined;
}

export function artifactKey(channelId, resourceId) {
  if (!text(channelId) || !text(resourceId)) throw new TypeError('Artifact 需要频道和资源 ID');
  return relationKey(text(channelId), text(resourceId));
}

export function buildArtifactIndex(state, { adapters = new Map() } = {}) {
  const channelId = text(state?.channelId);
  const index = new Map();
  if (!channelId || !(state?.rows instanceof Map)) return index;
  const cacheable = !adapters?.size;
  const signature = `${state.rows.size}:${state.lastSeq}`;
  const cached = cacheable ? artifactIndexCache.get(state) : null;
  if (cached?.signature === signature && cached.rows === state.rows) return cached.index;
  for (const [seq, envelope] of [...state.rows.entries()].sort((a, b) => a[0] - b[0])) {
    for (const fact of factsFromEnvelope(envelope, adapters)) {
      const key = artifactKey(channelId, fact.resourceId);
      const belongsToTurn = envelope.kind === 'request' || (envelope.kind === 'response' && envelope.parent_id);
      const source = sourceRef(channelId, envelope, seq, belongsToTurn ? 'turn' : 'entry', envelope.kind === 'request' ? envelope.id : envelope.parent_id || envelope.id);
      const existing = index.get(key);
      if (!existing) {
        index.set(key, {
          key,
          channelId,
          resourceId: fact.resourceId,
          kind: fact.kind || artifactKindForMediaType(fact.mediaType),
          name: fact.name,
          mediaType: fact.mediaType,
          size: fact.size,
          state: 'available',
          authorActorId: envelope.sender?.id,
          createdAt: envelope.ts,
          firstSeq: seq,
          lastSeq: seq,
          source,
          versionOf: relationKey(channelId, fact.versionOf),
          derivedFrom: fact.derivedFrom.map((id) => relationKey(channelId, id)),
          references: [source],
          preview: previewForMediaType(fact.mediaType),
          provenance: { source: 'feed', envelopeId: envelope.id, seq },
          anomalies: [],
          ...(fact.address ? { diagnostic: { address: fact.address } } : {}),
        });
        continue;
      }
      existing.lastSeq = seq;
      existing.references.push(source);
      if (!existing.size && fact.size) existing.size = fact.size;
      if ((!existing.name || existing.name === existing.resourceId) && fact.name) existing.name = fact.name;
      else if (fact.name && fact.name !== existing.name && fact.name !== existing.resourceId) existing.anomalies.push({ code: 'name_conflict', seq, envelopeId: envelope.id });
      if ((!existing.mediaType || existing.mediaType === 'application/octet-stream') && fact.mediaType) {
        existing.mediaType = fact.mediaType;
        existing.kind = artifactKindForMediaType(fact.mediaType);
        existing.preview = previewForMediaType(fact.mediaType);
      }
      else if (fact.mediaType && fact.mediaType !== existing.mediaType && fact.mediaType !== 'application/octet-stream') existing.anomalies.push({ code: 'media_type_conflict', seq, envelopeId: envelope.id });
      if (!existing.versionOf && fact.versionOf) existing.versionOf = relationKey(channelId, fact.versionOf);
      else if (fact.versionOf && existing.versionOf !== relationKey(channelId, fact.versionOf)) existing.anomalies.push({ code: 'version_conflict', seq, envelopeId: envelope.id });
      for (const id of fact.derivedFrom.map((value) => relationKey(channelId, value))) if (!existing.derivedFrom.includes(id)) existing.derivedFrom.push(id);
    }
  }
  if (cacheable) artifactIndexCache.set(state, { signature, rows: state.rows, index });
  return index;
}

export function artifactList(state, options) {
  return [...buildArtifactIndex(state, options).values()].sort((a, b) => b.lastSeq - a.lastSeq || a.name.localeCompare(b.name));
}

export function artifactAttachment(artifact) {
  return {
    resource_id: artifact.resourceId,
    name: artifact.name,
    media_type: artifact.mediaType,
    ...(artifact.size === undefined ? {} : { size: artifact.size }),
  };
}

export function formatArtifactSize(size) {
  if (!Number.isFinite(size)) return '大小未知';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
