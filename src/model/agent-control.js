import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';
import { taskLocation } from './task-controls.js';

// 会以"一条消息"身份出现在时间线/等待区的词。replace 恒不在此列：它是控制请求，
// 呈现效果只能是"目标消息的文本更新"，自己短暂的 queued 窗口恒不得闪进等待区。
const CONTENT_TYPES = new Set([
  TYPES.agentAsk,
  TYPES.agentQueue,
  TYPES.agentCompact,
  TYPES.agentSelect,
  TYPES.agentSteer,
]);
const DEFAULT_HOLD_DURATION_MS = 30 * 60 * 1000;

function terminalValue(turn, key) {
  return turn?.terminal?.payload?.[key] ?? turn?.terminal?.payload?.value?.[key];
}

export function isAgentMessageTurn(turn) {
  return CONTENT_TYPES.has(turn?.request?.type);
}

// A user message moves between the wait layer and the conversation from its
// own position facts only. A terminal merged_into is itself the acceptance
// fact for a batched message; all other terminals retain the last position.
export function agentMessageStage(turn) {
  if (!isAgentMessageTurn(turn)) return '';
  const location = taskLocation(turn);
  if (location === 'processing') return 'timeline';
  if (terminalValue(turn, 'merged_into')) return 'timeline';
  if (!turn?.terminal && location === 'queued') return 'queued';
  return '';
}

export function mergedInto(turn) {
  return String(terminalValue(turn, 'merged_into') || '');
}

export function preemptedBy(turn) {
  return String(terminalValue(turn, 'preempted_by') || '');
}

function terminalCompleted(turn) {
  return turn?.terminal?.payload?.status === 'completed';
}

export function resumedQueued(turn) {
  return [...(turn?.provisional || [])].reverse().some((item) => (
    item.envelope?.payload?.status === 'queued' && item.envelope?.payload?.resumed === true
  ));
}

export function editAdmission(state, session) {
  if (!session?.holdId || !session?.targetId) return { ready: false, error: '' };
  const hold = state?.turns?.get(session.holdId);
  if (!hold?.terminal) return { ready: false, error: '' };
  if (!terminalCompleted(hold)) {
    return { ready: false, error: hold.terminal.payload?.detail || hold.terminal.payload?.error_code || '无法锁定这条任务' };
  }
  if (session.location === 'processing' && !resumedQueued(state?.turns?.get(session.targetId))) {
    return { ready: false, error: '' };
  }
  return { ready: true, error: '' };
}

export function lockFromContext(payload, holdId) {
  const frozen = payload?.frozen;
  if (!frozen || frozen.held_by !== holdId) return { valid: false, error: '编辑锁已失效' };
  return { valid: true, frozen };
}

function requestTimestamp(request) {
  const numeric = Number(request?.ts);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(request?.ts || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function freezeDeadline(turn) {
  const requested = argsOf(turn?.request).duration_ms;
  const duration = Number.isSafeInteger(requested) && requested >= 1 && requested <= DEFAULT_HOLD_DURATION_MS
    ? requested
    : DEFAULT_HOLD_DURATION_MS;
  return requestTimestamp(turn?.request) + duration;
}

// 冻结与解除按请求自己的因果 seq 排，而不是按异步终态的落账 seq 排。
// processing/merged_into 是队列已经推进的事实，按它自己的事实 seq 清除。
export function agentFrozenState(state, actorId, now = Date.now()) {
  let frozen = null;
  const operations = [];
  for (const turn of state?.turns?.values?.() || []) {
    if (turn.request?.audience?.length !== 1 || turn.request.audience[0] !== actorId) continue;
    const type = turn.request?.type;
    if (terminalCompleted(turn) && (type === TYPES.agentHold || type === TYPES.agentInterrupt)) {
      operations.push({ seq: turn.requestSeq, kind: 'freeze', turn });
    } else if (terminalCompleted(turn) && type === TYPES.agentUnhold) {
      operations.push({ seq: turn.requestSeq, kind: 'clear' });
    }
    if (CONTENT_TYPES.has(type)) {
      const enteredBuffer = (turn.provisional || []).some((item) => item.envelope?.payload?.status === 'queued' && item.envelope?.payload?.resumed !== true);
      const capacityFailure = turn.terminal?.payload?.status === 'failed' && turn.terminal.payload?.error_code === 'base_capacity';
      if (enteredBuffer || capacityFailure) operations.push({ seq: turn.requestSeq, kind: 'new-content' });
      for (const item of turn.provisional || []) {
        if (item.envelope?.payload?.status === 'processing') operations.push({ seq: item.seq, kind: 'advanced' });
      }
      if (terminalValue(turn, 'merged_into')) operations.push({ seq: turn.terminalSeq, kind: 'advanced' });
    }
  }
  for (const [seq, envelope] of state?.rows || []) {
    if (envelope?.kind === 'event' && envelope.type === TYPES.agentHoldExpired) operations.push({ seq, kind: 'fire', envelope });
  }
  operations.sort((left, right) => left.seq - right.seq);
  for (const operation of operations) {
    if (operation.kind === 'freeze') {
      frozen = {
        held_by: operation.turn.requestId,
        until: freezeDeadline(operation.turn),
        source: operation.turn.request.type,
        target_id: operation.turn.request.parent_id || '',
        _seq: operation.turn.requestSeq,
      };
    } else if (operation.kind === 'clear' || operation.kind === 'advanced') {
      frozen = null;
    } else if (operation.kind === 'new-content' && frozen && operation.seq > frozen._seq) {
      frozen = null;
    } else if (operation.kind === 'fire' && frozen && operation.envelope?.payload?.hold_id === frozen.held_by) {
      frozen = null;
    }
  }
  if (!frozen || !(Number(now) < frozen.until)) return null;
  const { _seq: _ignored, ...visible } = frozen;
  return visible;
}

export function activeAgentTurn(state, roster = [], selfId = '') {
  const agentIDs = new Set(roster.filter((row) => row.kind === 'agent').map((row) => row.id));
  return [...(state?.turns?.values?.() || [])]
    .filter((turn) => !turn.terminal && (!selfId || turn.request?.sender?.id === selfId) && turn.request?.audience?.length === 1
      && agentIDs.has(turn.request.audience[0]) && taskLocation(turn) === 'processing')
    .sort((left, right) => right.lastSeq - left.lastSeq)[0] || null;
}

export function editableText(turn) {
  return accountText(turn) || String(argsOf(turn?.request || {})?.new_text ?? argsOf(turn?.request || {})?.text ?? '');
}

// 替换（replace）生效后，受理方把新文本打在目标消息自己的账上（status 帧带 text）。
// 呈现恒优先吃账——与 controls 同一原则：影响这条消息的事实由受理方宣告在它的账上。
export function accountText(turn) {
  return [...(turn?.provisional || [])]
    .reverse()
    .map((item) => item.envelope?.payload)
    .find((payload) => (payload?.status === 'queued' || payload?.status === 'processing') && typeof payload?.text === 'string' && payload.text)?.text || '';
}
