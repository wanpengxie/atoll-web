import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

const ACTIVE_STATES = new Set(['active', 'waiting', 'blocked', 'uncertain', 'queued', 'running']);
const FINISHED_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const RECOVERY_STATES = new Set(['uncertain', 'rejected']);

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

function explicitActions(actionFacts, keys, source) {
  const candidates = [];
  if (Array.isArray(source?.actions)) candidates.push(source.actions);
  for (const key of keys) {
    if (!key) continue;
    if (actionFacts instanceof Map) candidates.push(actionFacts.get(key));
    else if (actionFacts && typeof actionFacts === 'object') candidates.push(actionFacts[key]);
  }
  const actions = candidates.find(Array.isArray) || [];
  return Object.freeze([...new Set(actions.filter((action) => typeof action === 'string' && action))]);
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
    actions: explicitActions(actionFacts, [key, id, turn.requestId]),
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
    actions: explicitActions(actionFacts, [key, id]),
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
    actions: explicitActions(actionFacts, [key, id], row),
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
