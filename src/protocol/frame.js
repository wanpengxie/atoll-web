export const FRAME_VERSION = 2;
export const MAX_FRAME_BYTES = 512 * 1024;

export const UP = Object.freeze({
  attach: 'attach',
  submit: 'submit',
  resolve: 'resolve',
  cancel: 'cancel',
  after: 'after',
  cancel_timer: 'cancel_timer',
  resource: 'resource',
  observe: 'observe',
  unobserve: 'unobserve',
});

export const DOWN = Object.freeze({
  feed: 'feed',
  receipt: 'receipt',
  error: 'error',
  observe_ended: 'observe_ended',
});

export const ERROR_CODES = Object.freeze([
  'bad_payload',
  'not_in_audience',
  'unauthorized_sender',
  'already_closed',
  'request_not_found',
  'invalid_decision',
  'unavailable',
  'routing_unavailable',
  'idempotency_conflict',
  'now_member',
  'channel_not_found',
  'channel_unavailable',
  'capability_unavailable',
  'forbidden',
  'closed',
]);

export const OBSERVE_ENDED = Object.freeze([
  'now_member',
  'channel_retired',
  'channel_unavailable',
  'capability_unavailable',
]);

const PAYLOAD_FIELDS = Object.freeze({
  attach: ['since'],
  submit: [
    'channel_id',
    'id',
    'msg_type',
    'kind',
    'payload',
    'audience',
    'visibility',
    'parent_id',
    'expires_at_ms',
  ],
  resolve: ['channel_id', 'req_id', 'text', 'decision', 'note'],
  cancel: ['channel_id', 'req_id'],
  after: ['channel_id', 'duration_ms', 'msg_type', 'payload'],
  cancel_timer: ['channel_id', 'timer_id'],
  resource: [
    'channel_id',
    'op',
    'resource_id',
    'args',
    'target',
    'ops',
    'query',
    'address',
    'with_content',
  ],
  observe: ['channel_id'],
  unobserve: ['channel_id'],
});

const REQUIRED_PAYLOAD_FIELDS = Object.freeze({
  attach: [],
  submit: ['channel_id', 'msg_type'],
  resolve: ['channel_id', 'req_id'],
  cancel: ['channel_id', 'req_id'],
  after: ['channel_id', 'duration_ms', 'msg_type'],
  cancel_timer: ['channel_id', 'timer_id'],
  resource: ['channel_id', 'op'],
  observe: ['channel_id'],
  unobserve: ['channel_id'],
});

export class FrameValidationError extends Error {
  constructor(detail) {
    super(detail);
    this.name = 'FrameValidationError';
    this.code = 'bad_payload';
  }
}

export function validateUpstreamPayload(type, payload) {
  const allowed = PAYLOAD_FIELDS[type];
  if (!allowed) {
    throw new FrameValidationError(`unknown upstream frame_type: ${type}`);
  }
  if (payload == null) {
    if (REQUIRED_PAYLOAD_FIELDS[type].length) {
      throw new FrameValidationError(`${type} payload is required`);
    }
    return;
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new FrameValidationError(`${type} payload must be an object`);
  }
  const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new FrameValidationError(`${type} payload has unknown field: ${unknown.sort().join(', ')}`);
  }
  const missing = REQUIRED_PAYLOAD_FIELDS[type].filter((key) => payload[key] == null);
  if (missing.length) {
    throw new FrameValidationError(`${type} payload is missing: ${missing.join(', ')}`);
  }
  if (type === UP.after && (!Number.isSafeInteger(payload.duration_ms) || payload.duration_ms <= 0)) {
    throw new FrameValidationError('after duration_ms must be a positive safe integer');
  }
  if (type === UP.resource) validateResourcePayload(payload);
}

const RESOURCE_OPS = Object.freeze(['create', 'read', 'write', 'delete', 'stat', 'list']);

function validateResourcePayload(payload) {
  if (!RESOURCE_OPS.includes(payload.op)) {
    throw new FrameValidationError(`resource op must be one of: ${RESOURCE_OPS.join(', ')}`);
  }
  const hasResourceId = typeof payload.resource_id === 'string' && payload.resource_id.length > 0;
  const hasAddress = typeof payload.address === 'string' && payload.address.length > 0;
  if (payload.op === 'create' && !hasResourceId && !hasAddress) {
    throw new FrameValidationError('resource create requires resource_id or address');
  }
  if (['read', 'write', 'delete', 'stat'].includes(payload.op) && !hasResourceId) {
    throw new FrameValidationError(`resource ${payload.op} requires resource_id`);
  }
  if (payload.with_content != null && typeof payload.with_content !== 'boolean') {
    throw new FrameValidationError('resource with_content must be a boolean');
  }
}

export function frame(type, ref, payload) {
  validateUpstreamPayload(type, payload);
  const value = { v: FRAME_VERSION, frame_type: type };
  if (ref) value.ref = ref;
  if (payload != null) value.payload = payload;
  return value;
}

export function parseDownstream(text) {
  let value;
  try {
    value = typeof text === 'string' ? JSON.parse(text) : text;
  } catch (error) {
    return { kind: 'invalid', error };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'invalid', error: new TypeError('frame must be an object') };
  }
  if (value.v !== FRAME_VERSION) {
    return { kind: 'bad_version', frame: value };
  }
  if (!Object.values(DOWN).includes(value.frame_type)) {
    return { kind: 'unknown', frame: value };
  }
  return { kind: value.frame_type, frame: value, payload: value.payload ?? {} };
}

export const upstreamPayloadFields = (type) => [...(PAYLOAD_FIELDS[type] || [])];
