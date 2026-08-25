import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import fsPath from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createScanner, spawnPTY, stripControl } from './pty.mjs';
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
const REVIEWER_ACTOR_ID = 'reviewer';
const SYSTEM_ACTOR_ID = 'system';
// agent 基座的控制词闭集（drivers/agents/base/base.go）。agent.ask 不在其中——
// 它是“交办一件活”，不是控制。
const AGENT_CONTROL_WORDS = ['agent.steer', 'agent.interrupt', 'agent.hold', 'agent.unhold', 'agent.replace', 'agent.queue', 'agent.compact', 'agent.new', 'agent.select', 'agent.context', 'agent.fork'];

// progress 契约：凡带 status（queued/processing）的进度帧必带 controls——受理方在
// 这条消息自己的账上宣告"此刻可以对它用哪些控制词"。全量快照，后帧覆盖前帧；
// 控制词消息自身的进度帧恒为空集；终态帧恒不带。前端据此画按钮，不查任何表。
const QUEUED_CONTROLS = Object.freeze([{ word: 'agent.replace' }, { word: 'agent.steer' }]);
const PROCESSING_CONTROLS = Object.freeze([{ word: 'agent.interrupt' }, { word: 'agent.replace' }]);
// selections 是组合对目录（协议 §4.2：不是 model×effort 笛卡尔积——某 model
// 只有某些 effort 合法）。与真后端同源：decl config 的 selections 数组，
// default 恒是第一条。label 是展示元数据，恒不进当前值/判等。
const AGENT_SELECTIONS = Object.freeze({
  codex: [
    { model: 'gpt-5.6-sol', effort: 'medium', model_label: '5.6 Sol', effort_label: '中等' },
    { model: 'gpt-5.6-sol', effort: 'high', model_label: '5.6 Sol', effort_label: '高' },
    { model: 'gpt-5.6-sol', effort: 'xhigh', model_label: '5.6 Sol', effort_label: '超高' },
    { model: 'gpt-5.6-terra', effort: 'medium', model_label: '5.6 Terra', effort_label: '中等' },
    { model: 'gpt-5.4', effort: 'light', model_label: '5.4', effort_label: '轻量' },
  ],
  claude: [
    { model: 'claude-opus', effort: 'medium', model_label: 'Claude Opus', effort_label: '中等' },
    { model: 'claude-opus', effort: 'high', model_label: 'Claude Opus', effort_label: '高' },
    { model: 'claude-sonnet', effort: 'medium', model_label: 'Claude Sonnet', effort_label: '中等' },
  ],
});

function selectionCatalog(actorId) {
  return actorId === 'claude' ? AGENT_SELECTIONS.claude : AGENT_SELECTIONS.codex;
}

// describe 的 agent.select 词条 input_schema（协议 §4.2）：oneOf 每支 = 一个合法
// 组合对，每支必须 required 完整对（缺 required 时 {} 会命中多支被 oneOf 判非法）；
// 恒不写 additionalProperties:false（后端宽松解码，schema 不得伪装严格）。
function selectInputSchema(actorId) {
  return {
    type: 'object',
    properties: { model: { type: 'string' }, effort: { type: 'string' } },
    oneOf: selectionCatalog(actorId).map((row) => ({
      required: ['model', 'effort'],
      properties: {
        model: { const: row.model, ...(row.model_label ? { title: row.model_label } : {}) },
        effort: { const: row.effort, ...(row.effort_label ? { title: row.effort_label } : {}) },
      },
    })),
  };
}

