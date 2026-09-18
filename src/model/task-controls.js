import { argsOf } from '../protocol/envelope.js';
import { terminalResultPayload } from './fold.js';
import { TYPES } from '../protocol/vocab.js';

// 一条消息此刻可被哪些控制词操作，唯一权威是受理方（agent 基座的处理循环）——
// 它在这条消息自己的 progress 账里用 controls 字段宣告，全量快照、后帧覆盖前帧。
// 前端恒不推断、恒不查表（describe 是参数描述，不是按钮来源）：
// 账上有什么，交上归属与写权限后，画什么。

// 契约：凡带 status（queued/processing）的进度帧必带 controls；终态帧恒不带。
// 位置与可用控制取同一帧，天然同步。
function latestStatusFrame(turn) {
  return [...(turn?.provisional || [])]
    .reverse()
    .map((item) => argsOf(item.envelope))
    .find((payload) => payload?.status === 'queued' || payload?.status === 'processing') || null;
}

function processingTurnId(turn) {
  return [...(turn?.provisional || [])]
    .reverse()
    .map((item) => argsOf(item.envelope)?.turn_id)
    .find((value) => typeof value === 'string' && value) || '';
}

export function taskLocation(turn) {
  return latestStatusFrame(turn)?.status || '';
}

function controlEntries(frame) {
  if (!Array.isArray(frame?.controls)) return [];
  return frame.controls.filter((entry) => (
    entry
    && typeof entry.word === 'string'
    && entry.word
    && entry.payload
    && typeof entry.payload === 'object'
    && !Array.isArray(entry.payload)
  ));
}

// 核心词有前端专属交互（replace→编辑流程、steer→插入、interrupt→停止）。
// 白名单外的词走通用路径：label 兜底文案、点击即发词带 target——
// 将来任何 actor 新报的控制词零前端改动即可用。
const CORE_CONTROL_WORDS = Object.freeze([TYPES.agentReplace, TYPES.agentInterrupt, TYPES.agentSteer, TYPES.agentDismiss]);

export function extraControls(context) {
  if (!context?.actionable) return [];
  return context.controls.filter((entry) => !CORE_CONTROL_WORDS.includes(entry.word));
}

export function controlLabel(entry) {
  return entry.label || entry.word.split('.').pop();
}

// Work-aware controls carry their stable target in the actor-authored entry.
// Missing payload means the control is unavailable; the frontend never
// reconstructs an older command shape from the current view.
export function controlPayload(context, word) {
  const entry = context?.controls?.find((candidate) => candidate.word === word);
  const declared = entry?.payload;
  return declared && typeof declared === 'object' && !Array.isArray(declared)
    ? { ...declared }
    : null;
}

export function taskTargetCurrentness(turn, authority = null) {
  const actorId = turn?.request?.audience?.length === 1 ? turn.request.audience[0] : '';
  if (!actorId || authority?.current !== true || !(authority.actorIDs instanceof Set)) return 'unknown';
  return authority.actorIDs.has(actorId) ? 'current' : 'departed';
}

export function createWaitingTargetAuthority({
  principalId = '', channelId = '', generation = 0, rosterAuthority = null, roster = [],
} = {}) {
  const activeGeneration = Number(generation || 0);
  return {
    principalId,
    channelId,
    generation: activeGeneration,
    current: Boolean(
      activeGeneration > 0
      && rosterAuthority?.principalId === principalId
      && rosterAuthority?.channelId === channelId
      && rosterAuthority?.generation === activeGeneration
      && rosterAuthority?.current === true
    ),
    actorIDs: new Set((roster || [])
      .filter((row) => row?.kind === 'agent' && typeof row.id === 'string' && row.id)
      .map((row) => row.id)),
  };
}

export function taskControlContext(turn, {
  selfId = '', access = '', now = Date.now(), targetAuthority = null,
} = {}) {
  const request = turn?.request;
  const actorId = request?.audience?.length === 1 ? request.audience[0] : '';
  const open = Boolean(request && !turn.terminal);
  // 谁能操作:频道是一个统一权限边界,所以"能在这里写"就能操作这里等待中的活,
  // 不要求是它的发起人。发起人限制曾让最常见的一种情况无人可管——agent 代人转发
  // 的请求,它的 sender 是转发的 agent,于是真正的委托人只能眼看着自己的活排在队
  // 里而碰不到任何按钮。
  const owned = Boolean(selfId && request?.sender?.id === selfId);
  const writable = access === 'member_active';
  const frame = latestStatusFrame(turn);
  const terminal = terminalResultPayload(turn);
  const workFrame = frame?.work_id ? frame : (terminal?.work_id ? terminal : null);
  const location = frame?.status || '';
  const controls = open ? controlEntries(frame) : [];
  const words = new Set(controls.map((entry) => entry.word));
  const targetCurrentness = taskTargetCurrentness(turn, targetAuthority);
  const callerCancelEligible = open && writable && owned && location === 'queued';
  const targetControlsEligible = open && writable && targetCurrentness === 'current';
  const actionable = targetControlsEligible;
  const expiresAt = Number(request?.expires_at || 0);
  return {
    actorId,
    requestId: request?.id || '',
    open,
    owned,
    writable,
    actionable,
    targetCurrentness,
    callerCancelEligible,
    targetControlsEligible,
    turnId: processingTurnId(turn),
    expiresAt,
    expired: expiresAt > 0 && expiresAt <= now,
    location,
    controls,
    workId: typeof workFrame?.work_id === 'string' ? workFrame.work_id : '',
    workState: workFrame?.work_state || workFrame?.state || '',
    workStage: workFrame?.stage || '',
    executionState: workFrame?.execution_state || '',
    // 已离开队列、正在等 provider 裁定是否并入当前轮。按钮随 controls 一起清空，
    // 这里再给一个明确的事实，让等待区能写"正在并入"而不是无声地少了按钮。
    steering: Boolean(frame?.steering),
    // 「取消」一个按钮，两种事实，由归属决定是哪一种：
    //   自己发的 → 撤回，调用方关掉自己开的账（wire.cancel）；
    //   别人发的 → 请持有它的 actor 把它答掉（agent.dismiss）——第三方不是
    //   合法的终态作者，绕开受理方去关账是不存在的动作。
    // 后一种和其它控制词一样，以受理方在账上宣告 dismiss 为准。
    canCancel: callerCancelEligible
      || (targetControlsEligible && location === 'queued' && words.has(TYPES.agentDismiss)),
    cancelsAsDismiss: !callerCancelEligible && targetControlsEligible && !owned,
    canInsert: targetControlsEligible && words.has(TYPES.agentSteer),
    canEdit: targetControlsEligible && words.has(TYPES.agentReplace),
    canStop: targetControlsEligible && words.has(TYPES.agentInterrupt),
  };
}
