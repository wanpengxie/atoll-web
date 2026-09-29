import { GLOBAL_PREFIX, GLOBAL_REFERENCE_PREFIX, isGlobalName } from './global-keys.js';

// 成员的两层与配置编辑的纯函数一半。
//
// 每个 actor 分两层起来：标准层（能力、连接）先就绪，业务层（class 构造 + Proc）
// 在它之上初始化，报就绪才接活。present 只说"能不能服务"；哪一层没起来、为什么，
// 要看这两层自己的状态。名册（OBS 的 standard/business measure）和
// system.member.list/get 都带着这两层，这里把两种形状读成同一个事实。

export const MEMBER_LAYER_NAMES = Object.freeze({
  standard: '标准层',
  business: '业务层',
});

const LAYER_STATE_LABELS = Object.freeze({
  standard: Object.freeze({ connecting: '连接中', ready: '就绪', unreachable: '不可达' }),
  business: Object.freeze({ initializing: '初始化中', ready: '就绪', stuck: '卡住', retrying: '重试中' }),
});

export function memberLayerLabel(layer, state) {
  return LAYER_STATE_LABELS[layer]?.[state] || String(state || '未知');
}

// member.list / member.get 的形状：{state, reason?, since_ms?}。
export function memberLayer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const state = String(value.state || '').trim();
  if (!state) return undefined;
  const reason = String(value.reason || '').trim();
  const since = Number(value.since_ms ?? value.since ?? 0);
  return Object.freeze({
    state,
    ...(reason ? { reason } : {}),
    ...(Number.isFinite(since) && since > 0 ? { since } : {}),
  });
}

// OBS 名册的形状：measure {name, value:<state>, unknown, reason?, since}。
// unknown（没有证词）不是"没就绪"，是"不知道"——读成 undefined，行保持原样。
export function memberLayerFromMeasure(measure) {
  if (!measure || measure.unknown === true) return undefined;
  if (typeof measure.value !== 'string' || !measure.value) return undefined;
  return memberLayer({ state: measure.value, reason: measure.reason, since_ms: measure.since });
}

// 一个成员此刻为什么不能服务：先看标准层（它没起来，上面什么都起不来），再看
// 业务层。都就绪或都没有证词时返回 null——就绪成员的行和从前一样薄。
export function memberLayerIssue(row) {
  for (const layer of ['standard', 'business']) {
    const value = row?.[layer];
    if (!value?.state || value.state === 'ready') continue;
    const label = memberLayerLabel(layer, value.state);
    const reason = String(value.reason || '');
    return Object.freeze({
      layer,
      layerName: MEMBER_LAYER_NAMES[layer],
      state: value.state,
      label,
      reason,
      ...(value.since ? { since: value.since } : {}),
      // 例："业务层卡住：missing global resource global/deepseek_prod"
      text: `${MEMBER_LAYER_NAMES[layer]}${label}${reason ? `：${reason}` : ''}`,
    });
  }
  return null;
}

