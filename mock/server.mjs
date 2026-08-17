import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const FRAME_VERSION = 2;
const MAX_FRAME_BYTES = 512 * 1024;
const ROOT_ID = 'root';
const ROOT_EMAIL = 'root@atoll.local';
const ROOT_ACTOR_ID = 'root';
const STEWARD_ACTOR_ID = 'steward';
const SYSTEM_ACTOR_ID = 'system';
const SESSION_COOKIE = 'atoll_session';
const CONTRACT_VERSION = 'mock-v2';

const PAYLOAD_FIELDS = Object.freeze({
  attach: ['since'],
  submit: ['channel_id', 'id', 'msg_type', 'kind', 'payload', 'audience', 'visibility', 'parent_id', 'expires_at_ms'],
  resolve: ['channel_id', 'req_id', 'decision', 'payload'],
  cancel: ['channel_id', 'req_id'],
  after: ['channel_id', 'duration_ms', 'msg_type', 'payload'],
  cancel_timer: ['channel_id', 'timer_id'],
  resource: ['channel_id', 'op', 'resource_id', 'args', 'target', 'ops', 'query', 'address', 'with_content'],
  observe: ['channel_id'],
  unobserve: ['channel_id'],
});

const REQUIRED_FIELDS = Object.freeze({
  attach: [],
  submit: ['channel_id', 'msg_type'],
  resolve: ['channel_id', 'req_id', 'decision'],
  cancel: ['channel_id', 'req_id'],
  after: ['channel_id', 'duration_ms', 'msg_type'],
  cancel_timer: ['channel_id', 'timer_id'],
  resource: ['channel_id', 'op', 'resource_id'],
  observe: ['channel_id'],
  unobserve: ['channel_id'],
});

const now = () => Date.now();
const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

function json(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(`${JSON.stringify(value)}\n`);
}

function httpError(response, status, code, detail) {
  json(response, status, { code, detail });
}

function cookieValue(request, name) {
  const header = request.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

async function readJSON(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_FRAME_BYTES) throw new Error('request body exceeds size limit');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) throw new Error('unexpected end of JSON input');
  return JSON.parse(text);
}

function measure(name, value, observedAt = now()) {
  return { name, value, unknown: false, observed_at: observedAt, since: null };
}

function item(declared, measures = null, key = declared.id) {
  return {
    ...(key ? { key } : {}),
    declared,
    actual: measures == null ? null : { measures },
  };
}

function observation(subject, kind, items) {
  return { subject, kind, complete: true, items };
}

function channelRow(id, { parentId = '', name = id, qualifiedName = id, serving = true } = {}) {
  const declared = {
    id,
    ...(parentId ? { parent_id: parentId } : {}),
    name,
    qualified_name: qualifiedName,
    type: 'group',
    status: 'present',
    owner_principal: ROOT_ID,
    created_at: 1_723_974_400_000,
  };
  return item(declared, [measure('open', serving)]);
}

