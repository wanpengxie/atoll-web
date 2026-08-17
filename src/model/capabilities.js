const CONTROL_TYPES = new Set([
  'agent.steer',
  'agent.interrupt',
  'agent.queue',
  'agent.stop',
  'agent.terminate',
  'agent.restart',
]);

const HIGH_RISK_TYPES = new Set(['agent.stop', 'agent.terminate', 'agent.restart']);

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

export function describeValue(payload = {}) {
  const wrapped = asObject(payload.value);
  const value = wrapped || asObject(payload);
  if (!value?.actor_id) return null;
  return value;
}

export function normalizeTypeMeta(type, raw = {}) {
  const value = asObject(raw) || {};
  const allowedKinds = Array.isArray(value.allowed_kinds) && value.allowed_kinds.length
    ? value.allowed_kinds.filter((item) => typeof item === 'string')
    : ['request'];
  const fields = Array.isArray(value.payload_fields)
    ? value.payload_fields.filter((field) => field && typeof field.name === 'string')
    : [];
  const errors = Array.isArray(value.error_codes)
    ? value.error_codes.filter((item) => item && typeof item.code === 'string')
    : [];
  return {
    type,
    description: String(value.description || ''),
    allowedKinds,
    maxPendingMs: Number.isFinite(Number(value.max_pending_ms)) ? Number(value.max_pending_ms) : 0,
    payloadExample: asObject(value.payload_example) || null,
    payloadFields: fields.map((field) => ({
      name: field.name,
      required: Boolean(field.required),
      description: String(field.description || ''),
      example: field.example,
    })),
    inputSchema: parseJSONDocument(value.input_schema),
    outputSchema: parseJSONDocument(value.output_schema),
    errorCodes: errors.map((item) => ({ code: item.code, description: String(item.description || ''), recovery: String(item.recovery || '') })),
    notes: String(value.notes || ''),
    raw: value,
  };
}

export function normalizeDescribe(raw) {
  const value = asObject(raw);
  if (!value?.actor_id) return null;
  const types = new Map();
  if (asObject(value.types)) {
    for (const [type, meta] of Object.entries(value.types)) types.set(type, normalizeTypeMeta(type, meta));
  } else if (typeof value.type === 'string' && value.type) {
    types.set(value.type, normalizeTypeMeta(value.type, value));
  }
  return {
    actorId: value.actor_id,
    description: String(value.description || ''),
    skillDoc: String(value.skill_doc || ''),
    types,
    raw: value,
  };
}

function mergeDescribe(current, incoming) {
  if (!current) return incoming;
  return {
    actorId: incoming.actorId || current.actorId,
    description: incoming.description || current.description,
    skillDoc: incoming.skillDoc || current.skillDoc,
    types: new Map([...current.types, ...incoming.types]),
    raw: incoming.types.size > 1 ? incoming.raw : current.raw,
  };
}

export function capabilityIndexFromState(state) {
  const index = new Map();
  const turns = [...(state?.turns?.values?.() || [])].sort((left, right) => left.requestSeq - right.requestSeq);
  for (const turn of turns) {
    if (turn.request?.type !== 'actor.describe') continue;
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

export function typeSupportsRequest(meta) {
  return Boolean(meta && (!meta.allowedKinds.length || meta.allowedKinds.includes('request')));
}

export function capabilityRisk(type) {
  if (type === 'agent.terminate') return 'critical';
  if (HIGH_RISK_TYPES.has(type)) return 'high';
  if (type === 'agent.interrupt' || type === 'agent.steer') return 'medium';
  return 'normal';
}

export function isAgentControl(type) {
  return CONTROL_TYPES.has(type);
}

export function supportsType(entry, type) {
  return typeSupportsRequest(entry?.describe?.types?.get(type));
}
