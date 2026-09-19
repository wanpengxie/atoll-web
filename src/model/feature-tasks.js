import { argsOf } from '../protocol/envelope.js';
import { TYPES, isSystemWord } from '../protocol/vocab.js';
import { createControlCommand } from './control-command.js';
import { terminalResultPayload, terminalResultState } from './terminal-result.js';

const ACTIVE_STATES = new Set(['active', 'waiting', 'blocked', 'uncertain', 'queued', 'running', 'held']);
const FINISHED_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const RECOVERY_STATES = new Set(['uncertain', 'rejected']);
const LOCAL_WAITING_STATES = new Set(['queued', 'transmitting', 'accepted', 'delayed', 'uncertain']);
const LOCAL_WAITING_TYPES = new Set([TYPES.agentAsk, TYPES.agentQueue]);

export const FEATURE_TASK_ACTION = Object.freeze({
  approve: 'approval.approve',
  reject: 'approval.reject',
  retry: 'recovery.retry',
  cancel: 'request.cancel',
  cancelAutomation: 'automation.cancel',
});

export const FEATURE_TASK_PAGE_SIZE = 120;

export const FEATURE_COMMAND_STATE = Object.freeze({
  ready: 'ready',
  submitting: 'submitting',
  disabled: 'disabled',
  unsupported: 'unsupported',
  failed: 'failed',
});

export const FEATURE_WAITING_CONTROL = Object.freeze({
  steer: TYPES.agentSteer,
  interrupt: TYPES.agentInterrupt,
});

function requiredText(value, label) {
  const result = String(value || '').trim();
  if (!result) throw new TypeError(`${label}不能为空`);
  return result;
}

// Pure adapters for the existing submission owner. Keeping request authorship
// here prevents Workspace composition from having to reconstruct protocol
// payloads or silently fall back to an untyped no-op.
export function createFeatureTaskSubmission({
  channelId,
  providerId,
  providerName = '',
  title,
  description = '',
  dueAt = '',
  source = null,
} = {}) {
  const resolvedChannelId = requiredText(channelId, '频道');
  const resolvedProviderId = requiredText(providerId, '任务执行者');
  const resolvedTitle = requiredText(title, '任务内容');
  const resolvedDescription = String(description || '').trim();
  const payload = {
    title: resolvedTitle,
    ...(resolvedDescription ? { description: resolvedDescription } : {}),
    ...(dueAt ? { due_at: String(dueAt) } : {}),
    ...(source ? { source: { ...source, channelId: resolvedChannelId } } : {}),
  };
  return Object.freeze({
    channelId: resolvedChannelId,
    text: resolvedTitle,
    msgType: 'task.create',
    audience: Object.freeze([resolvedProviderId]),
    targetLabel: String(providerName || resolvedProviderId),
    payload: Object.freeze(payload),
  });
}

export function createFeatureWaitingControlSubmission({ item, type, intent = 'single', targetLabel = '' } = {}) {
  const channelId = requiredText(item?.channelId, '频道');
  const actorId = requiredText(item?.actorId, '等待区控制目标');
  const requestId = requiredText(item?.requestId || item?.id, '等待区请求');
  if (!featureWaitingActions(item).includes(type)) throw new TypeError('该控制词未由当前账本声明');
  let payload;
  if (type === FEATURE_WAITING_CONTROL.interrupt) payload = {};
  else if (type === FEATURE_WAITING_CONTROL.steer) {
    payload = intent === 'all' ? { all: true } : { target: requestId };
  } else throw new TypeError('该控制词尚无可靠的请求构造器');
  const request = {
    channelId,
    text: '',
    msgType: type,
    audience: Object.freeze([actorId]),
    targetLabel: String(targetLabel || actorId),
    payload: Object.freeze(payload),
  };
  if (type === FEATURE_WAITING_CONTROL.interrupt) {
    request.controlContext = {
      source: 'feature',
      turn: item.turn,
      targetAuthority: item.targetAuthority || null,
    };
  }
  return createControlCommand(request);
}

function timelineTurns(timeline = []) {
  const turns = [];
  const visit = (entry) => {
    if (entry?.kind === 'turn' && entry.turn?.request?.id) turns.push(entry.turn);
    for (const child of entry?.thread || []) visit(child);
  };
  for (const entry of timeline) visit(entry);
  return turns;
}

