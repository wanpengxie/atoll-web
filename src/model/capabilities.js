import { TYPES } from '../protocol/vocab.js';

// agent 基座直接受理的控制词（drivers/agents/base/base.go）。它们不是“一件正在
// 进行的工作”，所以工作项索引把它们排除在外。
const CONTROL_TYPES = new Set([
  TYPES.agentSteer,
  TYPES.agentQueue,
  TYPES.agentInterrupt,
  TYPES.agentHold,
  TYPES.agentUnhold,
  TYPES.agentReplace,
  TYPES.agentFork,
  TYPES.agentCompact,
  TYPES.agentNew,
  TYPES.agentSelect,
  TYPES.agentContext,
]);

const HIGH_RISK_TYPES = new Set([TYPES.agentFork]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function parseJSONDocument(value) {
  if (asObject(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return asObject(JSON.parse(value));
  } catch {
    return null;
  }
}

// actor.describe 的终态 payload 就是 Describe 本身平铺在 status 旁边：
// {status, class, interfaces, capabilities, words}。没有 value 包装，也没有
// actor_id —— 身份是名册的真相，不由 actor 自述。
export function describeValue(payload = {}) {
  const value = asObject(payload);
  if (!value) return null;
  const { status: _status, ...rest } = value;
  return rest.words || rest.class ? rest : null;
}

export function normalizeWordSpec(type, raw = {}) {
  const value = asObject(raw) || {};
  const errors = Array.isArray(value.error_codes) ? value.error_codes.filter((item) => typeof item === 'string') : [];
  return {
    type,
    description: String(value.description || ''),
    inputSchema: parseJSONDocument(value.input_schema),
    outputSchema: parseJSONDocument(value.output_schema),
    errorCodes: errors.map((code) => ({ code, description: '', recovery: '' })),
    examples: Array.isArray(value.examples) ? value.examples : [],
    payloadExample: asObject(Array.isArray(value.examples) ? value.examples[0] : null),
    raw: value,
  };
}

export function normalizeDescribe(raw) {
  const value = asObject(raw);
  if (!value || !asObject(value.words)) return null;
  const types = new Map();
  for (const [type, meta] of Object.entries(value.words)) types.set(type, normalizeWordSpec(type, meta));
  return {
    className: String(value.class || ''),
    interfaces: Array.isArray(value.interfaces) ? value.interfaces.filter((item) => typeof item === 'string') : [],
    capabilities: asObject(value.capabilities) || {},
    types,
    raw: value,
  };
}

function mergeDescribe(current, incoming) {
  if (!current) return incoming;
  return {
    className: incoming.className || current.className,
    interfaces: incoming.interfaces.length ? incoming.interfaces : current.interfaces,
    capabilities: { ...current.capabilities, ...incoming.capabilities },
    // actor.describe 带 type 选择子时只回那一个词，所以按词合并而不是整体替换。
    types: new Map([...current.types, ...incoming.types]),
    raw: incoming.types.size > 1 ? incoming.raw : current.raw,
  };
}

// capability 是活状态读数，不是账本事实：账本里的历史 describe 响应只是
// "当时的自述"，服务重启换过配置后即陈旧。liveRequestIds 非空时只折本连接
// 发出的 describe（现场拉的读数），历史帧恒不当缓存——页面刷新/重连后
// 集合易失清空，活状态自然重新现问。
export function capabilityIndexFromState(state, liveRequestIds = null) {
  const index = new Map();
  const turns = [...(state?.turns?.values?.() || [])].sort((left, right) => left.requestSeq - right.requestSeq);
  for (const turn of turns) {
    if (turn.request?.type !== TYPES.describe) continue;
    if (liveRequestIds && !liveRequestIds.has(turn.requestId)) continue;
    const actorId = turn.request.audience?.[0] || '';
    if (!actorId) continue;
    const current = index.get(actorId) || { actorId, describe: null, loading: false, error: null, requestId: '', seq: 0 };
    current.requestId = turn.requestId;
    current.seq = turn.lastSeq;
    current.loading = !turn.terminal;
    if (turn.terminal?.payload?.status === 'completed') {
      const describe = normalizeDescribe(describeValue(turn.terminal.payload));
      if (describe) current.describe = mergeDescribe(current.describe, describe);
      current.error = describe ? null : { code: 'invalid_describe', detail: 'Actor 返回的能力结构无法识别' };
      current.loading = false;
    } else if (turn.terminal) {
      current.error = {
        code: turn.terminal.payload?.error_code || turn.terminal.payload?.reason || 'describe_failed',
        detail: turn.terminal.payload?.detail || '',
      };
      current.loading = false;
    }
    index.set(actorId, current);
  }
  return index;
}

// 词表声明固定请求接口；provider 的动态效果强弱由 capabilities 单独声明。
// supportsType 只回答“这个词能否请求”，不能替代能力位判断。
export function typeSupportsRequest(meta) {
  return Boolean(meta);
}

export function capabilityRisk(type) {
  if (HIGH_RISK_TYPES.has(type)) return 'high';
  if (type === TYPES.agentInterrupt || type === TYPES.agentSteer) return 'medium';
  return 'normal';
}

export function isAgentControl(type) {
  return CONTROL_TYPES.has(type);
}

export function supportsType(entry, type) {
  return typeSupportsRequest(entry?.describe?.types?.get(type));
}

export function hasCapability(entry, name) {
  return Boolean(entry?.describe?.capabilities?.[name]);
}
