import { correlationOf, FINAL, PROVISIONAL } from '../protocol/envelope.js';
import { isActivity, isNarrationEnvelope, TYPES } from '../protocol/vocab.js';

// subjectgate 只让这两个词走 resolve 帧（platform/internal/humancell）。
const RESOLVABLE = new Set([TYPES.humanAsk, TYPES.humanApprove]);
const BUSINESS_PROVISIONAL = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*$/;
const timelineCache = new WeakMap();

export function createChannelState(channelId = '') {
  return {
    channelId,
    rows: new Map(),
    turns: new Map(), // request id → RequestTurn
    correlations: new Map(), // correlation id → request ids[]
    narration: [],
    approvals: new Map(),
    standalone: [],
    orphans: [],
    anomalies: [],
    lastSeq: 0,
    _seenIds: new Set(),
    _envelopesById: new Map(),
    _unmatchedByParent: new Map(),
    _unmatchedByCorrelation: new Map(),
  };
}

function newTurn(request, seq) {
  const correlationId = correlationOf(request);
  return {
    requestId: request.id,
    correlation: correlationId,
    correlationId,
    request,
    requestSeq: seq,
    provisional: [],
    activity: [],
    terminal: null,
    terminalSeq: 0,
    final: null, // 兼容旧 UI 名称；与 terminal 始终一致。
    phase: 'open',
    status: 'open',
    latestStatus: '',
    text: '',
    lastSeq: seq,
    anomalies: [],
  };
}

function anomaly(state, code, seq, envelope, turn = null) {
  const value = { code, seq, envelopeId: envelope?.id || '', requestId: turn?.requestId || envelope?.parent_id || '' };
  state.anomalies.push(value);
  turn?.anomalies.push(value);
}

function sameEnvelope(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function pushMap(map, key, item) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(item);
  map.set(key, values);
}

function latestCorrelationTurn(state, correlationId) {
  const requestIds = state.correlations.get(correlationId) || [];
  const values = requestIds.map((id) => state.turns.get(id)).filter(Boolean);
  return values.findLast((turn) => !turn.terminal) || values.at(-1) || null;
}

function findTurn(state, envelope) {
  if (envelope.parent_id && state.turns.has(envelope.parent_id)) return state.turns.get(envelope.parent_id);
  if (envelope.correlation_id) return latestCorrelationTurn(state, envelope.correlation_id);
  return null;
}

function businessFields(payload = {}) {
  const { status: _status, ...rest } = payload || {};
  return rest;
}

function terminalText(payload = {}) {
  if (Object.prototype.hasOwnProperty.call(payload, 'text')) return String(payload.text ?? '');
  if (payload.status === 'failed') return [payload.reason, payload.error_code, payload.detail].filter(Boolean).join(': ');
  return '';
}

function applyProvisional(state, turn, seq, envelope) {
  const status = envelope.payload?.status;
  const core = PROVISIONAL.has(status);
  const business = typeof status === 'string' && BUSINESS_PROVISIONAL.test(status) && !FINAL.has(status);
  if (!core && !business) {
    anomaly(state, 'unknown_response_status', seq, envelope, turn);
    state.orphans.push({ seq, envelope });
    return;
  }
  turn.provisional.push({ seq, envelope, status, core });
  turn.latestStatus = status;
  turn.lastSeq = Math.max(turn.lastSeq, seq);
  if (turn.terminal) {
    anomaly(state, 'provisional_after_terminal', seq, envelope, turn);
    return;
  }
  turn.phase = core ? status : 'business_provisional';
  turn.status = turn.phase;
}

function applyTerminal(state, turn, seq, envelope) {
  if (turn.terminal) {
    anomaly(state, 'terminal_conflict', seq, envelope, turn);
    return;
  }
  turn.terminal = envelope;
  turn.final = envelope;
  turn.terminalSeq = seq;
  turn.phase = envelope.payload.status;
  turn.status = turn.phase;
  turn.latestStatus = envelope.payload.status;
  turn.text = terminalText(envelope.payload);
  turn.lastSeq = Math.max(turn.lastSeq, seq);
  if (envelope.parent_id) state.approvals.delete(envelope.parent_id);
}

function attachResponse(state, turn, seq, envelope) {
  if (FINAL.has(envelope.payload?.status)) applyTerminal(state, turn, seq, envelope);
  else applyProvisional(state, turn, seq, envelope);
}

function attachActivity(state, turn, seq, envelope) {
  turn.activity.push({ seq, envelope });
  turn.lastSeq = Math.max(turn.lastSeq, seq);
  if (envelope.type === TYPES.activity.toolEnded) {
    const toolCallId = envelope.payload?.tool_call_id;
    if (toolCallId && !turn.activity.some((item) => (
      item !== turn.activity.at(-1)
      && item.envelope.type === TYPES.activity.toolStarted
      && item.envelope.payload?.tool_call_id === toolCallId
    ))) anomaly(state, 'tool_start_missing', seq, envelope, turn);
  }
}

function drainRequestMatches(state, turn) {
  const byParent = state._unmatchedByParent.get(turn.requestId) || [];
  state._unmatchedByParent.delete(turn.requestId);
  for (const item of byParent.sort((left, right) => left.seq - right.seq)) {
    if (isActivity(item.envelope.type)) attachActivity(state, turn, item.seq, item.envelope);
    else attachResponse(state, turn, item.seq, item.envelope);
  }

  const byCorrelation = state._unmatchedByCorrelation.get(turn.correlationId) || [];
  state._unmatchedByCorrelation.delete(turn.correlationId);
  for (const item of byCorrelation.sort((left, right) => left.seq - right.seq)) {
    if (isActivity(item.envelope.type)) attachActivity(state, turn, item.seq, item.envelope);
    else attachResponse(state, turn, item.seq, item.envelope);
  }
}