function terminalState(turn) {
  if (!turn?.terminal) return 'active';
  if (turn.terminalClosureOnly === true) return 'uncertain';
  const terminal = argsOf(turn.terminal);
  if (terminal.status === 'completed') return 'completed';
  const reason = String(terminal.reason || terminal.error_code || '');
  return ['cancelled', 'interrupted'].includes(reason) ? 'cancelled' : 'failed';
}

function isControlRequest(type = '') {
  return type === TYPES.describe
    || isSystemWord(type)
    || [
      TYPES.agentSteer,
      TYPES.agentQueue,
      TYPES.agentInterrupt,
      TYPES.agentDismiss,
      TYPES.agentHold,
      TYPES.agentUnhold,
      TYPES.agentReplace,
      TYPES.agentHoldExpired,
      TYPES.agentFork,
      TYPES.agentCompact,
      TYPES.agentNew,
      TYPES.agentSelect,
      TYPES.agentOptions,
      TYPES.agentContext,
    ].includes(type);
}

function explicitActions(actionFacts, keys, source, context) {
  const candidates = [];
  if (Array.isArray(source?.actions)) candidates.push(source.actions);
  if (typeof actionFacts === 'function') candidates.push(actionFacts(Object.freeze(context)));
  for (const key of keys) {
    if (!key) continue;
    if (actionFacts instanceof Map) candidates.push(actionFacts.get(key));
    else if (actionFacts && typeof actionFacts === 'object') candidates.push(actionFacts[key]);
  }
  const actions = candidates.filter(Array.isArray).flat();
  return Object.freeze([...new Set(actions.filter((action) => typeof action === 'string' && action))]);
}

function latestControlFact(turn) {
  return [...(turn?.provisional || [])]
    .sort((left, right) => Number(right.seq || 0) - Number(left.seq || 0))
    .map((entry) => argsOf(entry.envelope))
    .find((body) => ['queued', 'processing'].includes(body.status) && Array.isArray(body.controls)) || null;
}

function declaredControls(frame) {
  return (frame?.controls || []).flatMap((entry) => (
    entry && typeof entry.word === 'string' && entry.word ? [entry.word] : []
  ));
}

function titleOf(request, fallback) {
  const body = argsOf(request);
  return String(body.title || body.text || body.detail || body.description || fallback).trim();
}

function taskFact(turn, channelId, actionFacts) {
  const request = turn.request;
  const body = argsOf(request);
  const terminal = terminalResultPayload(turn) || {};
  const value = terminal.value && typeof terminal.value === 'object' && !Array.isArray(terminal.value)
    ? terminal.value
    : terminal;
  const id = String(value.task_id || value.id || turn.requestId);
  const key = `task:${channelId}:${id}`;
  return Object.freeze({
    key,
    id,
    channelId,
    kind: 'task',
    title: String(value.title || body.title || body.description || '未命名任务'),
    description: String(body.description || ''),
    state: normalizeTaskState(value.state || value.status || terminalState(turn)),
    assigneeActorIds: Object.freeze([value.assignee || request.audience?.[0]].filter(Boolean)),
    ownerId: String(request.sender?.id || ''),
    requesterActorId: String(request.sender?.id || ''),
    nativeId: id,
    dueAt: value.due_at || body.due_at || '',
    priority: value.priority || body.priority || 'normal',
    relatedArtifacts: Object.freeze([...(value.related_artifacts || [])]),
    createdAt: request.ts,
    updatedAt: turn.terminal?.ts || request.ts,
    actions: explicitActions(actionFacts, [key, id, turn.requestId], { actions: value.actions }, { kind: 'task', key, id, turn, value }),
    actionableBySelf: false,
    provenance: 'ledger',
    diagnostic: Object.freeze({ providerActorId: request.audience?.[0] || '', rawStatus: value.status || value.state || '' }),
    source: Object.freeze(body.source?.channelId === channelId && body.source?.objectId
      ? { ...body.source, channelId }
      : { channelId, view: 'dynamic', objectType: 'turn', objectId: turn.requestId, requestId: turn.requestId, seq: turn.requestSeq }),
  });
}

function normalizeTaskState(value) {
  const state = String(value || 'active');
  if (['active', 'waiting', 'blocked', 'uncertain', 'completed', 'failed', 'cancelled', 'expired'].includes(state)) return state;
  if (['queued', 'processing', 'received', 'open', 'todo', 'in_progress'].includes(state)) return 'active';
  if (['done', 'closed', 'resolved'].includes(state)) return 'completed';
  return 'active';
}