function rosterItem({ id, kind, declId = '', name = id, description = '', bound = true, online = null }) {
  const declared = {
    id,
    kind,
    ...(declId ? { decl_id: declId } : {}),
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
  const measures = [measure('bound', bound)];
  if (online == null) {
    measures.push({
      name: 'device_online',
      value: null,
      unknown: true,
      reason: 'no_testimony',
      observed_at: now(),
      since: null,
    });
  } else {
    measures.push(measure('device_online', online));
  }
  measures.sort((left, right) => left.name.localeCompare(right.name));
  return item(declared, measures);
}

function envelope({
  id,
  channelId,
  sender,
  kind,
  type,
  payload = {},
  parentId = '',
  correlationId = '',
  visibility = 'public',
  audience = [],
  ts = now(),
}) {
  return {
    id,
    ts,
    channel_id: channelId,
    sender,
    kind,
    type,
    payload,
    ...(parentId ? { parent_id: parentId } : {}),
    ...(correlationId ? { correlation_id: correlationId } : {}),
    visibility,
    audience,
  };
}

function seededHistory(channelId) {
  const rows = [];
  const add = (value) => rows.push({ channel_id: channelId, seq: rows.length + 1, envelope: value });
  const root = { kind: 'human', id: ROOT_ACTOR_ID };
  const isLobby = channelId === 'c0.lobby';
  const responderId = isLobby ? 'coreactor' : STEWARD_ACTOR_ID;
  const responder = { kind: isLobby ? 'tool' : 'agent', id: responderId };
  const system = { kind: 'system', id: SYSTEM_ACTOR_ID };
  const base = 1_723_974_400_000;

  for (let index = 1; index <= 3; index += 1) {
    const requestId = `${channelId}-history-request-${index}`;
    const at = base + index * 10_000;
    const requestText = isLobby
      ? `Lobby history ${index}: inspect channel coordination`
      : `c0 history ${index}: ask steward for PONG`;
    const responseText = isLobby ? `Lobby coordination check ${index} complete` : `PONG ${index}`;
    const toolName = isLobby ? 'mock.lobby.status' : 'mock.echo';
    add(envelope({ id: requestId, channelId, sender: root, kind: 'request', type: 'human.text', payload: { text: requestText }, audience: [responderId], ts: at }));
    add(envelope({ id: `${requestId}-queued`, channelId, sender: responder, kind: 'response', type: 'human.text', payload: { status: 'queued', turn_index: index }, parentId: requestId, correlationId: requestId, audience: [ROOT_ACTOR_ID], ts: at + 1 }));
    add(envelope({ id: `${requestId}-processing`, channelId, sender: responder, kind: 'response', type: 'human.text', payload: { status: 'processing', turn_index: index }, parentId: requestId, correlationId: requestId, audience: [ROOT_ACTOR_ID], ts: at + 2 }));
    add(envelope({ id: `${requestId}-turn-started`, channelId, sender: responder, kind: 'event', type: 'activity.turn.started', payload: { turn_index: index, status: 'started' }, correlationId: requestId, audience: [ROOT_ACTOR_ID], ts: at + 3 }));
    add(envelope({ id: `${requestId}-tool-started`, channelId, sender: responder, kind: 'event', type: 'activity.tool.started', payload: { turn_index: index, tool_call_id: `${requestId}-tool`, tool: toolName, status: 'started' }, correlationId: requestId, audience: [ROOT_ACTOR_ID], ts: at + 4 }));
    add(envelope({ id: `${requestId}-tool-ended`, channelId, sender: responder, kind: 'event', type: 'activity.tool.ended', payload: { turn_index: index, tool_call_id: `${requestId}-tool`, tool: toolName, status: 'completed' }, correlationId: requestId, audience: [ROOT_ACTOR_ID], ts: at + 5 }));
    add(envelope({ id: `${requestId}-turn-ended`, channelId, sender: responder, kind: 'event', type: 'activity.turn.ended', payload: { turn_index: index, status: 'ok' }, correlationId: requestId, audience: [ROOT_ACTOR_ID], ts: at + 6 }));
    add(envelope({ id: `${requestId}-completed`, channelId, sender: responder, kind: 'response', type: 'human.text', payload: { status: 'completed', turn_index: index, text: responseText }, parentId: requestId, correlationId: requestId, audience: [ROOT_ACTOR_ID], ts: at + 7 }));
  }

  const registeredActors = isLobby ? ['coreactor', 'svcactor'] : ['steward', 'svcactor'];
  for (const [index, actorId] of registeredActors.entries()) {
    add(envelope({
      id: `${channelId}-registered-${actorId}`,
      channelId,
      sender: system,
      kind: 'event',
      type: 'system.actor.registered',
      payload: { actor_id: actorId, actor_kind: actorId === 'steward' ? 'agent' : 'tool', registered_at: base + 50_000 + index },
      visibility: 'system',
      ts: base + 50_000 + index,
    }));
  }

  add(envelope({
    id: `${channelId}-approval-1`,
    channelId,
    sender: responder,
    kind: 'request',
    type: 'human.approve',
    payload: { title: 'Approve mock action', detail: `Approval fixture for ${channelId}` },
    audience: [ROOT_ACTOR_ID],
    ts: base + 60_000,
  }));
  add(envelope({
    id: `${channelId}-summary`,
    channelId,
    sender: responder,
    kind: 'event',
    type: 'mock.channel.summary',
    payload: {
      text: isLobby
        ? 'Lobby 独立账本：负责频道协调与成员接入。'
        : 'c0 独立账本：负责 steward 的任务回合。',
    },
    audience: [ROOT_ACTOR_ID],
    ts: base + 70_000,
  }));
  return rows;
}

function validatePayload(type, payload) {
  if (!isObject(payload)) return `${type} payload must be an object`;
  const allowed = PAYLOAD_FIELDS[type];
  const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unknown.length) return `${type} payload has unknown field: ${unknown.sort().join(', ')}`;
  const missing = REQUIRED_FIELDS[type].filter((key) => payload[key] == null || payload[key] === '');
  if (missing.length) return `${type} payload is missing: ${missing.join(', ')}`;
  if (type !== 'attach' && typeof payload.channel_id !== 'string') return `${type} channel_id must be a string`;
  if (payload.id != null && typeof payload.id !== 'string') return `${type} id must be a string`;
  if (payload.req_id != null && typeof payload.req_id !== 'string') return `${type} req_id must be a string`;
  if (payload.msg_type != null && typeof payload.msg_type !== 'string') return `${type} msg_type must be a string`;
  if (payload.kind != null && typeof payload.kind !== 'string') return `${type} kind must be a string`;
  if (payload.visibility != null && typeof payload.visibility !== 'string') return `${type} visibility must be a string`;
  if (payload.audience != null && (!Array.isArray(payload.audience) || payload.audience.some((value) => typeof value !== 'string'))) return `${type} audience must be an array of strings`;
  if (payload.decision != null && typeof payload.decision !== 'string') return `${type} decision must be a string`;
  return '';
}

