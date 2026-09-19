import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';
import { taskLocation } from './task-controls.js';
import { terminalResultEnvelope, terminalResultPayload, terminalResultState, terminalRetainedValue } from './terminal-result.js';

// 会以"一条消息"身份出现在时间线/等待区的词。replace 在列：协议 §4.6 里 replace
// 请求受理成功后**自身就是新行**（admitBufferedAt 以原下标入队、继承 Resumed），
// 原行终态 replaced_by 后从呈现中消失，新行以 new_text 接替。
// agentSelect 恒不在列：select 走旁路独占槽（协议 §8），不进等待区、不占容量、
// 不受冻结控制——它不是"一条消息"，是一次参数登记；呈现走控制卡，状态走参数区。
const CONTENT_TYPES = new Set([
  TYPES.agentAsk,
  TYPES.agentQueue,
  TYPES.agentCompact,
  TYPES.agentNew,
  TYPES.agentReplace,
  TYPES.agentSteer,
]);
const DEFAULT_HOLD_DURATION_MS = 30 * 60 * 1000;

function terminalValue(turn, key) {
  const retained = key === 'merged_into' || key === 'replaced_by' || key === 'preempted_by';
  if (retained) return terminalRetainedValue(turn, key);
  const payload = terminalResultPayload(turn);
  return payload?.[key] ?? payload?.value?.[key];
}

export function isAgentMessageTurn(turn) {
  return isAgentMessageType(turn?.request?.type);
}

export function isAgentMessageType(type) {
  return CONTENT_TYPES.has(type);
}

// A user message moves between the wait layer and the conversation from its
// own position facts only. A terminal merged_into is itself the acceptance
// fact for a batched message; all other terminals retain the last position.
export function agentMessageStage(turn) {
  if (!isAgentMessageTurn(turn)) return '';
  const location = taskLocation(turn);
  if (location === 'processing') return 'timeline';
  if (terminalValue(turn, 'merged_into')) return 'timeline';
  // Semantic history deliberately removes completed progress frames. A
  // terminal request/response pair is still a complete conversation and must
  // not disappear merely because its former `processing` position marker was
  // compacted out of the transport window.
  if (turn?.terminal && !terminalValue(turn, 'replaced_by')) return 'timeline';
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
  return argsOf(turn?.terminal)?.status === 'completed';
}

export function resumedQueued(turn) {
  return [...(turn?.provisional || [])].reverse().some((item) => (
    argsOf(item.envelope)?.status === 'queued' && argsOf(item.envelope)?.resumed === true
  ));
}

