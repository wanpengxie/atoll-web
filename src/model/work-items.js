import { isAgentControl, supportsType } from './capabilities.js';
import { TYPES, isSystemWord } from '../protocol/vocab.js';

export const WORK_ITEM_KINDS = ['task', 'approval', 'agent_run', 'recovery', 'automation'];
export const ACTIVE_WORK_ITEM_STATES = new Set(['active', 'waiting', 'blocked', 'uncertain']);

// 控制词与治理词都不是“一件正在进行的工作”，不进工作项索引。
function isControlRequest(type = '') {
  return type === TYPES.describe || isAgentControl(type) || isSystemWord(type);
}

function source(channelId, objectType, objectId, seq) {
  return { channelId, view: 'dynamic', objectType, objectId, seq };
}

function timestamp(envelope, fallback = 0) {
  return Number(envelope?.ts || fallback || 0);
}

function stateOfTurn(turn) {
  if (!turn?.terminal) {
    if (turn?.latestStatus === 'deferred') return 'waiting';
    if (turn?.latestStatus === 'unavailable') return 'blocked';
    return 'active';
  }
  if (turn.terminal.payload?.status === 'completed') return 'completed';
  const reason = turn.terminal.payload?.reason || turn.terminal.payload?.error_code;
  return reason === 'cancelled' || reason === 'interrupted' ? 'cancelled' : 'failed';
}

function approvalState(turn, now) {
  if (turn.terminal) return stateOfTurn(turn);
  const expiresAt = Number(turn.request?.expires_at || 0);
  return expiresAt > 0 && expiresAt <= now ? 'expired' : 'waiting';
}

function titleOfTurn(turn) {
  const payload = turn?.request?.payload || {};
  return String(payload.title || payload.text || payload.detail || turn?.request?.type || '未命名工作').trim();
}

function taskValue(turn) {
  if (turn?.request?.type !== 'task.create' || turn?.terminal?.payload?.status !== 'completed') return null;
  const raw = turn.terminal.payload?.value;
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : turn.terminal.payload;
  const taskId = value.task_id || value.id;
  return typeof taskId === 'string' && taskId ? { ...value, taskId } : null;
}

function taskState(value) {
  const raw = String(value.status || value.state || 'active');
  if (['active', 'waiting', 'blocked', 'uncertain', 'completed', 'failed', 'cancelled', 'expired'].includes(raw)) return raw;
  if (['queued', 'processing', 'received', 'open', 'todo', 'in_progress'].includes(raw)) return 'active';
  if (['done', 'closed', 'resolved'].includes(raw)) return 'completed';
  return 'active';
}

