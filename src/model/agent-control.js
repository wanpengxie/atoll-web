import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';
import { taskLocation } from './task-controls.js';

const CONTENT_TYPES = new Set([
  TYPES.agentAsk,
  TYPES.agentQueue,
  TYPES.agentCompact,
  TYPES.agentSelect,
  TYPES.agentReplace,
  TYPES.agentSteer,
]);

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

// 活跃连接中按账本顺序推瞬态冻结。context 的 completed 是刷新/重连后的
// 权威快照；hold_expired 只有 hold_id 命中当前 held_by 才能解除。
export function agentFrozenState(state, actorId) {
  let frozen = null;
  const items = [];
  for (const turn of state?.turns?.values?.() || []) {
    if (turn.request?.audience?.length !== 1 || turn.request.audience[0] !== actorId) continue;
    items.push({ seq: turn.requestSeq, kind: 'request', turn });
    for (const item of turn.provisional || []) items.push({ seq: item.seq, kind: 'response', turn, envelope: item.envelope });
    if (turn.terminal) items.push({ seq: turn.terminalSeq, kind: 'terminal', turn, envelope: turn.terminal });
  }
  for (const [seq, envelope] of state?.rows || []) {
    if (envelope?.kind === 'event' && envelope.type === TYPES.agentHoldExpired) items.push({ seq, kind: 'fire', envelope });
  }
  items.sort((left, right) => left.seq - right.seq);
  for (const item of items) {
    const type = item.turn?.request?.type;
    if (item.kind === 'terminal' && terminalCompleted(item.turn)) {
      if (type === TYPES.agentContext) {
        frozen = item.envelope.payload?.frozen ? { ...item.envelope.payload.frozen, _seq: item.seq } : null;
      } else if (type === TYPES.agentHold || type === TYPES.agentInterrupt) {
        frozen = { held_by: item.turn.requestId, until: 0, _seq: item.turn.requestSeq };
      } else if (type === TYPES.agentUnhold) {
        frozen = null;
      }
    }
    const enteredBuffer = item.envelope?.payload?.status === 'queued';
    const newlyStartedContent = item.envelope?.payload?.status === 'processing' && type !== TYPES.agentSteer;
    if (item.kind === 'response' && frozen && CONTENT_TYPES.has(type) && item.turn.requestSeq > frozen._seq
      && (enteredBuffer || newlyStartedContent) && item.envelope?.payload?.resumed !== true) frozen = null;
    if (item.kind === 'terminal' && frozen && type !== TYPES.agentReplace && CONTENT_TYPES.has(type) && item.turn.requestSeq > frozen._seq
      && item.envelope?.payload?.status === 'failed' && item.envelope?.payload?.error_code === 'base_capacity') frozen = null;
    if (item.kind === 'fire' && frozen && item.envelope?.payload?.hold_id === frozen.held_by) frozen = null;
  }
  if (!frozen) return null;
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
  const payload = argsOf(turn?.request || {});
  return String(payload?.new_text ?? payload?.text ?? '');
}
