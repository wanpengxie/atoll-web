import { TYPES } from '../protocol/vocab.js';
import { FINAL } from '../protocol/envelope.js';

// 协议正形：
// - actor.describe 只声明 agent.options / agent.select 两个稳定 word；
// - 值域 = 当前 incarnation 的 agent.options 终态快照；旧服务的 describe.oneOf
//   仅保留为滚动升级期 fallback。
// - 当前值 = agent.options 的当前 generation 快照；本连接内后续可确认的
//   terminal usage / agent.context 再覆盖它。
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

export function normalizeAgentOptions(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.models)) return null;
  const models = [];
  const selections = [];
  for (const rawModel of value.models) {
    const model = typeof rawModel?.value === 'string' ? rawModel.value.trim() : '';
    if (!model) continue;
    const modelLabel = String(rawModel.label || model);
    models.push({ id: model, label: modelLabel, description: String(rawModel.description || '') });
    const efforts = Array.isArray(rawModel.efforts) ? rawModel.efforts : [];
    if (!efforts.length) {
      selections.push({ model, effort: '', modelLabel, effortLabel: '' });
      continue;
    }
    for (const rawEffort of efforts) {
      const effort = typeof rawEffort?.value === 'string' ? rawEffort.value.trim() : '';
      if (!effort) continue;
      selections.push({ model, effort, modelLabel, effortLabel: String(rawEffort.label || effort), description: String(rawEffort.description || '') });
    }
  }
  if (!models.length) return null;
  const current = typeof value.current?.model === 'string' && value.current.model
    ? { model: value.current.model, effort: typeof value.current.effort === 'string' ? value.current.effort : '' }
    : null;
  return {
    provider: String(value.provider || ''),
    source: String(value.source || ''),
    generatedAt: String(value.generated_at || ''),
    models,
    selections,
    current,
    client: value.client && typeof value.client === 'object' ? value.client : null,
  };
}

export function latestAgentOptions(state, actorId, liveRequestId = '') {
  if (!state?.rows || !actorId || !liveRequestId) return null;
  for (const row of state.rows.values()) {
    if (row.kind !== 'response' || row.type !== TYPES.agentOptions || row.parent_id !== liveRequestId) continue;
    if (row.sender?.id !== actorId || row.payload?.status !== 'completed') continue;
    return normalizeAgentOptions(row.payload);
  }
  return null;
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

function normalizedUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const contextTokens = value.context_tokens != null && value.context_tokens !== '' && Number.isFinite(Number(value.context_tokens)) && Number(value.context_tokens) >= 0 ? Number(value.context_tokens) : null;
  const contextWindow = value.context_window != null && value.context_window !== '' && Number.isFinite(Number(value.context_window)) && Number(value.context_window) > 0 ? Number(value.context_window) : null;
  const model = typeof value.model === 'string' ? value.model : '';
  const effort = typeof value.effort === 'string' ? value.effort : '';
  if (!model && contextTokens == null && contextWindow == null) return null;
  return { model, effort, contextTokens, contextWindow };
}

function usableUsage(payload) {
  return normalizedUsage(payload?.usage);
}

function mergeUsage(current, next) {
  if (!next) return current;
  return {
    model: next.model || current?.model || '',
    effort: next.model ? next.effort : (current?.effort || next.effort || ''),
    contextTokens: next.contextTokens ?? current?.contextTokens ?? null,
    contextWindow: next.contextWindow ?? current?.contextWindow ?? null,
  };
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
      found = mergeUsage(found, normalizedUsage(row.payload));
      continue;
    }
    if (!live || row.sender?.id !== actorId) continue;
    if (row.kind === 'response' && FINAL.has(row.payload?.status)) {
      const usage = usableUsage(row.payload);
      if (usage) found = mergeUsage(found, usage);
    }
  }
  return found;
}

// —— 参数面板视图（ModelSelector 的消费形）—————————————————————