function agentRunFact(turn, channelId, selfId, actionFacts) {
  const request = turn.request;
  const resultState = terminalResultState(turn);
  const resultUnavailable = turn.terminalClosureOnly === true
    && (request.type === 'task.create' || argsOf(turn.terminal)?.status === 'failed');
  const id = String(turn.requestId);
  const key = `agent_run:${channelId}:${id}`;
  const state = resultUnavailable ? 'uncertain' : terminalState(turn);
  return Object.freeze({
    key,
    id,
    nativeId: id,
    requestId: id,
    channelId,
    kind: 'agent_run',
    title: titleOf(request, request.type || '未命名工作'),
    state,
    assigneeActorIds: Object.freeze([...(request.audience || [])]),
    ownerId: String(request.sender?.id || ''),
    requesterActorId: String(request.sender?.id || ''),
    waitingFor: resultUnavailable ? resultState.error : String(turn.latestStatus || ''),
    createdAt: request.ts,
    updatedAt: turn.terminal?.ts || turn.provisional?.at(-1)?.envelope?.ts || request.ts,
    actions: explicitActions(actionFacts, [key, id], null, { kind: 'agent_run', key, id, turn, state }),
    actionableBySelf: !turn.terminal && request.sender?.id === selfId,
    provenance: 'ledger',
    diagnostic: Object.freeze({ requestType: request.type, requestId: id, resultUnavailable, resultPhase: resultState.phase }),
    source: Object.freeze({ channelId, view: 'dynamic', objectType: 'turn', objectId: id, requestId: id, seq: turn.requestSeq }),
  });
}

function approvalFact(turn, channelId, selfId, now, actionFacts) {
  const request = turn.request;
  const id = String(turn.requestId);
  const key = `approval:${channelId}:${id}`;
  const expiresAt = Number(request.expires_at || 0);
  const state = !turn.terminal && now > 0 && expiresAt > 0 && expiresAt <= now
    ? 'expired'
    : turn.terminal ? terminalState(turn) : 'waiting';
  const assignees = Object.freeze([...(request.audience || [])]);
  return Object.freeze({
    key,
    id,
    channelId,
    kind: 'approval',
    title: titleOf(request, '待处理请求'),
    state,
    assigneeActorIds: assignees,
    ownerId: String(request.sender?.id || ''),
    requesterActorId: String(request.sender?.id || ''),
    nativeId: id,
    needsYou: state === 'waiting' && assignees.includes(selfId),
    actionableBySelf: state === 'waiting' && assignees.includes(selfId),
    waitingFor: state === 'waiting' ? '等待决定' : '',
    dueAt: request.expires_at || '',
    priority: argsOf(request).priority || 'high',
    createdAt: request.ts,
    updatedAt: turn.terminal?.ts || request.ts,
    actions: explicitActions(actionFacts, [key, id], null, { kind: 'approval', key, id, turn, state }),
    provenance: 'ledger',
    diagnostic: Object.freeze({ requestType: request.type, impact: argsOf(request).impact || '' }),
    source: Object.freeze({ channelId, view: 'dynamic', objectType: 'turn', objectId: id, requestId: id, seq: turn.requestSeq }),
  });
}

function recoveryFact(row, channelId, selfId, actionFacts) {
  const id = String(row.messageId || row.key || '');
  const key = `recovery:${channelId}:${id}`;
  return Object.freeze({
    key,
    id,
    channelId,
    kind: 'recovery',
    title: String(row.text || row.frame?.msg_type || '待确认的提交'),
    state: row.state === 'uncertain' ? 'uncertain' : 'failed',
    assigneeActorIds: Object.freeze([selfId].filter(Boolean)),
    ownerId: selfId,
    requesterActorId: selfId,
    nativeId: id,
    needsYou: Boolean(selfId),
    actionableBySelf: Boolean(selfId),
    waitingFor: String(row.error?.detail || (row.state === 'uncertain' ? '等待频道账本确认' : '等待安全重试')),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    actions: explicitActions(actionFacts, [key, id], row, { kind: 'recovery', key, id, row }),
    submission: row,
    provenance: 'local_durable',
    localScope: 'this_device',
    diagnostic: Object.freeze({ submissionKey: row.key, error: row.error }),
    source: Object.freeze({ channelId, view: 'dynamic', objectType: 'message', objectId: id, messageId: id }),
  });
}