const MOCK_CONTEXT_WINDOW = 200_000;

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
function mockDescribe(actorId, { taskCapability = false } = {}) {
  return {
    class: actorId === 'claude' ? 'claude' : 'codex',
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
      'agent.new': { description: '新建对话' },
      'agent.select': { description: '切换模型与算力', input_schema: selectInputSchema(actorId) },
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
    add(envelope({ id: `${requestId}-queued`, channelId, sender: responder, kind: 'response', type: 'agent.ask', payload: { status: 'queued', turn_index: index, controls: QUEUED_CONTROLS }, parentId: requestId, correlationId: requestId, audience: [selfActorId], ts: at + 1 }));
    add(envelope({ id: `${requestId}-processing`, channelId, sender: responder, kind: 'response', type: 'agent.ask', payload: { status: 'processing', turn_index: index, controls: PROCESSING_CONTROLS }, parentId: requestId, correlationId: requestId, audience: [selfActorId], ts: at + 2 }));
    add(envelope({ id: `${requestId}-turn-started`, channelId, sender: responder, kind: 'response', type: 'agent.ask', payload: { status: 'processing', turn_index: index, controls: PROCESSING_CONTROLS, process: { kind: 'turn', phase: 'started' } }, parentId: requestId, correlationId: requestId, audience: [selfActorId], ts: at + 3 }));
    add(envelope({ id: `${requestId}-tool-started`, channelId, sender: responder, kind: 'response', type: 'agent.ask', payload: { status: 'processing', turn_index: index, controls: PROCESSING_CONTROLS, process: { kind: 'tool', phase: 'started', tool_call_id: `${requestId}-tool`, tool: toolName, input: { channel_id: channelId, query: `检查 ${channelId} 的协作账本` } } }, parentId: requestId, correlationId: requestId, audience: [selfActorId], ts: at + 4 }));
    add(envelope({ id: `${requestId}-tool-ended`, channelId, sender: responder, kind: 'response', type: 'agent.ask', payload: { status: 'processing', turn_index: index, controls: PROCESSING_CONTROLS, process: { kind: 'tool', phase: 'ended', tool_call_id: `${requestId}-tool`, tool: toolName, outcome: 'completed', output: { ok: true, matched_rows: 3, channel_id: channelId } } }, parentId: requestId, correlationId: requestId, audience: [selfActorId], ts: at + 5 }));
    add(envelope({ id: `${requestId}-completed`, channelId, sender: responder, kind: 'response', type: 'agent.ask', payload: { status: 'completed', turn_index: index, text: responseText, usage: { context_tokens: 30_000 + index * 1_000, context_window: 200_000, model: 'gpt-5.6-sol', effort: 'medium' } }, parentId: requestId, correlationId: requestId, audience: [selfActorId], ts: at + 6 }));
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
  // 服务器世代号：进程重启或账本 reset 都是"新世界"，随 attach 回执告知前端，
  // 前端据此整体作废本地缓存——手测者恒不该被要求手清 cookie/localStorage。
  let bootId = randomUUID();
  const sockets = new Set();
  const attached = new WeakSet();
  const socketPrincipals = new WeakMap();
  const socketObserved = new WeakMap();
  const scheduled = new Set();
  const recurring = new Set();
  // agent 的冻结真相：hold 受理即记 holder，unhold 清除；agent.context 如实回报。
  const agentHolds = new Map();
  // per-agent 当前参数真相：select 成功终态才 sticky（默认 = 目录第一条，同后端
  // DefaultSelection）；reset 归位。label 恒不进当前值。
  const agentSelections = new Map();
  const agentOptions = (channelId, actorId) => {
    const sticky = agentSelections.get(`${channelId}:${actorId}`);
    if (sticky) return sticky;
    const { model, effort } = selectionCatalog(actorId)[0];
    return { model, effort };
  };
  const usageOf = (channelId, actorId) => ({ context_tokens: 42_000, context_window: MOCK_CONTEXT_WINDOW, ...agentOptions(channelId, actorId) });
  // select 旁路独占槽（协议 §8）：0 或 1 个占位，忙时挂起，当前 turn 终态后、
  // 任何续跑之前插队执行；恒不进等待区、不占容量、不受 hold/interrupt 冻结。
  const agentSelectSlots = new Map(); // `${channelId}:${actorId}` -> {messageId, chosen, base}
  const runSelectSlotEntry = (channelId, actorId, entry, delayBase = 5) => {
    const { messageId, chosen, base } = entry;
    later(delayBase, () => append(channelId, envelope({ ...base, id: `${messageId}-processing`, kind: 'response', type: 'agent.select', payload: { status: 'processing', turn_index: 1, turn_id: `turn-${messageId}`, controls: [] } })));
    later(delayBase + 10, () => append(channelId, envelope({ ...base, id: `${messageId}-turn-started`, kind: 'response', type: 'agent.select', payload: { status: 'processing', turn_index: 1, controls: [], process: { kind: 'turn', phase: 'started' } } })));
    later(delayBase + 20, () => {
      agentSelections.set(`${channelId}:${actorId}`, { model: chosen.model, effort: chosen.effort });
    });
    later(delayBase + 30, () => append(channelId, envelope({ ...base, id: `${messageId}-terminal`, kind: 'response', type: 'agent.select', payload: { status: 'completed', turn_index: 1, usage: usageOf(channelId, actorId) } })));
  };
  const runSelectSlot = (channelId, actorId) => {
    const key = `${channelId}:${actorId}`;
    const entry = agentSelectSlots.get(key);
    if (!entry) return;
    agentSelectSlots.delete(key);
    runSelectSlotEntry(channelId, actorId, entry, 5);
  };
  let rosters = domain.rosters;
  let histories = domain.histories;
  const applyScenarioRoster = () => {
    if (domain.behavior.message !== 'agent-tree') return;
    const rows = rosters.get('c0');
    if (rows && !rows.some((row) => row.declared.id === REVIEWER_ACTOR_ID)) {
      rows.push(rosterItem({ id: REVIEWER_ACTOR_ID, kind: 'agent', declId: 'mock:analyst', name: 'Reviewer', description: 'Mock review agent' }));
    }
  };
  applyScenarioRoster();
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
    // 单主体 mock：凡持有 cookie 即视为 root——会话表在内存里，mock 进程重启
    // 不该迫使手测者重新登录。登出走"清 cookie"，无 cookie 仍然 401。
    return Boolean(cookieValue(request, SESSION_COOKIE));
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
      && (!AGENT_CONTROL_WORDS.includes(value.type) || value.type === 'agent.replace')
      && value.type !== 'actor.describe'
      && !value.type.startsWith('system.')
      && !hasTerminal(channelId, value.id)
      && [...rows].reverse().map((row) => row.envelope).find((reply) => reply.kind === 'response' && reply.parent_id === value.id)?.payload?.status === 'processing'
    )) || null;
  }

  function latestTaskStatus(channelId, requestId) {
    return [...(histories.get(channelId) || [])].reverse()
      .map((row) => row.envelope)
      .find((value) => value.kind === 'response' && value.parent_id === requestId)?.payload?.status || '';
  }

  function isResumedTask(channelId, requestId) {
    return [...(histories.get(channelId) || [])].reverse().map((row) => row.envelope)
      .find((value) => value.kind === 'response' && value.parent_id === requestId && value.payload?.status === 'queued')?.payload?.resumed === true;
  }

  function bufferedAgentTasks(channelId, actorId) {
    return (histories.get(channelId) || []).map((row) => row.envelope).filter((value) => (
      value.kind === 'request'
      && value.sender?.kind === 'human'
      && value.audience?.includes(actorId)
      // replace 请求受理后自身就是新行（协议 §4.6），算队列成员。
      && (!AGENT_CONTROL_WORDS.includes(value.type) || value.type === 'agent.replace')
      && value.type !== 'actor.describe'
      && !value.type.startsWith('system.')
      && !hasTerminal(channelId, value.id)
      && latestTaskStatus(channelId, value.id) === 'queued'
    // Resumed 件恒在队首（协议：打断退回原下标）。
    )).sort((left, right) => Number(isResumedTask(channelId, right.id)) - Number(isResumedTask(channelId, left.id)));
  }

  // 手工演示用的确定性计算步进。它不绕过账本：每次点击仍然只追加标准
  // progress / terminal 帧，前端继续完全从账推导状态。
  function advanceAgentComputation(channelId) {
    const agent = (rosters.get(channelId) || []).map((entry) => entry.declared).find((entry) => entry.kind === 'agent');
    if (!agent) return { status: 'idle', detail: '频道中没有 Agent' };
    const active = activeAgentTask(channelId, agent.id);
    if (!active) return { status: 'idle', detail: '当前没有正在计算的任务' };
    const history = histories.get(channelId) || [];
    const previousStep = history
      .filter((row) => row.envelope.kind === 'response' && row.envelope.parent_id === active.id)
      .map((row) => Number(row.envelope.payload?.mock_compute_step || 0))
      .reduce((maximum, value) => Math.max(maximum, value), 0);
    const selfActorId = domain.activeMembership(ROOT_ID, channelId)?.actor_id || ROOT_ACTOR_ID;
    const base = {
      channelId,
      sender: { kind: 'agent', id: agent.id },
      kind: 'response',
      type: active.type,
      parentId: active.id,
      correlationId: active.correlation_id || active.id,
      audience: [selfActorId],
      ts: domain.now(),
    };
    if (previousStep < 2) {
      const step = previousStep + 1;
      const message = step === 1 ? '正在分析请求并整理上下文…' : '正在生成并校验结果…';
      append(channelId, envelope({
        ...base,
        id: domain.nextId(`${active.id}-manual-progress`),
        payload: { status: 'processing', turn_id: `turn-${active.id}`, controls: PROCESSING_CONTROLS, mock_compute_step: step, message },
      }));
      return { status: 'processing', request_id: active.id, step, message };
    }

    const requestText = String(active.payload?.text || '').trim();
    append(channelId, envelope({
      ...base,
      id: domain.nextId(`${active.id}-manual-terminal`),
      payload: { status: 'completed', text: `已完成：${requestText || '当前任务'}`, usage: usageOf(channelId, agent.id) },
    }));
    // turn 终态后、续跑批之前：select 槽插队（协议 §8"任何指令之前"）。
    runSelectSlot(channelId, agent.id);

    // 完成后按协议（§4.4.5）恢复：队首为 Resumed 件则单独成批；否则整批带走，
    // 批的 owner 恒是 tail（批内最后一条，同 loop.go:1009），其余 merged_into tail。
    const buffered = bufferedAgentTasks(channelId, agent.id);
    let resumedOwner = null;
    let merged = [];
    if (buffered.length) {
      if (isResumedTask(channelId, buffered[0].id)) resumedOwner = buffered[0];
      else { resumedOwner = buffered[buffered.length - 1]; merged = buffered.slice(0, -1); }
      append(channelId, envelope({
        ...base,
        id: domain.nextId(`${resumedOwner.id}-manual-resume`),
        type: resumedOwner.type,
        parentId: resumedOwner.id,
        correlationId: resumedOwner.id,
        payload: { status: 'processing', turn_id: `turn-${resumedOwner.id}`, controls: PROCESSING_CONTROLS },
      }));
      for (const item of merged) {
        append(channelId, envelope({
          ...base,
          id: domain.nextId(`${item.id}-manual-merged`),
          type: item.type,
          parentId: item.id,
          correlationId: item.id,
          payload: { status: 'completed', merged_into: resumedOwner.id },
        }));
      }
    }
    return { status: 'completed', request_id: active.id, resumed_request_id: resumedOwner?.id || '', merged_request_ids: merged.map((item) => item.id) };
  }

  function closeTask(channelId, request, actorId, payload) {
    if (!request || hasTerminal(channelId, request.id)) return;
    append(channelId, envelope({
      id: domain.nextId(`${request.id}-controlled-terminal`), channelId,
      sender: { kind: 'agent', id: actorId }, kind: 'response', type: request.type,
      payload, parentId: request.id, correlationId: request.correlation_id || request.id,
      audience: [request.sender.id],
    }));
    // turn 被收口（打断等）后：select 槽插队（协议 §8）。
    runSelectSlot(channelId, actorId);
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
    // request 帧恒强制单收件人（runtime/harness/step_kind_audience.go：基数 ≠1 整条拒）。
    // 多 @ 由前端拆发成 N 条合法帧（协议 §3.2），mock 恒不许非法广播"看似成功"。
    if (kind === 'request' && audience.length !== 1) {
      sendError(socket, { ref, frame: 'submit', code: 'harness_request_audience_invalid', detail: 'kind=request requires audience=[<concrete-actor>]' });
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
						assertClosedPayload(body, ['name', 'recipe', 'initial_actor_ids']);
						if (!Object.hasOwn(body, 'initial_actor_ids')) throw new TypeError('initial_actor_ids is required; send [] for an empty channel');
						const created = domain.createChannel(channelId, body.name, principal, body.initial_actor_ids);
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

    // 队列里的会话消息（FIFO，未终态且最新位置为 queued）。
    // agent.replace 请求成功后自身就是新行（协议 §4.6：admitBufferedAt），算内容行。
    const isContentRow = (value) => value.kind === 'request' && value.sender?.kind === 'human' && value.audience?.includes(respondingAgent.id)
      && (!AGENT_CONTROL_WORDS.includes(value.type) || value.type === 'agent.replace')
      && value.type !== 'actor.describe' && !value.type.startsWith('system.');
    // 队首行是否带 Resumed 标记（最新 queued 帧 resumed:true；replace 帧继承）。
    const isResumedRow = (requestId) => [...history].reverse().map((row) => row.envelope)
      .find((value) => value.kind === 'response' && value.parent_id === requestId && value.payload?.status === 'queued')?.payload?.resumed === true;

    const bufferedConversation = () => history.map((row) => row.envelope).filter((value) => (
      isContentRow(value)
      && !hasTerminal(channelId, value.id)
      && [...history].reverse().map((row) => row.envelope).find((reply) => reply.kind === 'response' && reply.parent_id === value.id)?.payload?.status === 'queued'
    // Resumed 件恒在队首（协议：打断退回原下标；replace 新行继承）。mock 无下标，
    // 显式前置；其余保持 FIFO（稳定排序）。
    )).sort((left, right) => Number(isResumedRow(right.id)) - Number(isResumedRow(left.id)));

    // 解冻/停止后续跑恒走 FIFO。组批判据照协议 §4.4.5：**Resumed 件恒单独成批**
    // ——被打断退回的队首独跑，其余继续 queued；队首是普通件才整批带走。
    // 批的 owner 是 **tail**（批内最后一条，同 loop.go:1009/1024）：tail processing，
    // 其余终态 merged_into = tail 的请求 id。
    const resumeQueueHead = (delay, leadId = '') => later(delay, () => {
      if (activeAgentTask(channelId, respondingAgent.id, messageId)) return;
      let rows = bufferedConversation();
      // 插入指定的 target 领批（08-22 改判）：提到队首，优先于 Resumed 排序。
      if (leadId) rows = [...rows.filter((row) => row.id === leadId), ...rows.filter((row) => row.id !== leadId)];
      if (!rows.length) return;
      if (!leadId && isResumedRow(rows[0].id)) {
        const head = rows[0];
        append(channelId, envelope({ ...responseBase, id: `${messageId}-resume-processing`, parentId: head.id, correlationId: head.id, kind: 'response', type: head.type, payload: { status: 'processing', turn_id: `turn-${head.id}`, controls: PROCESSING_CONTROLS } }));
        return;
      }
      const tail = rows[rows.length - 1];
      append(channelId, envelope({ ...responseBase, id: `${messageId}-resume-processing`, parentId: tail.id, correlationId: tail.id, kind: 'response', type: tail.type, payload: { status: 'processing', turn_id: `turn-${tail.id}`, controls: PROCESSING_CONTROLS } }));
      for (const row of rows.slice(0, -1)) {
        append(channelId, envelope({ ...responseBase, id: `${messageId}-merged-${row.id}`, parentId: row.id, correlationId: row.id, kind: 'response', type: row.type, payload: { status: 'completed', merged_into: tail.id } }));
      }
    });

    // 定向 hold 用于编辑某一条消息。解冻时只能让该目标恢复 processing，不能把
    // 它后面的等待消息顺手 merged_into；否则“编辑 A”会隐式发射 B/C。
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
        // 全体插入（协议 §4.4.15）：{all:true} 单字段闭集，把等待区里发起人自己的
        // 消息全部并入；他人的留下。
        if ('all' in (payload.payload || {})) {
          if (payload.payload.all !== true || Object.keys(payload.payload).length !== 1) { fail('invalid_args', 'all form must be exactly {all:true}'); return; }
          const own = bufferedConversation().filter((row) => row.sender?.id === selfActorId);
          if (!own.length) { complete({}); return; }
          complete({});
          if (!active) {
            // 内容动作恒解除停止：清冻结 + 整批续跑（owner=tail）。
            agentHolds.delete(`${channelId}:${respondingAgent.id}`);
            resumeQueueHead(20);
            return;
          }
          // 有 turn：own 全部卷进当前 turn，tail 上位 owner，其余（含旧 owner）merged_into tail。
          const tail = own[own.length - 1];
          later(20, () => {
            closeTask(channelId, active, respondingAgent.id, { status: 'completed', merged_into: tail.id });
            for (const row of own.slice(0, -1)) {
              append(channelId, envelope({ ...responseBase, id: `${messageId}-all-merged-${row.id}`, parentId: row.id, correlationId: row.id, kind: 'response', type: row.type, payload: { status: 'completed', merged_into: tail.id } }));
            }
            append(channelId, envelope({ ...responseBase, id: `${messageId}-all-lead`, parentId: tail.id, correlationId: tail.id, kind: 'response', type: tail.type, payload: { status: 'processing', turn_id: turnId, controls: PROCESSING_CONTROLS } }));
          });
          return;
        }
        const targetId = String(payload.payload?.target || '');
        if (targetId) {
          if (text.trim() || Object.keys(payload.payload || {}).length !== 1) { fail('invalid_args', 'target form only accepts target'); return; }
          const targetRequest = history.find((row) => row.envelope.id === targetId)?.envelope;
          const targetPosition = [...history].reverse().map((row) => row.envelope).find((value) => value.kind === 'response' && value.parent_id === targetId)?.payload?.status;
          if (!targetRequest || targetPosition !== 'queued') { fail('cas_mismatch', 'steer target is not buffered'); return; }
          if (targetRequest.sender?.id !== selfActorId) { fail('target_not_owned', 'steer target belongs to another sender'); return; }
          complete({});
          if (!active) {
            // 08-22 改判：插入是内容动作——清除冻结、target 提队首领批、恢复推进。
            agentHolds.delete(`${channelId}:${respondingAgent.id}`);
            resumeQueueHead(20, targetId);
            return;
          }
          later(20, () => {
            // 插入后旧 owner 并入新 turn：终态 merged_into = target（同 loop.go:1415）。
            closeTask(channelId, active, respondingAgent.id, { status: 'completed', merged_into: targetId });
            append(channelId, envelope({ ...responseBase, id: `${messageId}-target-inserted`, parentId: targetId, correlationId: targetId, kind: 'response', type: targetRequest.type, payload: { status: 'processing', turn_id: turnId, controls: PROCESSING_CONTROLS } }));
          });
          return;
        }
        if (!text.trim()) { fail('empty_input', 'steer requires text input'); return; }
        if (payload.payload?.expected_turn_id && payload.payload.expected_turn_id !== turnId) { fail('cas_mismatch', 'steer target is no longer active'); return; }
        if (!active) { fail('cas_mismatch', 'no steerable turn'); return; }
        later(20, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-processing`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', turn_id: turnId, controls: [] } })));
        later(45, () => {
          closeTask(channelId, active, respondingAgent.id, { status: 'completed', value: { preempted_by: messageId } });
          append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed', value: { merged_into: turnId, direction: text } } }));
        });
        return;
      }
      if (payload.msg_type === 'agent.interrupt') {
        // 停止 = 打断当前 turn + 冻结队列；恢复 = 再发消息（消息路径解除此冻结）。
        agentHolds.set(`${channelId}:${respondingAgent.id}`, { holdId: messageId, source: 'interrupt' });
        append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed' } }));
        later(25, () => {
          closeTask(channelId, active, respondingAgent.id, { status: 'failed', reason: 'interrupted', error_code: 'interrupted', detail: 'interrupted by user control' });
        });
        return;
      }
      if (payload.msg_type === 'agent.hold' || payload.msg_type === 'agent.unhold') {
        const holdKey = `${channelId}:${respondingAgent.id}`;
        const holdArgs = payload.payload || {};
        if (payload.msg_type === 'agent.hold') {
          // schema 闭集：{target?, duration_ms?: 1..1800000}
          const unknownKeys = Object.keys(holdArgs).filter((key) => !['target', 'duration_ms'].includes(key));
          const duration = holdArgs.duration_ms;
          if (unknownKeys.length || (duration != null && (!Number.isInteger(duration) || duration < 1 || duration > 1_800_000))) { fail('invalid_args', 'hold accepts only target and duration_ms (1..1800000)'); return; }
        } else if (Object.keys(holdArgs).length) { fail('invalid_args', 'unhold takes no arguments'); return; }
        const holdTarget = payload.msg_type === 'agent.hold' ? String(holdArgs.target || '') : '';
        const targetRequest = holdTarget ? history.find((row) => row.envelope.id === holdTarget)?.envelope : null;
        if (holdTarget && targetRequest && targetRequest.sender?.id !== selfActorId) { fail('target_not_owned', 'hold target belongs to another sender'); return; }
        if (payload.msg_type === 'agent.hold') {
          const previous = agentHolds.get(holdKey);
          // hold 恢复前任冻结（协议 §4.4.16）：前任是停止冻结则记标记，后写覆盖继承。
          const restoreInterrupt = previous?.source === 'interrupt' || previous?.restoreInterrupt === true;
          const effectiveDuration = holdArgs.duration_ms ?? 1_800_000;
          agentHolds.set(holdKey, { holdId: messageId, source: 'hold', targetId: holdTarget, restoreInterrupt, until: domain.now() + effectiveDuration });
          // 到期与 unhold 同语义：恢复前任停止冻结，或清锁续跑。
          later(effectiveDuration, () => {
            if (agentHolds.get(holdKey)?.holdId !== messageId) return;
            if (restoreInterrupt) { agentHolds.set(holdKey, { holdId: messageId, source: 'interrupt' }); return; }
            agentHolds.delete(holdKey);
            resumeQueueHead(10);
          });
        } else {
          const released = agentHolds.get(holdKey);
          agentHolds.delete(holdKey);
          if (released?.restoreInterrupt) {
            // 管理动作收尾恒不惊动停止状态：恢复 interrupt 冻结、恒不续跑。
            agentHolds.set(holdKey, { holdId: released.holdId, source: 'interrupt' });
          }
        }
        append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed' } }));
        if (payload.msg_type === 'agent.unhold' && agentHolds.get(holdKey)?.source !== 'interrupt') {
          // unhold 无目标参数；真正的续跑对象由 Resumed/FIFO 队首决定。
          resumeQueueHead(30);
        }
        // hold 带 target 且目标正在处理：打断当前 turn，目标消息回到队列头（Resumed）。
        if (targetRequest) {
          const targetPosition = [...history].reverse().map((value) => value.envelope).find((value) => value.kind === 'response' && value.parent_id === holdTarget)?.payload?.status;
          if (targetPosition === 'processing') {
            // 只发 Resumed 帧：消息回队列头，不打终态（活动判定本就从账推，最新帧
            // 变 queued 即不再是活动 turn）。
            later(25, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-target-resumed`, parentId: holdTarget, correlationId: holdTarget, kind: 'response', type: targetRequest.type, payload: { status: 'queued', resumed: true, controls: QUEUED_CONTROLS } })));
          }
        }
        return;
      }
      if (payload.msg_type === 'agent.replace') {
        // 协议校验：目标存在且在队列中、归属发起人、old_text 与当前缓冲内容 CAS。
        const replaceTarget = String(payload.payload?.target || '');
        const replaceRequest = history.find((row) => row.envelope.id === replaceTarget)?.envelope;
        if (!replaceRequest) { fail('cas_mismatch', 'replace target not found'); return; }
        if (replaceRequest.sender?.id !== selfActorId) { fail('target_not_owned', 'replace target belongs to another sender'); return; }
        const replacePosition = [...history].reverse().map((row) => row.envelope).find((value) => value.kind === 'response' && value.parent_id === replaceTarget)?.payload?.status;
        if (replacePosition !== 'queued') { fail('cas_mismatch', 'replace target is not buffered'); return; }
        // 当前缓冲文本 = 目标行自己的正文：普通消息在 text，replace 行（新行）在 new_text。
        const currentText = String(replaceRequest.payload?.new_text ?? replaceRequest.payload?.text ?? '');
        if (String(payload.payload?.old_text ?? '') !== currentText) { fail('cas_mismatch', 'old_text does not match the buffered content'); return; }
        // 协议形（§4.6 / loop.go TypeReplace 分支）：原行终态 replaced_by = replace
        // 请求 id；replace 请求自身以原下标入队成为新行，继承 Resumed 标记。
        const targetResumed = [...history].reverse().map((row) => row.envelope)
          .find((value) => value.kind === 'response' && value.parent_id === replaceTarget && value.payload?.status === 'queued')?.payload?.resumed === true;
        later(20, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-target-terminal`, parentId: replaceTarget, correlationId: replaceTarget, kind: 'response', type: replaceRequest.type, payload: { status: 'completed', replaced_by: messageId } })));
        later(30, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-queued`, kind: 'response', type: payload.msg_type, payload: { status: 'queued', ...(targetResumed ? { resumed: true } : {}), controls: QUEUED_CONTROLS } })));
        return;
      }
      if (payload.msg_type === 'agent.queue') {
        if (!text.trim()) { fail('empty_input', 'queue requires text input'); return; }
        later(20, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-queued`, kind: 'response', type: payload.msg_type, payload: { status: 'queued', controls: QUEUED_CONTROLS } })));
        later(80, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed', value: { queued: true, text } } })));
        return;
      }
      if (payload.msg_type === 'agent.context') {
        // 只读自省：如实回报当前参数、上下文用量与冻结状态（loop.go usageValue 同形），
        // 绝不动活动 turn。
        const holdEntry = agentHolds.get(`${channelId}:${respondingAgent.id}`);
        later(15, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed', ...usageOf(channelId, respondingAgent.id), ...(holdEntry ? { frozen: { held_by: holdEntry.holdId, until: holdEntry.until || domain.now() + 1_800_000 } } : {}) } })));
        return;
      }
      if (payload.msg_type === 'agent.select') {
        // select 走旁路独占槽（协议 §8）：不进等待区、不占容量、不受冻结控制。
        // 空闲立即执行；忙时挂槽，当前 turn 终态后、任何续跑之前插队执行。
        const catalog = selectionCatalog(respondingAgent.id);
        // 宽松形对齐 loop.go validateSelection：未知字段被忽略（恒不闭集拒）；
        // {} 两字段全空 → 匹配循环全不中 → invalid_args；只给 effort 沿用当前
        // model；只给 model 时 effort 任意匹配该 model 第一条。
        const selection = payload.payload || {};
        const currentOptions = agentOptions(channelId, respondingAgent.id);
        const rawModel = String(selection.model || '').trim();
        const rawEffort = String(selection.effort || '').trim();
        const model = rawModel || (rawEffort ? currentOptions.model : '');
        const chosen = catalog.find((row) => row.model === model && (!rawEffort || row.effort === rawEffort));
        if (!chosen) { fail('invalid_args', 'selection is not in provider selections'); return; }
        const slotKey = `${channelId}:${respondingAgent.id}`;
        // 独占覆盖：被顶掉的占位者终态 failed/superseded（它从没生效过）。
        const held = agentSelectSlots.get(slotKey);
        if (held) {
          agentSelectSlots.delete(slotKey);
          append(channelId, envelope({ ...held.base, id: `${held.messageId}-terminal`, kind: 'response', type: 'agent.select', payload: { status: 'failed', reason: 'superseded', error_code: 'superseded', detail: 'superseded by a newer agent.select' } }));
        }
        // 槽登记回执（controls 空集：槽在等待区之外，插入/编辑恒够不着）。
        later(15, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-queued`, kind: 'response', type: payload.msg_type, payload: { status: 'queued', turn_index: 1, controls: [] } })));
        const entry = { messageId, chosen, base: { ...responseBase } };
        if (activeAgentTask(channelId, respondingAgent.id, messageId)) {
          agentSelectSlots.set(slotKey, entry);
          return;
        }
        runSelectSlotEntry(channelId, respondingAgent.id, entry, 25);
        return;
      }
      const key = { 'agent.compact': 'compacted', 'agent.new': 'new', 'agent.fork': 'forked' }[payload.msg_type];
      later(30, () => {
        closeTask(channelId, active, respondingAgent.id, { status: 'failed', reason: 'cancelled', error_code: 'cancelled', detail: payload.msg_type });
        append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed', value: { [key]: true } } }));
      });
      return;
    }

    // 容量门：缓冲满（RequestMaxCount=8）时新的占格请求整体拒绝。
    if (bufferedConversation().length >= 8) { fail('base_capacity', 'agent request buffer is full'); return; }
    const busy = activeAgentTask(channelId, respondingAgent.id, messageId);
    later(20, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-queued`, kind: 'response', type: payload.msg_type, payload: { status: 'queued', turn_index: 1, controls: QUEUED_CONTROLS } })));
    const freezeEntry = agentHolds.get(`${channelId}:${respondingAgent.id}`);
    if (freezeEntry?.source === 'interrupt') {
      // 停止后的恢复 = 发内容：解除冻结，从队列头 FIFO 续跑（新消息排在队尾）。
      agentHolds.delete(`${channelId}:${respondingAgent.id}`);
      resumeQueueHead(45);
      return;
    }
    if (freezeEntry) return; // hold 冻结：只入队，恒不开跑。
    if (busy) return;
    const mode = domain.behavior.message || '';
    later(40, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-processing`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', turn_index: 1, controls: PROCESSING_CONTROLS, ...(mode === 'long-running' ? { turn_id: `turn-${messageId}` } : {}) } })));
    if (mode === 'business-provisional') later(50, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-business`, kind: 'response', type: payload.msg_type, payload: { status: 'provider.waiting', queue: 'external' } })));
    later(50, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-turn-started`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', turn_index: 1, controls: PROCESSING_CONTROLS, process: { kind: 'turn', phase: 'started' } } })));
    if (mode === 'progress-demo') {
      const tools = ['理解任务', '读取频道', '检查成员', '搜索资料', '整理上下文', '分析数据', '生成方案', '校验结果', '组织回复', '完成收尾'];
      tools.forEach((tool, index) => {
        const startedAt = 80 + index * 30_000;
        const callId = `${messageId}-demo-${index + 1}`;
        later(startedAt, () => append(channelId, envelope({ ...responseBase, id: `${callId}-started`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', turn_index: 1, controls: PROCESSING_CONTROLS, process: { kind: 'tool', phase: 'started', tool_call_id: callId, tool, input: { step: index + 1, total: tools.length, channel_id: channelId } } } })));
        later(startedAt + 29_999, () => append(channelId, envelope({ ...responseBase, id: `${callId}-ended`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', turn_index: 1, controls: PROCESSING_CONTROLS, process: { kind: 'tool', phase: 'ended', tool_call_id: callId, tool, outcome: 'completed', output: { step: index + 1, ok: true } } } })));
      });
      const completedAt = 80 + tools.length * 30_000;
      later(completedAt + 20, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type, payload: { status: 'completed', turn_index: 1, text: '已完成 10 个演示过程。', usage: usageOf(channelId, respondingAgent.id) } })));
      return;
    }
    if (mode === 'agent-tree') {
      const rootCorrelation = messageId;
      const parentAgentId = respondingAgent.id;
      const childAgentId = parentAgentId === 'claude' ? STEWARD_ACTOR_ID : 'claude';
      const childB = `${messageId}-child-b`;
      const childC = `${messageId}-child-c`;
      const grandchildD = `${messageId}-child-d`;
      const grandchildAgentId = REVIEWER_ACTOR_ID;
      const callB = `${messageId}-call-b`;
      const callC = `${messageId}-call-c`;
      const callD = `${messageId}-call-d`;
      const progress = (id, parentId, senderId, receiverId, process) => append(channelId, envelope({
        id, channelId, sender: { kind: 'agent', id: senderId }, kind: 'response', type: 'agent.ask',
        parentId, correlationId: rootCorrelation, audience: [receiverId],
        payload: { status: 'processing', controls: PROCESSING_CONTROLS, process },
      }));
      const childRequest = (id, parentId, senderId, receiverId, childText) => append(channelId, envelope({
        id, channelId, sender: { kind: 'agent', id: senderId }, kind: 'request', type: 'agent.ask',
        parentId, correlationId: rootCorrelation, audience: [receiverId], payload: { text: childText },
      }));
      const childTerminal = (id, parentId, senderId, receiverId, childText) => append(channelId, envelope({
        id, channelId, sender: { kind: 'agent', id: senderId }, kind: 'response', type: 'agent.ask',
        parentId, correlationId: rootCorrelation, audience: [receiverId], payload: { status: 'completed', text: childText, usage: usageOf(channelId, senderId) },
      }));

      later(60, () => progress(`${callB}-started`, messageId, parentAgentId, selfActorId, {
        kind: 'tool', phase: 'started', tool_call_id: callB, tool: 'call_actor',
        input: { actor_id: childAgentId, type: 'agent.ask', payload: { text: 'B 负责资料分析' } },
      }));
      later(70, () => childRequest(childB, messageId, parentAgentId, childAgentId, 'B 负责资料分析'));
      later(80, () => progress(`${childB}-turn`, childB, childAgentId, parentAgentId, { kind: 'turn', phase: 'started' }));
      later(90, () => progress(`${childB}-stage`, childB, childAgentId, parentAgentId, { kind: 'stage', stage: 'thinking', text: 'B 正在整理资料' }));
      later(100, () => progress(`${callD}-started`, childB, childAgentId, parentAgentId, {
        kind: 'tool', phase: 'started', tool_call_id: callD, tool: 'call_actor',
        input: { actor_id: grandchildAgentId, type: 'agent.ask', payload: { text: 'D 负责核验关键事实' } },
      }));
      later(110, () => childRequest(grandchildD, childB, childAgentId, grandchildAgentId, 'D 负责核验关键事实'));
      later(120, () => progress(`${grandchildD}-stage`, grandchildD, grandchildAgentId, childAgentId, { kind: 'stage', stage: 'thinking', text: 'D 正在核验' }));
      later(130, () => childTerminal(`${grandchildD}-terminal`, grandchildD, grandchildAgentId, childAgentId, 'D 核验完成'));
      later(140, () => progress(`${callD}-ended`, childB, childAgentId, parentAgentId, {
        kind: 'tool', phase: 'ended', tool_call_id: callD, tool: 'call_actor', outcome: 'completed',
        output: { status: 'completed', text: 'D 核验完成' },
      }));
      later(150, () => childTerminal(`${childB}-terminal`, childB, childAgentId, parentAgentId, 'B 汇总完成'));
      later(160, () => progress(`${callB}-ended`, messageId, parentAgentId, selfActorId, {
        kind: 'tool', phase: 'ended', tool_call_id: callB, tool: 'call_actor', outcome: 'completed',
        output: { status: 'completed', text: 'B 汇总完成' },
      }));

      later(170, () => progress(`${callC}-started`, messageId, parentAgentId, selfActorId, {
        kind: 'tool', phase: 'started', tool_call_id: callC, tool: 'call_actor',
        input: { actor_id: childAgentId, type: 'agent.ask', payload: { text: 'C 负责独立复核' } },
      }));
      later(180, () => childRequest(childC, messageId, parentAgentId, childAgentId, 'C 负责独立复核'));
      later(190, () => progress(`${childC}-stage`, childC, childAgentId, parentAgentId, { kind: 'stage', stage: 'thinking', text: 'C 正在复核' }));
      later(200, () => childTerminal(`${childC}-terminal`, childC, childAgentId, parentAgentId, 'C 复核完成'));
      later(210, () => progress(`${callC}-ended`, messageId, parentAgentId, selfActorId, {
        kind: 'tool', phase: 'ended', tool_call_id: callC, tool: 'call_actor', outcome: 'completed',
        output: { status: 'completed', text: 'C 复核完成' },
      }));
      later(230, () => append(channelId, envelope({
        ...responseBase, id: `${messageId}-terminal`, kind: 'response', type: payload.msg_type,
        payload: { status: 'completed', text: 'A 已汇总 B 与 C 的结果。', usage: usageOf(channelId, parentAgentId) },
      })));
      return;
    }
    later(60, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-tool-started`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', turn_index: 1, controls: PROCESSING_CONTROLS, process: { kind: 'tool', phase: 'started', tool_call_id: `${messageId}-tool`, tool: 'mock.ping', input: { channel_id: channelId, message_id: messageId } } } })));
    later(80, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-tool-ended`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', turn_index: 1, controls: PROCESSING_CONTROLS, process: { kind: 'tool', phase: 'ended', tool_call_id: `${messageId}-tool`, tool: 'mock.ping', outcome: 'completed', output: { pong: true, channel_id: channelId } } } })));
    if (mode === 'long-running') return;
    const terminalDelay = mode === 'business-provisional' ? 500 : 100;
    // 每个 turn 的 usage 只随 terminal 出账——不再制造 turn.ended event。
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
            ? { status: 'failed', reason: 'receiver_internal_error', error_code: 'type_unsupported', detail: 'mock failure requested by message text', diagnostic: { attempt: 1 }, usage: usageOf(channelId, respondingAgent.id) }
            : { status: 'completed', turn_index: 1, text: 'PONG', usage: usageOf(channelId, respondingAgent.id) },
    })));
    // turn 终态后、任何续跑之前：先跑挂着的 select 槽。
    later(terminalDelay + 3, () => runSelectSlot(channelId, respondingAgent.id));
    if (mode === 'provisional-after-terminal') {
      later(220, () => append(channelId, envelope({ ...responseBase, id: `${messageId}-late-processing`, kind: 'response', type: payload.msg_type, payload: { status: 'processing', late: true, controls: [] } })));
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
    if (type === 'history_before') {
      const principal = socketPrincipals.get(socket) || '';
      const observed = socketObserved.get(socket) || new Set();
      if (!domain.canRead(principal, payload.channel_id, observed)) {
        sendError(socket, { ref, frame: type, code: 'forbidden', detail: 'no eligibility for channel' });
        return;
      }
      if (!histories.has(payload.channel_id)) {
        sendError(socket, { ref, frame: type, code: 'channel_not_found', detail: 'channel does not exist' });
        return;
      }
      const rows = histories.get(payload.channel_id).filter((row) => row.envelope.visibility !== 'system');
      const headSeq = histories.get(payload.channel_id).at(-1)?.seq || 0;
      const anchor = payload.before_seq > 0 ? payload.before_seq : headSeq + 1;
      const candidates = rows.filter((row) => row.seq < anchor);
      const page = candidates.slice(-(payload.limit || 200));
      sendReceipt(socket, ref, {
        channel_id: payload.channel_id,
        head_seq: headSeq,
        oldest_seq: page[0]?.seq || 0,
        newest_seq: page.at(-1)?.seq || 0,
        has_older: candidates.length > page.length,
        rows: page.map(({ seq, envelope }) => ({ seq, envelope })),
      });
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
      const invalidPositions = (positions) => positions != null && (!isObject(positions) || Object.values(positions).some((seq) => !Number.isSafeInteger(seq) || seq < 0));
      if (validation || invalidPositions(payload.since)) {
        sendError(socket, { ref, frame: frameType, code: 'bad_payload', detail: validation || 'since must map channel ids to non-negative integer seq values' });
        return;
      }
      attached.add(socket);
      const since = payload.since || {};
      const historyGrants = [];
      const effectiveSince = { ...since };
      const initialTails = new Map();
      for (const [channelId, rows] of histories) {
        const principal = socketPrincipals.get(socket) || '';
        const observed = socketObserved.get(socket) || new Set();
        if (!domain.canRead(principal, channelId, observed)) continue;
        const visible = rows.filter((row) => row.envelope.visibility !== 'system');
        const tail = visible.slice(-200);
        const oldestSeq = tail[0]?.seq || 0;
        const floor = oldestSeq ? oldestSeq - 1 : rows.at(-1)?.seq || 0;
        const cursor = Number(since[channelId] || 0);
        const truncated = cursor < floor;
        if (truncated) {
          effectiveSince[channelId] = rows.at(-1)?.seq || 0;
          initialTails.set(channelId, tail);
        }
        historyGrants.push({ channel_id: channelId, head_seq: rows.at(-1)?.seq || 0, oldest_seq: oldestSeq, has_older: visible.length > tail.length, truncated });
      }
      // 对齐真后端 AttachReceipt：成员清单随回执直接交付（资格账快照），
      // 前端连上即知道自己在哪些频道，恒不靠 feed 副作用反推。
      sendReceipt(socket, ref, {
        contract_version: CONTRACT_VERSION,
        boot: bootId,
        memberships: domain.attachMemberships(socketPrincipals.get(socket) || ''),
        memberships_complete: true,
        history: historyGrants,
      });
      const replay = () => {
        for (const [channelId, history] of histories) {
          const principal = socketPrincipals.get(socket) || '';
          const observed = socketObserved.get(socket) || new Set();
          if (!domain.canRead(principal, channelId, observed)) continue;
          const cursor = Number(effectiveSince[channelId] || 0);
          const replayRows = initialTails.get(channelId) || history.filter((row) => row.envelope.visibility !== 'system' && row.seq > cursor);
          for (const row of replayRows) {
            sendFrame(socket, 'feed', '', row);
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
      const submittedAccount = typeof body?.email === 'string' ? body.email.trim() : '';
      const email = path.endsWith('/login') && submittedAccount === 'root' ? ROOT_EMAIL : submittedAccount;
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
      json(response, 200, { scenarios: scenarioIds(), agent_advance: true, actions: ['drop', 'approval', 'revoke_membership', 'grant_membership', 'retire_channel', 'set_channel_open', 'set_obs_complete', 'pulse', 'push_provisional', 'push_terminal', 'replay_envelope', 'terminal_conflict', 'resolve_approval'] });
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
        const computation = body.compute?.channel_id ? advanceAgentComputation(String(body.compute.channel_id)) : null;
        json(response, 200, { clock: domain.now(), applied: due, ...(computation ? { computation } : {}) });
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
        applyScenarioRoster();
        if (loadScenario(body.scenario || 'multi-channel', body.seed).history) {
          for (const channelId of histories.keys()) {
            if (domain.activeMembership(ROOT_ID, channelId)) histories.set(channelId, seededHistory(channelId, domain.behavior));
          }
        }
        closedRequests.clear();
        agentHolds.clear();
        agentSelections.clear();
        agentSelectSlots.clear();
        bootId = randomUUID();
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
  // 终端腿：独立 WebSocketServer，与账本 feed 互不相扰——与真节点同形
  // （见 .dalek/pm/terminal-line-design.md §4.5）。
  const ptySockets = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  const ptySessions = new Map();
  const PTY_GRACE_MS = 60_000;
  const integrationPath = process.env.ATOLL_MOCK_SHELL_INTEGRATION
    || fsPath.resolve(process.cwd(), '../atoll/scripts/shell/atoll-integration.zsh');

  // 命令记录落进 mock 的账本，作者是 root——与真节点一样，
  // 身份由服务端定，恒不由终端自称。这样在时间轴上就能看到完整闭环。
  function recordCommand(channelId, rec) {
    // 作者恒是这个频道里的「我」，与 seededHistory 用的是同一条规则——
    // 真节点由 runtime 从 subject slot 盖章，mock 这里由服务端定，
    // 两者共同点是：恒不由终端自称。
    const selfId = channelId === 'c0' || channelId === 'c0.lobby'
      ? ROOT_ACTOR_ID
      : `root-${channelId.split('.').at(-1)}`;
    append(channelId, envelope({
      id: `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channelId,
      sender: { kind: 'human', id: selfId },
      kind: 'event',
      type: 'terminal.command',
      payload: rec,
    }));
  }

  function servePTY(ws, url) {
    const channelId = url.searchParams.get('channel_id') || 'c0';
    const cols = Number(url.searchParams.get('cols')) || 80;
    const rows = Number(url.searchParams.get('rows')) || 24;
    const want = url.searchParams.get('session') || '';

    let session = want ? ptySessions.get(want) : null;
    if (session && session.grace) { clearTimeout(session.grace); session.grace = null; }
    // 接管而非拒绝：切频道/刷新回来时，旧 socket 常常还没断干净。拒绝会把人
    // 推去开一个新 shell，而那正是要避免的事——同一个 caller 恒可接管自己的
    // 会话，被顶掉的旧 socket 静默关闭。
    if (session && session.ws) {
      const stale = session.ws;
      session.ws = null;
      try { stale.close(1000, 'superseded'); } catch { /* gone */ }
    }
    if (!session) {
      const id = `pty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const child = spawnPTY({ cols, rows, integrationPath });
      session = { id, channelId, child, ws: null, grace: null, scan: createScanner(), tail: '', inCmd: false, openAt: 0 };
      ptySessions.set(id, session);

      child.stdout.on('data', (buf) => onPTYOutput(session, buf));
      child.stderr.on('data', (buf) => onPTYOutput(session, buf));
      const end = (reason) => {
        if (session.ended) return;
        session.ended = reason;
        // 与真节点同形：正常结束恒须带 reason，否则前端分不清
        // 「shell 退出」与「网络断」，会静默重连进第二个 shell。
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
          try { session.ws.close(1000, reason); } catch { /* gone */ }
        }
        ptySessions.delete(session.id);
      };
      child.on('exit', (code) => end(code ? `shell exited (${code})` : 'shell exited'));
      child.on('error', () => end('shell failed to start'));
      // 没有观众也要上钟：开了却没人来的会话恒不得泄漏一个 shell。
      session.grace = setTimeout(() => { try { child.kill('SIGHUP'); } catch { /* gone */ } }, PTY_GRACE_MS);
    }

    session.ws = ws;
    ws.send(JSON.stringify({ type: 'ready', session: session.id }));

    ws.on('message', (data, isBinary) => {
      if (isBinary) { session.child.stdin.write(data); return; }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'input') session.child.stdin.write(msg.data);
      else if (msg.type === 'resize') {
        // script(1) 不转发窗口尺寸，mock 里只记不改——真节点走 TIOCSWINSZ。
        session.cols = msg.cols; session.rows = msg.rows;
      } else if (msg.type === 'close') {
        try { session.child.kill('SIGHUP'); } catch { /* gone */ }
      }
    });
    ws.on('close', () => {
      if (session.ws !== ws) return;
      session.ws = null;
      // 保住进程，恒不保住输出：断线不杀 shell，宽限期内回来接同一个。
      if (!session.ended) {
        session.grace = setTimeout(() => {
          try { session.child.kill('SIGHUP'); } catch { /* gone */ }
          ptySessions.delete(session.id);
        }, PTY_GRACE_MS);
      }
    });
  }

  function onPTYOutput(session, buf) {
    const events = session.scan(buf);
    let prev = 0;
    for (const ev of events) {
      if (session.inCmd) session.tail += buf.slice(prev, ev.offset).toString();
      prev = ev.offset;
      if (ev.kind === 'start') { session.inCmd = true; session.tail = ''; session.openAt = Date.now(); }
      else if (ev.kind === 'end') {
        recordCommand(session.channelId, {
          session_id: session.id,
          cmd: ev.text,
          cwd: ev.cwd,
          exit_code: ev.exitCode,
          duration_ms: session.openAt ? Date.now() - session.openAt : 0,
          output_tail: stripControl(session.tail).slice(-4000),
        });
        session.inCmd = false; session.tail = '';
      }
    }
    if (session.inCmd && prev < buf.length) session.tail += buf.slice(prev).toString();
    // 字节恒原样透传：标记是带内的，xterm.js 自己也要消费它。
    if (session.ws && session.ws.readyState === WebSocket.OPEN) session.ws.send(buf);
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://mock.local');
    if (url.pathname === '/pty') {
      if (!authenticated(request)) {
        const body = JSON.stringify({ code: 'not_authenticated', detail: 'invalid session' });
        socket.write(`HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
        socket.destroy();
        return;
      }
      ptySockets.handleUpgrade(request, socket, head, (ws) => servePTY(ws, url));
      return;
    }
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
    socketPrincipals.set(socket, cookieValue(request, SESSION_COOKIE) ? ROOT_ID : '');
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
