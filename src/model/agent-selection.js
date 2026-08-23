import { TYPES } from '../protocol/vocab.js';
import { FINAL } from '../protocol/envelope.js';

// 协议正形（agent-model-params-design.md §4）：
// - 值域 = actor.describe 的 agent.select 词条 input_schema——oneOf 每支一个合法
//   (model, effort) 组合对，const 旁的 title 是展示元数据（无则显裸值）。
// - 当前值 = 账本保鲜（最后一个带非空 model/effort 的 terminal response usage）
//   + agent.context 冷启动兜底。
// 本文件是协议的唯一适配点：Composer 和选择器恒不感知帧的具体形状。

// —— 值域：describe → 组合对列表 ——————————————————————————————

export function selectionsFromDescribe(describe) {
  // capabilities.js 的归一形（types Map / inputSchema）优先；原始 wire 形
  // （words / input_schema）兜底，供直接拿 describe payload 的调用方与测试。
  const word = describe?.types?.get?.(TYPES.agentSelect) || describe?.words?.[TYPES.agentSelect];
  const schema = word?.inputSchema || word?.input_schema;
  const branches = Array.isArray(schema?.oneOf) ? schema.oneOf : [];
  return branches.map((branch) => {
    const model = branch?.properties?.model || {};
    const effort = branch?.properties?.effort || {};
    if (typeof model.const !== 'string' || !model.const || typeof effort.const !== 'string' || !effort.const) return null;
    return {
      model: model.const,
      effort: effort.const,
      modelLabel: String(model.title || model.const),
      effortLabel: String(effort.title || effort.const),
    };
  }).filter(Boolean);
}

// 换 model 的落点：命中 (model, preferredEffort) 或该 model 的第一个合法组合。
// 组合对不是笛卡尔积——切换恒提交目录里存在的一支（§4.4）。
export function selectionFor(selections, model, preferredEffort = '') {
  const rows = selections.filter((row) => row.model === model);
  if (!rows.length) return null;
  const match = preferredEffort ? rows.find((row) => row.effort === preferredEffort) : null;
  const chosen = match || rows[0];
  return { model: chosen.model, effort: chosen.effort };
}

// —— 当前值：账本推导 ——————————————————————————————————————

function usableUsage(payload) {
  const usage = payload?.usage || null;
  if (!usage || typeof usage.model !== 'string' || !usage.model) return null;
  return { model: usage.model, effort: typeof usage.effort === 'string' ? usage.effort : '', contextTokens: usage.context_tokens ?? null, contextWindow: usage.context_window ?? null };
}

// 该 agent 的当前参数。当前值是活状态读数，恒只认本连接的证据——账本历史
// usage 是上一个生命期的读数（服务重启可能换过配置），恒不当"当前值"，也
// 恒不挡本连接的 context 探测。证据链：本连接 agent.context 探测（liveRequestId）
// 的 completed 响应起算，其后新完成的 terminal response（usage 带非空 model/effort；
// 缺字段的帧跳过，不得把显示清空）逐步覆盖。无本连接证据恒返回 null。
export function latestAgentUsage(state, actorId, liveRequestId = '') {
  if (!state?.rows || !actorId || !liveRequestId) return null;
  let live = false;
  let found = null;
  for (const row of state.rows.values()) {
    if (row.kind === 'response' && row.type === TYPES.agentContext && row.parent_id === liveRequestId && row.payload?.status === 'completed') {
      live = true;
      const flat = row.payload;
      if (typeof flat.model === 'string' && flat.model) {
        found = { model: flat.model, effort: typeof flat.effort === 'string' ? flat.effort : '', contextTokens: flat.context_tokens ?? null, contextWindow: flat.context_window ?? null };
      }
      continue;
    }
    if (!live || row.sender?.id !== actorId) continue;
    if (row.kind === 'response' && FINAL.has(row.payload?.status)) {
      const usage = usableUsage(row.payload);
      if (usage) found = usage;
    }
  }
  return found;
}

// —— 参数面板视图（ModelSelector 的消费形）—————————————————————

