import { SYSTEM_ACTOR_ID, TYPES } from '../../protocol/vocab.js';

const SENDABLE_KINDS = new Set(['agent', 'human']);
const RETRYABLE_STATES = new Set(['rejected', 'uncertain']);
const AGENT_COMMAND_PREFIX = 'agent.';
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9._-]*$/u;
const DELIVERY_SOURCE_LABELS = Object.freeze({
  reply: '回复',
  mention: '由 @ 指定',
  filter: '默认 · 跟随筛选',
  manual: '默认 · 手选',
  recent: '默认 · 最近交互',
  only: '默认 · 频道唯一 Agent',
});
export const COMPOSER_SLASH_COMMANDS = Object.freeze([
  Object.freeze({ command: 'compact', type: TYPES.agentCompact, scope: 'agent', label: '压缩上下文', description: '保留当前对话，压缩较早的上下文', usage: '/compact', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'new', type: TYPES.agentNew, scope: 'agent', label: '新建对话', description: '保留当前 Agent，换成一段全新会话', usage: '/new', minArgs: 0, maxArgs: 0 }),
  // Restart belongs to the channel system actor: a wedged Agent must not be
  // asked to restart itself. The selected Agent is carried in payload.member.
  Object.freeze({ command: 'restart', type: TYPES.member.restart, scope: 'system-target', label: '重启 Agent', description: '给卡住的 Agent 换一届任期；账本与文件不动', usage: '/restart', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'model', type: TYPES.agentSelect, scope: 'agent', menu: false, label: '切换模型', description: '设置目标 Agent 的模型与推理强度', usage: '/model [model] [effort]', minArgs: 0, maxArgs: 2 }),
  Object.freeze({ command: 'fork', type: TYPES.agentFork, scope: 'agent', menu: false, label: '分叉对话', description: '从当前上下文分叉', usage: '/fork', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'context', type: TYPES.agentContext, scope: 'agent', menu: false, label: '查看上下文', description: '请求目标 Agent 的上下文状态', usage: '/context', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'status', type: TYPES.describe, scope: 'agent', menu: false, label: '查看状态', description: '读取目标 Agent 的当前状态', usage: '/status', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'introduce', type: TYPES.member.create, scope: 'system', menu: false, label: '创建成员', description: '按声明在当前频道创建成员', usage: '/introduce <decl_id>', minArgs: 1, maxArgs: 1 }),
  Object.freeze({ command: 'admit', type: TYPES.member.admit, scope: 'system', menu: false, label: '准入用户', description: '将 principal 准入当前频道', usage: '/admit <principal>', minArgs: 1, maxArgs: 1 }),
  Object.freeze({ command: 'members', type: TYPES.member.list, scope: 'system', menu: false, label: '成员列表', description: '查看当前频道成员', usage: '/members', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'channels', type: TYPES.channel.list, scope: 'system', menu: false, label: '频道列表', description: '查看子频道', usage: '/channels [parent_id]', minArgs: 0, maxArgs: 1 }),
]);
const SLASH_COMMAND_BY_NAME = new Map(COMPOSER_SLASH_COMMANDS.map((row) => [row.command, row]));

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPlainObject(value) {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
// This is deliberately a small allowlist for the command port, not a general
// JSON Schema interpreter. Unknown keywords and untyped branches fail closed.
const SCHEMA_KEYS = new Set([
  'type', 'oneOf', 'anyOf', 'allOf', 'enum', 'const',
  'properties', 'required', 'additionalProperties', 'items',
  'minLength', 'maxLength', 'minimum', 'maximum',
  'title', 'description',
]);

function allowedKindsOf(word) {
  if (!word || typeof word !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(word, 'allowedKinds')) return word.allowedKinds;
  const raw = word.raw;
  if (!raw || typeof raw !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(raw, 'allowedKinds')) return raw.allowedKinds;
  if (Object.prototype.hasOwnProperty.call(raw, 'allowed_kinds')) return raw.allowed_kinds;
  return undefined;
}

function requestAllowed(word) {
  const kinds = allowedKindsOf(word);
  // The canonical actor.describe `words` map contains request words by
  // default. An explicit malformed or non-request declaration fails closed.
  if (kinds === undefined) return true;
  if (!Array.isArray(kinds)) return false;
  return kinds.includes('request');
}

function inputSchemaOf(word) {
  const schema = word?.inputSchema;
  return validateSchemaDefinition(schema, 'inputSchema', { root: true }) ? null : schema;
}

function dynamicCommandName(type) {
  if (typeof type !== 'string' || !type.startsWith(AGENT_COMMAND_PREFIX)) return '';
  const command = type.slice(AGENT_COMMAND_PREFIX.length);
  return COMMAND_NAME_PATTERN.test(command) ? command : '';
}

function dynamicSlashCommands(capability) {
  const types = capability?.describe?.types;
  if (typeof types?.entries !== 'function') return [];
  const rows = [];
  for (const [type, word] of types.entries()) {
    const command = dynamicCommandName(type);
    const schema = inputSchemaOf(word);
    if (!command || !schema || !requestAllowed(word) || SLASH_COMMAND_BY_NAME.has(command)) continue;
    const description = text(word?.description);
    rows.push(Object.freeze({
      command,
      type,
      scope: 'agent',
      label: description || command,
      description: description || `向目标 Agent 发送 ${type}`,
      usage: `/${command} <JSON payload>`,
      minArgs: 0,
      maxArgs: 0,
      dynamic: true,
      inputSchema: schema,
    }));
  }
  return rows.sort((left, right) => left.command.localeCompare(right.command));
}

function commandRegistry(capability) {
  return Object.freeze([...COMPOSER_SLASH_COMMANDS, ...dynamicSlashCommands(capability)]);
}

function schemaError(detail) {
  return { code: 'composer_command_payload_invalid', detail };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isJSONValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((entry) => isJSONValue(entry, seen));
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((entry) => isJSONValue(entry, seen));
}

function validateSchemaDefinition(schema, path = 'inputSchema', { root = false, seen = new Set() } = {}) {
  if (!isPlainObject(schema)) return schemaError(`${path} 必须是 plain object`);
  if (seen.has(schema)) return schemaError(`${path} 不能包含循环 schema`);
  const nestedSeen = new Set(seen);
  nestedSeen.add(schema);
  const unknownKey = Object.keys(schema).find((key) => !SCHEMA_KEYS.has(key));
  if (unknownKey) return schemaError(`${path}.${unknownKey} 不是支持的 schema 字段`);

  const type = schema.type;
  if (typeof type !== 'string' || !SCHEMA_TYPES.has(type)) {
    return schemaError(`${path}.type 必须是受支持的 primitive/object/array 类型`);
  }
  if (root && type !== 'object') return schemaError(`${path}.type 必须为 object`);

  for (const combinator of ['oneOf', 'anyOf', 'allOf']) {
    if (!hasOwn(schema, combinator)) continue;
    const branches = schema[combinator];
    if (!Array.isArray(branches) || !branches.length) return schemaError(`${path}.${combinator} 必须是非空 schema 数组`);
    for (let index = 0; index < branches.length; index += 1) {
      const failure = validateSchemaDefinition(branches[index], `${path}.${combinator}[${index}]`, { seen: nestedSeen });
      if (failure) return failure;
    }
  }
  if (hasOwn(schema, 'enum')) {
    if (!Array.isArray(schema.enum) || !schema.enum.length || !schema.enum.every((entry) => isJSONValue(entry))) {
      return schemaError(`${path}.enum 必须是非空 JSON 值数组`);
    }
  }
  if (hasOwn(schema, 'const') && !isJSONValue(schema.const)) return schemaError(`${path}.const 必须是 JSON 值`);
  for (const key of ['title', 'description']) {
    if (hasOwn(schema, key) && typeof schema[key] !== 'string') return schemaError(`${path}.${key} 必须是字符串`);
  }
  if (type === 'object') {
    if (hasOwn(schema, 'required')) {
      if (!Array.isArray(schema.required)) return schemaError(`${path}.required 必须是字符串数组`);
      const required = new Set();
      for (const key of schema.required) {
        if (typeof key !== 'string' || required.has(key)) return schemaError(`${path}.required 必须是无重复字符串数组`);
        required.add(key);
      }
    }
    if (hasOwn(schema, 'properties')) {
      if (!isPlainObject(schema.properties)) return schemaError(`${path}.properties 必须是 plain object`);
      for (const [key, child] of Object.entries(schema.properties)) {
        const failure = validateSchemaDefinition(child, `${path}.properties.${key}`, { seen: nestedSeen });
        if (failure) return failure;
      }
    }
    if (hasOwn(schema, 'additionalProperties') && schema.additionalProperties !== false) {
      return schemaError(`${path}.additionalProperties 仅支持 false`);
    }
  } else {
    if (hasOwn(schema, 'properties') || hasOwn(schema, 'required') || hasOwn(schema, 'additionalProperties')) {
      return schemaError(`${path} 的 object 字段与 type 不匹配`);
    }
  }

  if (type === 'array') {
    if (!hasOwn(schema, 'items')) return schemaError(`${path}.items 必须声明受支持的子 schema`);
    const failure = validateSchemaDefinition(schema.items, `${path}.items`, { seen: nestedSeen });
    if (failure) return failure;
  } else if (hasOwn(schema, 'items')) {
    return schemaError(`${path}.items 仅支持 array schema`);
  }

  if (type === 'string') {
    if (hasOwn(schema, 'minLength') && (!Number.isSafeInteger(schema.minLength) || schema.minLength < 0)) {
      return schemaError(`${path}.minLength 必须是非负整数`);
    }
    if (hasOwn(schema, 'maxLength') && (!Number.isSafeInteger(schema.maxLength) || schema.maxLength < 0)) {
      return schemaError(`${path}.maxLength 必须是非负整数`);
    }
    if (schema.minLength > schema.maxLength) return schemaError(`${path}.minLength 不能大于 maxLength`);
  } else if (hasOwn(schema, 'minLength') || hasOwn(schema, 'maxLength')) {
    return schemaError(`${path}.minLength/maxLength 仅支持 string schema`);
  }

  if (type === 'number' || type === 'integer') {
    if (hasOwn(schema, 'minimum') && (typeof schema.minimum !== 'number' || !Number.isFinite(schema.minimum))) {
      return schemaError(`${path}.minimum 必须是有限数字`);
    }
    if (hasOwn(schema, 'maximum') && (typeof schema.maximum !== 'number' || !Number.isFinite(schema.maximum))) {
      return schemaError(`${path}.maximum 必须是有限数字`);
    }
    if (schema.minimum > schema.maximum) return schemaError(`${path}.minimum 不能大于 maximum`);
  } else if (hasOwn(schema, 'minimum') || hasOwn(schema, 'maximum')) {
    return schemaError(`${path}.minimum/maximum 仅支持 number/integer schema`);
  }

  return null;
}

function sameJSON(left, right) {
  if (Object.is(left, right)) return true;
  if (!isRecord(left) && !Array.isArray(left)) return false;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function validateSchemaValue(value, schema, path = 'payload') {
  if (!isPlainObject(schema)) return schemaError(`${path} 缺少有效 inputSchema`);
  if (Array.isArray(schema.oneOf) && !schema.oneOf.some((branch) => !validateSchemaValue(value, branch, path))) {
    return schemaError(`${path} 不匹配 inputSchema.oneOf`);
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => !validateSchemaValue(value, branch, path))) {
    return schemaError(`${path} 不匹配 inputSchema.anyOf`);
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      const failure = validateSchemaValue(value, branch, path);
      if (failure) return failure;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => sameJSON(candidate, value))) {
    return schemaError(`${path} 不在 inputSchema.enum 中`);
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !sameJSON(schema.const, value)) {
    return schemaError(`${path} 不符合 inputSchema.const`);
  }

  const type = typeof schema.type === 'string' ? schema.type : '';
  if (type === 'object') {
    if (!isPlainObject(value)) return schemaError(`${path} 必须是对象`);
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(value, key)) {
          return schemaError(`${path}.${String(key)} 是必填字段`);
        }
      }
    } else if (Object.prototype.hasOwnProperty.call(schema, 'required')) {
      return schemaError(`${path}.required 不是有效字段列表`);
    }
    const properties = schema.properties === undefined ? {} : schema.properties;
    if (!isPlainObject(properties)) return schemaError(`${path}.properties 不是有效对象`);
    for (const [key, childSchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const failure = validateSchemaValue(value[key], childSchema, `${path}.${key}`);
      if (failure) return failure;
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(properties));
      const extra = Object.keys(value).find((key) => !known.has(key));
      if (extra) return schemaError(`${path}.${extra} 不是 inputSchema 声明字段`);
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) return schemaError(`${path} 必须是数组`);
    if (schema.items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        const failure = validateSchemaValue(value[index], schema.items, `${path}[${index}]`);
        if (failure) return failure;
      }
    }
  } else if (type === 'string') {
    if (typeof value !== 'string') return schemaError(`${path} 必须是字符串`);
  } else if (type === 'integer') {
    if (!Number.isSafeInteger(value)) return schemaError(`${path} 必须是整数`);
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return schemaError(`${path} 必须是数字`);
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') return schemaError(`${path} 必须是布尔值`);
  } else if (type === 'null') {
    if (value !== null) return schemaError(`${path} 必须为 null`);
  } else if (type && !['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'].includes(type)) {
    return schemaError(`${path} 使用了不支持的 inputSchema 类型 ${type}`);
  }
  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) return schemaError(`${path} 短于 inputSchema.minLength`);
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) return schemaError(`${path} 长于 inputSchema.maxLength`);
  }
  if (typeof value === 'number') {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) return schemaError(`${path} 小于 inputSchema.minimum`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) return schemaError(`${path} 大于 inputSchema.maximum`);
  }
  return null;
}

