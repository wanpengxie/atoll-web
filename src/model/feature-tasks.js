import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

const ACTIVE_STATES = new Set(['active', 'waiting', 'blocked', 'uncertain', 'queued', 'running']);
const FINISHED_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const RECOVERY_STATES = new Set(['uncertain', 'rejected']);
const LOCAL_WAITING_STATES = new Set(['queued', 'transmitting', 'accepted', 'delayed', 'uncertain']);
const LOCAL_WAITING_TYPES = new Set([TYPES.agentAsk, TYPES.agentQueue]);

export const FEATURE_TASK_ACTION = Object.freeze({
  approve: 'approval.approve',
  reject: 'approval.reject',
  retry: 'recovery.retry',
  cancel: 'request.cancel',
});

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
  return Object.freeze({
    channelId,
    text: '',
    msgType: type,
    audience: Object.freeze([actorId]),
    targetLabel: String(targetLabel || actorId),
    payload: Object.freeze(payload),
  });
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
  const terminal = argsOf(turn.terminal);
  if (terminal.status === 'completed') return 'completed';
  const reason = String(terminal.reason || terminal.error_code || '');
  return ['cancelled', 'interrupted'].includes(reason) ? 'cancelled' : 'failed';
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
  const terminal = argsOf(turn.terminal);
  const value = terminal.value && typeof terminal.value === 'object' && !Array.isArray(terminal.value)
    ? terminal.value
    : {};
  const id = String(value.task_id || value.id || turn.requestId);
  const key = `task:${channelId}:${id}`;
  return Object.freeze({
    key,
    id,
    channelId,
    kind: 'task',
    title: String(value.title || body.title || body.description || '未命名任务'),
    description: String(body.description || ''),
    state: String(value.state || value.status || terminalState(turn)),
    assigneeActorIds: Object.freeze([value.assignee || request.audience?.[0]].filter(Boolean)),
    ownerId: String(request.sender?.id || ''),
    createdAt: request.ts,
    updatedAt: turn.terminal?.ts || request.ts,
    actions: explicitActions(actionFacts, [key, id, turn.requestId], null, { kind: 'task', key, id, turn }),
    source: Object.freeze({ kind: 'canonical', requestId: turn.requestId, seq: turn.requestSeq }),
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
    needsYou: state === 'waiting' && assignees.includes(selfId),
    waitingFor: state === 'waiting' ? '等待决定' : '',
    createdAt: request.ts,
    updatedAt: turn.terminal?.ts || request.ts,
    actions: explicitActions(actionFacts, [key, id], null, { kind: 'approval', key, id, turn, state }),
    source: Object.freeze({ kind: 'canonical', requestId: id, seq: turn.requestSeq }),
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
    needsYou: Boolean(selfId),
    waitingFor: String(row.error?.detail || (row.state === 'uncertain' ? '等待频道账本确认' : '等待安全重试')),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    actions: explicitActions(actionFacts, [key, id], row, { kind: 'recovery', key, id, row }),
    submission: row,
    source: Object.freeze({ kind: 'submission', messageId: id }),
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
} = {}) {
  if (!channelId) return Object.freeze([]);
  const facts = [];
  const canonicalRequestIds = new Set();
  for (const turn of timelineTurns(state?.timeline || [])) {
    const request = turn.request;
    canonicalRequestIds.add(String(turn.requestId || request.id));
    if (request.type === 'task.create') facts.push(taskFact(turn, channelId, actionFacts));
    else if (request.type === TYPES.humanApprove || request.type === TYPES.humanAsk) {
      facts.push(approvalFact(turn, channelId, selfId, now, actionFacts));
    }
  }
  for (const row of pending) {
    if ((!row?.channelId && !row?.frame?.channel_id)
      || String(row.channelId || row.frame.channel_id) !== channelId
      || !RECOVERY_STATES.has(row.state)
      || !row.messageId
      || canonicalRequestIds.has(String(row.messageId))) continue;
    facts.push(recoveryFact(row, channelId, selfId, actionFacts));
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
      actions: explicitActions(actionFacts, [key, id], { actions: declaredControls(frame) }, { kind: 'waiting', key, id, turn, frame }),
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
      actions: explicitActions(actionFacts, [key, id], row, { kind: 'waiting', key, id, row }),
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
  return items.filter((item) => {
    if (kind !== 'all' && item?.kind !== kind) return false;
    const state = String(item?.state || 'active');
    if (status === 'active' && !ACTIVE_STATES.has(state)) return false;
    if (status === 'completed' && state !== 'completed') return false;
    if (status === 'failed' && !FINISHED_STATES.has(state)) return false;
    if (scope !== 'me') return true;
    const assignees = item?.assigneeActorIds || item?.assignees || [];
    return item?.needsYou === true || item?.ownerId === selfId || assignees.includes(selfId);
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
