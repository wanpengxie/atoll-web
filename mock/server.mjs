import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CONTRACT_VERSION,
  cookieValue,
  downstreamFrame,
  FRAME_VERSION,
  httpError,
  isObject,
  json,
  MAX_FRAME_BYTES,
  PAYLOAD_FIELDS,
  readJSON,
  SESSION_COOKIE,
  validatePayload,
} from './protocol.mjs';
import { createMockDomain, envelope as domainEnvelope, item as domainItem, measure as domainMeasure, observation as domainObservation, rosterItem as domainRosterItem } from './domain.mjs';
import { loadScenario, scenarioIds } from './scenarios.mjs';

const ROOT_ID = 'root';
const ROOT_EMAIL = 'root@atoll.local';
const ROOT_ACTOR_ID = 'root';
const STEWARD_ACTOR_ID = 'steward';
const SYSTEM_ACTOR_ID = 'system';
// agent 基座的控制词闭集（drivers/agents/base/base.go）。agent.ask 不在其中——
// 它是“交办一件活”，不是控制。
const AGENT_CONTROL_WORDS = ['agent.steer', 'agent.interrupt', 'agent.hold', 'agent.unhold', 'agent.replace', 'agent.queue', 'agent.compact', 'agent.select', 'agent.context', 'agent.fork'];

const now = () => Date.now();

function assertClosedPayload(payload, allowed) {
  if (!isObject(payload)) {
    const error = new TypeError('payload must be a JSON object');
    error.code = 'bad_payload';
    throw error;
  }
  const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    const error = new TypeError(`payload has unknown field: ${unknown.sort().join(', ')}`);
    error.code = 'bad_payload';
    throw error;
  }
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

function observation(subject, kind, items, complete = true, extra = {}) {
  return { subject, kind, complete, items, ...extra };
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
  expiresAt = null,
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
    ...(expiresAt != null ? { expires_at: expiresAt } : {}),
  };
}

// actor.describe 的回答形状 = lib/introspect.Describe：
// {class, interfaces, capabilities, words}，words 的每一项是 WordSpec。
function mockDescribe(_actorId, { taskCapability = false } = {}) {
  return {
    class: 'codex',
    interfaces: ['actor', 'agent'],
    capabilities: { steer: true, interrupt: true, resume: true },
    words: {
      'agent.ask': {
        description: '执行普通文本任务',
        input_schema: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', description: '任务内容' } } },
        error_codes: ['provider_timeout'],
      },
      'mock.order.create': {
        description: '创建一个 Mock 订单',
        examples: [{ name: '演示订单', count: 1, priority: 'normal', notify: false }],
        input_schema: {
          type: 'object', required: ['name', 'count'], additionalProperties: false,
          properties: {
            name: { type: 'string', description: '订单名称' },
            count: { type: 'integer', description: '数量', minimum: 1 },
            priority: { type: 'string', description: '优先级', enum: ['normal', 'urgent'], default: 'normal' },
            notify: { type: 'boolean', description: '完成后通知' },
          },
        },
        output_schema: { type: 'object', properties: { order_id: { type: 'string' }, accepted: { type: 'boolean' } } },
        error_codes: ['payload_invalid'],
      },
      ...(taskCapability ? { 'task.create': {
        description: '创建可重放的正式任务',
        input_schema: {
          type: 'object', required: ['title'], additionalProperties: false,
          properties: {
            title: { type: 'string', description: '任务标题' },
            description: { type: 'string', description: '补充说明' },
            due_at: { type: 'string', description: '截止时间' },
            source: { type: 'object', description: '来源引用' },
          },
        },
        output_schema: { type: 'object', required: ['task_id', 'status'], properties: { task_id: { type: 'string' }, status: { type: 'string' }, title: { type: 'string' } } },
      } } : {}),
      'agent.steer': { description: '调整当前回合方向', error_codes: ['cas_mismatch'] },
      'agent.interrupt': { description: '打断当前回合' },
      'agent.hold': { description: '暂停等待区' },
      'agent.unhold': { description: '继续等待区' },
      'agent.replace': { description: '修改排队任务' },
      'agent.queue': { description: '排队一个新任务' },
      'agent.compact': { description: '压缩上下文' },
      'agent.select': { description: '切换模型与算力' },
      'agent.context': { description: '查看上下文用量' },
      'agent.fork': { description: '分叉出新 Agent' },
    },
  };
}

