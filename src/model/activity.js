import { systemEventPresentation } from './system-event-presentation.js';
import { turnStatusLabel } from './turn-presentation.js';

const READABLE_ACCESS = new Set([
  'member_active',
  'member_stale',
  'member_unavailable',
  'observer_active',
  'observer_stale',
]);

const ACTIVE_OPERATION_STATES = new Set([
  'submitting',
  'accepted',
  'transferring',
  'waiting_ledger',
  'waiting_projection',
  'uncertain',
  'partial',
]);

const ATTENTION_WORK_ITEM_STATES = new Set(['active', 'waiting', 'blocked', 'uncertain', 'failed', 'expired']);
const STANDARD_ACTOR_IDS = new Set(['system']);
const STANDARD_ACTOR_DECL_IDS = new Set([
  'atoll-internal:registrar-seat',
  'atoll-internal:svcactor',
  'coreactor',
]);

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function values(value) {
  if (value instanceof Map) return [...value.values()];
  return Array.isArray(value) ? value : [];
}

function timestamp(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function channelIdOf(channel) {
  return string(channel?.id || channel?.channelId || channel?.state?.channelId);
}

function accessOf(channel) {
  return string(channel?.access || channel?.accessState?.mode || channel?.mode);
}

export function isActivityChannelVisible(channel) {
  return Boolean(channelIdOf(channel)) && READABLE_ACCESS.has(accessOf(channel));
}

function sourceRef(value, fallback = {}) {
  const channelId = string(value?.channelId || fallback.channelId);
  const view = ['dynamic', 'artifacts', 'tasks'].includes(value?.view) ? value.view : fallback.view || 'dynamic';
  const objectType = string(value?.objectType || fallback.objectType);
  const objectId = string(value?.objectId || fallback.objectId);
  if (!channelId || !objectType || !objectId) return null;
  return {
    channelId,
    view,
    objectType,
    objectId,
    ...(Number.isSafeInteger(Number(value?.seq ?? fallback.seq)) ? { seq: Number(value?.seq ?? fallback.seq) } : {}),
    ...(string(value?.requestId || fallback.requestId) ? { requestId: string(value?.requestId || fallback.requestId) } : {}),
    ...(string(value?.envelopeId || fallback.envelopeId) ? { envelopeId: string(value?.envelopeId || fallback.envelopeId) } : {}),
  };
}

function channelSource(channelId) {
  return { channelId, view: 'dynamic', objectType: 'channel', objectId: channelId };
}

function factKey(source, fallback) {
  if (source?.requestId) return `${source.channelId}:request:${source.requestId}`;
  if (source?.envelopeId) return `${source.channelId}:envelope:${source.envelopeId}`;
  if (source?.objectType && source?.objectId) return `${source.channelId}:${source.objectType}:${source.objectId}`;
  return fallback;
}

function channelName(channel) {
  return string(channel?.name || channel?.profile?.name || channel?.accessState?.profile?.name) || channelIdOf(channel);
}

function activityPriority(item) {
  if (item.severity === 'critical') return 0;
  if (item.actionableBySelf) return 1;
  if (item.severity === 'warning') return 2;
  return 3;
}

function preferActivity(left, right) {
  const rank = { work_item: 0, operation: 1, terminal: 2, membership: 3 };
  if ((rank[right.kind] ?? 9) !== (rank[left.kind] ?? 9)) return (rank[right.kind] ?? 9) < (rank[left.kind] ?? 9) ? right : left;
  return right.updatedAt >= left.updatedAt ? right : left;
}

function terminalActivity(channelId, turn) {
  const terminal = turn?.terminal;
  if (!terminal) return null;
  const status = terminal.payload?.status;
  if (!['completed', 'failed', 'cancelled'].includes(status)) return null;
  const source = sourceRef(null, {
    channelId,
    view: 'dynamic',
    objectType: 'turn',
    objectId: turn.requestId,
    seq: turn.requestSeq,
    requestId: turn.requestId,
    envelopeId: terminal.id,
  });
  const requestText = string(turn.request?.payload?.title || turn.request?.payload?.text || turn.request?.type);
  return {
    key: `activity:${factKey(source, `${channelId}:turn:${turn.requestId}`)}`,
    factKey: factKey(source),
    channelId,
    kind: 'terminal',
    title: requestText || '频道工作',
    summary: turnStatusLabel(turn),
    severity: status === 'failed' ? 'critical' : status === 'cancelled' ? 'warning' : 'info',
    actionableBySelf: false,
    updatedAt: timestamp(terminal.ts, turn.terminalSeq || turn.lastSeq),
    source,
  };
}

function workItemActivity(channelId, item) {
  if (!ATTENTION_WORK_ITEM_STATES.has(item?.state)) return null;
  const origin = sourceRef(item.source, {
    channelId,
    view: 'dynamic',
    objectType: 'turn',
    objectId: item.nativeId || item.key,
  });
  const source = sourceRef(null, {
    channelId,
    view: 'tasks',
    objectType: 'work_item',
    objectId: item.key || item.nativeId,
  });
  if (!source || !origin || origin.channelId !== channelId) return null;
  const actionable = Boolean(item.actionableBySelf);
  const identity = factKey(origin, item.key);
  return {
    key: `activity:${identity}`,
    factKey: identity,
    channelId,
    kind: 'work_item',
    title: string(item.title) || '待处理工作',
    summary: string(item.waitingFor) || string(item.state),
    severity: ['failed', 'blocked', 'expired'].includes(item.state) ? 'critical' : actionable ? 'warning' : 'info',
    actionableBySelf: actionable,
    updatedAt: timestamp(item.updatedAt, timestamp(item.createdAt)),
    source,
  };
}

function narrationActivity(channelId, item) {
  const envelope = item?.envelope;
  const presentation = envelope ? systemEventPresentation(envelope) : null;
  if (!presentation || presentation.hidden || presentation.tier !== 'important') return null;
  const source = sourceRef(null, {
    channelId,
    view: 'dynamic',
    objectType: 'entry',
    objectId: envelope.id,
    seq: item.seq,
    envelopeId: envelope.id,
  });
  return {
    key: `activity:${factKey(source, `${channelId}:narration:${item.seq}`)}`,
    factKey: factKey(source),
    channelId,
    kind: 'membership',
    title: presentation.title,
    summary: string(envelope.type),
    severity: envelope.payload?.severity === 'critical' ? 'critical' : 'warning',
    actionableBySelf: false,
    updatedAt: timestamp(envelope.ts, item.seq),
    source,
  };
}

function operationActivity(channelId, operation) {
  if (!['uncertain', 'partial', 'failed'].includes(operation?.state)) return null;
  const source = sourceRef(operation.source, {
    channelId,
    view: 'dynamic',
    objectType: 'operation',
    objectId: operation.operationId || operation.key,
    requestId: operation.requestId,
  });
  if (!source || source.channelId !== channelId) return null;
  return {
    key: `activity:${factKey(source, operation.key)}`,
    factKey: factKey(source, operation.key),
    channelId,
    kind: 'operation',
    title: string(operation.title) || '后台操作',
    summary: string(operation.state),
    severity: operation.state === 'failed' ? 'critical' : 'warning',
    actionableBySelf: true,
    updatedAt: timestamp(operation.updatedAt, operation.startedAt),
    source,
  };
}

function visibleChannels(channels) {
  return values(channels).filter(isActivityChannelVisible);
}

export function buildOperationIndex({ channels = [], operations = [] } = {}) {
  const allowed = new Set(visibleChannels(channels).map(channelIdOf));
  const index = new Map();
  for (const operation of values(operations)) {
    const channelId = string(operation?.channelId || operation?.source?.channelId);
    const operationId = string(operation?.operationId || operation?.key);
    if (!allowed.has(channelId) || !operationId) continue;
    const source = sourceRef(operation.source, {
      channelId,
      view: 'dynamic',
      objectType: 'operation',
      objectId: operationId,
      requestId: operation.requestId,
    });
    if (!source || source.channelId !== channelId) continue;
    const key = `operation:${channelId}:${operationId}`;
    const normalized = {
      key,
      operationId,
      channelId,
      kind: string(operation.kind),
      title: string(operation.title) || '后台操作',
      state: string(operation.state),
      source,
      ...(string(operation.requestId) ? { requestId: string(operation.requestId) } : {}),
      ...(string(operation.resourceId) ? { resourceId: string(operation.resourceId) } : {}),
      startedAt: timestamp(operation.startedAt),
      updatedAt: timestamp(operation.updatedAt, timestamp(operation.startedAt)),
      checkpoints: Array.isArray(operation.checkpoints) ? operation.checkpoints.map((checkpoint) => ({
        id: string(checkpoint?.id),
        label: string(checkpoint?.label),
        state: string(checkpoint?.state),
      })).filter((checkpoint) => checkpoint.id) : [],
      recoveries: Array.isArray(operation.recoveries) ? operation.recoveries.map(string).filter(Boolean) : [],
      ...(operation.error && typeof operation.error === 'object' ? { error: {
        code: string(operation.error.code) || 'unknown',
        ...(string(operation.error.detail) ? { detail: string(operation.error.detail) } : {}),
      } } : {}),
      ...(string(operation.provenance) ? { provenance: string(operation.provenance) } : {}),
    };
    const previous = index.get(key);
    if (!previous || timestamp(normalized.updatedAt, normalized.startedAt) >= timestamp(previous.updatedAt, previous.startedAt)) index.set(key, normalized);
  }
  return index;
}

export function activeOperations(index) {
  return values(index)
    .filter((item) => ACTIVE_OPERATION_STATES.has(item.state))
    .sort((left, right) => timestamp(right.updatedAt, right.startedAt) - timestamp(left.updatedAt, left.startedAt) || left.key.localeCompare(right.key));
}

export function buildActivityIndex({ channels = [], operations = [] } = {}) {
  const operationIndex = buildOperationIndex({ channels, operations });
  const byFact = new Map();
  const add = (item) => {
    if (!item) return;
    const previous = byFact.get(item.factKey);
    byFact.set(item.factKey, previous ? preferActivity(previous, item) : item);
  };
  for (const channel of visibleChannels(channels)) {
    const channelId = channelIdOf(channel);
    for (const item of values(channel.workItems)) add(workItemActivity(channelId, item));
    for (const turn of channel.state?.turns?.values?.() || []) add(terminalActivity(channelId, turn));
    for (const item of channel.state?.narration || []) add(narrationActivity(channelId, item));
  }
  for (const operation of operationIndex.values()) add(operationActivity(operation.channelId, operation));
  return new Map([...byFact.values()]
    .sort((left, right) => activityPriority(left) - activityPriority(right) || right.updatedAt - left.updatedAt || left.key.localeCompare(right.key))
    .map((item) => [item.key, item]));
}

function normalizeSearchText(...parts) {
  return parts.flat(Infinity).filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushSearch(index, item, searchParts, { facts, identity = '', rank = 9 } = {}) {
  if (!item.source) return;
  const normalized = { ...item, searchText: normalizeSearchText(item.title, item.subtitle, searchParts) };
  if (identity && facts) {
    const previous = facts.get(identity);
    if (previous && (previous.rank < rank || (previous.rank === rank && previous.updatedAt >= normalized.updatedAt))) return;
    if (previous) index.delete(previous.key);
    facts.set(identity, { key: normalized.key, rank, updatedAt: normalized.updatedAt });
  }
  index.set(normalized.key, normalized);
}

function requestSearchIdentity(channelId, source) {
  if (!source || source.channelId !== channelId) return '';
  const requestId = string(source.requestId) || (source.objectType === 'turn' ? string(source.objectId) : '');
  return requestId ? `${channelId}:request:${requestId}` : '';
}

function turnSearchItem(channelId, turn) {
  const request = turn?.request || {};
  const source = sourceRef(null, { channelId, view: 'dynamic', objectType: 'turn', objectId: turn.requestId, seq: turn.requestSeq, requestId: turn.requestId, envelopeId: request.id });
  const title = string(request.payload?.title || request.payload?.text || request.type) || '频道工作';
  const responseText = string(turn.terminal?.payload?.text || turn.terminal?.payload?.detail);
  return {
    key: `search:${channelId}:turn:${turn.requestId}`,
    channelId,
    kind: 'turn',
    title,
    subtitle: responseText,
    updatedAt: timestamp(turn.terminal?.ts || request.ts, turn.lastSeq),
    source,
    searchParts: [request.type, request.sender?.id, request.audience, responseText],
  };
}

function standaloneSearchItem(channelId, item) {
  const envelope = item?.envelope || {};
  const title = string(envelope.payload?.title || envelope.payload?.text || envelope.payload?.message || envelope.payload?.detail || envelope.type);
  const source = sourceRef(null, { channelId, view: 'dynamic', objectType: 'entry', objectId: envelope.id, seq: item.seq, envelopeId: envelope.id });
  if (!title || !source) return null;
  return {
    key: `search:${channelId}:entry:${envelope.id}`,
    channelId,
    kind: 'entry',
    title,
    subtitle: string(envelope.type),
    updatedAt: timestamp(envelope.ts, item.seq),
    source,
    searchParts: [envelope.sender?.id, envelope.audience],
  };
}

export function buildGlobalSearchIndex({ channels = [], operations = [] } = {}) {
  const index = new Map();
  const facts = new Map();
  for (const channel of visibleChannels(channels)) {
    const channelId = channelIdOf(channel);
    const name = channelName(channel);
    pushSearch(index, {
      key: `search:${channelId}:channel`, channelId, kind: 'channel', title: name, subtitle: channelId,
      updatedAt: timestamp(channel?.state?.lastSeq), source: channelSource(channelId),
    }, [channel?.description]);

    for (const turn of channel.state?.turns?.values?.() || []) {
      const item = turnSearchItem(channelId, turn);
      pushSearch(index, item, item.searchParts, { facts, identity: `${channelId}:request:${turn.requestId}`, rank: 2 });
    }
    for (const row of channel.state?.standalone || []) {
      const item = standaloneSearchItem(channelId, row);
      if (item) pushSearch(index, item, item.searchParts);
    }
    for (const artifact of values(channel.artifacts)) {
      if (artifact.source?.channelId && artifact.source.channelId !== channelId) continue;
      const source = sourceRef(null, { channelId, view: 'artifacts', objectType: 'artifact', objectId: artifact.key || artifact.resourceId });
      if (!source) continue;
      pushSearch(index, {
        key: `search:${channelId}:artifact:${artifact.key || artifact.resourceId}`, channelId, kind: 'artifact',
        title: string(artifact.name) || string(artifact.resourceId), subtitle: string(artifact.mediaType || artifact.kind),
        updatedAt: timestamp(artifact.createdAt, artifact.lastSeq), source,
      }, [artifact.resourceId, artifact.authorActorId, artifact.kind]);
    }
    for (const workItem of values(channel.workItems)) {
      if (workItem.source?.channelId && workItem.source.channelId !== channelId) continue;
      const source = sourceRef(null, { channelId, view: 'tasks', objectType: 'work_item', objectId: workItem.key || workItem.nativeId });
      if (!source) continue;
      const origin = sourceRef(workItem.source, { channelId, view: 'dynamic', objectType: '', objectId: '' });
      const identity = ['agent_run', 'approval'].includes(workItem.kind) ? requestSearchIdentity(channelId, origin) : '';
      pushSearch(index, {
        key: `search:${channelId}:work_item:${workItem.key || workItem.nativeId}`, channelId, kind: 'work_item',
        title: string(workItem.title) || '未命名工作', subtitle: string(workItem.waitingFor || workItem.state),
        updatedAt: timestamp(workItem.updatedAt, workItem.createdAt), source,
      }, [workItem.nativeId, workItem.kind, workItem.assigneeActorIds], { facts, identity, rank: 0 });
    }
    for (const participant of values(channel.participants || channel.roster)) {
      const participantId = string(participant.id || participant.actorId);
      if (!participantId || STANDARD_ACTOR_IDS.has(participantId) || STANDARD_ACTOR_DECL_IDS.has(participant.decl_id)) continue;
      pushSearch(index, {
        key: `search:${channelId}:participant:${participantId}`, channelId, kind: 'participant',
        title: string(participant.name) || participantId, subtitle: string(participant.description || participant.kind),
        updatedAt: timestamp(participant.updatedAt), source: { channelId, view: 'dynamic', objectType: 'participant', objectId: participantId },
      }, [participantId, participant.principal, participant.decl_id]);
    }
  }
  for (const operation of buildOperationIndex({ channels, operations }).values()) {
    const identity = requestSearchIdentity(operation.channelId, operation.source);
    pushSearch(index, {
      key: `search:${operation.channelId}:operation:${operation.operationId}`, channelId: operation.channelId, kind: 'operation',
      title: string(operation.title) || '后台操作', subtitle: string(operation.state),
      updatedAt: timestamp(operation.updatedAt, operation.startedAt), source: operation.source,
    }, [operation.kind, operation.requestId, operation.resourceId], { facts, identity, rank: 1 });
  }
  return index;
}

function matchScore(item, terms) {
  let score = 0;
  const title = normalizeSearchText(item.title);
  for (const term of terms) {
    if (!item.searchText.includes(term)) return -1;
    if (title === term) score += 100;
    else if (title.startsWith(term)) score += 40;
    else if (title.includes(term)) score += 20;
    else score += 5;
  }
  return score;
}

export function searchGlobalIndex(index, query, { kinds, channelId = '', limit = 30 } = {}) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  if (!terms.length || limit <= 0) return [];
  const allowedKinds = kinds ? new Set(kinds) : null;
  return values(index)
    .filter((item) => (!channelId || item.channelId === channelId) && (!allowedKinds || allowedKinds.has(item.kind)))
    .map((item) => ({ item, score: matchScore(item, terms) }))
    .filter((match) => match.score >= 0)
    .sort((left, right) => right.score - left.score || right.item.updatedAt - left.item.updatedAt || left.item.key.localeCompare(right.item.key))
    .slice(0, Math.max(0, Math.floor(limit)))
    .map(({ item, score }) => ({ ...item, score }));
}
