import { selectTimelineItems } from './conversation-presentation.js';
import { terminalResultPayload } from './terminal-result.js';
import { argsOf } from '../protocol/envelope.js';

const READABLE_ACCESS = new Set([
  'member_active',
  'member_stale',
  'member_unavailable',
  'observer_active',
  'observer_stale',
]);

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
  if (value instanceof Map || typeof value?.values === 'function') return [...value.values()];
  return Array.isArray(value) ? value : [];
}

function timestamp(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteSeq(value) {
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
}

function channelIdOf(channel) {
  return string(channel?.id || channel?.channelId || channel?.state?.channelId);
}

function channelName(channel) {
  return string(channel?.qualified_name || channel?.name || channel?.profile?.name) || channelIdOf(channel);
}

function channelCanExposeContent(channel) {
  const channelId = channelIdOf(channel);
  if (!channelId) return false;
  const access = string(channel?.access || channel?.accessState?.mode || channel?.mode);
  return access ? READABLE_ACCESS.has(access) : true;
}

function normalizeSearchText(...parts) {
  return parts.flat(Infinity)
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/gu, ' ')
    .trim();
}

function readingLocator(channelId, messageID, seq) {
  if (!channelId || !messageID) return null;
  return Object.freeze({
    channelId,
    viewKey: 'conversation',
    bookmark: Object.freeze({ messageID: String(messageID), seq: finiteSeq(seq) }),
  });
}

// Search never owns reading state. This is the whole hand-off contract to the
// composition root: select the channel/view, then ask the Reading owner to
// resolve this semantic bookmark against its committed Presentation.
export function featureSearchReadingLocator(source) {
  const locator = source?.readingLocator;
  const channelId = string(locator?.channelId);
  const messageID = string(locator?.bookmark?.messageID);
  if (!channelId || locator?.viewKey !== 'conversation' || !messageID) return null;
  return readingLocator(channelId, messageID, locator.bookmark.seq);
}

function conversationSource({ channelId, objectType, objectId, seq, requestId = '', envelopeId = '', rowID = '' }) {
  if (!channelId || !objectType || !objectId) return null;
  const locator = readingLocator(channelId, rowID || objectId, seq);
  return Object.freeze({
    kind: 'message',
    channelId,
    view: 'dynamic',
    objectType,
    objectId,
    ...(finiteSeq(seq) ? { seq: finiteSeq(seq) } : {}),
    ...(requestId ? { requestId } : {}),
    ...(envelopeId ? { envelopeId } : {}),
    ...(locator ? { readingLocator: locator } : {}),
  });
}

function envelopeTitle(envelope) {
  const body = argsOf(envelope);
  return string(body.title || body.text || body.message || body.detail || envelope?.type);
}

function entryLocation(entry, channelId, rowID) {
  if (entry?.kind === 'turn') {
    const turn = entry.turn || {};
    const requestId = string(turn.requestId || turn.request?.id);
    if (!requestId) return null;
    return conversationSource({
      channelId,
      objectType: 'turn',
      objectId: requestId,
      seq: turn.requestSeq || entry.seq,
      requestId,
      envelopeId: string(turn.request?.id),
      rowID,
    });
  }
  const envelope = entry?.envelope;
  const envelopeId = string(envelope?.id);
  if (!envelopeId) return null;
  return conversationSource({
    channelId,
    objectType: 'entry',
    objectId: envelopeId,
    seq: entry.seq,
    envelopeId,
    rowID,
  });
}

function turnSearchRow(entry, channel, rowID) {
  const turn = entry?.turn || {};
  const request = turn.request || {};
  const requestId = string(turn.requestId || request.id);
  const source = entryLocation(entry, channel.id, rowID);
  if (!requestId || !source) return null;
  const workItemKey = request.type === 'agent.ask'
    ? `agent_run:${channel.id}:${requestId}`
    : '';
  const resultSource = workItemKey ? Object.freeze({ ...source, workItemKey }) : source;
  const terminal = terminalResultPayload(turn);
  const responseText = string(terminal?.text || terminal?.detail);
  return Object.freeze({
    key: `search:${channel.id}:turn:${requestId}`,
    id: requestId,
    kind: 'turn',
    objectType: 'turn',
    title: envelopeTitle(request) || '频道工作',
    subtitle: responseText,
    text: normalizeSearchText(
      request.type,
      request.sender?.id,
      request.audience,
      responseText,
      ...(turn.provisional || []).map((row) => envelopeTitle(row?.envelope)),
    ),
    updatedAt: timestamp(turn.terminal?.ts || request.ts, turn.lastSeq),
    channelId: channel.id,
    channelName: channelName(channel),
    source: resultSource,
  });
}