function seededHistory(channelId, behavior = {}) {
  const rows = [];
  const add = (value) => rows.push({ channel_id: channelId, seq: rows.length + 1, envelope: value });
  const isLobby = channelId === 'c0.lobby';
  const selfActorId = channelId === 'c0' || isLobby ? ROOT_ACTOR_ID : `root-${channelId.split('.').at(-1)}`;
  const root = { kind: 'human', id: selfActorId };
  const responderId = isLobby ? 'svcactor' : channelId === 'c0' ? STEWARD_ACTOR_ID : `${channelId.split('.').at(-1)}-agent`;
  const responder = { kind: isLobby ? 'tool' : 'agent', id: responderId };
  const system = { kind: 'system', id: SYSTEM_ACTOR_ID };
  const base = 1_723_974_400_000;

  for (let index = 1; index <= 3; index += 1) {
    const requestId = `${channelId}-history-request-${index}`;
    const at = base + index * 10_000;
    const requestText = isLobby
      ? `Lobby history ${index}: inspect channel coordination`
      : `${channelId} history ${index}: ask ${responderId} for PONG`;
    const responseText = isLobby ? `Lobby coordination check ${index} complete` : `${channelId} PONG ${index}`;
    const toolName = isLobby ? 'mock.lobby.status' : 'mock.echo';
    const demoAttachments = behavior.demo_attachments && channelId === 'c0.project' && index === 3
      ? [{ resource_id: 'file:seed:c0.project:3', name: '项目说明.md', media_type: 'text/markdown', size: 47 }]
      : [];
    add(envelope({ id: requestId, channelId, sender: root, kind: 'request', type: 'agent.ask', payload: { text: requestText, ...(demoAttachments.length ? { attachments: demoAttachments } : {}) }, audience: [responderId], ts: at }));
    add(envelope({ id: `${requestId}-queued`, channelId, sender: responder, kind: 'response', type: 'agent.ask', payload: { status: 'queued', turn_index: index }, parentId: requestId, correlationId: requestId, audience: [selfActorId], ts: at + 1 }));
    add(envelope({ id: `${requestId}-processing`, channelId, sender: responder, kind: 'response', type: 'agent.ask', payload: { status: 'processing', turn_index: index }, parentId: requestId, correlationId: requestId, audience: [selfActorId], ts: at + 2 }));
    add(envelope({ id: `${requestId}-turn-started`, channelId, sender: responder, kind: 'event', type: 'agent.turn.started', payload: { turn_index: index, status: 'started' }, correlationId: requestId, audience: [selfActorId], ts: at + 3 }));
    add(envelope({ id: `${requestId}-tool-started`, channelId, sender: responder, kind: 'event', type: 'agent.tool.started', payload: { turn_index: index, tool_call_id: `${requestId}-tool`, tool: toolName, status: 'started' }, correlationId: requestId, audience: [selfActorId], ts: at + 4 }));
    add(envelope({ id: `${requestId}-tool-ended`, channelId, sender: responder, kind: 'event', type: 'agent.tool.ended', payload: { turn_index: index, tool_call_id: `${requestId}-tool`, tool: toolName, status: 'completed' }, correlationId: requestId, audience: [selfActorId], ts: at + 5 }));
    add(envelope({ id: `${requestId}-turn-ended`, channelId, sender: responder, kind: 'event', type: 'agent.turn.ended', payload: { turn_index: index, status: 'ok' }, correlationId: requestId, audience: [selfActorId], ts: at + 6 }));
    add(envelope({ id: `${requestId}-completed`, channelId, sender: responder, kind: 'response', type: 'agent.ask', payload: { status: 'completed', turn_index: index, text: responseText }, parentId: requestId, correlationId: requestId, audience: [selfActorId], ts: at + 7 }));
  }

  const registeredActors = isLobby ? ['svcactor'] : ['steward', 'svcactor'];
  for (const [index, actorId] of registeredActors.entries()) {
    add(envelope({
      id: `${channelId}-registered-${actorId}`,
      channelId,
      sender: system,
      kind: 'event',
      type: 'system.member.created',
      payload: { member: actorId, decl_id: actorId === 'steward' ? 'mock:steward' : 'svcactor', by: { caller: { channel: channelId, actor: selfActorId } } },
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
    payload: {
      title: 'Approve mock action',
      detail: `Approval fixture for ${channelId}`,
      impact: '允许 Mock Agent 继续执行订单操作',
      ...(behavior.approval_schema ? {
        response_schema: {
          type: 'object', required: ['note', 'severity'], additionalProperties: false,
          properties: {
            note: { type: 'string', description: '审批说明' },
            severity: { type: 'string', description: '风险级别', enum: ['low', 'high'] },
            notify: { type: 'boolean', description: '通知请求方' },
          },
        },
        response_example: { note: '', severity: 'low', notify: false },
      } : {}),
    },
    audience: [selfActorId],
    expiresAt: behavior.approval_expired ? base - 1 : null,
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
        : `${channelId} 独立账本：负责 ${responderId} 的任务回合。`,
    },
    audience: [selfActorId],
    ts: base + 70_000,
  }));
  if (behavior.seed_actor_describe && channelId === 'c0') {
    const requestId = `${channelId}-actor-describe`;
    add(envelope({
      id: requestId,
      channelId,
      sender: root,
      kind: 'request',
      type: 'actor.describe',
      payload: {},
      audience: [STEWARD_ACTOR_ID],
      ts: base + 80_000,
    }));
    add(envelope({
      id: `${requestId}-completed`,
      channelId,
      sender: responder,
      kind: 'response',
      type: 'actor.describe',
      payload: { status: 'completed', ...mockDescribe(STEWARD_ACTOR_ID, { taskCapability: behavior.task_capability }) },
      parentId: requestId,
      correlationId: requestId,
      audience: [selfActorId],
      ts: base + 80_001,
    }));
  }
  return rows;
}

