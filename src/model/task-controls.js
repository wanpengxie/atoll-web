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
    .map((item) => item.envelope?.payload)
    .find((payload) => payload?.status === 'queued' || payload?.status === 'processing') || null;
}

function processingTurnId(turn) {
  return [...(turn?.provisional || [])]
    .reverse()
    .map((item) => item.envelope?.payload?.turn_id)
    .find((value) => typeof value === 'string' && value) || '';
}

export function taskLocation(turn) {
  return latestStatusFrame(turn)?.status || '';
}

function controlEntries(frame) {
  if (!Array.isArray(frame?.controls)) return [];
  return frame.controls.filter((entry) => entry && typeof entry.word === 'string' && entry.word);
}

// 核心词有前端专属交互（replace→编辑流程、steer→插入、interrupt→停止）。
// 白名单外的词走通用路径：label 兜底文案、点击即发词带 target——
// 将来任何 actor 新报的控制词零前端改动即可用。
const CORE_CONTROL_WORDS = Object.freeze([TYPES.agentReplace, TYPES.agentInterrupt, TYPES.agentSteer]);

export function extraControls(context) {
  if (!context?.actionable) return [];
  return context.controls.filter((entry) => !CORE_CONTROL_WORDS.includes(entry.word));
}

export function controlLabel(entry) {
  return entry.label || entry.word.split('.').pop();
}

export function taskControlContext(turn, { selfId = '', access = '', now = Date.now() } = {}) {
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
  const location = frame?.status || '';
  const controls = open ? controlEntries(frame) : [];
  const words = new Set(controls.map((entry) => entry.word));
  const actionable = open && writable;
  const expiresAt = Number(request?.expires_at || 0);
  return {
    actorId,
    requestId: request?.id || '',
    open,
    owned,
    writable,
    actionable,
    turnId: processingTurnId(turn),
    expiresAt,
    expired: expiresAt > 0 && expiresAt <= now,
    location,
    controls,
    // 取消是消息撤回(channel 层的能力),不是 agent 控制词,不进 controls——
    // 而且它是唯一仍然要求 owned 的一个,不是策略选择而是结构约束:取消写的是
    // **调用方给自己的账**写终态,harness 只认 sender == 那条请求的 sender 这一支
    // (step_response_pairing 的 callerSelfClose)。第三方按下去只会拿到
    // unauthorized_sender,所以按钮不该出现。别人的活要停,用 interrupt。
    canCancel: actionable && owned && location === 'queued',
    canInsert: actionable && words.has(TYPES.agentSteer),
    canEdit: actionable && words.has(TYPES.agentReplace),
    canStop: actionable && words.has(TYPES.agentInterrupt),
  };
}