export function apply(state, row, selfId = '') {
  const { channel_id: channelId, seq: rawSeq, envelope } = row || {};
  const seq = Number(rawSeq);
  if (!state || !envelope || !Number.isSafeInteger(seq) || seq < 0) return state;
  state.lastSeq = Math.max(state.lastSeq, seq);
  if (state.channelId && channelId && state.channelId !== channelId) {
    anomaly(state, 'channel_mismatch', seq, envelope);
    return state;
  }
  if (envelope.id && state._seenIds.has(envelope.id)) {
    if (!sameEnvelope(state._envelopesById.get(envelope.id), envelope)) anomaly(state, 'message_id_content_conflict', seq, envelope);
    else anomaly(state, 'duplicate_envelope_id', seq, envelope);
    return state;
  }
  if (envelope.id) {
    state._seenIds.add(envelope.id);
    state._envelopesById.set(envelope.id, envelope);
  }
  state.rows.set(seq, envelope);

  if (isNarrationEnvelope(envelope)) {
    state.narration.push({ seq, envelope });
    return state;
  }

  if (envelope.kind === 'request') {
    if (!envelope.id) {
      anomaly(state, 'request_id_missing', seq, envelope);
      state.orphans.push({ seq, envelope });
      return state;
    }
    const turn = newTurn(envelope, seq);
    state.turns.set(envelope.id, turn);
    const correlationRequests = state.correlations.get(turn.correlationId) || [];
    correlationRequests.push(envelope.id);
    state.correlations.set(turn.correlationId, correlationRequests);
    if (RESOLVABLE.has(envelope.type) && selfId && envelope.audience?.includes(selfId)) {
      state.approvals.set(envelope.id, envelope);
    }
    drainRequestMatches(state, turn);
    return state;
  }

  if (isActivity(envelope.type) && envelope.kind === 'event') {
    const turn = findTurn(state, envelope);
    if (turn) attachActivity(state, turn, seq, envelope);
    else if (envelope.parent_id) pushMap(state._unmatchedByParent, envelope.parent_id, { seq, envelope });
    else if (envelope.correlation_id) pushMap(state._unmatchedByCorrelation, envelope.correlation_id, { seq, envelope });
    else {
      anomaly(state, 'activity_parent_missing', seq, envelope);
      state.orphans.push({ seq, envelope });
    }
    return state;
  }

  if (envelope.kind === 'response') {
    const turn = findTurn(state, envelope);
    if (turn) attachResponse(state, turn, seq, envelope);
    else if (envelope.parent_id) pushMap(state._unmatchedByParent, envelope.parent_id, { seq, envelope });
    else if (envelope.correlation_id) pushMap(state._unmatchedByCorrelation, envelope.correlation_id, { seq, envelope });
    else {
      anomaly(state, 'response_parent_missing', seq, envelope);
      state.orphans.push({ seq, envelope });
    }
    return state;
  }

  state.standalone.push({ seq, envelope });
  return state;
}

export function reconcileApprovals(state, selfId) {
  state.approvals.clear();
  if (!selfId) return state;
  for (const turn of state.turns.values()) {
    const request = turn.request;
    if (
      RESOLVABLE.has(request.type)
      && request.audience?.includes(selfId)
      && !turn.terminal
    ) state.approvals.set(request.id, request);
  }
  return state;
}

export function fold(rows, selfId = '') {
  const state = createChannelState(rows[0]?.channel_id || '');
  for (const row of rows) apply(state, row, selfId);
  return state;
}

// 一个 agent 在回合中调用别的 actor，发出的是它自己的 request，`parent_id` 指着
// 那条把它叫起来的请求。所以账本本来就是棵树，只是过去被摊平成同一层：人问的一句
// 和 agent 顺手查的六次成员列表挤在一起，读的人分不出哪句是主线。
//
// 这里按 parent_id 把树收回来：只有根请求进时间线，被叫出来的那些挂在它的 thread 上
// （深度优先、按账本序号，孙代也在同一条 thread 里，带 depth 供缩进）。判据用
// parent_id 而不是 correlation_id —— 同一个 correlation 里的请求是平级还是父子，
// 只有 parent_id 说得清。
function threadOf(turn, childrenByParent, depth = 1, out = []) {
  for (const child of childrenByParent.get(turn.requestId) || []) {
    out.push({ turn: child, depth });
    threadOf(child, childrenByParent, depth + 1, out);
  }
  return out;
}

export function orderedTimeline(state) {
  const signature = `${state.turns.size}:${state.standalone.length}:${state.orphans.length}`;
  const cached = timelineCache.get(state);
  if (cached?.signature === signature) return cached.entries;

  const childrenByParent = new Map();
  const roots = [];
  for (const turn of state.turns.values()) {
    const parentId = turn.request?.parent_id;
    // 父必须是本频道见过的另一个请求；父不在（跨频道来的、还没回放到）就按根处理，
    // 宁可平铺也不让它消失。
    if (parentId && parentId !== turn.requestId && state.turns.has(parentId)) {
      pushMap(childrenByParent, parentId, turn);
    } else roots.push(turn);
  }
  for (const values of childrenByParent.values()) values.sort((left, right) => left.requestSeq - right.requestSeq);

  const entries = [];
  for (const turn of roots) entries.push({ kind: 'turn', seq: turn.requestSeq, turn, thread: threadOf(turn, childrenByParent) });
  for (const item of state.standalone) entries.push({ kind: 'standalone', ...item });
  for (const item of state.orphans) entries.push({ kind: 'orphan', ...item });
  entries.sort((left, right) => left.seq - right.seq);
  timelineCache.set(state, { signature, entries });
  return entries;
}

export function structuredBusinessPayload(payload = {}) {
  return businessFields(payload);
}
