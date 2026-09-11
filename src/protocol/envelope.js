export const ENVELOPE_FIELDS = Object.freeze([
  'id',
  'ts',
  'ts_received',
  'channel_id',
  'sender',
  'kind',
  'type',
  'payload',
  'parent_id',
  'correlation_id',
  'visibility',
  'audience',
  'expires_at',
]);

export const KIND = Object.freeze({
  event: 'event',
  request: 'request',
  response: 'response',
});

export const VISIBILITY = Object.freeze({
  public: 'public',
  system: 'system',
});

export const SENDER_KIND = Object.freeze({
  human: 'human',
  agent: 'agent',
  tool: 'tool',
  system: 'system',
});

export const FINAL = new Set(['completed', 'failed']);
export const PROVISIONAL = new Set([
  'received',
  'queued',
  'processing',
  'deferred',
  'unavailable',
]);

export function isTerminal(envelope) {
  return envelope?.kind === KIND.response && FINAL.has(argsOf(envelope)?.status);
}

export function correlationOf(envelope) {
  return envelope?.correlation_id || envelope?.id || '';
}

// Requests, responses and events carry {_context?, body}. Older ledger rows
// have a flat payload. Read the business body without changing the raw envelope.
export function argsOf(envelope) {
  const payload = envelope?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  // 更早的账本行没有这层包装，原样返回，历史消息照样读得出。
  if (!Object.prototype.hasOwnProperty.call(payload, 'body')) return payload;
  const body = payload.body;
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

export function visibilityOf(envelope, warn = console.warn) {
  const visibility = envelope?.visibility;
  if (visibility === VISIBILITY.public || visibility === VISIBILITY.system) {
    return visibility;
  }
  warn?.(`unknown envelope visibility ${JSON.stringify(visibility)}; displaying as public`);
  return VISIBILITY.public;
}