function standaloneSearchRow(entry, channel, rowID) {
  const envelope = entry?.envelope || {};
  const envelopeId = string(envelope.id);
  const title = envelopeTitle(envelope);
  const source = entryLocation(entry, channel.id, rowID);
  if (!envelopeId || !title || !source) return null;
  return Object.freeze({
    key: `search:${channel.id}:entry:${envelopeId}`,
    id: envelopeId,
    kind: 'entry',
    objectType: 'entry',
    title,
    subtitle: string(envelope.type),
    text: normalizeSearchText(envelope.sender?.id, envelope.audience),
    updatedAt: timestamp(envelope.ts, entry.seq),
    channelId: channel.id,
    channelName: channelName(channel),
    source,
  });
}

function attachmentFact(value) {
  if (!value || typeof value !== 'object') return null;
  const resourceId = string(value.resource_id || value.resourceId);
  if (!resourceId) return null;
  const versionOf = string(value.version_of || value.versionOf);
  return Object.freeze({
    resourceId,
    name: string(value.name) || resourceId,
    mediaType: string(value.media_type || value.mediaType) || 'application/octet-stream',
    kind: string(value.artifact_kind || value.kind),
    ...(versionOf ? { versionOf } : {}),
  });
}

function attachmentFacts(envelope) {
  if (!envelope) return [];
  const body = argsOf(envelope);
  const terminal = envelope.kind === 'response'
    && ['completed', 'failed', 'cancelled'].includes(body.status);
  const facts = [];
  if ((envelope.kind === 'request' || terminal) && Array.isArray(body.attachments)) {
    facts.push(...body.attachments.map(attachmentFact).filter(Boolean));
  }
  if ((envelope.kind === 'request' || terminal) && Array.isArray(body.files)) {
    facts.push(...body.files.map(attachmentFact).filter(Boolean));
  }
  if (terminal) {
    const single = attachmentFact(body.attachment);
    if (single) facts.push(single);
    const artifact = attachmentFact(body.artifact);
    if (artifact) facts.push(artifact);
  }
  return facts;
}

function entryEnvelopes(entry) {
  if (entry?.kind !== 'turn') return entry?.envelope ? [entry.envelope] : [];
  return [entry.turn?.request, entry.turn?.terminal].filter(Boolean);
}

function visitEntries(entries, visit, inheritedRowID = '') {
  for (const entry of entries || []) {
    const rowID = inheritedRowID
      || string(entry?.kind === 'turn' ? entry.turn?.requestId || entry.turn?.request?.id : entry?.envelope?.id);
    visit(entry, rowID);
    visitEntries(entry?.thread, visit, rowID);
  }
}

function addArtifactReference(artifacts, fact, entry, channel, rowID, envelope) {
  const entrySource = entryLocation(entry, channel.id, rowID);
  if (!entrySource) return;
  const key = `search:${channel.id}:artifact:${fact.resourceId}`;
  const versionKey = fact.versionOf ? `search:${channel.id}:artifact:${fact.versionOf}` : undefined;
  const reference = Object.freeze({
    ...entrySource,
    envelopeId: string(envelope?.id) || entrySource.envelopeId,
    resourceId: fact.resourceId,
  });
  const existing = artifacts.get(key);
  if (existing) {
    existing.references.push(reference);
    existing.updatedAt = Math.max(existing.updatedAt, timestamp(envelope?.ts, entry?.seq));
    if (existing.title === existing.resourceId && fact.name) existing.title = fact.name;
    if (existing.subtitle === 'application/octet-stream' && fact.mediaType) existing.subtitle = fact.mediaType;
    if (!existing.versionOf && versionKey) existing.versionOf = versionKey;
    return;
  }
  artifacts.set(key, {
    key,
    id: fact.resourceId,
    resourceId: fact.resourceId,
    kind: 'artifact',
    objectType: 'artifact',
    title: fact.name,
    subtitle: fact.mediaType || fact.kind,
    text: normalizeSearchText(fact.resourceId, fact.kind),
    updatedAt: timestamp(envelope?.ts, entry?.seq),
    channelId: channel.id,
    channelName: channelName(channel),
    ...(versionKey ? { versionOf: versionKey } : {}),
    source: Object.freeze({
      kind: 'file-reference',
      channelId: channel.id,
      view: 'artifacts',
      objectType: 'artifact',
      objectId: fact.resourceId,
      fileId: fact.resourceId,
      resourceId: fact.resourceId,
      readingLocator: entrySource.readingLocator,
    }),
    references: [reference],
  });
}

