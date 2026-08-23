import { parseJSONDocument } from './capabilities.js';
import { TYPES } from '../protocol/vocab.js';

// 固定词的表单兜底；有 input_schema 时始终以 actor.describe 的机器可读声明为准。
// 字段名对齐 drivers/agents/base/loop.go 的解码结构。
const KNOWN_CONTROL_FIELDS = Object.freeze({
  [TYPES.agentAsk]: [
    { name: 'text', required: true, description: '要问 Agent 的内容', type: 'string', multiline: true },
  ],
  [TYPES.agentSteer]: [
    { name: 'text', required: true, description: '补充或调整当前任务方向', type: 'string', multiline: true },
    { name: 'expected_turn_id', required: false, description: '只在这一回合仍在进行时生效', type: 'string' },
  ],
  [TYPES.agentQueue]: [
    { name: 'text', required: true, description: '排队的新任务内容', type: 'string', multiline: true },
  ],
  [TYPES.agentSelect]: [
    { name: 'model', required: false, description: '切换到的模型', type: 'string' },
    { name: 'effort', required: false, description: '推理力度', type: 'string' },
  ],
  [TYPES.agentInterrupt]: [],
  [TYPES.agentHold]: [
    { name: 'target', required: false, description: '要冻结并编辑的请求编号', type: 'string' },
    { name: 'duration_ms', required: false, description: '冻结时长（最多 1800000 毫秒）', type: 'integer' },
  ],
  [TYPES.agentUnhold]: [],
  [TYPES.agentReplace]: [
    { name: 'target', required: true, description: '被替换的请求编号', type: 'string' },
    { name: 'old_text', required: true, description: '编辑前全文', type: 'string', multiline: true },
    { name: 'new_text', required: true, description: '编辑后全文', type: 'string', multiline: true },
    { name: 'attachments', required: false, description: '更新后的附件', type: 'array' },
  ],
  [TYPES.agentCompact]: [],
  [TYPES.agentNew]: [],
  [TYPES.agentContext]: [],
  [TYPES.agentFork]: [],
});

function inferredType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null || value === undefined) return 'string';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'object';
  return 'string';
}

function fieldFromSchema(name, schema, required) {
  const value = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {};
  const type = Array.isArray(value.type) ? value.type.find((item) => item !== 'null') || 'string' : value.type || inferredType(value.default);
  return {
    name,
    required,
    description: String(value.description || ''),
    type,
    enum: Array.isArray(value.enum) ? value.enum : null,
    defaultValue: value.default,
    example: value.example,
    multiline: type === 'string' && (value.format === 'textarea' || Number(value.maxLength) > 160),
    raw: value,
  };
}

export function buildFormSpec(type, meta = {}) {
  const schema = parseJSONDocument(meta.inputSchema || meta.input_schema);
  if (schema) {
    const unsupportedRoot = schema.oneOf || schema.anyOf || schema.allOf || (schema.type && schema.type !== 'object');
    if (unsupportedRoot || !schema.properties || typeof schema.properties !== 'object') {
      return { mode: 'json', fields: [], initial: meta.payloadExample || {}, reason: '此 Schema 需要使用原始 JSON 输入' };
    }
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    return {
      mode: 'fields',
      fields: Object.entries(schema.properties).map(([name, field]) => fieldFromSchema(name, field, required.has(name))),
      initial: meta.payloadExample || {},
      additionalProperties: schema.additionalProperties !== false,
    };
  }
  if (Object.prototype.hasOwnProperty.call(KNOWN_CONTROL_FIELDS, type)) {
    return { mode: 'fields', fields: KNOWN_CONTROL_FIELDS[type], initial: {}, additionalProperties: false };
  }
  return { mode: 'json', fields: [], initial: meta.payloadExample || {}, reason: '该能力没有机器可读字段说明' };
}

function parseField(field, raw) {
  if (field.type === 'boolean') return Boolean(raw);
  if (field.type === 'number' || field.type === 'integer') {
    if (raw === '' || raw == null) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) throw new TypeError(`${field.name} 必须是${field.type === 'integer' ? '整数' : '数字'}`);
    return value;
  }
  if (field.type === 'object' || field.type === 'array') {
    if (raw === '' || raw == null) return undefined;
    let value;
    try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new TypeError(`${field.name} 必须是合法 JSON`); }
    if (field.type === 'array' ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field.name} 类型不正确`);
    return value;
  }
  return raw == null ? '' : String(raw);
}

export function valuesToPayload(spec, values = {}, rawJSON = '') {
  if (spec.mode === 'json') {
    let value;
    try { value = JSON.parse(rawJSON || '{}'); } catch { throw new TypeError('请输入合法的 JSON object'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('能力参数必须是 JSON object');
    return value;
  }
  const payload = {};
  for (const field of spec.fields) {
    const value = parseField(field, values[field.name]);
    if (field.required && (value === undefined || value === '')) throw new TypeError(`${field.name} 为必填项`);
    if (value !== undefined && value !== '') {
      if (field.enum && !field.enum.some((item) => Object.is(item, value))) throw new TypeError(`${field.name} 不在允许值中`);
      payload[field.name] = value;
    }
  }
  return payload;
}

// resolve 帧的字段闭集由 platform/subjectgate 定死：human.ask 只收 text，
// human.approve 只收 decision + 可选 note。所以这里没有“动态表单”的余地。
export function resolveFormSpec(requestType) {
  if (requestType === TYPES.humanAsk) {
    return { mode: 'text', field: 'text', label: '你的回答', required: true };
  }
  return { mode: 'decision', field: 'note', label: '备注（可选）', required: false };
}