// 只有干活的成员（agent / tool）有 class 和配置可改；人、system、peer 没有。
export function isEditableMemberKind(kind) {
  return kind === 'agent' || kind === 'tool';
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function sameJSON(left, right) {
  return canonical(left) === canonical(right);
}

// member.set 的 params 和 member.config.set 的 values 都是 RFC 7396 合并补丁：
// 给出的键覆盖，对象逐层合并，值为 null 的键删掉。编辑器里改完的是整份对象，
// 这里算出从 before 到 after 的最小补丁：
//
// - 两边都是对象的键 → 往下一层比；
// - 值变了 → 给新值；
// - 编辑后删掉的键 → null；
// - 没动的键 → 不发。
//
// 只发变了的键不是省流量：读到的值可能在本地缓存里被脱敏过（redactSensitive），
// 整份回写会把"已隐藏"写回成员。没动的键不发，就不会碰它。
export function mergePatch(before, after) {
  const previous = plainObject(before) ? before : {};
  const next = plainObject(after) ? after : {};
  const patch = {};
  for (const [key, value] of Object.entries(next)) {
    if (!Object.hasOwn(previous, key)) {
      patch[key] = value;
    } else if (plainObject(previous[key]) && plainObject(value)) {
      const inner = mergePatch(previous[key], value);
      if (Object.keys(inner).length) patch[key] = inner;
    } else if (!sameJSON(previous[key], value)) {
      patch[key] = value;
    }
  }
  for (const key of Object.keys(previous)) {
    if (!Object.hasOwn(next, key)) patch[key] = null;
  }
  return patch;
}

// "a.b.c" 和一个值 → {a:{b:{c:值}}}：填一个占位时发的补丁。
export function patchAtPath(path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (!keys.length) throw new TypeError('键路径为空');
  return keys.reduceRight((inner, key) => ({ [key]: inner }), value);
}

// 按 "a.b.c" 读一个嵌套值；读不到是 undefined。
export function valueAtPath(value, path) {
  let current = value;
  for (const key of String(path || '').split('.').filter(Boolean)) {
    if (!plainObject(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

// 合成值里每个键来自哪一层（member.get 的 sources）。
export const MEMBER_SOURCE_LABELS = Object.freeze({
  default: 'Class 默认值',
  actor: 'Actor 描述',
  member: '成员条目',
  config: '这一台的配置',
});

export function memberSourceRows(detail) {
  const sources = plainObject(detail?.sources) ? detail.sources : {};
  return Object.keys(sources).sort().map((path) => Object.freeze({
    path,
    layer: sources[path],
    label: MEMBER_SOURCE_LABELS[sources[path]] || sources[path],
    value: valueAtPath(detail?.effective, path),
  }));
}

// 本地缓存会把名叫 key、token、secret 之类的字段替换成"已隐藏"。这样的值绝不能
// 被当成配置写回成员。
export const REDACTED_PLACEHOLDER = '已隐藏';

export function hasRedactedValue(value) {
  if (value === REDACTED_PLACEHOLDER) return true;
  if (Array.isArray(value)) return value.some(hasRedactedValue);
  if (plainObject(value)) return Object.values(value).some(hasRedactedValue);
  return false;
}

export function parseMemberConfigText(text) {
  let value;
  try {
    value = JSON.parse(String(text ?? '').trim() || '{}');
  } catch (error) {
    throw new TypeError(`配置 JSON 格式无效：${error?.message || error}`);
  }
  if (!plainObject(value)) throw new TypeError('配置必须是 JSON 对象');
  return value;
}

// 配置里写 "$global.<name>" 是**引用**，不是值：成员起来时由标准层按名字从全局
// key 里取。这里只收集它引用了哪些名字，好告诉编辑的人哪一个还不存在。
export function globalReferenceNames(value, found = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith(GLOBAL_REFERENCE_PREFIX)) {
      const name = value.slice(GLOBAL_REFERENCE_PREFIX.length);
      if (isGlobalName(name)) found.add(name);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) globalReferenceNames(item, found);
  } else if (plainObject(value)) {
    for (const item of Object.values(value)) globalReferenceNames(item, found);
  }
  return found;
}

export function missingGlobalReferences(config, existingNames = []) {
  const existing = new Set(existingNames);
  return [...globalReferenceNames(config)].filter((name) => !existing.has(name)).sort()
    .map((name) => `${GLOBAL_PREFIX}${name}`);
}

// 在光标处插入一个 JSON 字符串字面量 "$global.<name>"。插入的是完整的 JSON 值，
// 编辑的人把它放到某个键后面即可，不需要自己记引号和前缀怎么拼。
export function insertGlobalReference(text, selectionStart, selectionEnd, name) {
  if (!isGlobalName(name)) throw new TypeError('全局 key 名称无效');
  const source = String(text ?? '');
  const start = Number.isSafeInteger(selectionStart) ? Math.max(0, Math.min(selectionStart, source.length)) : source.length;
  const end = Number.isSafeInteger(selectionEnd) ? Math.max(start, Math.min(selectionEnd, source.length)) : start;
  const literal = JSON.stringify(`${GLOBAL_REFERENCE_PREFIX}${name}`);
  return Object.freeze({
    text: `${source.slice(0, start)}${literal}${source.slice(end)}`,
    cursor: start + literal.length,
  });
}

// 成员条目的 body 说成员是从什么造出来的：一个 Actor 描述（名字@版本）或一个 Class。
export function memberBodyLabel(body) {
  if (!plainObject(body)) return '';
  if (body.actor) return `Actor 描述 ${body.actor}`;
  if (body.class) return `Class ${body.class}`;
  return '';
}

// 占位（"$required[:说明]"）还没填的键：member.get 的 missing，[{key, hint}]。
export function missingPlaceholders(detail) {
  return (Array.isArray(detail?.missing) ? detail.missing : [])
    .filter((row) => row && typeof row.key === 'string' && row.key)
    .map((row) => Object.freeze({ key: row.key, hint: String(row.hint || '') }));
}