function channelProjectionRows(state, channel) {
  const rows = [];
  const artifacts = new Map();
  const projection = selectTimelineItems(state, { scope: 'all' });
  visitEntries(projection.items, (entry, rowID) => {
    const row = entry?.kind === 'turn'
      ? turnSearchRow(entry, channel, rowID)
      : standaloneSearchRow(entry, channel, rowID);
    if (row) rows.push(row);
    for (const envelope of entryEnvelopes(entry)) {
      for (const fact of attachmentFacts(envelope)) {
        addArtifactReference(artifacts, fact, entry, channel, rowID, envelope);
      }
    }
  });
  rows.push(...[...artifacts.values()].map((artifact) => Object.freeze({
    ...artifact,
    references: Object.freeze(artifact.references),
  })));
  return rows;
}

function ownedRows(input) {
  if (input instanceof Map || typeof input?.entries === 'function') {
    return [...input.entries()].flatMap(([channelId, value]) => Array.isArray(value)
      ? value.map((row) => ({ row, channelId }))
      : [{ row: value, channelId: value?.channelId || channelId }]);
  }
  return [...(input || [])].map((row) => ({ row, channelId: row?.channelId || '' }));
}

function taskSearchRow(item, fallbackChannelId, channelById) {
  const channelId = string(item?.channelId || fallbackChannelId);
  const channel = channelById.get(channelId);
  const id = string(item?.key || item?.id);
  if (!id || !channelCanExposeContent(channel)) return null;
  return Object.freeze({
    key: `search:${channelId}:work_item:${id}`,
    id,
    kind: 'work_item',
    objectType: 'work_item',
    title: string(item.title || item.text) || '未命名工作',
    text: normalizeSearchText(item.description, item.waitingFor, item.nativeId, item.kind, item.assigneeActorIds),
    subtitle: string(item.waitingFor || item.state),
    workItemKind: string(item.kind),
    requestId: string(item.source?.requestId || item.requestId),
    updatedAt: timestamp(item.updatedAt, timestamp(item.createdAt)),
    channelId,
    channelName: channelName(channel),
    source: Object.freeze({
      kind: 'task', channelId, view: 'tasks', objectType: 'work_item', objectId: id, taskId: id,
    }),
  });
}

function fileSearchRow(entry, fallbackChannelId, channelById) {
  const channelId = string(entry?.channelId || fallbackChannelId);
  const channel = channelById.get(channelId);
  const id = string(entry?.resourceId || entry?.path || entry?.key);
  if (entry?.kind !== 'file' || !id || !channelCanExposeContent(channel)) return null;
  return Object.freeze({
    key: `search:${channelId}:artifact:${id}`,
    id,
    resourceId: id,
    kind: 'artifact',
    objectType: 'artifact',
    title: string(entry.name) || id,
    text: normalizeSearchText(id, entry.path, entry.kind),
    subtitle: string(entry.mediaType) || 'application/octet-stream',
    updatedAt: timestamp(entry.updatedAt, timestamp(entry.createdAt)),
    channelId,
    channelName: channelName(channel),
    source: Object.freeze({
      kind: 'file', channelId, view: 'artifacts', objectType: 'artifact', objectId: id, fileId: id,
    }),
  });
}

function participantSearchRow(actor, channel) {
  const actorId = string(actor?.id || actor?.actorId);
  if (!actorId || STANDARD_ACTOR_IDS.has(actorId) || STANDARD_ACTOR_DECL_IDS.has(actor?.decl_id)) return null;
  return Object.freeze({
    key: `search:${channel.id}:participant:${actorId}`,
    id: actorId,
    kind: 'participant',
    objectType: 'participant',
    title: string(actor.name) || actorId,
    text: normalizeSearchText(actorId, actor.principal, actor.decl_id),
    subtitle: string(actor.description || actor.kind),
    updatedAt: timestamp(actor.updatedAt),
    actorId,
    channelId: channel.id,
    channelName: channelName(channel),
    source: Object.freeze({
      kind: 'actor', channelId: channel.id, view: 'dynamic', objectType: 'participant', objectId: actorId, actorId,
    }),
  });
}

