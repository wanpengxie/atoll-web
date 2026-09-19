import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

const AGENT_MESSAGE_TYPES = new Set([TYPES.agentAsk, TYPES.agentQueue]);

function isAgentMessageType(type) {
  return AGENT_MESSAGE_TYPES.has(type);
}

function isAgentMessageTurn(turn) {
  return isAgentMessageType(turn?.request?.type);
}

function agentMessageStage(turn) {
  if (!isAgentMessageTurn(turn)) return '';
  if (turn.terminal) return 'timeline';
  const status = [...(turn.provisional || [])]
    .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
    .map((item) => String(argsOf(item.envelope)?.status || ''))
    .filter(Boolean).at(-1);
  return status === 'processing' ? 'timeline' : 'queued';
}

export const HIDDEN_TURN_TYPES = new Set([
  TYPES.agentHold,
  TYPES.agentUnhold,
  TYPES.agentInterrupt,
  TYPES.agentContext,
  TYPES.agentOptions,
  TYPES.agentFork,
  TYPES.describe,
]);

const SELECT_OR_NEW = new Set([TYPES.agentSelect, TYPES.agentNew]);

export function isUiProtocolType(type = '') {
  return typeof type === 'string' && type.startsWith('ui.');
}

export function isToolProtocolType(type = '') {
  return typeof type === 'string' && type.startsWith('tool.');
}

export function hasReadableMessageContent(envelope) {
  const payload = argsOf(envelope);
  const attachments = payload?.attachments || payload?.files;
  return Boolean(
    String(payload?.text || payload?.body || payload?.message || '').trim()
    || (Array.isArray(attachments) && attachments.length > 0)
  );
}

const TERMINAL_TRANSPORT_FIELDS = new Set([
  'status', 'reason', 'error_code', 'detail', 'cancelled', 'closed_by', 'controls', 'process', 'usage',
  'merged_into', 'replaced_by', 'preempted_by',
]);

// A terminal frame can be only a lifecycle acknowledgement (`{status:
// 'completed'}`). That closes Waiting but does not create a new person-readable
// message. Text, files, structured business output, and an explained failure
// are content; protocol bookkeeping is not.
export function hasReadableTerminalContent(envelope) {
  const payload = argsOf(envelope);
  if (hasReadableMessageContent(envelope)) return true;
  if (payload?.status === 'failed' && String(payload.detail || payload.reason || payload.error_code || '').trim()) return true;
  return Object.keys(payload || {}).some((key) => !TERMINAL_TRANSPORT_FIELDS.has(key));
}

// A public event is a notification only when it is itself a readable Timeline
// item. Transport/lifecycle events may remain visible in activity surfaces, but
// visibility alone is not evidence that a person received a new message.
export function personConversationEventVisible(envelope) {
  const type = String(envelope?.type || '');
  return envelope?.kind === 'event'
    && envelope?.visibility !== 'system'
    && !isUiProtocolType(type)
    && !HIDDEN_TURN_TYPES.has(type)
    && !type.startsWith('terminal.')
    && type !== TYPES.agentHoldExpired
    && argsOf(envelope)?.transient !== true
    && hasReadableMessageContent(envelope);
}

// One shared answer for whether a canonical turn currently has a Timeline
// conversation row. Consumers may still apply a view scope afterwards, but
// notification policy must not count a request before any row can acknowledge
// it (queued work and incomplete select/new operations are the common cases).
export function timelineTurnVisible(turn, editingTargetId = '') {
  if (!turn?.request) return false;
  if (HIDDEN_TURN_TYPES.has(turn.request.type)) return false;
  if (SELECT_OR_NEW.has(turn.request.type)) return argsOf(turn.terminal)?.status === 'completed';
  if (turn.requestId === editingTargetId) return true;
  if (isAgentMessageTurn(turn)) return agentMessageStage(turn) === 'timeline';
  return true;
}

// Request notifications describe the fact that landed at requestSeq, not a
// later lifecycle snapshot. Message turns and select/new controls have no
// conversation row at that point; processing or terminal facts may make them
// visible later and are classified at their own sequence instead.
export function personConversationRequestVisible(turn) {
  const type = turn?.request?.type;
  return Boolean(turn?.request)
    && !isUiProtocolType(type)
    && !HIDDEN_TURN_TYPES.has(type)
    && !SELECT_OR_NEW.has(type)
    && !isAgentMessageType(type);
}

// ui.* is an operation stream between an actor and one browser tab. It remains
// available in the all-ledger inspection view, but is never a person's message
// or a channel notification.
export function personConversationTurnVisible(turn, editingTargetId = '') {
  return !isUiProtocolType(turn?.request?.type) && timelineTurnVisible(turn, editingTargetId);
}