function automationFact(row, channelId, selfId, actionFacts) {
  const id = String(row?.timerId || row?.timer_id || row?.id || '');
  if (!id) return null;
  const key = `automation:${channelId}:${id}`;
  const rawState = String(row.state || 'scheduled');
  const state = rawState === 'scheduled' ? 'waiting' : rawState === 'fired' ? 'completed' : 'cancelled';
  const actions = explicitActions(actionFacts, [key, id], row, { kind: 'automation', key, id, row, state });
  const declaredActions = actions.length || state !== 'waiting'
    ? actions
    : Object.freeze([FEATURE_TASK_ACTION.cancelAutomation]);
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return Object.freeze({
    key,
    id,
    nativeId: id,
    channelId,
    kind: 'automation',
    title: String(payload.text || row.msgType || row.msg_type || '自动动作'),
    state,
    assigneeActorIds: Object.freeze([]),
    ownerId: selfId,
    requesterActorId: selfId,
    dueAt: row.dueAt || row.due_at || '',
    waitingFor: state === 'waiting' ? '等待本设备定时触发' : '',
    createdAt: row.createdAt || row.created_at || row.dueAt || row.due_at,
    updatedAt: row.firedAt || row.fired_at || row.cancelledAt || row.cancelled_at || row.createdAt || row.created_at,
    actions: declaredActions,
    actionableBySelf: state === 'waiting',
    provenance: 'local_durable',
    localScope: 'this_device',
    diagnostic: Object.freeze({ msgType: row.msgType || row.msg_type || '', payload, durationMs: row.durationMs || row.duration_ms || 0 }),
    source: Object.freeze({ channelId, view: 'tasks', objectType: 'automation', objectId: id }),
  });
}

// Pure projection over the current ChannelReplica snapshot and the submission
// owner's pending rows. It neither retains lifecycle state nor invents command
// availability: actions must be supplied explicitly by either upstream input.
export function selectFeatureTaskFacts({
  state,
  channelId = state?.channelId || '',
  pending = [],
  selfId = '',
  now = 0,
  actionFacts = new Map(),
  automationRecords = [],
} = {}) {
  if (!channelId) return Object.freeze([]);
  const facts = [];
  const canonicalRequestIds = new Set();
  for (const turn of timelineTurns(state?.timeline || [])) {
    const request = turn.request;
    canonicalRequestIds.add(String(turn.requestId || request.id));
    const taskPayload = request.type === 'task.create' ? terminalResultPayload(turn) : null;
    const taskValue = taskPayload?.value && typeof taskPayload.value === 'object' && !Array.isArray(taskPayload.value)
      ? taskPayload.value
      : taskPayload;
    if (request.type === 'task.create' && (taskValue?.task_id || taskValue?.id)) facts.push(taskFact(turn, channelId, actionFacts));
    else if (request.type === TYPES.humanApprove || request.type === TYPES.humanAsk) {
      facts.push(approvalFact(turn, channelId, selfId, now, actionFacts));
    } else if (!isControlRequest(request.type)) facts.push(agentRunFact(turn, channelId, selfId, actionFacts));
  }
  for (const row of pending) {
    if ((!row?.channelId && !row?.frame?.channel_id)
      || String(row.channelId || row.frame.channel_id) !== channelId
      || !RECOVERY_STATES.has(row.state)
      || !row.messageId
      || canonicalRequestIds.has(String(row.messageId))) continue;
    facts.push(recoveryFact(row, channelId, selfId, actionFacts));
  }
  for (const row of automationRecords) {
    const rowChannelId = String(row?.channelId || row?.channel_id || channelId);
    if (rowChannelId !== channelId) continue;
    const fact = automationFact(row, channelId, selfId, actionFacts);
    if (fact) facts.push(fact);
  }
  facts.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
    || left.key.localeCompare(right.key));
  return Object.freeze(facts);
}