// 两级菜单是组合对的投影：模型段 = 去重 model；强度段 = 当前 model 名下的合法
// effort（逐 model 不同）。current 恒来自账本真相（usage/context），无真值时为
// null——恒不拿 selections[0] 冒充当前值（decl 的 default 可以不是第一条，
// 冒充会长期显示错误参数；§4.1 要求无真值只显示角色名）。
export function agentSelectionView({ actorId, describe, usage }) {
  const selections = selectionsFromDescribe(describe);
  const current = usage?.model ? { model: usage.model, effort: usage.effort } : null;
  // 没有 selections 只表示不可切换，不表示没有当前配置。agent.context 仍可能
  // 返回真实 model（有些 provider 没有 effort），此时生成只读视图。
  if (!selections.length && !current) return null;
  const seen = new Set();
  const models = selections.filter((row) => !seen.has(row.model) && seen.add(row.model))
    .map((row) => ({ id: row.model, label: row.modelLabel }));
  return { actorId, current, models, selections, confirmed: Boolean(current), configurable: selections.length > 0 };
}

export function selectedOption(rows, id) {
  return rows?.find((row) => row.id === id) || (id ? { id, label: id } : null);
}

// select 成功回执的系统行文案（§8：切换不是"说了句话"，是一次配置变更——
// 请求恒不显示为用户消息，成功终态收成一条系统消息）。label 自 describe 值域
// 查得，无缓存时显裸值。
export function selectSystemNote({ usage = {}, describe = null, agentName = '' }) {
  if (!usage.model) return '';
  const selections = selectionsFromDescribe(describe);
  const row = selections.find((item) => item.model === usage.model && item.effort === usage.effort);
  const model = row?.modelLabel || usage.model;
  const effort = row?.effortLabel || usage.effort;
  return `${agentName} 切换为 ${model} 模型，effort=${effort}`;
}

// —— 参数面板目标判据链（§2.1，从上往下第一个命中即止）————————————

// mentionAgents：编辑框里 @ 生效的 agent（顺序即出现序）。返回：
// { kind: 'single', agent } | { kind: 'multi', count } | { kind: 'none' }。
// mention 里只有 human → none（不显示"最近 agent"误导）。
export function resolveParameterAgent({ mentions = [], manualAgentId = '', roster = [], state = null, selfId = '' }) {
  const agents = roster.filter((row) => row.kind === 'agent');
  const mentionAgents = mentions.filter((row) => row.kind === 'agent');
  if (mentionAgents.length === 1) return { kind: 'single', agent: mentionAgents[0], source: 'mention' };
  if (mentionAgents.length > 1) return { kind: 'multi', count: mentionAgents.length };
  if (mentions.length > 0) return { kind: 'none' };
  const manual = manualAgentId ? agents.find((row) => row.id === manualAgentId) : null;
  if (manual) return { kind: 'single', agent: manual, source: 'manual' };
  const recentId = latestInteractedAgentId(state, selfId, new Set(agents.map((row) => row.id)));
  const recent = recentId ? agents.find((row) => row.id === recentId) : null;
  if (recent) return { kind: 'single', agent: recent, source: 'recent' };
  if (agents.length === 1) return { kind: 'single', agent: agents[0], source: 'only' };
  return { kind: 'none' };
}

// 最近交互（§2.1.3）：我自己发的 + agent.ask（用户真实内容，恒不是 describe/
// context/select 这类自省控制词）+ audience 恰一个 agent + 该 agent 仍在 roster。
// 从账本推导，不另设持久状态。
export function latestInteractedAgentId(state, selfId, agentIds) {
  if (!state?.rows || !selfId) return '';
  let found = '';
  for (const row of state.rows.values()) {
    if (row.kind !== 'request' || row.type !== TYPES.agentAsk) continue;
    if (row.sender?.id !== selfId) continue;
    const audience = Array.isArray(row.audience) ? row.audience : [];
    if (audience.length !== 1 || !agentIds.has(audience[0])) continue;
    found = audience[0];
  }
  return found;
}