export function taskProviders(capabilityIndex = new Map(), roster = []) {
  const names = new Map(roster.map((row) => [row.id, row.name || row.id]));
  return [...capabilityIndex.values()]
    .filter((entry) => names.has(entry.actorId) && supportsType(entry, 'task.create'))
    .map((entry) => ({ actorId: entry.actorId, name: names.get(entry.actorId) || entry.actorId, capability: entry }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export function buildWorkItemIndex({ state, pending = [], timers = [], selfId = '', access = '', capabilityIndex = new Map(), now = Date.now() } = {}) {
  const channelId = state?.channelId || '';
  const index = new Map();
  const writable = access === 'member_active';

  for (const turn of state?.turns?.values?.() || []) {
    const request = turn.request || {};
    const itemSource = source(channelId, 'turn', turn.requestId, turn.requestSeq);
    const task = taskValue(turn);
    if (task) {
      const declaredSource = request.payload?.source;
      const taskSource = declaredSource && declaredSource.channelId === channelId && declaredSource.objectId
        ? { ...declaredSource, channelId }
        : itemSource;
      index.set(`task:${channelId}:${task.taskId}`, {
        key: `task:${channelId}:${task.taskId}`, channelId, kind: 'task', nativeId: task.taskId,
        title: String(task.title || request.payload?.title || request.payload?.description || '未命名任务'), state: taskState(task),
        assigneeActorIds: [task.assignee || request.audience?.[0]].filter(Boolean), requesterActorId: request.sender?.id,
        dueAt: task.due_at || request.payload?.due_at || '', priority: task.priority || request.payload?.priority || 'normal',
        source: taskSource, relatedArtifacts: task.related_artifacts || [],
        createdAt: request.ts, updatedAt: turn.terminal?.ts || request.ts, actionableBySelf: false,
        provenance: 'ledger', diagnostic: { providerActorId: request.audience?.[0] || '', rawStatus: task.status || task.state || '' },
      });
      continue;
    }
    if (request.type === TYPES.humanApprove || request.type === TYPES.humanAsk) {
      const itemState = approvalState(turn, now);
      const assignees = request.audience || [];
      index.set(`approval:${channelId}:${turn.requestId}`, {
        key: `approval:${channelId}:${turn.requestId}`, channelId, kind: 'approval', nativeId: turn.requestId,
        title: titleOfTurn(turn), state: itemState, assigneeActorIds: assignees, requesterActorId: request.sender?.id,
        dueAt: request.expires_at || '', waitingFor: '等待审批决定', priority: request.payload?.priority || 'high', source: itemSource,
        relatedArtifacts: [], createdAt: request.ts, updatedAt: turn.terminal?.ts || request.ts,
        actionableBySelf: writable && itemState === 'waiting' && assignees.includes(selfId), provenance: 'ledger',
        diagnostic: { requestType: request.type, impact: request.payload?.impact || '' },
      });
      continue;
    }
    if (!isControlRequest(request.type)) {
      index.set(`agent_run:${channelId}:${turn.requestId}`, {
        key: `agent_run:${channelId}:${turn.requestId}`, channelId, kind: 'agent_run', nativeId: turn.requestId,
        title: titleOfTurn(turn), state: stateOfTurn(turn), assigneeActorIds: request.audience || [], requesterActorId: request.sender?.id,
        waitingFor: turn.latestStatus || '', source: itemSource, relatedArtifacts: [], createdAt: request.ts,
        updatedAt: turn.terminal?.ts || timestamp(turn.provisional?.at(-1)?.envelope, request.ts),
        actionableBySelf: writable && !turn.terminal && request.sender?.id === selfId, provenance: 'ledger',
        diagnostic: { requestType: request.type, requestId: turn.requestId },
      });
    }
  }

  for (const item of pending.filter((row) => row.channelId === channelId && ['uncertain', 'rejected'].includes(row.state))) {
    index.set(`recovery:${channelId}:${item.messageId}`, {
      key: `recovery:${channelId}:${item.messageId}`, channelId, kind: 'recovery', nativeId: item.messageId,
      title: item.text || '待确认的提交', state: item.state === 'uncertain' ? 'uncertain' : 'failed', assigneeActorIds: [selfId].filter(Boolean),
      requesterActorId: selfId, waitingFor: item.state === 'uncertain' ? '等待频道账本确认' : '等待安全重试',
      source: source(channelId, 'message', item.messageId), relatedArtifacts: [], createdAt: item.createdAt, updatedAt: item.updatedAt,
      actionableBySelf: writable, provenance: 'local_durable', localScope: 'this_device', diagnostic: { submissionKey: item.key, error: item.error },
    });
  }

  for (const timer of timers.filter((row) => row.channelId === channelId)) {
    const itemState = timer.state === 'scheduled' ? 'waiting' : timer.state === 'fired' ? 'completed' : 'cancelled';
    index.set(`automation:${channelId}:${timer.timerId}`, {
      key: `automation:${channelId}:${timer.timerId}`, channelId, kind: 'automation', nativeId: timer.timerId,
      title: timer.payload?.text || timer.msgType || '自动动作', state: itemState, assigneeActorIds: [], requesterActorId: selfId,
      dueAt: timer.dueAt, waitingFor: itemState === 'waiting' ? '等待本设备定时触发' : '',
      source: { channelId, view: 'tasks', objectType: 'automation', objectId: timer.timerId }, relatedArtifacts: [],
      createdAt: timer.createdAt, updatedAt: timer.firedAt || timer.cancelledAt || timer.createdAt,
      actionableBySelf: writable && itemState === 'waiting', provenance: 'local_durable', localScope: 'this_device',
      diagnostic: { msgType: timer.msgType, payload: timer.payload, durationMs: timer.durationMs },
    });
  }
  return index;
}

export function filterWorkItems(items, { scope = 'me', status = 'active', kind = 'all', selfId = '' } = {}) {
  return [...items].filter((item) => {
    if (scope === 'me' && !item.assigneeActorIds.includes(selfId) && !item.actionableBySelf && item.kind !== 'automation' && item.kind !== 'recovery') return false;
    if (kind !== 'all' && item.kind !== kind) return false;
    if (status === 'active' && !ACTIVE_WORK_ITEM_STATES.has(item.state)) return false;
    if (status === 'completed' && !['completed', 'cancelled', 'expired'].includes(item.state)) return false;
    if (status === 'failed' && item.state !== 'failed') return false;
    return true;
  }).sort((left, right) => {
    const priority = { urgent: 0, high: 1, normal: 2 };
    return (priority[left.priority] ?? 2) - (priority[right.priority] ?? 2)
      || Number(right.actionableBySelf) - Number(left.actionableBySelf)
      || Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
      || left.key.localeCompare(right.key);
  });
}

export function workItemGroup(item) {
  if (item.actionableBySelf && ['approval', 'recovery'].includes(item.kind)) return 'needs_you';
  if (item.kind === 'recovery') return 'recovery';
  if (item.kind === 'automation') return 'automation';
  if (['completed', 'cancelled', 'expired', 'failed'].includes(item.state)) return 'history';
  return 'active';
}