export function createMockServer({
  rootPassword = process.env.ATOLL_ROOT_PASSWORD || 'root',
  liveIntervalMs = 0,
  scenario = process.env.ATOLL_MOCK_SCENARIO || 'multi-channel',
  seed = process.env.ATOLL_MOCK_SEED,
} = {}) {
  let domain = createMockDomain(loadScenario(scenario, seed));
  const sessions = new Map();
  const sockets = new Set();
  const attached = new WeakSet();
  const socketPrincipals = new WeakMap();
  const socketObserved = new WeakMap();
  const scheduled = new Set();
  const recurring = new Set();
  let rosters = domain.rosters;
  let histories = domain.histories;
  if (loadScenario(scenario, seed).history) {
    for (const channelId of histories.keys()) {
      if (domain.activeMembership(ROOT_ID, channelId)) histories.set(channelId, seededHistory(channelId, domain.behavior));
    }
  }
  const closedRequests = new Set();
  const submittedFrames = new Map();
  let introduced = 0;
  if (domain.behavior.drop_receipt) domain.configureFault({ target: 'receipt', mode: 'drop', count: 1 });

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
    socket.send(JSON.stringify(downstreamFrame(frameType, ref, payload)));
  }

  function sendError(socket, { ref = '', frame = '', code = 'bad_payload', detail = '' } = {}) {
    sendFrame(socket, 'error', ref, { frame, code, ...(detail ? { detail } : {}) });
  }

  function sendReceipt(socket, ref, payload) {
    // receipt 故障注入针对业务回执；attach receipt 只受 delay 影响，避免场景在登录阶段提前消耗故障。
    const fault = String(ref).startsWith('attach-') ? null : domain.takeFault('receipt');
    const delay = fault?.mode === 'delay' ? fault.delay_ms : Number(domain.delays.receipt_ms || 0);
    if (fault?.mode === 'drop') {
      socket.close(1012, 'mock receipt drop');
      return;
    }
    if (delay > 0) later(delay, () => sendFrame(socket, 'receipt', ref, payload));
    else sendFrame(socket, 'receipt', ref, payload);
  }

  function broadcast(row) {
    const fault = domain.takeFault('feed');
    if (fault?.mode === 'drop') {
      for (const socket of sockets) socket.close(1012, 'mock feed drop');
      return;
    }
    const delay = fault?.mode === 'delay' ? fault.delay_ms : Number(domain.delays.feed_ms || 0);
    if (delay > 0) {
      later(delay, () => broadcastNow(row));
      return;
    }
    broadcastNow(row);
  }

  function broadcastNow(row) {
    for (const socket of sockets) {
      const principal = socketPrincipals.get(socket) || '';
      const observed = socketObserved.get(socket) || new Set();
      if (attached.has(socket) && domain.canRead(principal, row.channel_id, observed)) sendFrame(socket, 'feed', '', row);
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
    const id = domain.nextId(`${channelId}-approval`);
    const selfActorId = domain.activeMembership(ROOT_ID, channelId)?.actor_id || ROOT_ACTOR_ID;
    append(channelId, envelope({
      id,
      channelId,
      sender: { kind: 'agent', id: STEWARD_ACTOR_ID },
      kind: 'request',
      type: 'human.approve',
      payload: { title: 'Approve live mock action', detail: 'Created by GET /mock/approve' },
      audience: [selfActorId],
    }));
    return id;
  }

  let liveTick = 0;
  function pushLiveDemo() {
    liveTick += 1;
    const channelId = liveTick % 2 === 1 ? 'c0' : 'c0.project';
    const isProject = channelId === 'c0.project';
    append(channelId, envelope({
      id: domain.nextId(`${channelId}-live`),
      channelId,
      sender: { kind: 'agent', id: isProject ? 'project-agent' : STEWARD_ACTOR_ID },
      kind: 'event',
      type: 'mock.channel.pulse',
      payload: {
        text: isProject
          ? `project 动态 #${liveTick}：project-agent 正在整理项目进度。`
          : `c0 动态 #${liveTick}：steward 在线，等待新任务。`,
        tick: liveTick,
        transient: true,
      },
      audience: [ROOT_ACTOR_ID],
    }));
  }

  function hasTerminal(channelId, requestId) {
    return (histories.get(channelId) || []).some((row) => row.envelope.kind === 'response'
      && row.envelope.parent_id === requestId
      && ['completed', 'failed'].includes(row.envelope.payload?.status));
  }

  function activeAgentTask(channelId, actorId, excludedId = '') {
    const rows = histories.get(channelId) || [];
    return [...rows].reverse().map((row) => row.envelope).find((value) => (
      value.id !== excludedId
      && value.kind === 'request'
      && value.sender?.kind === 'human'
      && value.audience?.includes(actorId)
      // 可被控制的是“正在办的活”本身；控制词与自省词不算活。
      && !AGENT_CONTROL_WORDS.includes(value.type)
      && value.type !== 'actor.describe'
      && !value.type.startsWith('system.')
      && !hasTerminal(channelId, value.id)
      && [...rows].reverse().map((row) => row.envelope).find((reply) => reply.kind === 'response' && reply.parent_id === value.id)?.payload?.status === 'processing'
    )) || null;
  }

  function closeTask(channelId, request, actorId, payload) {
    if (!request || hasTerminal(channelId, request.id)) return;
    append(channelId, envelope({
      id: domain.nextId(`${request.id}-controlled-terminal`), channelId,
      sender: { kind: 'agent', id: actorId }, kind: 'response', type: request.type,
      payload, parentId: request.id, correlationId: request.correlation_id || request.id,
      audience: [request.sender.id],
    }));
  }

  function handleSubmit(socket, ref, payload) {
    const channelId = payload.channel_id;
    const history = histories.get(channelId);
    if (!history) {
      sendError(socket, { ref, frame: 'submit', code: 'channel_not_found', detail: 'channel does not exist' });
      return;
    }
    const principal = socketPrincipals.get(socket) || '';
    if (!domain.canWrite(principal, channelId)) {
      const channel = domain.channel(channelId);
      const code = channel && (channel.status !== 'present' || !channel.open) ? 'channel_unavailable' : 'forbidden';
      sendError(socket, { ref, frame: 'submit', code, detail: code === 'forbidden' ? 'principal is not an active channel member' : 'channel is not serving' });
      return;
    }
    const kind = payload.kind || 'request';
    const selfActorId = domain.activeMembership(principal, channelId)?.actor_id || ROOT_ACTOR_ID;
    if (!['request', 'event'].includes(kind) || typeof payload.msg_type !== 'string' || !payload.msg_type) {
      sendError(socket, { ref, frame: 'submit', code: 'bad_payload', detail: 'kind must be request or event and msg_type must be non-empty' });
      return;
    }
    // 保留命名空间的权威只落在 system.* 的“事件”上：只有频道 system actor 能发。
    // system.* 的“请求”任何成员都能发——这正是治理面的走法。
    // （runtime/harness/step_type_registered.go）
    if (payload.msg_type.startsWith('system.') && kind === 'event') {
      sendError(socket, { ref, frame: 'submit', code: 'forbidden', detail: 'system events may only be emitted by the channel system actor' });
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
    if (payload.payload != null && !isObject(payload.payload)) {
      sendError(socket, { ref, frame: 'submit', code: 'bad_payload', detail: 'payload must be a JSON object' });
      return;
    }
    const messageId = payload.id || domain.nextId('message');
    const fingerprint = JSON.stringify({
      channel_id: channelId,
      msg_type: payload.msg_type,
      kind,
      payload: payload.payload || {},
      audience,
      visibility: payload.visibility || 'public',
      parent_id: payload.parent_id || '',
      expires_at_ms: payload.expires_at_ms || 0,
    });
    if (submittedFrames.has(messageId)) {
      if (submittedFrames.get(messageId) === fingerprint) sendReceipt(socket, ref, { message_id: messageId });
      else sendError(socket, { ref, frame: 'submit', code: 'idempotency_conflict', detail: 'message id already exists with different semantics' });
      return;
    }
    if (history.some((row) => row.envelope.id === messageId)) {
      sendError(socket, { ref, frame: 'submit', code: 'idempotency_conflict', detail: 'message id already exists with unknown mock fingerprint' });
      return;
    }
    submittedFrames.set(messageId, fingerprint);
    sendReceipt(socket, ref, { message_id: messageId });
    append(channelId, envelope({
      id: messageId,
      channelId,
      sender: { kind: 'human', id: selfActorId },
      kind,
      type: payload.msg_type,
      payload: payload.payload || {},
      parentId: payload.parent_id || '',
      visibility: payload.visibility || 'public',
      audience,
    }));

    const target = (rosters.get(channelId) || [])
      .map((entry) => entry.declared)
      .find((entry) => audience.includes(entry.id));
    const responseBase = {
      channelId,
      sender: { kind: target?.kind || 'tool', id: target?.id || audience[0] || 'system' },
      parentId: messageId,
      correlationId: messageId,
      audience: [selfActorId],
    };
    const complete = (value, extra = {}) => later(25, () => append(channelId, envelope({
      ...responseBase,
      id: `${messageId}-terminal`,
      kind: 'response',
      type: payload.msg_type,
      payload: { status: 'completed', value, ...extra },
    })));
    const fail = (code, detail) => later(25, () => append(channelId, envelope({
      ...responseBase,
      id: `${messageId}-terminal`,
      kind: 'response',
      type: payload.msg_type,
      payload: { status: 'failed', reason: code, error_code: code, detail },
    })));

    // sys.Reply 把回复对象平铺到 status 旁边；registrar 的回复本身就是 {value}。
    const completeFlat = (fields) => later(25, () => append(channelId, envelope({
      ...responseBase,
      id: `${messageId}-terminal`,
      kind: 'response',
      type: payload.msg_type,
      payload: { status: 'completed', ...fields },
    })));

    if (payload.msg_type === 'actor.describe' && target) {
      const describe = target.kind === 'agent'
        ? mockDescribe(target.id, { taskCapability: domain.behavior.task_capability })
        : { class: target.kind || 'tool', interfaces: ['actor'], capabilities: {}, words: {} };
      const selector = payload.payload?.type;
      if (selector) {
        const meta = describe.words?.[selector];
        if (!meta) fail('type_unsupported', `actor has no type ${selector}`);
        else completeFlat({ ...describe, words: { [selector]: meta } });
      } else completeFlat(describe);
      return;
    }

    // 频道面与空间面都只有一个收件人：本频道的 system actor。
    if (target?.id === SYSTEM_ACTOR_ID && String(payload.msg_type).startsWith('system.')) {
      if (domain.behavior.governance_denied) { fail('unauthorized_sender', 'sender is not an active channel member'); return; }
      const body = payload.payload || {};
      const narrate = (type, value) => append(channelId, envelope({
        id: domain.nextId(`${channelId}-system-event`),
        channelId,
        sender: { kind: 'system', id: SYSTEM_ACTOR_ID },
        kind: 'event',
        type,
        payload: value,
        visibility: 'system',
        ts: domain.now(),
      }));
      const channelReply = (value) => ({
        ...value,
        owner_principal: ROOT_ID,
        serving: value.open ? 1 : 0,
        profile: { serving: value.open ? 1 : 0, endpoints: {} },
      });
      try {
        switch (payload.msg_type) {
          // ---- 频道面（system actor 自己答）----
          case 'system.member.list': {
            assertClosedPayload(body, []);
            const actors = (rosters.get(channelId) || [])
              .map((entry) => entry.declared)
              .filter((row) => row.id !== SYSTEM_ACTOR_ID)
              .map((row) => ({ id: row.id, kind: row.kind, ...(row.name ? { name: row.name } : {}), present: true }));
            completeFlat({ actors });
            return;
          }
          case 'system.member.get': {
            assertClosedPayload(body, ['member']);
            const row = (rosters.get(channelId) || []).map((entry) => entry.declared).find((entry) => entry.id === body.member);
            if (!row) throw new TypeError('member does not exist');
            completeFlat({ actor_id: row.id, member: true, present: true });
            return;
          }
          case 'system.member.create': {
            assertClosedPayload(body, ['decl_id']);
            const value = domain.createMember(channelId, body.decl_id);
            narrate('system.member.created', { member: value.member, decl_id: body.decl_id });
            completeFlat(value);
            return;
          }
          case 'system.member.admit': {
            assertClosedPayload(body, ['principal']);
            const value = domain.admitMember(channelId, body.principal);
            narrate('system.member.created', { member: value.member, principal: body.principal });
            completeFlat(value);
            return;
          }
          case 'system.member.delete': {
            assertClosedPayload(body, ['member']);
            const value = domain.removeActor(channelId, body.member);
            narrate('system.member.deleted', { member: body.member, reason: 'removed' });
            completeFlat(value);
            return;
          }
          case 'system.member.restart': {
            assertClosedPayload(body, ['member']);
            completeFlat(domain.restartActor(channelId, body.member));
            return;
          }
          case 'system.log.recent': {
            assertClosedPayload(body, ['limit']);
            const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 5);
            const rows = (domain.histories.get(channelId) || []).slice(-limit);
            completeFlat({ messages: rows });
            return;
          }

          // ---- 空间面（system actor 转交 registrar）----
          case 'system.channel.create': {
            assertClosedPayload(body, ['name', 'recipe']);
            const created = domain.createChannel(channelId, body.name, principal);
            complete({ channel_id: created.id });
            return;
          }
          case 'system.channel.list': {
            assertClosedPayload(body, ['parent_id']);
            complete([...domain.channels.values()]
              .filter((channel) => !channel.internal && (!body.parent_id || channel.parent_id === body.parent_id))
              .map((channel) => ({ ...channel })));
            return;
          }
          case 'system.channel.get': {
            assertClosedPayload(body, ['channel_id']);
            const value = domain.channel(body.channel_id);
            if (!value) throw new TypeError('channel does not exist');
            complete(channelReply(value));
            return;
          }
          case 'system.channel.set': {
            assertClosedPayload(body, ['channel_id', 'description', 'serving']);
            if (body.channel_id !== channelId) throw new TypeError('profile must target the source channel');
            complete(domain.setProfile(channelId, body));
            return;
          }
          case 'system.channel.delete': {
            assertClosedPayload(body, ['channel_id']);
            const targetChannelId = body.channel_id;
            if (targetChannelId === 'c0') { fail('reserved', 'c0 cannot be retired'); return; }
            const row = domain.channel(targetChannelId);
            if (!row || row.status !== 'present') throw new TypeError('channel does not exist or is already retired');
            const activeChild = [...domain.channels.values()].some((item) => item.parent_id === targetChannelId && item.status === 'present');
            if (activeChild) { fail('conflict_exists', 'channel has active child channels'); return; }
            complete({ ...row, status: 'retired' });
            later(80, () => domain.retireChannel(targetChannelId));
            return;
          }
          case 'system.actor.overlay.set': {
            assertClosedPayload(body, ['decl_id', 'channel_id', 'config']);
            if (body.channel_id !== channelId) throw new TypeError('overlay must target the source channel');
            complete(domain.setOverlay(channelId, body.decl_id, body.config));
            return;
          }
          case 'system.actor.overlay.delete': {
            assertClosedPayload(body, ['decl_id', 'channel_id']);
            if (body.channel_id !== channelId) throw new TypeError('overlay must target the source channel');
            complete(domain.clearOverlay(channelId, body.decl_id));
            return;
          }
          case 'system.actor.template.list':
            assertClosedPayload(body, []);
            complete([...domain.declarations.values()].filter((row) => row.status === 'present').map((row) => ({ ...row })));
            return;
          case 'system.actor.template.get': {
            assertClosedPayload(body, ['id']);
            const row = domain.declarations.get(body.id);
            if (!row || row.status !== 'present') throw new TypeError('declaration does not exist');
            complete({ ...row });
            return;
          }
          case 'system.actor.template.create':
            assertClosedPayload(body, ['id', 'name', 'description', 'class', 'config', 'visibility', 'singleton']);
            complete(domain.registerActorTemplate(body));
            return;
          case 'system.actor.template.set':
            assertClosedPayload(body, ['id', 'name', 'description', 'class', 'config', 'visibility', 'singleton']);
            complete(domain.editActorTemplate(body));
            return;
          case 'system.actor.template.delete':
            assertClosedPayload(body, ['id']);
            complete(domain.revokeActorTemplate(body.id));
            return;
          case 'system.channel.template.list':
            assertClosedPayload(body, []);
            complete([...domain.channelTemplates.values()].filter((row) => row.status === 'present').map((row) => ({ ...row })));
            return;
          case 'system.channel.template.get': {
            assertClosedPayload(body, ['id']);
            const row = domain.channelTemplates.get(body.id);
            if (!row || row.status !== 'present') throw new TypeError('channel template does not exist');
            complete({ ...row });
            return;
          }
          case 'system.channel.template.create':
            assertClosedPayload(body, ['id', 'name', 'description', 'visibility', 'body']);
            complete(domain.registerChannelTemplate(body));
            return;
          case 'system.channel.template.set':
            assertClosedPayload(body, ['id', 'name', 'description', 'visibility', 'body']);
            complete(domain.editChannelTemplate(body));
            return;
          case 'system.channel.template.delete':
            assertClosedPayload(body, ['id']);
            complete(domain.revokeChannelTemplate(body.id));
            return;
          case 'system.device.create':
            assertClosedPayload(body, ['name']);
            complete(domain.mintDevice(body.name));
            return;
          case 'system.device.delete':
            assertClosedPayload(body, ['device_id']);
            complete(domain.retireDevice(body.device_id));
            return;
          case 'system.device.attach':
          case 'system.device.detach':
            assertClosedPayload(body, ['channel_id', 'device_id']);
            complete(domain.bindDevice(body.channel_id, body.device_id, payload.msg_type.endsWith('.attach')));
            return;
          case 'system.device.list':
            assertClosedPayload(body, []);
            complete([...domain.devices.values()].filter((row) => row.status === 'present').map(({ key: _key, ...row }) => row));
            return;
          default:
            fail('type_unsupported', `system actor does not support ${payload.msg_type}`);
            return;
        }
      } catch (error) {
        fail(error.code || 'invalid_args', error.message);
        return;
      }
    }

    const respondingAgent = (rosters.get(channelId) || [])
      .map((entry) => entry.declared)
      .find((entry) => entry.kind === 'agent' && audience.includes(entry.id));
    if (kind !== 'request' || !respondingAgent) return;
    const text = String(payload.payload?.text || '');
    responseBase.sender = { kind: 'agent', id: respondingAgent.id };

    if (payload.msg_type === 'mock.order.create') {
      const count = payload.payload?.count;
      if (!payload.payload?.name || !Number.isInteger(count) || count < 1) fail('payload_invalid', 'name and a positive integer count are required');
      else complete({ order_id: domain.nextId('order'), accepted: true, ...payload.payload });
      return;
    }

    if (payload.msg_type === 'task.create') {
      const title = String(payload.payload?.title || '').trim();
      if (!title) fail('payload_invalid', 'title is required');
      else complete({ task_id: domain.nextId('task'), status: 'active', title, assignee: respondingAgent.id, due_at: payload.payload?.due_at || '' });
      return;
    }

    if (AGENT_CONTROL_WORDS.includes(payload.msg_type)) {
      const active = activeAgentTask(channelId, respondingAgent.id, messageId);
      const turnId = active ? `turn-${active.id}` : '';
      if (payload.msg_type === 'agent.steer') {
        const targetId = String(payload.payload?.target || '');
        if (targetId) {
          if (text.trim() || Object.keys(payload.payload || {}).length !== 1) { fail('invalid_args', 'target form only accepts target'); return; }
          const targetRequest = history.find((row) => row.envelope.id === targetId)?.envelope;
          const targetPosition = [...history].reverse().map((row) => row.envelope).find((value) => value.kind === 'response' && value.parent_id === targetId)?.payload?.status;
          if (!targetRequest || targetPosition !== 'queued') { fail('cas_mismatch', 'steer target is not buffered'); return; }
          if (targetRequest.sender?.id !== selfActorId) { fail('target_not_owned', 'steer target belongs to another sender'); return; }
          complete({});
          if (!active) return;
          later(20, () => {
            closeTask(channelId, active, respondingAgent.id, { status: 'completed', value: { preempted_by: targetId } });
            append(channelId, envelope({ ...responseBase, id: `${targetId}-inserted`, parentId: targetId, correlationId: targetId, kind: 'response', type: targetRequest.type, payload: { status: 'processing', turn_id: turnId } }));
          });
          return;
        }
        if (!text.trim()) { fail('empty_input', 'steer requires text input'); return; }
        if (payload.payload?.expected_turn_id && payload.payload.expected_turn_id !== turnId) { fail('cas_mismatch', 'steer target is no longer active'); return; }
        if (!active) { fail('cas_mismatch', 'no steerable turn'); return; }
        later(20, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-processing`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', turn_id: turnId } })));
        later(45, () => {
          closeTask(channelId, active, respondingAgent.id, { status: 'completed', value: { preempted_by: messageId } });
          append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed', value: { merged_into: turnId, direction: text } } }));
        });
        return;
      }
      if (payload.msg_type === 'agent.interrupt') {
        append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed' } }));
        later(25, () => {
          closeTask(channelId, active, respondingAgent.id, { status: 'failed', reason: 'interrupted', error_code: 'interrupted', detail: 'interrupted by user control' });
        });
        return;
      }
      if (payload.msg_type === 'agent.hold' || payload.msg_type === 'agent.unhold') {
        append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed' } }));
        return;
      }
      if (payload.msg_type === 'agent.replace') {
        later(20, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-queued`, kind: 'response', type: payload.msg_type, payload: { status: 'queued' } })));
        later(60, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed', text: payload.payload?.new_text || '' } })));
        return;
      }
      if (payload.msg_type === 'agent.queue') {
        if (!text.trim()) { fail('empty_input', 'queue requires text input'); return; }
        later(20, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-queued`, kind: 'response', type: payload.msg_type, payload: { status: 'queued' } })));
        later(80, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed', value: { queued: true, text } } })));
        return;
      }
      const key = { 'agent.compact': 'compacted', 'agent.select': 'selected', 'agent.context': 'context', 'agent.fork': 'forked' }[payload.msg_type];
      later(30, () => {
        closeTask(channelId, active, respondingAgent.id, { status: 'failed', reason: 'cancelled', error_code: 'cancelled', detail: payload.msg_type });
        append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed', value: { [key]: true } } }));
      });
      return;
    }

    const busy = activeAgentTask(channelId, respondingAgent.id, messageId);
    later(20, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-queued`, kind: 'response', type: payload.msg_type, payload: { status: 'queued', turn_index: 1 } })));
    if (busy) return;
    const mode = domain.behavior.message || '';
    later(40, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-processing`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', turn_index: 1, ...(mode === 'long-running' ? { turn_id: `turn-${messageId}` } : {}) } })));
    if (mode === 'business-provisional') later(50, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-business`, kind: 'response', type: payload.msg_type, payload: { status: 'provider.waiting', queue: 'external' } })));
    later(60, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-tool-started`, kind: 'event', type: 'agent.tool.started', payload: { turn_index: 1, tool_call_id: `${messageId}-tool`, tool: 'mock.ping', status: 'started' } })));
    later(80, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-tool-ended`, kind: 'event', type: 'agent.tool.ended', payload: { turn_index: 1, tool_call_id: `${messageId}-tool`, tool: 'mock.ping', status: 'completed' } })));
    if (mode === 'long-running') return;
    const terminalDelay = mode === 'business-provisional' ? 500 : 100;
    later(terminalDelay, () => append(channelId, envelope({
      ...responseBase,
      id: `${messageId}-terminal`,
      kind: 'response',
      type: payload.msg_type,
      payload: mode === 'structured'
        ? {
          status: 'completed',
          instance_id: 'agent-1',
          created: true,
          result: {
            rows: Array.from({ length: 25 }, (_, index) => ({ id: `row-${index + 1}`, status: 'ok' })),
            secret: 'must-not-render',
          },
        }
        : mode === 'empty'
          ? { status: 'completed' }
          : mode === 'failed' || /fail/i.test(text)
            ? { status: 'failed', reason: 'receiver_internal_error', error_code: 'type_unsupported', detail: 'mock failure requested by message text', diagnostic: { attempt: 1 } }
            : { status: 'completed', turn_index: 1, text: 'PONG' },
    })));
    if (mode === 'provisional-after-terminal') {
      later(220, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-late-processing`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', late: true } })));
    }
    if (mode === 'terminal-conflict') {
      later(220, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal-conflict`, kind: 'response', type: payload.msg_type, payload: { status: 'failed', reason: 'receiver_internal_error', detail: 'conflicting mock terminal' } })));
    }
  }

  function handleResolve(socket, ref, payload) {
    const history = histories.get(payload.channel_id);
    if (!history) {
      sendError(socket, { ref, frame: 'resolve', code: 'channel_not_found', detail: 'channel does not exist' });
      return;
    }
    const request = history.find((row) => row.envelope.id === payload.req_id)?.envelope;
    if (!request || request.kind !== 'request' || !['human.ask', 'human.approve'].includes(request.type)) {
      sendError(socket, { ref, frame: 'resolve', code: 'request_not_found', detail: 'no such resolvable request' });
      return;
    }
    // 字段闭集：human.ask 只收 text；human.approve 只收 decision + 可选 note。
    if (request.type === 'human.ask' && (typeof payload.text !== 'string' || payload.decision || payload.note != null)) {
      sendError(socket, { ref, frame: 'resolve', code: 'bad_payload', detail: 'human.ask resolve requires only text' });
      return;
    }
    if (request.type === 'human.approve' && (payload.text != null || !['approve', 'reject'].includes(payload.decision))) {
      sendError(socket, { ref, frame: 'resolve', code: 'invalid_decision', detail: 'human.approve decision must be approve or reject' });
      return;
    }
    const principal = socketPrincipals.get(socket) || '';
    const selfActorId = domain.activeMembership(principal, payload.channel_id)?.actor_id || '';
    if (!selfActorId || !request.audience.includes(selfActorId)) {
      sendError(socket, { ref, frame: 'resolve', code: 'not_in_audience', detail: 'request not addressed to this subject' });
      return;
    }
    if (closedRequests.has(payload.req_id)) {
      sendError(socket, { ref, frame: 'resolve', code: 'already_closed', detail: 'request already closed' });
      return;
    }
    closedRequests.add(payload.req_id);
    sendReceipt(socket, ref, { req_id: payload.req_id });
    append(payload.channel_id, envelope({
      id: `${payload.req_id}-resolved`,
      channelId: payload.channel_id,
      sender: { kind: 'human', id: selfActorId },
      kind: 'response',
      type: request.type,
      payload: request.type === 'human.ask'
        ? { status: 'completed', text: payload.text }
        : { status: 'completed', decision: payload.decision, ...(payload.note != null ? { note: payload.note } : {}) },
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
    const injected = domain.takeFault(type);
    if (injected?.mode === 'reject') {
      sendError(socket, { ref, frame: type, code: injected.code, detail: 'injected mock rejection' });
      return;
    }
    if (injected?.mode === 'drop') {
      socket.close(1012, 'injected mock drop');
      return;
    }
    if (type === 'submit') return handleSubmit(socket, ref, payload);
    if (!['observe', 'unobserve'].includes(type)) {
      const principal = socketPrincipals.get(socket) || '';
      if (!domain.canWrite(principal, payload.channel_id)) {
        const channel = domain.channel(payload.channel_id);
        const code = channel && (channel.status !== 'present' || !channel.open) ? 'channel_unavailable' : 'forbidden';
        sendError(socket, { ref, frame: type, code, detail: code === 'forbidden' ? 'principal is not an active channel member' : 'channel is not serving' });
        return;
      }
    }
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
      const principal = socketPrincipals.get(socket) || '';
      const selfActorId = domain.activeMembership(principal, payload.channel_id)?.actor_id || '';
      if (!selfActorId || request.sender.id !== selfActorId) {
        sendError(socket, { ref, frame: type, code: 'unauthorized_sender', detail: 'only the sender may cancel' });
        return;
      }
      if (closedRequests.has(payload.req_id)) {
        sendError(socket, { ref, frame: type, code: 'already_closed', detail: 'request already closed' });
        return;
      }
      closedRequests.add(payload.req_id);
      sendReceipt(socket, ref, { req_id: payload.req_id });
      // receipt 和原请求终态是两个独立事实，保留短暂间隔供 UI 明确展示“已受理，等待收敛”。
      later(120, () => append(payload.channel_id, envelope({
        id: `${payload.req_id}-cancelled`,
        channelId: payload.channel_id,
        sender: { kind: 'human', id: selfActorId },
        kind: 'response',
        type: request.type,
        payload: { status: 'failed', reason: 'unanswered_timeout', detail: 'cancelled by caller', cancelled: true },
        parentId: payload.req_id,
        correlationId: request.correlation_id || request.id,
        audience: request.audience,
      })));
      return;
    }
    if (type === 'after') {
      const timerId = domain.nextId('timer');
      domain.scheduled.push({ type: 'timer', timer_id: timerId, channel_id: payload.channel_id, at_ms: domain.now() - 1_723_974_400_000 + payload.duration_ms, msg_type: payload.msg_type, payload: structuredClone(payload.payload ?? {}) });
      sendReceipt(socket, ref, { timer_id: timerId });
      return;
    }
    if (type === 'cancel_timer') {
      const index = domain.scheduled.findIndex((entry) => entry.type === 'timer' && entry.timer_id === payload.timer_id && entry.channel_id === payload.channel_id);
      if (index < 0) { sendError(socket, { ref, frame: type, code: 'request_not_found', detail: 'timer does not exist or already fired' }); return; }
      domain.scheduled.splice(index, 1);
      sendReceipt(socket, ref, { timer_id: payload.timer_id });
      return;
    }
    if (type === 'resource') {
      try { sendReceipt(socket, ref, domain.resource(payload.channel_id, payload)); }
      catch (error) { sendError(socket, { ref, frame: type, code: error.message.includes('already') ? 'conflict_exists' : 'bad_payload', detail: error.message }); }
      return;
    }
    if (type === 'observe' || type === 'unobserve') {
      const observed = socketObserved.get(socket) || new Set();
      if (type === 'observe') {
        const channel = domain.channel(payload.channel_id);
        if (!channel || channel.internal || channel.status !== 'present') {
          sendError(socket, { ref, frame: type, code: 'channel_not_found', detail: 'channel cannot be observed' });
          return;
        }
        observed.add(payload.channel_id);
      } else {
        observed.delete(payload.channel_id);
      }
      socketObserved.set(socket, observed);
      sendReceipt(socket, ref, { channel_id: payload.channel_id });
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
      sendReceipt(socket, ref, { contract_version: CONTRACT_VERSION });
      const since = payload.since || {};
      const replay = () => {
        for (const [channelId, history] of histories) {
          const principal = socketPrincipals.get(socket) || '';
          const observed = socketObserved.get(socket) || new Set();
          if (!domain.canRead(principal, channelId, observed)) continue;
          const cursor = Number(since[channelId] || 0);
          for (const row of history) {
            if (row.seq > cursor) sendFrame(socket, 'feed', '', row);
          }
        }
      };
      const receiptDelay = Number(domain.delays.receipt_ms || 0);
      if (receiptDelay > 0) later(receiptDelay, replay);
      else replay();
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

    if (path === '/files') {
      if (!authenticated(request)) { httpError(response, 401, 'not_authenticated', 'invalid session'); return; }
      // 票的作用域是（频道, actor）：频道由请求写明，actor 由服务端从会话解析。
      const channelId = url.searchParams.get('channel_id') || '';
      const ticket = url.searchParams.get('t') || '';
      if (!channelId || !ticket || url.searchParams.size !== 2) { httpError(response, 400, 'bad_payload', 'channel_id and exactly one ticket are required'); return; }
      if (request.method === 'PUT') {
        const grant = domain.redeemTicket(ticket, 'put');
        const address = grant?.address;
        if (!grant) { httpError(response, 403, 'ticket_invalid', 'upload ticket is invalid, expired or already used'); return; }
        const chunks = []; let size = 0;
        try {
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) throw new TypeError('file exceeds mock 8MB limit');
            chunks.push(chunk);
          }
        } catch (error) { httpError(response, 413, 'file_too_large', error.message); return; }
        const content = Buffer.concat(chunks);
        const mediaType = request.headers['content-type'] || 'application/octet-stream';
        domain.files.set(address, { content, mediaType, size: content.length });
        for (const store of domain.resources.values()) {
          const row = store.get(grant.resourceId);
          if (row) row.meta = { size: content.length, media_type: mediaType, available: true };
        }
        json(response, 200, { status: 'ok', resource_id: grant.resourceId, size: content.length });
        return;
      }
      if (request.method === 'GET') {
        const grant = domain.redeemTicket(ticket, 'get');
        if (!grant) { httpError(response, 403, 'ticket_invalid', 'download ticket is invalid or expired'); return; }
        const file = domain.files.get(grant.address);
        if (!file) { httpError(response, 404, 'resource_not_found', 'file bytes are not available'); return; }
        response.writeHead(200, { 'Content-Type': file.mediaType, 'Content-Length': file.content.length, 'Content-Disposition': 'attachment' });
        response.end(file.content);
        return;
      }
      httpError(response, 405, 'not_found', 'method not allowed'); return;
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
      const obsFault = domain.takeFault('obs');
      if (obsFault?.mode === 'reject') {
        httpError(response, 503, obsFault.code, 'injected mock OBS rejection');
        return;
      }
      const obsDelay = obsFault?.mode === 'delay' ? obsFault.delay_ms : Number(domain.delays.obs_ms || 0);
      if (obsDelay > 0) await new Promise((resolve) => setTimeout(resolve, obsDelay));
      if (path === '/obs/space/channels') {
        const parentId = url.searchParams.get('parent_id');
        if (url.searchParams.size > (parentId == null ? 0 : 1) || (url.searchParams.has('parent_id') && !parentId)) {
          httpError(response, 400, 'invalid_args', 'parent_id must appear once with a non-empty value');
          return;
        }
        const rows = domain.channelRows(parentId);
        json(response, 200, observation('space', 'channels', rows, domain.obsComplete));
        return;
      }
      if (path === '/obs/space/memberships') {
        if (domain.behavior.membership_extension === false) {
          httpError(response, 404, 'not_found', 'membership projection is not available on the real backend');
          return;
        }
        json(response, 200, observation('space', 'memberships', domain.membershipRows(ROOT_ID), domain.obsComplete, { mock_extension: true }));
        return;
      }
      if (path === '/obs/space/principals') {
        json(response, 200, observation('space', 'principals', [
          item({ id: ROOT_ID, kind: 'human', email: ROOT_EMAIL, display_name: 'Root', status: 'present', created_at: 1_723_974_400_000 }, null),
          item({ id: 'alice', kind: 'human', email: 'alice@atoll.local', display_name: 'Alice', status: 'present', created_at: 1_723_974_400_100 }, null),
          item({ id: 'bob', kind: 'human', email: 'bob@atoll.local', display_name: 'Bob', status: 'present', created_at: 1_723_974_400_200 }, null),
        ]));
        return;
      }
      if (path === '/obs/space/daemons') {
        json(response, 200, observation('space', 'daemons', domain.daemonRows()));
        return;
      }
      if (path === '/obs/space/decls') {
        json(response, 200, observation('space', 'decls', domain.declarationRows()));
        return;
      }
      const match = path.match(/^\/obs\/channel\/([^/]+)\/(profile|actors)$/);
      if (match) {
        const channelId = decodeURIComponent(match[1]);
        if (!domain.channel(channelId)) {
          json(response, 200, observation(channelId, match[2], []));
          return;
        }
        if (match[2] === 'profile') {
          const profile = domain.channelRow(domain.channel(channelId), { withKey: false });
          profile.declared.description = domain.profiles.get(channelId)?.description || profile.declared.description;
          profile.declared.serving = domain.profiles.get(channelId)?.serving ?? profile.declared.serving;
          profile.declared.endpoints = structuredClone(domain.profiles.get(channelId)?.endpoints || {});
          json(response, 200, observation(channelId, 'profile', [profile]));
        } else {
          if (!domain.channel(channelId).open) {
            httpError(response, 503, 'not_serving', 'channel is not serving');
            return;
          }
          const rows = domain.behavior.roster_principal === false
            ? (rosters.get(channelId) || []).map((row) => ({ ...row, declared: Object.fromEntries(Object.entries(row.declared).filter(([key]) => key !== 'principal')) }))
            : rosters.get(channelId);
          json(response, 200, observation(channelId, 'actors', rows));
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
        id: domain.nextId(`c0-registered-${actorId}`),
        channelId: 'c0',
        sender: { kind: 'system', id: SYSTEM_ACTOR_ID },
        kind: 'event',
        type: 'system.member.created',
        payload: { member: actorId, decl_id: `mock:${actorId}` },
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

    if (request.method === 'GET' && path === '/mock/control/catalog') {
      json(response, 200, { scenarios: scenarioIds(), actions: ['drop', 'approval', 'revoke_membership', 'grant_membership', 'retire_channel', 'set_channel_open', 'set_obs_complete', 'pulse', 'push_provisional', 'push_terminal', 'replay_envelope', 'terminal_conflict', 'resolve_approval'] });
      return;
    }

    if (request.method === 'GET' && path === '/mock/control/state') {
      json(response, 200, domain.snapshot());
      return;
    }

    if (request.method === 'POST' && path === '/mock/control/advance') {
      try {
        const body = await readJSON(request);
        const due = domain.advance(body.ms);
        for (const entry of due.filter((row) => row.type === 'timer')) {
          append(entry.channel_id, envelope({
            id: entry.timer_id,
            channelId: entry.channel_id,
            sender: { kind: 'system', id: SYSTEM_ACTOR_ID },
            kind: 'event',
            type: entry.msg_type,
            payload: entry.payload,
            visibility: 'public',
            ts: domain.now(),
          }));
        }
        json(response, 200, { clock: domain.now(), applied: due });
      } catch (error) {
        httpError(response, 400, 'invalid_args', error.message);
      }
      return;
    }

    if (request.method === 'POST' && path === '/mock/control/action') {
      try {
        const body = await readJSON(request);
        if (body.type === 'drop') {
          const count = sockets.size;
          later(0, () => { for (const socket of sockets) socket.close(1012, 'mock drop'); });
          json(response, 200, { type: body.type, affected: count });
          return;
        }
        if (body.type === 'approval') {
          const id = pushApproval(body.channel_id || 'c0');
          json(response, 200, { type: body.type, id });
          return;
        }
        if (body.type === 'revoke_membership') {
          const changed = domain.revokeMembership(ROOT_ID, body.channel_id);
          json(response, 200, { type: body.type, changed });
          return;
        }
        if (body.type === 'grant_membership') {
          const membership = domain.grantMembership(ROOT_ID, body.channel_id, body.actor_id);
          json(response, 200, { type: body.type, membership });
          return;
        }
        if (body.type === 'set_channel_open') {
          const channel = domain.setChannelOpen(body.channel_id, body.open);
          json(response, 200, { type: body.type, channel });
          return;
        }
        if (body.type === 'set_obs_complete') {
          domain.obsComplete = Boolean(body.complete);
          json(response, 200, { type: body.type, complete: domain.obsComplete });
          return;
        }
        if (body.type === 'retire_channel') {
          const changed = domain.retireChannel(body.channel_id);
          json(response, 200, { type: body.type, changed });
          return;
        }
        if (body.type === 'pulse') {
          pushLiveDemo();
          json(response, 200, { type: body.type, tick: liveTick });
          return;
        }
        if (body.type === 'push_provisional' || body.type === 'push_terminal' || body.type === 'terminal_conflict') {
          const channelId = body.channel_id || 'c0';
          const requestId = body.request_id;
          const request = histories.get(channelId)?.find((row) => row.envelope.id === requestId)?.envelope;
          if (!request) throw new TypeError('request does not exist');
          const status = body.type === 'push_provisional' ? body.status || 'provider.waiting' : body.status || (body.type === 'terminal_conflict' ? 'failed' : 'completed');
          const row = append(channelId, envelope({
            id: domain.nextId(`${requestId}-${body.type}`), channelId,
            sender: { kind: 'agent', id: request.audience?.[0] || 'steward' }, kind: 'response', type: request.type,
            payload: { status, ...(body.payload || {}) }, parentId: requestId, correlationId: request.correlation_id || request.id,
            audience: [request.sender.id],
          }));
          json(response, 200, { type: body.type, row });
          return;
        }
        if (body.type === 'replay_envelope') {
          const row = histories.get(body.channel_id || 'c0')?.find((item) => item.envelope.id === body.envelope_id);
          if (!row) throw new TypeError('envelope does not exist');
          broadcast(row);
          json(response, 200, { type: body.type, row });
          return;
        }
        if (body.type === 'resolve_approval') {
          const channelId = body.channel_id || 'c0';
          const request = (histories.get(channelId) || []).map((row) => row.envelope).find((value) => value.kind === 'request' && value.type === 'human.approve' && (!body.request_id || value.id === body.request_id));
          if (!request) throw new TypeError('approval request does not exist');
          if (hasTerminal(channelId, request.id)) throw new TypeError('approval request is already closed');
          const row = append(channelId, envelope({
            id: domain.nextId(`${request.id}-external-resolve`), channelId,
            sender: { kind: 'human', id: body.actor_id || 'external-reviewer' }, kind: 'response', type: request.type,
            payload: { status: 'completed', decision: body.decision || 'approved', ...(body.payload || {}) },
            parentId: request.id, correlationId: request.correlation_id || request.id,
            audience: [request.sender.id],
          }));
          closedRequests.add(request.id);
          json(response, 200, { type: body.type, row });
          return;
        }
        httpError(response, 400, 'invalid_args', 'unknown mock action');
      } catch (error) {
        httpError(response, 400, 'invalid_args', error.message);
      }
      return;
    }

    if (request.method === 'POST' && path === '/mock/control/reset') {
      try {
        const body = await readJSON(request);
        domain = createMockDomain(loadScenario(body.scenario || 'multi-channel', body.seed));
        rosters = domain.rosters;
        histories = domain.histories;
        if (loadScenario(body.scenario || 'multi-channel', body.seed).history) {
          for (const channelId of histories.keys()) {
            if (domain.activeMembership(ROOT_ID, channelId)) histories.set(channelId, seededHistory(channelId, domain.behavior));
          }
        }
        closedRequests.clear();
        submittedFrames.clear();
        introduced = 0;
        liveTick = 0;
        if (domain.behavior.drop_receipt) domain.configureFault({ target: 'receipt', mode: 'drop', count: 1 });
        json(response, 200, domain.snapshot());
      } catch (error) {
        httpError(response, 400, 'invalid_args', error.message);
      }
      return;
    }

    if (request.method === 'POST' && path === '/mock/control/fault') {
      try {
        const body = await readJSON(request);
        json(response, 200, domain.configureFault(body));
      } catch (error) {
        httpError(response, 400, 'invalid_args', error.message);
      }
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
  webSockets.on('connection', (socket, request) => {
    sockets.add(socket);
    socketPrincipals.set(socket, sessions.get(cookieValue(request, SESSION_COOKIE)) || '');
    socketObserved.set(socket, new Set());
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