// 两级菜单是组合对的投影：模型段 = 去重 model；强度段 = 当前 model 名下的合法
// effort（逐 model 不同）。current 的基线来自 agent.options，随后由本连接内能
// 命中 catalog 的 usage/context 覆盖；恒不拿 selections[0] 冒充当前值（decl 的
// default 可以不是第一条，冒充会长期显示错误参数）。
export function agentSelectionView({ actorId, describe, options = null, usage }) {
  const selections = options?.selections?.length ? options.selections : selectionsFromDescribe(describe);
  // The displayed current value is the ledger's truth: whatever the latest
  // usage reports is what the agent ran with, even when the provider spells
  // it as a resolved id the catalog does not list (Claude reports
  // claude-fable-5-1 for the catalog value claude-fable-5-1[1m]). The options
  // snapshot is probed once per incarnation and goes stale after the first
  // agent.select, so it is only the baseline before any usage exists. Owner
  // 2026-09-09: reflect faithfully, do not judge.
  const current = usage?.model
    ? { model: usage.model, effort: usage.effort }
    : options?.current || null;
  // 没有 selections 只表示不可切换，不表示没有当前配置。agent.context 仍可能
  // 返回真实 model（有些 provider 没有 effort），此时生成只读视图。
  if (!selections.length && !current && usage?.contextTokens == null && usage?.contextWindow == null) return null;
  const seen = new Set();
  const models = options?.models?.length ? options.models : selections.filter((row) => !seen.has(row.model) && seen.add(row.model))
    .map((row) => ({ id: row.model, label: row.modelLabel }));
  return { actorId, current, usage, models, selections, client: options?.client || null, source: options?.source || '', confirmed: Boolean(current), configurable: selections.length > 0 };
}

// Context 是 provider 上报的当前 session 真值。前端只做单位和比例投影；
// context_window 缺失时展示数值，绝不猜模型窗口。
export function contextUsageView(usage) {
  const tokens = Number.isFinite(Number(usage?.contextTokens)) && Number(usage.contextTokens) >= 0 ? Number(usage.contextTokens) : null;
  const window = Number.isFinite(Number(usage?.contextWindow)) && Number(usage.contextWindow) > 0 ? Number(usage.contextWindow) : null;
  if (tokens == null && window == null) return null;
  const percent = tokens != null && window != null ? Math.round((tokens / window) * 100) : null;
  return { tokens, window, percent };
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

// recipients：收件人条上 @ 选中的成员（顺序即选中序）。返回：
// { kind: 'single', agent } | { kind: 'multi', count } | { kind: 'none' }。
// 只 @ 了 human → none（不显示"最近 agent"误导）。
//
// filterAgentId：动态过滤条恰好只选中一个 agent 时，就是那个 agent。它排在手选
// 之前，理由是它恒在屏幕上显示着——屏幕上只剩「我和他」的往来时，回车发给别人
// 是显然错的，而人看得见自己筛的是谁，所以拿它当默认恒不引入暗状态。手选（§2.1.2）
// 只在判据链走到 none 时才有入口，两者恒不会互相抢：筛选一旦命中，手选入口本就不出现。
// 判据链的第一环单独导出：Composer 持有收件人条，App 持有名册与账本，两边恒共用
// 这一环，恒不各写一份（写两份就会在"@ 了三个人"这种格子上各说各话）。
// 未命中返回 null = 这一环没有意见，继续往下走。
export function mentionRing(recipients = []) {
  const agents = recipients.filter((row) => row.kind === 'agent');
  if (agents.length === 1) return { kind: 'single', agent: agents[0], source: 'mention' };
  if (agents.length > 1) return { kind: 'multi', count: agents.length };
  if (recipients.length > 0) return { kind: 'none' };
  return null;
}

export function resolveParameterAgent({ recipients = [], filterAgentId = '', manualAgentId = '', roster = [], state = null, selfId = '' }) {
  const agents = roster.filter((row) => row.kind === 'agent');
  const mentioned = mentionRing(recipients);
  if (mentioned) return mentioned;
  const focused = filterAgentId ? agents.find((row) => row.id === filterAgentId) : null;
  if (focused) return { kind: 'single', agent: focused, source: 'filter' };
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
