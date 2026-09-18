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

export function hasCanonicalBody(envelope) {
  const payload = envelope?.payload;
  return Boolean(payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && Object.prototype.hasOwnProperty.call(payload, 'body'));
}

// Requests, responses and events carry {_context?, body}. Historical flat
// payloads are unsupported development data: keep accepting the ledger row at
// the transport boundary, but expose no business body and render nothing.
export function argsOf(envelope) {
  const payload = envelope?.payload;
  if (!hasCanonicalBody(envelope)) return {};
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