export function editAdmission(state, session) {
  if (!session?.holdId || !session?.targetId) return { ready: false, error: '' };
  const hold = state?.turns?.get(session.holdId);
  if (!hold?.terminal) return { ready: false, error: '' };
  const result = terminalResultPayload(hold);
  if (!result) {
    return { ready: false, error: terminalResultState(hold).error };
  }
  if (result.status !== 'completed') {
    return { ready: false, error: result.detail || result.error_code || '无法锁定这条任务' };
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
  // An interrupt is a stopped state, not a timed editing lease. The backend
  // keeps it until a content action explicitly resumes the queue.
  if (turn?.request?.type === TYPES.agentInterrupt) return Number.POSITIVE_INFINITY;
  const requested = argsOf(turn?.request).duration_ms;
  const duration = Number.isSafeInteger(requested) && requested >= 1 && requested <= DEFAULT_HOLD_DURATION_MS
    ? requested
    : DEFAULT_HOLD_DURATION_MS;
  return requestTimestamp(turn?.request) + duration;
}

function reduceFrozenOperations(operations, now) {
  let frozen = null;
  operations.sort((left, right) => left.seq - right.seq);
  for (const operation of operations) {
    if (operation.kind === 'freeze') {
      // A hold temporarily overlays a prior interrupt. Replacing one hold with
      // another keeps that same restore point; an interrupt arriving later is
      // stronger and discards the editing lease entirely.
      const restore = operation.turn.request.type === TYPES.agentHold
        ? (frozen?.source === TYPES.agentInterrupt ? frozen : frozen?._restore || null)
        : null;
      frozen = {
        held_by: operation.turn.requestId,
        until: freezeDeadline(operation.turn),
        source: operation.turn.request.type,
        target_id: operation.turn.request.parent_id || '',
        _restore: restore,
        _seq: operation.turn.requestSeq,
      };
    } else if (operation.kind === 'release') {
      if (frozen?.source === TYPES.agentHold) frozen = frozen._restore || null;
    } else if (operation.kind === 'advanced') {
      frozen = null;
    } else if (operation.kind === 'new-content' && frozen && operation.seq > frozen._seq) {
      frozen = null;
    } else if (operation.kind === 'fire' && frozen && argsOf(operation.envelope)?.hold_id === frozen.held_by) {
      frozen = frozen._restore || null;
    }
  }
  // The local deadline is enough to stop presenting an expired hold while its
  // event is in flight, but expiry must reveal a prior interrupt rather than
  // pretending the Agent resumed.
  if (frozen?.source === TYPES.agentHold && !(Number(now) < frozen.until)) frozen = frozen._restore || null;
  if (!frozen || !(Number(now) < frozen.until)) return null;
  const { _seq: _ignored, _restore: _ignoredRestore, ...visible } = frozen;
  return visible;
}

// 一次生成屏幕上所有 agent 的冻结状态。旧的逐 actor 查询会为每个成员各扫描
// 一遍 turns 和 rows；频道越热、成员越多，单条 progress 的成本就被成倍放大。
// 冻结与解除仍按请求自己的因果 seq 排，processing/merged_into 按事实 seq 清除。
export function agentFrozenStates(state, actorIds = null, now = Date.now()) {
  const wanted = actorIds ? new Set(actorIds) : null;
  const operationsByActor = new Map();
  const holdOwner = new Map();
  const operationsFor = (actorId) => {
    let operations = operationsByActor.get(actorId);
    if (!operations) {
      operations = [];
      operationsByActor.set(actorId, operations);
    }
    return operations;
  };
  for (const turn of state?.turns?.values?.() || []) {
    if (turn.request?.audience?.length !== 1) continue;
    const actorId = turn.request.audience[0];
    if (wanted && !wanted.has(actorId)) continue;
    const operations = operationsFor(actorId);
    const type = turn.request?.type;
    if (terminalCompleted(turn) && (type === TYPES.agentHold || type === TYPES.agentInterrupt)) {
      operations.push({ seq: turn.requestSeq, kind: 'freeze', turn });
      holdOwner.set(turn.requestId, actorId);
    } else if (terminalCompleted(turn) && type === TYPES.agentUnhold) {
      // New agents report whether a hold was actually released. Old ledger
      // rows have no flag and retain their historical clear behavior.
      if (terminalResultEnvelope(turn) && terminalValue(turn, 'released') !== false) operations.push({ seq: turn.requestSeq, kind: 'release' });
    }
    if (CONTENT_TYPES.has(type)) {
      const enteredBuffer = (turn.provisional || []).some((item) => argsOf(item.envelope)?.status === 'queued' && argsOf(item.envelope)?.resumed !== true);
      const terminal = terminalResultPayload(turn);
      const capacityFailure = terminal?.status === 'failed' && terminal.error_code === 'base_capacity';
      // replace is admitted in place without releasing the editing hold.
      if (type !== TYPES.agentReplace && (enteredBuffer || capacityFailure)) operations.push({ seq: turn.requestSeq, kind: 'new-content' });
      // 一条进度行不是"队列前进"。只有轮次**进入** processing 的那一次跃迁才
      // 是：hold 之前就在跑的轮次会一直重复报 processing，把每一条都当前进，
      // 就会在 hold 完成后的下一秒把刚拿到的编辑租约清掉（账本 seq 93719–
      // 93725 的"编辑被另一项控制终止"）。跃迁本身按自己的 seq 排序，因此
      // hold 之前的跃迁先于冻结被消费，hold 之后开跑的（新入队的轮次、被 hold
      // 的目标自己复跑）照旧作废租约。业务态进度行不改核心状态。
      let coreStatus = '';
      for (const item of turn.provisional || []) {
        if (item.core !== true) continue;
        if (item.status === 'processing' && coreStatus !== 'processing') {
          operations.push({ seq: item.seq, kind: 'advanced' });
        }
        coreStatus = item.status;
      }
      if (terminalValue(turn, 'merged_into')) operations.push({ seq: turn.terminalSeq, kind: 'advanced' });
    }
  }
  if (holdOwner.size) {
    for (const [seq, envelope] of state?.rows || []) {
      if (envelope?.kind !== 'event' || envelope.type !== TYPES.agentHoldExpired) continue;
      const actorId = holdOwner.get(argsOf(envelope)?.hold_id);
      if (actorId) operationsFor(actorId).push({ seq, kind: 'fire', envelope });
    }
  }
  const states = new Map();
  for (const [actorId, operations] of operationsByActor) {
    const frozen = reduceFrozenOperations(operations, now);
    if (frozen) states.set(actorId, frozen);
  }
  return states;
}

export function agentFrozenState(state, actorId, now = Date.now()) {
  return agentFrozenStates(state, [actorId], now).get(actorId) || null;
}

export function activeAgentTurn(state, roster = [], selfId = '') {
  const agentIDs = new Set(roster.filter((row) => row.kind === 'agent').map((row) => row.id));
  let latest = null;
  for (const turn of state?.turns?.values?.() || []) {
    if (turn.terminal || (selfId && turn.request?.sender?.id !== selfId) || turn.request?.audience?.length !== 1) continue;
    if (!agentIDs.has(turn.request.audience[0]) || taskLocation(turn) !== 'processing') continue;
    if (!latest || turn.lastSeq > latest.lastSeq) latest = turn;
  }
  return latest;
}

export function editableText(turn) {
  const payload = argsOf(turn?.request || {});
  return String(payload?.new_text ?? payload?.text ?? '');
}
