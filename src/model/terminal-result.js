import { argsOf } from '../protocol/envelope.js';

const SENSITIVE_FIELD = /^(password|secret|secret_hash|token|access_token|refresh_token|private_key|key|credential)$/i;

// Keep the same pure policy at both security boundaries: cache persistence and
// structured result rendering. Match complete field names only so ordinary
// business fields such as `token_count` or `keynote` remain readable.
export function redactSensitive(value, key = '') {
  if (key && SENSITIVE_FIELD.test(String(key))) return '已隐藏';
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactSensitive(item, name)]));
  }
  return value;
}

// A turn's process rows are one projection shared by the timeline and its
// detail surface. Keep the envelope/sequence anchor, but never hand a UI
// component the raw process payload as a display object.
export function turnProcessObservations(turn) {
  return (turn?.provisional || [])
    .map((item) => ({
      seq: Number(item.seq),
      envelope: item.envelope,
      process: argsOf(item.envelope)?.process,
    }))
    .filter((item) => Number.isFinite(item.seq) && item.process && typeof item.process === 'object')
    .sort((left, right) => left.seq - right.seq);
}

const PROCESS_AUDIT_IDENTIFIER_FIELDS = Object.freeze([
  ['audit_id', '审计编号'],
  ['auditId', '审计编号'],
  ['tool_call_id', '调用编号'],
  ['toolCallId', '调用编号'],
  ['turn_id', '回合编号'],
  ['turnId', '回合编号'],
  ['trace_id', '跟踪编号'],
  ['traceId', '跟踪编号'],
]);

function scalarIdentifier(value) {
  return (typeof value === 'string' || typeof value === 'number') && String(value).trim()
    ? String(value)
    : '';
}

// Detail is intentionally a facts projection, not a generic structured-data
// viewer. Recursively redact before selecting identifiers so a future nested
// process shape cannot bypass the existing persistence/rendering policy.
export function turnProcessAuditFacts(turn) {
  return turnProcessObservations(turn).map(({ seq, envelope, process }) => {
    const safe = redactSensitive(process);
    const identifiers = [];
    const seenLabels = new Set();
    for (const [field, label] of PROCESS_AUDIT_IDENTIFIER_FIELDS) {
      const value = scalarIdentifier(safe?.[field]);
      if (!value || seenLabels.has(label)) continue;
      seenLabels.add(label);
      identifiers.push({ label, value });
    }
    const envelopeId = scalarIdentifier(envelope?.id);
    if (envelopeId && !seenLabels.has('过程编号')) identifiers.push({ label: '过程编号', value: envelopeId });
    return Object.freeze({
      seq,
      kind: scalarIdentifier(safe?.kind),
      phase: scalarIdentifier(safe?.phase || safe?.stage),
      identifiers: Object.freeze(identifiers),
    });
  });
}

const TERMINAL_RETAINED_FIELDS = Object.freeze([
  'merged_into',
  'replaced_by',
  'preempted_by',
]);

export function terminalRetainedFields(payload = {}) {
  const retained = {};
  for (const key of TERMINAL_RETAINED_FIELDS) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && value !== '') retained[key] = value;
  }
  return retained;
}

export function terminalRetainedValue(turn, key) {
  if (!TERMINAL_RETAINED_FIELDS.includes(key)) return undefined;
  return terminalRetainedFields(argsOf(turn?.terminal))[key];
}

export function terminalResultEnvelope(turn) {
  return turn?.terminal && turn.terminalClosureOnly !== true ? turn.terminal : null;
}

export function terminalResultPayload(turn) {
  const terminal = terminalResultEnvelope(turn);
  return terminal ? argsOf(terminal) : null;
}

export const TERMINAL_RESULT_UNAVAILABLE = '终态详情不可用，请刷新或重新进入频道';

export function terminalResultState(turn) {
  if (!turn?.terminal) return Object.freeze({ phase: 'waiting', error: '' });
  if (turn.terminalClosureOnly === true) {
    return Object.freeze({ phase: 'unavailable', error: TERMINAL_RESULT_UNAVAILABLE });
  }
  return Object.freeze({ phase: 'available', error: '' });
}

export function terminalContentEnvelope(turn) {
  return terminalResultEnvelope(turn);
}