function validateCommandPayload(definition, payload) {
  if (!definition?.dynamic) return null;
  const schemaFailure = validateSchemaDefinition(definition.inputSchema, 'inputSchema', { root: true });
  if (schemaFailure) return schemaFailure;
  if (!isPlainObject(payload)) return schemaError('命令 payload 必须是对象');
  return validateSchemaValue(payload, definition.inputSchema);
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function editorDocument(value = '') {
  return {
    type: 'doc',
    content: text(value).split('\n').map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}

function actorName(actor) {
  return text(actor?.name) || text(actor?.label) || text(actor?.id) || '未知成员';
}

function commandError(message, code) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

// A leading slash is never silently downgraded to an ordinary message.
// `//literal` is the explicit escape and is sent as `/literal`.
export function parseComposerCommand(value, definitions = COMPOSER_SLASH_COMMANDS) {
  const source = text(value).trim();
  if (!source.startsWith('/')) return null;
  if (source.startsWith('//')) return Object.freeze({ kind: 'escaped', text: source.slice(1) });
  const [verb, ...args] = source.split(/\s+/u);
  const command = verb.slice(1);
  const definition = new Map(definitions.map((row) => [row.command, row])).get(command);
  if (!definition) {
    throw commandError(`未知命令 ${verb || '/'}；普通正文以 / 开头时请写成 /${source}`, 'composer_command_unknown');
  }
  if (definition.dynamic) {
    const schemaFailure = validateSchemaDefinition(definition.inputSchema, 'inputSchema', { root: true });
    if (schemaFailure) throw commandError(schemaFailure.detail, schemaFailure.code);
    const payloadText = source.slice(verb.length).trim();
    let payload = {};
    if (payloadText) {
      try {
        payload = JSON.parse(payloadText);
      } catch {
        throw commandError(`命令 /${command} 的 payload 必须是 JSON 对象`, 'composer_command_payload_invalid');
      }
    }
    if (!isPlainObject(payload)) throw commandError(`命令 /${command} 的 payload 必须是 JSON 对象`, 'composer_command_payload_invalid');
    return Object.freeze({ kind: 'command', ...definition, payload: Object.freeze(payload) });
  }
  if (args.length < definition.minArgs || args.length > definition.maxArgs) {
    throw commandError(`用法：${definition.usage}`, 'composer_command_usage');
  }
  let payload = {};
  if (command === 'model') payload = { ...(args[0] ? { model: args[0] } : {}), ...(args[1] ? { effort: args[1] } : {}) };
  else if (command === 'introduce') payload = { decl_id: args[0] };
  else if (command === 'admit') payload = { principal: args[0] };
  else if (command === 'channels' && args[0]) payload = { parent_id: args[0] };
  return Object.freeze({ kind: 'command', ...definition, payload: Object.freeze(payload) });
}

function uniqueRows(rows, keyOf) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyOf(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeComposerDraft(value) {
  const draft = value && typeof value === 'object' ? value : {};
  return Object.freeze({
    ...draft,
    text: text(draft.text),
    doc: draft.doc || null,
    recipients: Object.freeze(Array.isArray(draft.recipients) ? [...draft.recipients] : []),
    attachments: Object.freeze(Array.isArray(draft.attachments) ? [...draft.attachments] : []),
    replyTarget: draft.replyTarget || null,
    editorRevision: Math.max(0, Number(draft.editorRevision) || 0),
  });
}

function recipientIdentity(recipient) {
  return typeof recipient === 'string' ? recipient : text(recipient?.id);
}

function deliverySourceLabel(source) {
  return DELIVERY_SOURCE_LABELS[text(source)] || '';
}

function lostDeliveryLabel(rows, fallback = '收件人') {
  const names = rows.map((row) => `@${actorName(row)}`).join('、') || fallback;
  return `${names} 已不在频道，当前不可投递`;
}

// The current Workspace owner only supplies selectedAgentId. Preserve an
// explicitly supplied fallback source when a future owner has one, but do not
// infer filter/manual provenance from the same id: both routes intentionally
// converge on the same Composer command.
function selectedAgentSource(agentSelection, soleFallback) {
  const source = text(agentSelection?.fallbackSource)
    || text(agentSelection?.source)
    || text(agentSelection?.target?.source)
    || text(agentSelection?.view?.source);
  return deliverySourceLabel(source) ? source : soleFallback ? 'only' : '';
}

export function resolveMentionRows(recipients, roster) {
  const rosterByID = new Map((roster || []).map((actor) => [actor.id, actor]));
  return Object.freeze(uniqueRows((recipients || []).flatMap((recipient) => {
    const id = recipientIdentity(recipient);
    if (!id) return [];
    const actor = rosterByID.get(id);
    if (actor) return [{ ...actor, missing: false, label: actorName(actor) }];
    return [{
      id,
      kind: text(recipient?.kind),
      name: text(recipient?.name) || text(recipient?.label) || id,
      label: text(recipient?.name) || text(recipient?.label) || id,
      missing: true,
    }];
  }), (row) => row.id));
}

function selectedAgentID(agentSelection) {
  const target = agentSelection?.target;
  if (target?.kind === 'single' && target.agent?.id) return target.agent.id;
  return text(agentSelection?.agentId)
    || text(agentSelection?.selectedAgentId)
    || text(agentSelection?.actorId)
    || text(agentSelection?.view?.actorId);
}

// The Composer has one target-selection contract.  `manualAgentId` and
// `recentAgentId` are the two facts the probe owner can observe; the optional
// selected id is the already-materialized projection supplied by the shell.
// Keeping the order here means the hook cannot drift from the pure Composer
// projection when a roster changes or a channel is replaced.
export function resolveComposerAgentSelection({
  roster = [],
  manualAgentId = '',
  recentAgentId = '',
  selectedAgentId = '',
  selectedSource = '',
} = {}) {
  const agents = (roster || []).filter((actor) => actor?.kind === 'agent' && actor.id);
  const byId = new Map(agents.map((actor) => [actor.id, actor]));
  const manual = byId.get(text(manualAgentId));
  if (manual) return Object.freeze({ actorId: manual.id, agent: manual, source: 'manual' });
  const recent = byId.get(text(recentAgentId));
  if (recent) return Object.freeze({ actorId: recent.id, agent: recent, source: 'recent' });
  const selected = byId.get(text(selectedAgentId));
  if (selected) {
    return Object.freeze({
      actorId: selected.id,
      agent: selected,
      source: text(selectedSource) || (agents.length === 1 ? 'only' : 'selected'),
    });
  }
  if (agents.length === 1) return Object.freeze({ actorId: agents[0].id, agent: agents[0], source: 'only' });
  return Object.freeze({ actorId: '', agent: null, source: '' });
}

export function resolveComposerDelivery({ draft, roster, agentSelection }) {
  const normalized = normalizeComposerDraft(draft);
  const rosterByID = new Map((roster || []).map((actor) => [actor.id, actor]));
  const mentions = resolveMentionRows(normalized.recipients, roster);
  const reply = normalized.replyTarget;

  if (reply) {
    const id = text(reply.senderId) || text(reply.actorId);
    const actor = rosterByID.get(id);
    if (!actor) {
      return Object.freeze({
        kind: 'lost',
        source: 'reply',
        rows: Object.freeze([]),
        missing: Object.freeze([]),
        sourceLabel: deliverySourceLabel('reply'),
        label: lostDeliveryLabel([{ name: text(reply.senderName) || id || '原发送者' }]),
      });
    }
    return Object.freeze({ kind: 'direct', source: 'reply', rows: Object.freeze([actor]), missing: Object.freeze([]), sourceLabel: deliverySourceLabel('reply'), label: `回复 @${actorName(actor)}` });
  }

  if (mentions.length) {
    const missing = mentions.filter((row) => row.missing);
    return Object.freeze({
      kind: missing.length ? 'lost' : 'direct',
      source: 'mention',
      rows: mentions,
      missing: Object.freeze(missing),
      sourceLabel: deliverySourceLabel('mention'),
      label: missing.length
        ? lostDeliveryLabel(missing)
        : mentions.map((row) => `@${actorName(row)}`).join('、'),
    });
  }

  const selectedID = selectedAgentID(agentSelection);
  const selected = selectedID ? rosterByID.get(selectedID) : null;
  if (selected?.kind === 'agent') {
    const source = selectedAgentSource(agentSelection, false);
    return Object.freeze({ kind: 'direct', source: 'agent-selection', sourceKey: source, rows: Object.freeze([selected]), missing: Object.freeze([]), sourceLabel: deliverySourceLabel(source), label: `@${actorName(selected)}` });
  }
  return Object.freeze({ kind: 'none', source: '', rows: Object.freeze([]), missing: Object.freeze([]), sourceLabel: '', label: '请选择收件人' });
}

export function composerPermissions(access) {
  if (access && typeof access === 'object') {
    const writable = access.relationship === 'member'
      && access.existence !== 'retired'
      && access.unavailable !== true
      && access.runtime !== 'closed';
    const canEditDraft = access.canEditDraft ?? access.canWrite ?? writable;
    const canDurablyAccept = access.canDurablyAccept ?? canEditDraft;
    const canTransmit = access.canTransmit ?? (canDurablyAccept && access.transportOpen !== false);
    return Object.freeze({
      canEditDraft: Boolean(canEditDraft),
      canDurablyAccept: Boolean(canDurablyAccept),
      canTransmit: Boolean(canTransmit),
      reason: text(access.reason) || (canEditDraft ? '' : '当前频道不可写'),
    });
  }
  const writable = access === 'member_active' || access === 'member';
  return Object.freeze({
    canEditDraft: writable,
    canDurablyAccept: writable,
    canTransmit: writable,
    reason: writable ? '' : '当前频道不可写',
  });
}

function pendingForChannel(pending, channelId) {
  return (pending || []).filter((row) => !row?.channelId || row.channelId === channelId);
}

export function mentionRowsFor(query, candidates) {
  const needle = String(query || '').toLocaleLowerCase();
  const rows = (candidates || []).filter((actor) => {
    const haystack = `${actorName(actor)} ${actor.id}`.toLocaleLowerCase();
    return !needle || haystack.includes(needle);
  });
  return Object.freeze(rows.slice(0, 8));
}

export function mentionQuery(value, candidates) {
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(value);
  if (!match) return null;
  const at = match.index + match[0].lastIndexOf('@');
  return Object.freeze({
    query: match[1], start: at, end: value.length, rows: mentionRowsFor(match[1], candidates),
  });
}

function controlAvailability(capability, type, targetAgent, permissions) {
  if (!targetAgent) return Object.freeze({ state: 'no-target', enabled: false, reason: '请先选择目标 Agent' });
  if (!permissions.canTransmit) return Object.freeze({ state: 'offline', enabled: false, reason: '连接可用后才能发送控制命令' });
  if (capability?.error) {
    return Object.freeze({ state: 'unavailable', enabled: false, reason: 'Agent 能力读取失败' });
  }
  if (!capability?.describe) {
    // Reading a manifest is itself a request on the ledger, so nothing here
    // asks for one. An unread manifest is not a refusal: offer the control and
    // let the receiver answer for its own words.
    return Object.freeze({ state: 'unknown', enabled: true, reason: '' });
  }
  if (!capability.describe.types?.has?.(type)) {
    return Object.freeze({ state: 'unsupported', enabled: false, reason: `Agent 不支持 ${type}` });
  }
  return Object.freeze({ state: 'supported', enabled: true, reason: '' });
}

function commandAvailability(definition, capability, targetAgent, permissions) {
  if (!permissions.canTransmit) return Object.freeze({ state: 'offline', enabled: false, reason: '连接可用后才能发送命令' });
  if (definition.scope === 'system') return Object.freeze({ state: 'supported', enabled: true, reason: '' });
  if (!targetAgent) return Object.freeze({ state: 'no-target', enabled: false, reason: '请先选择目标 Agent' });
  if (definition.scope === 'system-target') return Object.freeze({ state: 'supported', enabled: true, reason: '' });
  const word = capability?.describe?.types?.get?.(definition.type);
  if (word && !requestAllowed(word)) {
    return Object.freeze({ state: 'unsupported', enabled: false, reason: `Agent 不支持请求 ${definition.type}` });
  }
  return controlAvailability(capability, definition.type, targetAgent, permissions);
}

export function commandRowsFor(query, controls, definitions) {
  const needle = String(query || '').toLocaleLowerCase();
  const matching = (definitions || []).filter((row) => row.menu !== false && (
    `${row.command} ${row.label}`.toLocaleLowerCase().includes(needle)
  ));
  const rows = matching.filter((row) => controls[row.command]?.enabled).map((row) => Object.freeze({
    ...row,
    availability: controls[row.command],
  }));
  const unavailable = matching.find((row) => controls[row.command]?.reason);
  return Object.freeze({
    rows: Object.freeze(rows),
    reason: rows.length ? '' : controls[unavailable?.command]?.reason || controls.restart?.reason || '没有匹配的命令',
  });
}

export function slashCommandMenu(value, controls, definitions) {
  const match = /^\/([^\s/]*)$/u.exec(text(value));
  if (!match) return null;
  return Object.freeze({ query: match[1], ...commandRowsFor(match[1], controls, definitions) });
}

export function buildComposerModel({
  activeChannelId = '',
  draft,
  pending = [],
  roster = [],
  selfId = '',
  access,
  agentSelection = null,
  capabilityIndex = new Map(),
  attachments,
  edit = null,
  editText,
  accepting = false,
} = {}) {
  const baseDraft = normalizeComposerDraft({
    ...draft,
    attachments: attachments ?? draft?.attachments,
  });
  const editSession = edit?.session || edit || null;
  const normalizedDraft = editSession ? normalizeComposerDraft({
    ...baseDraft,
    text: editText ?? editSession.text ?? '',
    // The ordinary draft's ProseMirror document is not the edit session's
    // document.  Keeping it here would make Composer's EditorView effect
    // write the ordinary draft back immediately after entering edit mode.
    doc: editorDocument(editText ?? editSession.text ?? ''),
    attachments: editSession.attachments || [],
  }) : baseDraft;
  const permissions = composerPermissions(access);
  const channelPending = pendingForChannel(pending, activeChannelId);
  const failures = channelPending.filter((row) => RETRYABLE_STATES.has(row?.state));
  const mentionCandidates = (roster || []).filter((actor) => (
    actor?.id && actor.id !== selfId && SENDABLE_KINDS.has(actor.kind)
  ));
  const activeMention = mentionQuery(normalizedDraft.text, mentionCandidates);
  const agents = (roster || []).filter((actor) => actor?.kind === 'agent');
  const selectedID = selectedAgentID(agentSelection);
  const selection = resolveComposerAgentSelection({
    roster,
    selectedAgentId: selectedID,
    selectedSource: selectedAgentSource(agentSelection, false),
  });
  const selectedAgent = selection.agent;
  const delivery = resolveComposerDelivery({
    draft: normalizedDraft,
    roster,
    agentSelection: selectedAgent
      ? {
        ...agentSelection,
        selectedAgentId: selectedAgent.id,
        ...(selection.source === 'only' ? { fallbackSource: 'only' } : {}),
      }
      : agentSelection,
  });
  const deliveryAgents = delivery.rows.filter((actor) => actor.kind === 'agent');
  const targetAgent = deliveryAgents.length === 1 ? deliveryAgents[0] : delivery.rows.length ? null : selectedAgent;
  const parameterView = agentSelection?.view?.actorId && agentSelection.view.actorId !== targetAgent?.id
    ? null
    : agentSelection?.view || null;
  const parameterPending = agentSelection?.pending?.actorId && agentSelection.pending.actorId !== targetAgent?.id
    ? null
    : agentSelection?.pending || null;
  const editOwner = edit || normalizedDraft.edit || null;
  const targetCapability = targetAgent ? capabilityIndex.get(targetAgent.id) : null;
  const commandDefinitions = commandRegistry(targetCapability);
  const commandControls = Object.freeze(Object.fromEntries(commandDefinitions.map((definition) => [
    definition.command,
    commandAvailability(definition, targetCapability, targetAgent, permissions),
  ])));
  const controls = Object.freeze({
    actorId: targetAgent?.id || '',
    steer: controlAvailability(targetCapability, TYPES.agentSteer, targetAgent, permissions),
    interrupt: controlAvailability(targetCapability, TYPES.agentInterrupt, targetAgent, permissions),
    commands: commandControls,
  });
  const hasBody = Boolean(normalizedDraft.text.trim() || normalizedDraft.attachments.length);
  const commandLike = normalizedDraft.text.trim().startsWith('/') && !normalizedDraft.text.trim().startsWith('//');
  const canSubmit = editOwner
    ? Boolean(normalizedDraft.text.trim() && permissions.canTransmit && (!editSession?.phase || editSession.phase === 'editing'))
    : commandLike
      ? Boolean(hasBody && permissions.canEditDraft)
      : Boolean(hasBody && permissions.canDurablyAccept && delivery.kind === 'direct');

  return Object.freeze({
    channelId: activeChannelId,
    draft: normalizedDraft,
    delivery,
    roster: Object.freeze([...(roster || [])]),
    selfId,
    mentionCandidates: Object.freeze(mentionCandidates),
    mentionQuery: activeMention,
    agents: Object.freeze(agents),
    selectedAgent,
    targetAgent,
    agentSelection,
    parameters: parameterView,
    parameterPending,
    controls,
    commandDefinitions,
    commandMenu: editOwner ? null : slashCommandMenu(normalizedDraft.text, commandControls, commandDefinitions),
    pending: Object.freeze(channelPending),
    failures: Object.freeze(failures),
    failure: failures.at(-1) || null,
    edit: editOwner,
    editSession,
    permissions,
    canSubmit,
    busy: Boolean(accepting || (editSession?.phase
      && editSession.phase !== 'editing'
      && !editSession.error)),
  });
}

function ensureSendableDelivery(delivery) {
  if (delivery.kind === 'lost') throw new TypeError(delivery.label || '收件人已不在频道');
  if (delivery.kind !== 'direct' || !delivery.rows.length) throw new TypeError('请选择收件人或目标 Agent');
  const invalid = delivery.rows.find((row) => !SENDABLE_KINDS.has(row.kind));
  if (invalid) throw new TypeError(`@${actorName(invalid)} 不能作为消息收件人`);
}

export function createMessageRequest(model, persistedDraft) {
  ensureSendableDelivery(model.delivery);
  if (!model.draft.text.trim() && !model.draft.attachments.length) throw new TypeError('消息内容不能为空');
  const slash = parseComposerCommand(model.draft.text, model.commandDefinitions);
  if (slash?.kind === 'command') {
    throw commandError(`命令 /${slash.command} 必须通过命令端口发送`, 'composer_command_route_required');
  }
  const body = slash?.kind === 'escaped'
    ? slash.text
    : model.draft.text.trim() || `发送 ${model.draft.attachments.length} 个附件`;
  const parentId = text(model.draft.replyTarget?.sourceId);
  const batch = model.delivery.rows.map((actor) => ({
    channelId: model.channelId,
    text: body,
    msgType: actor.kind === 'human' ? TYPES.humanMessage : TYPES.agentAsk,
    audience: [actor.id],
    targetLabel: actorName(actor),
    payload: model.draft.attachments.length
      ? { text: body, attachments: model.draft.attachments }
      : undefined,
    ...(parentId ? { parentId } : {}),
  }));
  return Object.freeze({
    channelId: model.channelId,
    batch,
    draftRevision: Number(persistedDraft?.revision ?? model.draft.revision ?? 0),
    editorRevision: model.draft.editorRevision,
  });
}

export function createComposerCommandRequest(model, parsed) {
  const definitions = model?.commandDefinitions || COMPOSER_SLASH_COMMANDS;
  const command = parsed === undefined
    ? parseComposerCommand(model?.draft?.text, definitions)
    : parsed;
  if (!command || command.kind !== 'command') throw commandError('没有可执行的 Composer 命令', 'composer_command_missing');
  const definition = definitions.find((row) => row.command === command?.command);
  if (!definition || command.type !== definition.type || command.scope !== definition.scope) {
    throw commandError(`命令 /${command?.command || ''} 当前未被目标 Agent 声明`, 'composer_command_unknown');
  }
  if (model.draft.replyTarget) throw commandError('回复模式下不能使用斜杠命令，请先取消回复', 'composer_command_reply');
  if (model.draft.attachments.length) throw commandError('斜杠命令不能携带附件，请先移除附件', 'composer_command_attachments');
  const payloadFailure = validateCommandPayload(definition, command.payload);
  if (payloadFailure) throw commandError(payloadFailure.detail, payloadFailure.code);
  const availability = model.controls.commands?.[command.command];
  if (!availability?.enabled) {
    throw commandError(availability?.reason || `命令 /${command.command} 当前不可用`, `composer_command_${availability?.state || 'unavailable'}`);
  }
  if (command.scope === 'system' || command.scope === 'system-target') {
    return Object.freeze({
      channelId: model.channelId,
      text: '',
      msgType: command.type,
      audience: [SYSTEM_ACTOR_ID],
      targetLabel: SYSTEM_ACTOR_ID,
      payload: command.scope === 'system-target'
        ? Object.freeze({ ...command.payload, member: model.targetAgent.id })
        : command.payload,
    });
  }
  return createControlRequest(model, command.type, command.payload, model.targetAgent.id);
}

export function createControlRequest(model, type, payload, actorId = '') {
  const targetActor = actorId
    ? model.roster.find((actor) => actor.id === actorId)
    : model.selectedAgent || model.delivery.rows.find((actor) => actor.kind === 'agent');
  if (!targetActor || targetActor.kind !== 'agent') throw new TypeError('请选择目标 Agent');
  return Object.freeze({
    channelId: model.channelId,
    text: '',
    msgType: type,
    audience: [targetActor.id],
    targetLabel: actorName(targetActor),
    payload,
  });
}

export function editCASPayload(edit, nextText) {
  const target = text(edit?.targetId) || text(edit?.target);
  const oldText = text(edit?.oldText ?? edit?.text);
  const newText = text(nextText);
  if (!target) throw new TypeError('编辑目标不存在');
  if (!newText.trim()) throw new TypeError('编辑内容不能为空');
  return Object.freeze({
    target,
    old_text: oldText,
    new_text: newText,
    ...(text(edit?.holdId) ? { expected_hold_id: text(edit.holdId) } : {}),
  });
}
