// A probe is a ledger request, not merely the Promise returned by the local
// submission layer. Keep its guard alive until the ledger reports a terminal
// result (or the user explicitly retries it), otherwise receipt-before-feed
// ordering turns one automatic probe into a request loop.

// 两条硬闸门（owner 2026-09-18 拍定）。它们是自动探测的上限，不是建议值。
//
// 背景：原来唯一的闸门是 generation，而 generation 在**任何连接状态边界**
// 都会前进并清空 entries。前端服务 00:34 挂掉后浏览器不停重连，于是闸门等于
// 不存在：三小时里 1200 条 actor.describe 全部卡在 processing，塞满 codex
// 的 256 格在站账，root 本人反而被 overloaded 拒之门外。
//
// 所以频次闸门必须**跨代**存活（见 advanceAgentProbeGeneration），
// 而每条探测必须自带 1 分钟死线，让在站账自己把格子还回来。
export const PROBE_MIN_INTERVAL_MS = 60_000;
export const PROBE_TIMEOUT_MS = 60_000;

export function createAgentProbeLifecycle() {
  return {
    generation: 0,
    entries: new Map(),
    liveRequestIds: new Set(),
    // key -> 上次真正发出的时刻。与 entries 分开存，因为它必须活过 generation。
    lastSentAt: new Map(),
  };
}

export function advanceAgentProbeGeneration(lifecycle) {
  lifecycle.generation += 1;
  lifecycle.entries.clear();
  lifecycle.liveRequestIds.clear();
  // lastSentAt 故意不清：频次闸门跨连接代生效，否则"断线重连"就等于
  // "解除限流"，这正是探测风暴的成因。
  return lifecycle.generation;
}

// 频次闸门的唯一入口：返回 true 表示这一刻允许发，并已记账。
// force 是用户显式动作（点"读取能力"），不受自动探测的限流约束。
export function reserveProbeSlot(lifecycle, key, { force = false, now = Date.now() } = {}) {
  if (!force) {
    const last = lifecycle.lastSentAt.get(key) || 0;
    if (now - last < PROBE_MIN_INTERVAL_MS) return false;
  }
  lifecycle.lastSentAt.set(key, now);
  return true;
}

function owns(lifecycle, entry) {
  return Boolean(entry)
    && entry.generation === lifecycle.generation
    && lifecycle.entries.get(entry.key) === entry;
}

export function beginAgentProbe(lifecycle, key, { force = false, now = Date.now() } = {}) {
  const current = lifecycle.entries.get(key);
  if (current?.generation === lifecycle.generation && !force) return null;
  // 同代闸门放行后仍要过频次闸门：换代恰恰是风暴的入口。
  if (!reserveProbeSlot(lifecycle, key, { force, now })) return null;
  // 上一条的 requestId 恒不从 liveRequestIds 里摘掉：能力索引只认活请求，摘掉
  // 就等于在新结果到达前把已有能力清空，面板会先变空再被"换目标"重置关掉
  // （2026-09-18 用户实测"又不能切换了"的根因）。新旧并存，索引按 requestSeq
  // 排序后合并，新的自然覆盖旧的；整张表在换代时清空，所以不会无限增长。
  const entry = {
    key,
    generation: lifecycle.generation,
    requestId: '',
    phase: 'submitting',
    startedAt: now,
  };
  lifecycle.entries.set(key, entry);
  return entry;
}

export function acceptAgentProbe(lifecycle, entry, requestId) {
  if (!owns(lifecycle, entry)) return false;
  entry.requestId = requestId || '';
  entry.phase = entry.requestId ? 'awaiting-ledger' : 'failed';
  if (entry.requestId) lifecycle.liveRequestIds.add(entry.requestId);
  return Boolean(entry.requestId);
}

export function failAgentProbe(lifecycle, entry) {
  if (!owns(lifecycle, entry)) return false;
  entry.phase = 'failed';
  return true;
}

export function observeAgentProbe(lifecycle, key, capability, rejected = false, now = Date.now()) {
  const entry = lifecycle.entries.get(key);
  if (!owns(lifecycle, entry)) return null;
  if (rejected) entry.phase = 'failed';
  if (entry.requestId && capability?.requestId === entry.requestId && !capability.loading) {
    entry.phase = capability.error ? 'failed' : capability.describe ? 'succeeded' : entry.phase;
  }
  // 本地死线：账本可能永远不给这条探测一个结局（目标卡死时就是如此），
  // 所以判定权不能只挂在账本信号上——那正是旧实现看不出"已经发过"的原因。
  if (entry.phase !== 'succeeded' && entry.phase !== 'failed'
    && entry.startedAt && now - entry.startedAt >= PROBE_TIMEOUT_MS) {
    entry.phase = 'failed';
    if (entry.requestId) lifecycle.liveRequestIds.delete(entry.requestId);
  }
  return entry;
}

export function retryFailedAgentProbe(lifecycle, key) {
  const entry = lifecycle.entries.get(key);
  if (!owns(lifecycle, entry) || entry.phase !== 'failed') return false;
  if (entry.requestId) lifecycle.liveRequestIds.delete(entry.requestId);
  lifecycle.entries.delete(key);
  // 用户展开参数区是显式动作，不是自动轮询：放行一次，否则他点了没反应。
  // 限流针对的是自激，不是真人。
  lifecycle.lastSentAt.delete(key);
  return true;
}

// 真人要求刷新：无条件让位，连在途的那条也作废重发。
//
// owner 2026-09-18 的原话是「手动永远不被管理」。这里曾经只清 failed 的记录，
// 结果真人连点第二下被同代去重吃掉，表现就是点了没反应。去重是给自动探测防
// 自激用的，不该反过来管人。连点产生的重复请求由点的人自己负责。
export function releaseAgentProbe(lifecycle, key) {
  // 只让位，不销毁证据：上一条的 requestId 留在 liveRequestIds 里，它拿到的
  // 能力在新一条落地前仍是当前真值。刷新是"追加一份新证据"，不是"先清空再取"。
  lifecycle.entries.delete(key);
  return true;
}

// 用户显式重试时一并放行该 actor 的按词探测（agent.options / agent.context）。
export function clearProbeSlots(lifecycle, keyPrefix) {
  for (const key of [...lifecycle.lastSentAt.keys()]) {
    if (key === keyPrefix || key.startsWith(`${keyPrefix}:`)) lifecycle.lastSentAt.delete(key);
  }
}

export function agentProbeEntry(lifecycle, key) {
  const entry = lifecycle.entries.get(key);
  return owns(lifecycle, entry) ? entry : null;
}