const OPERATION_TERMINAL_STATES = new Set([
  'completed',
  'cancelled',
  'canceled',
  'succeeded',
  'success',
  'done',
  'settled',
]);

const PUBLIC_SOURCE_VIEWS = new Set(['dynamic', 'conversation', 'artifacts', 'files', 'tasks']);

function operationSourceRef(operation, fallback) {
  const source = operation?.source || {};
  const channelId = string(source.channelId || fallback.channelId);
  const objectId = string(source.objectId || fallback.objectId);
  if (!channelId || !objectId) return null;
  const view = PUBLIC_SOURCE_VIEWS.has(source.view)
    ? source.view
    : PUBLIC_SOURCE_VIEWS.has(fallback.view) ? fallback.view : 'dynamic';
  const objectType = string(source.objectType || fallback.objectType) || 'operation';
  const seq = finiteSeq(source.seq || fallback.seq);
  const requestId = string(source.requestId || fallback.requestId);
  const envelopeId = string(source.envelopeId || fallback.envelopeId);
  return Object.freeze({
    kind: 'operation',
    channelId,
    view,
    objectType,
    objectId,
    ...(seq ? { seq } : {}),
    ...(requestId ? { requestId } : {}),
    ...(envelopeId ? { envelopeId } : {}),
  });
}

function operationSearchRow(operation, fallbackChannelId, channelById) {
  const channelId = string(operation?.channelId || operation?.source?.channelId || fallbackChannelId);
  const channel = channelById.get(channelId);
  const operationId = string(operation?.operationId || operation?.nativeId || operation?.id || operation?.key);
  const state = string(operation?.state).toLocaleLowerCase('en-US');
  if (!operationId || !channelCanExposeContent(channel)) return null;
  const requestId = string(operation?.requestId || operation?.source?.requestId);
  const source = operationSourceRef(operation, {
    channelId,
    view: 'dynamic',
    objectType: 'operation',
    objectId: operationId,
    requestId,
  });
  if (!source) return null;
  const title = string(operation?.title || operation?.name || operation?.detail) || operationId;
  const detail = string(operation?.detail || operation?.description);
  const updatedAt = timestamp(operation?.updatedAt, timestamp(operation?.createdAt, timestamp(operation?.startedAt)));
  return Object.freeze({
    key: `search:${channelId}:operation:${operationId}`,
    id: operationId,
    operationId,
    kind: 'operation',
    objectType: 'operation',
    title,
    subtitle: detail || state || '有更新',
    text: normalizeSearchText(
      title,
      detail,
      state,
      operation?.kind,
      requestId,
      operation?.resourceId,
      operation?.resource_id,
    ),
    state,
    updatedAt,
    channelId,
    channelName: channelName(channel),
    ...(requestId ? { requestId } : {}),
    source,
  });
}

function operationProjectionRows(operations, channelById) {
  const latest = new Map();
  for (const { row, channelId } of ownedRows(operations)) {
    const operation = operationSearchRow(row, channelId, channelById);
    if (!operation) continue;
    const identity = `${operation.channelId}:operation:${operation.operationId}`;
    const previous = latest.get(identity);
    if (!previous || operation.updatedAt >= previous.updatedAt) latest.set(identity, operation);
  }
  return [...latest.values()].filter((operation) => !OPERATION_TERMINAL_STATES.has(operation.state));
}