export function selectFeatureTaskProviders(capabilityIndex = new Map(), roster = []) {
  const actors = new Map((roster || []).map((actor) => [actor?.id, actor]));
  return Object.freeze([...capabilityIndex.values()].flatMap((entry) => {
    const actor = actors.get(entry?.actorId);
    if (!actor || !entry?.describe?.types?.has?.('task.create')) return [];
    return [Object.freeze({
      actorId: actor.id,
      name: String(actor.name || actor.label || actor.id),
    })];
  }).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')));
}

export function selectFeatureWaitingFacts({
  state,
  channelId = state?.channelId || '',
  pending = [],
  actionFacts = new Map(),
  targetAuthority = null,
} = {}) {
  if (!channelId) return Object.freeze([]);
  const rows = [];
  const canonicalRequestIds = new Set();
  for (const turn of timelineTurns(state?.timeline || [])) {
    canonicalRequestIds.add(String(turn.requestId));
    if (turn.terminal) continue;
    const frame = latestControlFact(turn);
    if (!frame) continue;
    const request = turn.request;
    const id = String(turn.requestId);
    const key = `waiting:${channelId}:${id}`;
    rows.push(Object.freeze({
      key,
      id,
      requestId: id,
      channelId,
      kind: 'waiting',
      title: titleOf(request, '排队指令'),
      state: String(frame.status),
      actorId: String(request.audience?.[0] || ''),
      targetAuthority,
      actions: explicitActions(actionFacts, [key, id], { actions: declaredControls(frame) }, { kind: 'waiting', key, id, turn, frame, targetAuthority }),
      turn,
      createdAt: request.ts,
      updatedAt: turn.provisional?.at(-1)?.envelope?.ts || request.ts,
      source: Object.freeze({ kind: 'canonical', requestId: id, seq: turn.requestSeq }),
    }));
  }
  for (const row of pending) {
    const rowChannelId = String(row?.channelId || row?.frame?.channel_id || '');
    const id = String(row?.messageId || '');
    if (rowChannelId !== channelId
      || !id
      || canonicalRequestIds.has(id)
      || !LOCAL_WAITING_STATES.has(row.state)
      || !LOCAL_WAITING_TYPES.has(row.frame?.msg_type)) continue;
    const key = `waiting:${channelId}:${id}`;
    rows.push(Object.freeze({
      key,
      id,
      requestId: id,
      channelId,
      kind: 'waiting',
      title: String(row.text || row.frame?.payload?.text || row.frame?.msg_type || '排队指令'),
      state: String(row.state),
      actorId: String(row.frame?.audience?.[0] || ''),
      targetAuthority,
      actions: explicitActions(actionFacts, [key, id], row, { kind: 'waiting', key, id, row, targetAuthority }),
      submission: row,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      source: Object.freeze({ kind: 'submission', messageId: id }),
    }));
  }
  rows.sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0)
    || left.key.localeCompare(right.key));
  return Object.freeze(rows);
}

export function filterFeatureTasks(items = [], { scope = 'me', status = 'active', kind = 'all', selfId = '' } = {}) {
  return [...items].filter((item) => {
    if (kind !== 'all' && item?.kind !== kind) return false;
    const state = String(item?.state || 'active');
    if (status === 'active' && !ACTIVE_STATES.has(state)) return false;
    if (status === 'completed' && !['completed', 'cancelled', 'expired'].includes(state)) return false;
    if (status === 'failed' && state !== 'failed') return false;
    if (scope !== 'me') return true;
    const assignees = item?.assigneeActorIds || item?.assignees || [];
    return item?.needsYou === true
      || item?.actionableBySelf === true
      || item?.ownerId === selfId
      || assignees.includes(selfId)
      || ['automation', 'recovery'].includes(item?.kind);
  }).sort((left, right) => {
    const priority = { urgent: 0, high: 1, normal: 2 };
    return (priority[left?.priority] ?? 2) - (priority[right?.priority] ?? 2)
      || Number(Boolean(right?.actionableBySelf || right?.needsYou)) - Number(Boolean(left?.actionableBySelf || left?.needsYou))
      || Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0)
      || String(left?.key || '').localeCompare(String(right?.key || ''));
  });
}

export function boundedFeatureTaskPage(items = [], page = 0, size = FEATURE_TASK_PAGE_SIZE) {
  const values = Array.isArray(items) ? items : [];
  const windowSize = Math.max(1, Math.floor(Number(size) || FEATURE_TASK_PAGE_SIZE));
  const pageCount = Math.max(1, Math.ceil(values.length / windowSize));
  const safePage = Math.min(Math.max(0, Math.floor(Number(page) || 0)), pageCount - 1);
  const end = Math.max(0, values.length - safePage * windowSize);
  const start = Math.max(0, end - windowSize);
  return Object.freeze({
    items: Object.freeze(values.slice(start, end)),
    page: safePage,
    pageCount,
    start,
    end,
    total: values.length,
    hasOlder: start > 0,
    hasNewer: end < values.length,
  });
}

export function featureTaskGroup(item) {
  if (['needs_you', 'active', 'recovery', 'automation', 'history'].includes(item?.group)) return item.group;
  if (item?.needsYou === true) return 'needs_you';
  if (item?.kind === 'recovery') return 'recovery';
  if (item?.kind === 'automation') return 'automation';
  return FINISHED_STATES.has(String(item?.state || '')) ? 'history' : 'active';
}

export function featureWaitingActions(item) {
  return Array.isArray(item?.actions) ? item.actions : [];
}
