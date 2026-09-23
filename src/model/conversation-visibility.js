import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

// A replace is admitted as the new row in its target's place (the target
// closes with replaced_by and the replace carries new_text on), so it waits
// and moves to the timeline exactly as the message it replaced would.
const AGENT_MESSAGE_TYPES = new Set([TYPES.agentAsk, TYPES.agentQueue, TYPES.agentReplace]);

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

// Control words that are never a conversation row, whatever they carry.
export const HIDDEN_TURN_TYPES = new Set([
  TYPES.agentHold,
  TYPES.agentUnhold,
  TYPES.agentHoldExpired,
  TYPES.agentInterrupt,
  TYPES.agentDismiss,
  TYPES.agentContext,
  TYPES.agentOptions,
  TYPES.agentFork,
  TYPES.describe,
]);

// A steer is the one control word that may or may not be a message: with a
// person's prose it IS that message, and with only a target (or `all`) it is
// an operation whose whole visible effect is that the request it names moves
// into the current turn. Decide it per row, not by type.
const PROSE_OR_CONTROL_TYPES = new Set([TYPES.agentSteer]);

export function isControlOnlyTurn(turn) {
  return isControlOnlyBody(turn?.request?.type, argsOf(turn?.request));
}

// The same question asked of a frame that has not landed yet. A local echo and
// the canonical row it becomes must answer it identically, or the row appears
// on send and vanishes on landing — one height change each way, which the
// reader sees as the tail jumping.
export function isControlOnlyBody(type, body) {
  const word = String(type || '');
  if (HIDDEN_TURN_TYPES.has(word)) return true;
  if (!PROSE_OR_CONTROL_TYPES.has(word)) return false;
  const payload = body && typeof body === 'object' ? body : {};
  const attachments = payload.attachments || payload.files;
  return !(String(payload.text || payload.body || payload.message || '').trim()
    || (Array.isArray(attachments) && attachments.length > 0));
}

// A request carries its own deadline: every agent.ask on this ledger states
// expires_at, and an unanswered one is closed at that instant as
// unanswered_timeout — "请求在截止时间前没有得到最终响应". Past it nothing is
// outstanding any more, with or without a terminal row. This is the only thing
// that stops a queued request whose receiver never spoke again from living in
// Waiting forever, so Waiting and the conversation both read it here rather
// than each deciding on its own.
export function requestExpired(request, now = Date.now()) {
  const expiresAt = Number(request?.expires_at || argsOf(request)?.expires_at || 0);
  return expiresAt > 0 && expiresAt <= now;
}

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

// The one list of keys that are protocol bookkeeping rather than something a
// person wrote or an actor produced. Both "does this terminal carry content"
// and "what does the answer card show" read it, so a bookkeeping key can never
// be content to one of them and not the other.
export const TERMINAL_TRANSPORT_FIELDS = new Set([
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
  if (isControlOnlyTurn(turn)) return false;
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