// A pure projection over owner snapshots. Search neither loads history nor
// retains a shadow corpus; every row disappears when its supplying snapshot
// disappears. Message attachment references are derived from the same visible
// conversation Presentation so their Reading locators cannot target hidden
// rows.
export function selectFeatureSearchIndex({
  states = [],
  channels = [],
  rosters = new Map(),
  tasks = [],
  files = [],
  operations = [],
} = {}) {
  const stateEntries = [...(states || [])];
  const stateByChannel = new Map(stateEntries);
  const visibleChannels = (channels || []).filter(channelCanExposeContent);
  const channelById = new Map(visibleChannels.map((channel) => [channelIdOf(channel), { ...channel, id: channelIdOf(channel) }]));
  const rows = visibleChannels.map((channel) => {
    const channelId = channelIdOf(channel);
    const name = channelName(channel);
    return Object.freeze({
      key: `search:${channelId}:channel`,
      id: channelId,
      kind: 'channel',
      objectType: 'channel',
      title: name,
      text: normalizeSearchText(channel.description),
      subtitle: channelId,
      updatedAt: timestamp(channel?.state?.lastSeq, timestamp(stateByChannel.get(channelId)?.lastSeq)),
      channelId,
      channelName: name,
      source: Object.freeze({
        kind: 'channel', channelId, view: 'dynamic', objectType: 'channel', objectId: channelId,
      }),
    });
  });

  for (const [channelId, state] of stateEntries) {
    const channel = channelById.get(channelId);
    if (!channel) continue;
    rows.push(...channelProjectionRows(state, channel));
  }
  for (const [channelId, actors] of rosters || []) {
    const channel = channelById.get(channelId);
    if (!channel) continue;
    for (const actor of actors || []) {
      const row = participantSearchRow(actor, channel);
      if (row) rows.push(row);
    }
  }
  for (const { row, channelId } of ownedRows(tasks)) {
    const task = taskSearchRow(row, channelId, channelById);
    if (task) rows.push(task);
  }
  for (const { row, channelId } of ownedRows(files)) {
    const file = fileSearchRow(row, channelId, channelById);
    if (file) rows.push(file);
  }
  rows.push(...operationProjectionRows(operations, channelById));

  const unique = new Map();
  const requestFacts = new Map();
  for (const row of rows) {
    const requestId = row.kind === 'operation'
      ? row.requestId
      : row.kind === 'turn'
      ? string(row.source?.requestId || row.source?.objectId)
      : row.kind === 'work_item' && ['agent_run', 'approval'].includes(row.workItemKind)
        ? row.requestId
        : '';
    const identity = requestId ? `${row.channelId}:request:${requestId}` : '';
    const rank = row.kind === 'work_item' ? 0 : row.kind === 'operation' ? 1 : row.kind === 'turn' ? 2 : 9;
    const previousFact = identity ? requestFacts.get(identity) : null;
    if (previousFact && (previousFact.rank < rank
      || (previousFact.rank === rank && previousFact.updatedAt >= Number(row.updatedAt || 0)))) continue;
    if (previousFact) unique.delete(previousFact.key);
    const previous = unique.get(row.key);
    const previousLocatable = Boolean(featureSearchReadingLocator(previous?.source));
    const nextLocatable = Boolean(featureSearchReadingLocator(row?.source));
    if (!previous
      || (nextLocatable && !previousLocatable)
      || (nextLocatable === previousLocatable && Number(row.updatedAt || 0) >= Number(previous.updatedAt || 0))) {
      unique.set(row.key, row);
    }
    if (identity) requestFacts.set(identity, { key: row.key, rank, updatedAt: Number(row.updatedAt || 0) });
  }
  return Object.freeze([...unique.values()]);
}

function matchScore(row, terms) {
  const haystack = normalizeSearchText(
    row?.title,
    row?.subtitle,
    row?.channelName,
    row?.channelId,
    row?.text,
    row?.name,
    row?.actorId,
    row?.resourceId,
  );
  const title = normalizeSearchText(row?.title || row?.name || '未命名结果');
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) return -1;
    if (title === term) score += 100;
    else if (title.startsWith(term)) score += 40;
    else if (title.includes(term)) score += 20;
    else score += 5;
  }
  return score;
}

export function searchFeatureIndex(index = [], query = '', options = 40) {
  const { kinds, channelId = '', limit = 40 } = typeof options === 'number' ? { limit: options } : (options || {});
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  if (!terms.length || limit <= 0) return [];
  const allowedKinds = kinds ? new Set(kinds) : null;
  return values(index)
    .filter((row) => (!channelId || row.channelId === channelId) && (!allowedKinds || allowedKinds.has(row.kind)))
    .map((row) => ({ row, score: matchScore(row, terms) }))
    .filter((match) => match.score >= 0)
    .sort((left, right) => right.score - left.score
      || Number(right.row.updatedAt || 0) - Number(left.row.updatedAt || 0)
      || left.row.key.localeCompare(right.row.key))
    .slice(0, Math.max(0, Math.floor(limit)))
    .map(({ row, score }) => Object.freeze({ ...row, score }));
}
