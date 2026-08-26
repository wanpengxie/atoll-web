export const FRAME_VERSION = 5;
export const MAX_FRAME_BYTES = 512 * 1024;
export const SESSION_COOKIE = 'atoll_session';
export const CONTRACT_VERSION = 'mock-v5';

export const PAYLOAD_FIELDS = Object.freeze({
  attach: ['since', 'focus', 'history_protocol', 'generation'],
  submit: ['channel_id', 'id', 'msg_type', 'kind', 'payload', 'audience', 'visibility', 'parent_id', 'expires_at_ms'],
  resolve: ['channel_id', 'req_id', 'text', 'decision', 'note'],
  cancel: ['channel_id', 'req_id'],
  after: ['channel_id', 'duration_ms', 'msg_type', 'payload'],
  cancel_timer: ['channel_id', 'timer_id'],
  resource: ['channel_id', 'op', 'resource_id', 'args', 'target', 'ops', 'query', 'address', 'with_content'],
  observe: ['channel_id'],
  unobserve: ['channel_id'],
  history_before: ['channel_id', 'before_seq', 'limit', 'byte_limit', 'generation', 'purpose', 'priority'],
  history_cancel: ['channel_id', 'target_ref', 'generation'],
});

export const REQUIRED_FIELDS = Object.freeze({
  attach: ['focus', 'history_protocol', 'generation'],
  submit: ['channel_id', 'msg_type'],
  resolve: ['channel_id', 'req_id'],
  cancel: ['channel_id', 'req_id'],
  after: ['channel_id', 'duration_ms', 'msg_type'],
  cancel_timer: ['channel_id', 'timer_id'],
  resource: ['channel_id', 'op'],
  observe: ['channel_id'],
  unobserve: ['channel_id'],
  history_before: ['channel_id', 'generation', 'purpose', 'priority'],
  history_cancel: ['channel_id', 'target_ref', 'generation'],
});

export const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

export function json(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(`${JSON.stringify(value)}\n`);
}

export function httpError(response, status, code, detail) {
  json(response, status, { code, detail });
}

export function cookieValue(request, name) {
  const header = request.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

export async function readJSON(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_FRAME_BYTES) throw new Error('request body exceeds size limit');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) throw new Error('unexpected end of JSON input');
  return JSON.parse(text);
}

export function validatePayload(type, payload) {
  if (!isObject(payload)) return `${type} payload must be an object`;
  const allowed = PAYLOAD_FIELDS[type];
  if (!allowed) return `unknown upstream frame_type: ${type}`;
  const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unknown.length) return `${type} payload has unknown field: ${unknown.sort().join(', ')}`;
  const missing = REQUIRED_FIELDS[type].filter((key) => payload[key] == null);
  if (missing.length) return `${type} payload is missing: ${missing.join(', ')}`;
  if (type !== 'attach' && typeof payload.channel_id !== 'string') return `${type} channel_id must be a string`;
  if (payload.id != null && typeof payload.id !== 'string') return `${type} id must be a string`;
  if (payload.req_id != null && typeof payload.req_id !== 'string') return `${type} req_id must be a string`;
  if (payload.msg_type != null && typeof payload.msg_type !== 'string') return `${type} msg_type must be a string`;
  if (payload.kind != null && typeof payload.kind !== 'string') return `${type} kind must be a string`;
  if (payload.visibility != null && typeof payload.visibility !== 'string') return `${type} visibility must be a string`;
  if (payload.audience != null && (!Array.isArray(payload.audience) || payload.audience.some((value) => typeof value !== 'string'))) return `${type} audience must be an array of strings`;
  if (payload.decision != null && typeof payload.decision !== 'string') return `${type} decision must be a string`;
  if (type === 'after' && (!Number.isSafeInteger(payload.duration_ms) || payload.duration_ms <= 0)) return 'after duration_ms must be a positive safe integer';
  if (type === 'history_before') {
    if (payload.before_seq != null && (!Number.isSafeInteger(payload.before_seq) || payload.before_seq < 0)) return 'history_before before_seq must be a non-negative safe integer';
    if (payload.limit != null && (!Number.isSafeInteger(payload.limit) || payload.limit < 1 || payload.limit > 200)) return 'history_before limit must be an integer between 1 and 200';
	if (!Number.isSafeInteger(payload.generation) || payload.generation < 1) return 'history_before generation must be a positive safe integer';
	if (!['initial-tail', 'user-demand', 'hydrate'].includes(payload.purpose)) return 'history_before purpose is invalid';
	if (!['foreground', 'background'].includes(payload.priority)) return 'history_before priority is invalid';
	if (payload.byte_limit != null && (!Number.isSafeInteger(payload.byte_limit) || payload.byte_limit < 1 || payload.byte_limit > 4 * 1024 * 1024)) return 'history_before byte_limit must be between 1 and 4MiB';
  }
  if (type === 'history_cancel') {
	if (typeof payload.target_ref !== 'string' || !payload.target_ref) return 'history_cancel target_ref is required';
	if (!Number.isSafeInteger(payload.generation) || payload.generation < 1) return 'history_cancel generation must be a positive safe integer';
  }
  if (type === 'attach' && payload.history_protocol !== FRAME_VERSION) return `attach history_protocol must be ${FRAME_VERSION}`;
	if (type === 'attach' && (!Number.isSafeInteger(payload.generation) || payload.generation < 1)) return 'attach generation must be a positive safe integer';
  if (type === 'resource') {
    const ops = ['create', 'read', 'write', 'delete', 'stat', 'list'];
    if (!ops.includes(payload.op)) return `resource op must be one of: ${ops.join(', ')}`;
    const hasResourceId = typeof payload.resource_id === 'string' && payload.resource_id.length > 0;
    const hasAddress = typeof payload.address === 'string' && payload.address.length > 0;
    if (payload.op === 'create' && !hasResourceId && !hasAddress) return 'resource create requires resource_id or address';
    if (['read', 'write', 'delete', 'stat'].includes(payload.op) && !hasResourceId) return `resource ${payload.op} requires resource_id`;
    if (payload.with_content != null && typeof payload.with_content !== 'boolean') return 'resource with_content must be a boolean';
  }
  return '';
}

export function downstreamFrame(frameType, ref, payload) {
  return {
    v: FRAME_VERSION,
    frame_type: frameType,
    ...(ref ? { ref } : {}),
    ...(payload != null ? { payload } : {}),
  };
}
