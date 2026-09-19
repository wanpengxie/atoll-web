import { TYPES } from '../protocol/vocab.js';
import { argsOf } from '../protocol/envelope.js';

const AGENT_CONTROL_PREFIX = 'agent.';

export const CONTROL_COMMAND_SOURCE = Object.freeze({
  timeline: 'timeline',
  composer: 'composer',
  feature: 'feature',
  waiting: 'waiting',
});

function failure(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function objectPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.freeze({ ...value });
}

function audienceOf(request) {
  if (Array.isArray(request?.audience)) return request.audience.map(text).filter(Boolean);
  const actorId = text(request?.actorId);
  return actorId ? [actorId] : [];
}

export function isAgentControlType(type) {
  return typeof type === 'string'
    && type.startsWith(AGENT_CONTROL_PREFIX)
    && type !== TYPES.agentAsk;
}

function latestControlFrame(turn) {
  return [...(turn?.provisional || [])]
    .sort((left, right) => Number(right?.seq || 0) - Number(left?.seq || 0))
    .map((entry) => argsOf(entry?.envelope))
    .find((body) => body?.status === 'queued' || body?.status === 'processing') || null;
}

function normalizeTurn(turn, actorId) {
  const request = turn?.request || {};
  const frame = latestControlFrame(turn);
  const audience = Array.isArray(request.audience) ? request.audience.map(text).filter(Boolean) : [];
  const controls = Array.isArray(frame?.controls)
    ? frame.controls.flatMap((entry) => text(entry?.word) ? [text(entry.word)] : [])
    : [];
  return Object.freeze({
    requestId: text(turn?.requestId || request.id),
    requestType: text(request.type),
    audience: Object.freeze(audience),
    terminal: Boolean(turn?.terminal),
    local: Boolean(turn?.local || request.local_submission_state),
    status: text(frame?.status),
    controls: Object.freeze([...new Set(controls)]),
    actorId,
  });
}

function normalizeAuthority(authority) {
  if (!authority || typeof authority !== 'object') return null;
  const actorIDs = authority.actorIDs instanceof Set
    ? [...authority.actorIDs]
    : Array.isArray(authority.actorIDs) ? authority.actorIDs : [];
  return Object.freeze({
    current: authority.current === true,
    actorIDs: Object.freeze(actorIDs.map(text).filter(Boolean)),
  });
}

function normalizeControlContext(request, actorId) {
  const source = text(request?.controlContext?.source) || text(request?.source) || '';
  const rawTurn = request?.controlContext?.turn || request?.turn;
  const rawAuthority = request?.controlContext?.targetAuthority || request?.targetAuthority;
  return Object.freeze({
    source,
    turn: normalizeTurn(rawTurn, actorId),
    targetAuthority: normalizeAuthority(rawAuthority),
  });
}

function assertInterruptContext(context, actorId) {
  const turn = context?.turn;
  if (!turn?.requestId || turn.requestType !== TYPES.agentAsk) {
    throw failure('control_target_invalid', '停止命令必须绑定 Agent 请求回合');
  }
  if (turn.actorId !== actorId || turn.audience.length !== 1 || turn.audience[0] !== actorId) {
    throw failure('control_target_invalid', '停止命令目标与请求收件人不一致');
  }
  if (turn.terminal || turn.local) {
    throw failure('control_target_closed', '终态或本地回显不能停止');
  }
  if (!['queued', 'processing'].includes(turn.status)) {
    throw failure('control_target_not_processing', '目标回合当前没有可停止的处理中事实');
  }
  if (!turn.controls.includes(TYPES.agentInterrupt)) {
    throw failure('control_capability_missing', '目标回合未宣告 agent.interrupt 能力');
  }
  const authority = context.targetAuthority;
  if (!authority || !authority.current || !authority.actorIDs.includes(actorId)) {
    throw failure('control_authority_stale', '目标 Agent 当前权威已失效');
  }
}

/**
 * Normalize every UI control caller to the one submission-owner shape.
 * `type` is accepted only as an ingress alias; the returned wire request
 * always uses `msgType` and exactly one audience actor.
 */
export function createControlCommand(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw failure('control_request_invalid', '控制命令请求格式不正确');
  }
  const requestedMsgType = text(request.msgType);
  const requestedType = text(request.type);
  if (requestedMsgType && requestedType && requestedMsgType !== requestedType) {
    throw failure('control_request_invalid', '控制命令 type 与 msgType 不一致');
  }
  const msgType = requestedMsgType || requestedType;
  if (!msgType) throw failure('control_request_invalid', '控制命令缺少 msgType');
  const channelId = text(request.channelId);
  if (!channelId) throw failure('control_request_invalid', '控制命令缺少频道');
  const audience = audienceOf(request);
  const requestedActor = text(request.actorId);
  if (requestedActor && audience.length && requestedActor !== audience[0]) {
    throw failure('control_target_invalid', '控制命令 actorId 与 audience 不一致');
  }
  if (isAgentControlType(msgType) && audience.length !== 1) {
    throw failure('control_target_invalid', 'Agent 控制命令必须只有一个目标');
  }
  const actorId = audience[0] || '';
  const command = {
    ...request,
    channelId,
    text: typeof request.text === 'string' ? request.text : '',
    msgType,
    audience: Object.freeze(audience),
    payload: objectPayload(request.payload),
  };
  delete command.type;
  delete command.actorId;
  delete command.turn;
  delete command.targetAuthority;
  if (msgType === TYPES.agentInterrupt) {
    const context = normalizeControlContext(request, actorId);
    assertInterruptContext(context, actorId);
    command.controlContext = context;
  }
  return Object.freeze(command);
}

export function assertControlAccess(command, current = {}) {
  if (!isAgentControlType(command?.msgType)) return true;
  const access = current.access || {};
  if (access.relationship !== 'member') throw failure('forbidden', '当前频道成员权限已失效');
  if (access.existence === 'retired') throw failure('channel_not_found', '频道已退役');
  if (access.unavailable || access.runtime === 'closed') {
    throw failure('channel_unavailable', '频道暂不可用');
  }
  if (access.freshness && access.freshness !== 'fresh') {
    throw failure('control_authority_stale', '频道授权事实尚未确认');
  }
  if (command.msgType === TYPES.agentInterrupt && current.transportOpen !== true) {
    throw failure('transport_changed', '消息连接已变化');
  }
  return true;
}