export function createMockServer({
  rootPassword = process.env.ATOLL_ROOT_PASSWORD || 'root',
  liveIntervalMs = 0,
} = {}) {
  const sessions = new Map();
  const sockets = new Set();
  const attached = new WeakSet();
  const scheduled = new Set();
  const recurring = new Set();
  const rosters = new Map([
    ['c0', [
      rosterItem({ id: ROOT_ACTOR_ID, kind: 'human', name: 'root', online: true, description: 'Root human member' }),
      rosterItem({ id: STEWARD_ACTOR_ID, kind: 'agent', declId: 'mock:steward', name: 'steward', description: 'codex agent' }),
      rosterItem({ id: SYSTEM_ACTOR_ID, kind: 'system', name: 'system', description: 'Channel system actor' }),
      rosterItem({ id: 'registrar', kind: 'tool', declId: 'atoll-internal:registrar-seat', name: 'registrar', description: 'Registrar seat tool' }),
      rosterItem({ id: 'svcactor', kind: 'tool', declId: 'atoll-internal:svcactor', name: 'svcactor', description: 'Service actor tool' }),
    ]],
    ['c0.lobby', [
      rosterItem({ id: ROOT_ACTOR_ID, kind: 'human', name: 'root', online: true, description: 'Root human member' }),
      rosterItem({ id: SYSTEM_ACTOR_ID, kind: 'system', name: 'system', description: 'Channel system actor' }),
      rosterItem({ id: 'coreactor', kind: 'tool', declId: 'coreactor', name: 'coreactor', description: 'Lobby core actor' }),
      rosterItem({ id: 'svcactor', kind: 'tool', declId: 'atoll-internal:svcactor', name: 'svcactor', description: 'Service actor tool' }),
    ]],
  ]);
  const histories = new Map([
    ['c0', seededHistory('c0')],
    ['c0.lobby', seededHistory('c0.lobby')],
  ]);
  const closedRequests = new Set();
  let introduced = 0;

  function authenticated(request) {
    const token = cookieValue(request, SESSION_COOKIE);
    return sessions.get(token) === ROOT_ID;
  }

  function setSession(response) {
    const token = randomUUID();
    sessions.set(token, ROOT_ID);
    response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
  }

  function sendFrame(socket, frameType, ref, payload) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      v: FRAME_VERSION,
      frame_type: frameType,
      ...(ref ? { ref } : {}),
      ...(payload != null ? { payload } : {}),
    }));
  }

  function sendError(socket, { ref = '', frame = '', code = 'bad_payload', detail = '' } = {}) {
    sendFrame(socket, 'error', ref, { frame, code, ...(detail ? { detail } : {}) });
  }

  function broadcast(row) {
    for (const socket of sockets) {
      if (attached.has(socket)) sendFrame(socket, 'feed', '', row);
    }
  }

  function append(channelId, value) {
    const history = histories.get(channelId);
    if (!history) return null;
    const row = { channel_id: channelId, seq: history.length + 1, envelope: value };
    history.push(row);
    broadcast(row);
    return row;
  }

  function later(delay, task) {
    const timer = setTimeout(() => {
      scheduled.delete(timer);
      task();
    }, delay);
    scheduled.add(timer);
  }

  function pushApproval(channelId = 'c0') {
    const id = `${channelId}-approval-${randomUUID()}`;
    append(channelId, envelope({
      id,
      channelId,
      sender: { kind: 'agent', id: STEWARD_ACTOR_ID },
      kind: 'request',
      type: 'human.approve',
      payload: { title: 'Approve live mock action', detail: 'Created by GET /mock/approve' },
      audience: [ROOT_ACTOR_ID],
    }));
    return id;
  }

  let liveTick = 0;
  function pushLiveDemo() {
    liveTick += 1;
    const channelId = liveTick % 2 === 1 ? 'c0' : 'c0.lobby';
    const isLobby = channelId === 'c0.lobby';
    append(channelId, envelope({
      id: `${channelId}-live-${randomUUID()}`,
      channelId,
      sender: isLobby
        ? { kind: 'tool', id: 'coreactor' }
        : { kind: 'agent', id: STEWARD_ACTOR_ID },
      kind: 'event',
      type: 'mock.channel.pulse',
      payload: {
        text: isLobby
          ? `Lobby 动态 #${liveTick}：coreactor 正在同步频道状态。`
          : `c0 动态 #${liveTick}：steward 在线，等待新任务。`,
        tick: liveTick,
      },
      audience: [ROOT_ACTOR_ID],
    }));
  }

  function handleSubmit(socket, ref, payload) {
    const channelId = payload.channel_id;
    const history = histories.get(channelId);
    if (!history) {
      sendError(socket, { ref, frame: 'submit', code: 'channel_not_found', detail: 'channel does not exist' });
      return;
    }
    const kind = payload.kind || 'request';
    if (!['request', 'event'].includes(kind) || typeof payload.msg_type !== 'string' || !payload.msg_type) {
      sendError(socket, { ref, frame: 'submit', code: 'bad_payload', detail: 'kind must be request or event and msg_type must be non-empty' });
      return;
    }
    if (payload.msg_type.startsWith('system.')) {
      sendError(socket, { ref, frame: 'submit', code: 'forbidden', detail: 'system.* types are reserved to the channel system actor' });
      return;
    }
    const audience = payload.audience || [];
    if (!Array.isArray(audience)) {
      sendError(socket, { ref, frame: 'submit', code: 'bad_payload', detail: 'audience must be an array' });
      return;
    }
    const members = new Set((rosters.get(channelId) || []).map((entry) => entry.declared.id));
    if (kind === 'request' && audience.length === 0) {
      sendError(socket, { ref, frame: 'submit', code: 'routing_unavailable', detail: 'request must name at least one recipient' });
      return;
    }
    if (audience.some((actorId) => typeof actorId !== 'string' || !members.has(actorId))) {
      sendError(socket, { ref, frame: 'submit', code: 'not_in_audience', detail: 'request audience must name channel members' });
      return;
    }
    if (payload.msg_type === 'channel.list' && audience.includes('registrar')) {
      sendError(socket, { ref, frame: 'submit', code: 'forbidden', detail: 'mock registrar capability is intentionally disabled for error-surface acceptance' });
      return;
    }
    if (payload.payload != null && !isObject(payload.payload)) {
      sendError(socket, { ref, frame: 'submit', code: 'bad_payload', detail: 'payload must be a JSON object' });
      return;
    }
    const messageId = payload.id || randomUUID();
    if (history.some((row) => row.envelope.id === messageId)) {
      sendError(socket, { ref, frame: 'submit', code: 'idempotency_conflict', detail: 'message id already exists with unknown mock fingerprint' });
      return;
    }
    sendFrame(socket, 'receipt', ref, { message_id: messageId });
    append(channelId, envelope({
      id: messageId,
      channelId,
      sender: { kind: 'human', id: ROOT_ACTOR_ID },
      kind,
      type: payload.msg_type,
      payload: payload.payload || {},
      parentId: payload.parent_id || '',
      visibility: payload.visibility || 'public',
      audience,
    }));

    if (kind !== 'request' || !audience.includes(STEWARD_ACTOR_ID)) return;
    const text = String(payload.payload?.text || '');
    const responseBase = {
      channelId,
      sender: { kind: 'agent', id: STEWARD_ACTOR_ID },
      parentId: messageId,
      correlationId: messageId,
      audience: [ROOT_ACTOR_ID],
    };
    later(20, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-queued`, kind: 'response', type: payload.msg_type, payload: { status: 'queued', turn_index: 1 } })));
    later(40, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-processing`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', turn_index: 1 } })));
    later(60, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-tool-started`, kind: 'event', type: 'activity.tool.started', payload: { turn_index: 1, tool_call_id: `${messageId}-tool`, tool: 'mock.ping', status: 'started' } })));
    later(80, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-tool-ended`, kind: 'event', type: 'activity.tool.ended', payload: { turn_index: 1, tool_call_id: `${messageId}-tool`, tool: 'mock.ping', status: 'completed' } })));
    later(100, () => append(channelId, envelope({
      ...responseBase,
      id: `${messageId}-terminal`,
      kind: 'response',
      type: payload.msg_type,
      payload: /fail/i.test(text)
        ? { status: 'failed', reason: 'receiver_internal_error', detail: 'mock failure requested by message text' }
        : { status: 'completed', turn_index: 1, text: 'PONG' },
    })));
  }

  function handleResolve(socket, ref, payload) {
    const history = histories.get(payload.channel_id);
    if (!history) {
      sendError(socket, { ref, frame: 'resolve', code: 'channel_not_found', detail: 'channel does not exist' });
      return;
    }
    if (!['approved', 'rejected'].includes(payload.decision)) {
      sendError(socket, { ref, frame: 'resolve', code: 'invalid_decision', detail: 'decision must be approved or rejected' });
      return;
    }
    if (payload.payload != null && !isObject(payload.payload)) {
      sendError(socket, { ref, frame: 'resolve', code: 'bad_payload', detail: 'resolve payload must be a JSON object' });
      return;
    }
    const request = history.find((row) => row.envelope.id === payload.req_id)?.envelope;
    if (!request || request.kind !== 'request' || request.type !== 'human.approve') {
      sendError(socket, { ref, frame: 'resolve', code: 'request_not_found', detail: 'no such approval request' });
      return;
    }
    if (!request.audience.includes(ROOT_ACTOR_ID)) {
      sendError(socket, { ref, frame: 'resolve', code: 'not_in_audience', detail: 'request not addressed to this subject' });
      return;
    }
    if (closedRequests.has(payload.req_id)) {
      sendError(socket, { ref, frame: 'resolve', code: 'already_closed', detail: 'request already closed' });
      return;
    }
    closedRequests.add(payload.req_id);
    sendFrame(socket, 'receipt', ref, { req_id: payload.req_id });
    append(payload.channel_id, envelope({
      id: `${payload.req_id}-resolved`,
      channelId: payload.channel_id,
      sender: { kind: 'human', id: ROOT_ACTOR_ID },
      kind: 'response',
      type: request.type,
      payload: { status: 'completed', ...(payload.payload || {}), decision: payload.decision },
      parentId: payload.req_id,
      correlationId: request.correlation_id || request.id,
      audience: [request.sender.id],
    }));
  }

  function handleAttachedFrame(socket, value) {
    const type = value.frame_type;
    const ref = typeof value.ref === 'string' ? value.ref : '';
    if (!(type in PAYLOAD_FIELDS)) {
      sendError(socket, { ref, frame: String(type || ''), code: 'bad_payload', detail: `unknown upstream frame_type: ${String(type)}` });
      return;
    }
    if (type === 'attach') {
      sendError(socket, { ref, frame: type, code: 'bad_payload', detail: 'attach may only be sent once as the first frame' });
      return;
    }
    const payload = value.payload;
    const validation = validatePayload(type, payload);
    if (validation) {
      sendError(socket, { ref, frame: type, code: 'bad_payload', detail: validation });
      return;
    }
    if (type === 'submit') return handleSubmit(socket, ref, payload);
    if (type === 'resolve') return handleResolve(socket, ref, payload);
    if (!histories.has(payload.channel_id)) {
      sendError(socket, { ref, frame: type, code: 'channel_not_found', detail: 'channel does not exist' });
      return;
    }
    if (type === 'cancel') {
      const request = histories.get(payload.channel_id).find((row) => row.envelope.id === payload.req_id)?.envelope;
      if (!request || request.kind !== 'request') {
        sendError(socket, { ref, frame: type, code: 'request_not_found', detail: 'no such request' });
        return;
      }
      if (request.sender.id !== ROOT_ACTOR_ID) {
        sendError(socket, { ref, frame: type, code: 'unauthorized_sender', detail: 'only the sender may cancel' });
        return;
      }
      if (closedRequests.has(payload.req_id)) {
        sendError(socket, { ref, frame: type, code: 'already_closed', detail: 'request already closed' });
        return;
      }
      closedRequests.add(payload.req_id);
      sendFrame(socket, 'receipt', ref, { req_id: payload.req_id });
      append(payload.channel_id, envelope({
        id: `${payload.req_id}-cancelled`,
        channelId: payload.channel_id,
        sender: { kind: 'human', id: ROOT_ACTOR_ID },
        kind: 'response',
        type: request.type,
        payload: { status: 'failed', reason: 'unanswered_timeout', detail: 'cancelled by caller', cancelled: true },
        parentId: payload.req_id,
        correlationId: request.correlation_id || request.id,
        audience: request.audience,
      }));
      return;
    }
    if (type === 'observe' || type === 'unobserve') {
      sendFrame(socket, 'receipt', ref, { channel_id: payload.channel_id });
      return;
    }
    sendError(socket, { ref, frame: type, code: 'forbidden', detail: `${type} is not granted by this mock` });
  }

  function handleWSMessage(socket, data, isBinary) {
    if (isBinary || data.length > MAX_FRAME_BYTES) {
      sendError(socket, { code: 'bad_payload', detail: 'frame must be UTF-8 JSON no larger than 512KB' });
      return;
    }
    let value;
    try {
      value = JSON.parse(data.toString('utf8'));
    } catch (error) {
      sendError(socket, { code: 'bad_payload', detail: error.message });
      return;
    }
    const ref = typeof value?.ref === 'string' ? value.ref : '';
    const frameType = typeof value?.frame_type === 'string' ? value.frame_type : '';
    if (!isObject(value) || value.v !== FRAME_VERSION || !frameType) {
      sendError(socket, { ref, frame: frameType, code: 'bad_payload', detail: 'frame requires v:2 and frame_type' });
      return;
    }
    if (value.ref != null && typeof value.ref !== 'string') {
      sendError(socket, { frame: frameType, code: 'bad_payload', detail: 'ref must be a string' });
      return;
    }
    const unknownEnvelopeFields = Object.keys(value).filter((key) => !['v', 'frame_type', 'ref', 'payload'].includes(key));
    if (unknownEnvelopeFields.length) {
      sendError(socket, { ref, frame: frameType, code: 'bad_payload', detail: `frame has unknown field: ${unknownEnvelopeFields.sort().join(', ')}` });
      return;
    }
    if (!attached.has(socket)) {
      if (frameType !== 'attach') {
        sendError(socket, { ref, frame: frameType, code: 'bad_payload', detail: 'first frame must be attach' });
        later(5, () => socket.close(1008, 'attach required'));
        return;
      }
      const payload = value.payload ?? {};
      const validation = validatePayload('attach', payload);
      if (validation || (payload.since != null && (!isObject(payload.since) || Object.values(payload.since).some((seq) => !Number.isSafeInteger(seq) || seq < 0)))) {
        sendError(socket, { ref, frame: frameType, code: 'bad_payload', detail: validation || 'since must map channel ids to non-negative integer seq values' });
        return;
      }
      attached.add(socket);
      sendFrame(socket, 'receipt', ref, { contract_version: CONTRACT_VERSION });
      const since = payload.since || {};
      for (const [channelId, history] of histories) {
        const cursor = Number(since[channelId] || 0);
        for (const row of history) {
          if (row.seq > cursor) sendFrame(socket, 'feed', '', row);
        }
      }
      return;
    }
    handleAttachedFrame(socket, value);
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://mock.local');
    const path = url.pathname;

    if (request.method === 'POST' && (path === '/api/identity/login' || path === '/api/identity/register')) {
      let body;
      try {
        body = await readJSON(request);
      } catch (error) {
        httpError(response, 400, 'invalid_args', error.message);
        return;
      }
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!email || !password) {
        httpError(response, 400, 'invalid_args', 'email and password required');
        return;
      }
      if (email !== ROOT_EMAIL || password !== rootPassword) {
        if (path.endsWith('/login')) httpError(response, 401, 'invalid_credentials', 'invalid credentials');
        else httpError(response, 400, 'invalid_args', `mock registration only supports ${ROOT_EMAIL}`);
        return;
      }
      setSession(response);
      // portal.go: login → 200 {id}; register → 201 full principal row (regspec.PrincipalRow).
      if (path.endsWith('/register')) {
        json(response, 201, { id: ROOT_ID, kind: 'human', email: ROOT_EMAIL, display_name: 'Root', status: 'present', created_at: 1_723_974_400_000 });
      } else {
        json(response, 200, { id: ROOT_ID });
      }
      return;
    }

    if (request.method === 'POST' && path === '/api/identity/logout') {
      const token = cookieValue(request, SESSION_COOKIE);
      if (token) sessions.delete(token);
      json(response, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` });
      return;
    }

    if (path.startsWith('/obs/')) {
      if (request.method !== 'GET') {
        httpError(response, 405, 'not_found', 'method not allowed');
        return;
      }
      if (!authenticated(request)) {
        httpError(response, 401, 'not_authenticated', 'invalid session');
        return;
      }
      if (path === '/obs/space/channels') {
        const parentId = url.searchParams.get('parent_id');
        if (url.searchParams.size > (parentId == null ? 0 : 1) || (url.searchParams.has('parent_id') && !parentId)) {
          httpError(response, 400, 'invalid_args', 'parent_id must appear once with a non-empty value');
          return;
        }
        const rows = parentId == null
          ? [channelRow('c0')]
          : parentId === 'c0' ? [channelRow('c0.lobby', { parentId: 'c0', name: 'lobby', qualifiedName: 'c0.lobby', serving: false })] : [];
        json(response, 200, observation('space', 'channels', rows));
        return;
      }
      if (path === '/obs/space/principals') {
        json(response, 200, observation('space', 'principals', [item({ id: ROOT_ID, kind: 'human', email: ROOT_EMAIL, display_name: 'Root', status: 'present', created_at: 1_723_974_400_000 }, null)]));
        return;
      }
      if (path === '/obs/space/daemons') {
        json(response, 200, observation('space', 'daemons', [item({ id: 'local-device', owner_principal: ROOT_ID, name: 'Mock local device', status: 'present', created_at: 1_723_974_400_000 }, [measure('online', true)])]));
        return;
      }
      if (path === '/obs/space/decls') {
        const stamp = 1_723_974_400_000;
        const declarations = [
          { id: 'mock:steward', name: 'Steward', description: 'Mock steward declaration', owner: ROOT_ID, default_class: 'codex', status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp },
          { id: 'atoll-internal:registrar-seat', name: 'Registrar Seat', owner: ROOT_ID, default_class: 'atoll-internal:registrar', status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp },
          { id: 'atoll-internal:svcactor', name: 'Service Actor', owner: ROOT_ID, default_class: 'svcactor', status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp },
        ];
        json(response, 200, observation('space', 'decls', declarations.map((declared) => item(declared, null))));
        return;
      }
      const match = path.match(/^\/obs\/channel\/([^/]+)\/(profile|actors)$/);
      if (match) {
        const channelId = decodeURIComponent(match[1]);
        if (!histories.has(channelId)) {
          json(response, 200, observation(channelId, match[2], []));
          return;
        }
        if (match[2] === 'profile') {
          const profile = channelId === 'c0'
            ? channelRow('c0')
            : channelRow('c0.lobby', { parentId: 'c0', name: 'lobby', qualifiedName: 'c0.lobby', serving: false });
          delete profile.key;
          json(response, 200, observation(channelId, 'profile', [profile]));
        } else {
          json(response, 200, observation(channelId, 'actors', rosters.get(channelId)));
        }
        return;
      }
      httpError(response, 404, 'not_found', 'route not found');
      return;
    }

    if (request.method === 'GET' && path === '/mock/approve') {
      const channelId = url.searchParams.get('channel') || 'c0';
      if (!histories.has(channelId)) {
        httpError(response, 404, 'not_found', 'channel does not exist');
        return;
      }
      json(response, 200, { id: pushApproval(channelId), channel_id: channelId });
      return;
    }

    if (request.method === 'GET' && path === '/mock/introduce') {
      introduced += 1;
      const actorId = `introduced-${introduced}`;
      rosters.get('c0').push(rosterItem({ id: actorId, kind: 'agent', declId: `mock:${actorId}`, name: actorId, description: 'Introduced codex agent' }));
      append('c0', envelope({
        id: `c0-registered-${actorId}-${randomUUID()}`,
        channelId: 'c0',
        sender: { kind: 'system', id: SYSTEM_ACTOR_ID },
        kind: 'event',
        type: 'system.actor.registered',
        payload: { actor_id: actorId, actor_kind: 'agent', registered_at: now() },
        visibility: 'system',
      }));
      json(response, 200, { actor_id: actorId });
      return;
    }

    if (request.method === 'GET' && path === '/mock/drop') {
      const count = sockets.size;
      json(response, 200, { dropped: count });
      later(0, () => {
        for (const socket of sockets) socket.close(1012, 'mock drop');
      });
      return;
    }

    if (request.method === 'GET' && path === '/healthz') {
      json(response, 200, { status: 'ok' });
      return;
    }

    if (path === '/ws') {
      httpError(response, 426, 'bad_payload', 'WebSocket upgrade required');
      return;
    }
    httpError(response, 404, 'not_found', 'route not found');
  });

  const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://mock.local');
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!authenticated(request)) {
      const body = JSON.stringify({ code: 'not_authenticated', detail: 'invalid session' });
      socket.write(`HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit('connection', webSocket, request));
  });
  webSockets.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('message', (data, isBinary) => handleWSMessage(socket, data, isBinary));
    socket.on('close', () => sockets.delete(socket));
  });
  if (Number.isFinite(liveIntervalMs) && liveIntervalMs > 0) {
    const timer = setInterval(() => {
      if ([...sockets].some((socket) => attached.has(socket))) pushLiveDemo();
    }, liveIntervalMs);
    recurring.add(timer);
  }
  server.on('close', () => {
    for (const timer of scheduled) clearTimeout(timer);
    scheduled.clear();
    for (const timer of recurring) clearInterval(timer);
    recurring.clear();
    for (const socket of sockets) socket.terminate();
    webSockets.close();
  });

  return server;
}

export async function startMockServer({
  port = Number(process.env.ATOLL_MOCK_PORT || process.env.PORT || 8832),
  host = process.env.ATOLL_MOCK_HOST || '127.0.0.1',
  rootPassword,
  liveIntervalMs = Number(process.env.ATOLL_MOCK_LIVE_INTERVAL_MS || 8_000),
} = {}) {
  const server = createMockServer({ rootPassword, liveIntervalMs });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startMockServer();
  const address = server.address();
  const host = typeof address === 'object' && address ? address.address : '127.0.0.1';
  const port = typeof address === 'object' && address ? address.port : 8832;
  console.log(`atoll mock listening on http://${host}:${port}`);
}
