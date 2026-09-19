import { argsOf, FINAL, KIND } from '../protocol/envelope.js';
import {
  HIDDEN_TURN_TYPES,
  hasReadableTerminalContent,
  isToolProtocolType,
  isUiProtocolType,
  personConversationEventVisible,
  personConversationRequestVisible,
  personConversationTurnVisible,
} from './conversation-visibility.js';

const TIMER_WAKE_TYPE = 'agent.timer.wake';

function isCanonicalAgentTimerFire(envelope) {
  const sender = envelope?.sender;
  return envelope?.kind === 'event'
    && typeof envelope.id === 'string'
    && envelope.id.startsWith('timer:')
    && !envelope.parent_id
    && envelope.correlation_id === envelope.id
    && sender?.kind === 'agent'
    && Boolean(sender.id)
    && Array.isArray(envelope.audience)
    && envelope.audience.length === 1
    && envelope.audience[0] === sender.id;
}

function turnFor(state, requestID) {
  if (!requestID) return null;
  for (const entry of state?.timeline || []) {
    if (entry?.turn?.requestId === requestID) return entry.turn;
    const child = entry?.thread?.find((item) => item.turn?.requestId === requestID);
    if (child) return child.turn;
  }
  return null;
}

// Notification classification follows canonical lifecycle/presentation facts,
// not the transport shape alone. In particular, a request that only exists in
// Waiting is not yet new conversation content. Processing and progress may
// install/update that row in Presentation, but they remain lifecycle facts;
// only its terminal content is a new notification for an agent-owned task.
export function notificationDisposition(channelState, envelope, selfId = '') {
  const directTurn = envelope?.kind === KIND.response && envelope.parent_id
    ? turnFor(channelState, envelope.parent_id)
    : null;
  const semanticType = directTurn?.request?.type || envelope?.type;
  if (envelope?.visibility === 'system' || directTurn?.request?.visibility === 'system') return 'system_narration';
  if (isUiProtocolType(semanticType)) return 'ui_protocol';
  if (HIDDEN_TURN_TYPES.has(semanticType)) return 'hidden_control';
  if (isCanonicalAgentTimerFire(envelope)) return 'timer_control';
  if (semanticType === TIMER_WAKE_TYPE) {
    const timerResult = envelope?.kind === KIND.response
      && FINAL.has(argsOf(envelope)?.status)
      && hasReadableTerminalContent(envelope);
    if (!timerResult) return 'timer_control';
  }

  const semanticRequest = envelope?.kind === KIND.request ? envelope : directTurn?.request;
  // A terminal tool frame can arrive before its request/parent closure. Its
  // shape alone is not enough to prove that it is nested lifecycle, nor that
  // it is an independent readable answer. Keep the qualification unresolved
  // until Replica materializes the parent context; callers must not flash a
  // normal final notification in the meantime.
  if (envelope?.kind === KIND.response
    && envelope.parent_id
    && isToolProtocolType(semanticType)
    && !directTurn) return 'notification_context_unknown';
  if (isToolProtocolType(semanticType) && semanticRequest?.parent_id) return 'nested_tool_lifecycle';

  if (envelope?.kind === 'event') {
    return personConversationEventVisible(envelope) ? 'event' : 'not_presented';
  }

  if (envelope?.kind === KIND.request) {
    const turn = envelope?.id ? turnFor(channelState, envelope.id) : null;
    if (turn && !personConversationRequestVisible(turn)) return 'not_presented';
    return 'request';
  }

  if (envelope?.kind !== KIND.response) return 'not_message';
  const status = argsOf(envelope)?.status;
  if (!FINAL.has(status)) return 'not_final';
  if (!hasReadableTerminalContent(envelope)) return 'not_presented';
  if (directTurn?.terminal && directTurn.terminal !== envelope) return 'terminal_conflict';
  const unmatched = envelope.parent_id
    ? channelState?._unmatchedTerminalClosures?.get?.(envelope.parent_id)
    : null;
  if (unmatched?.envelope && unmatched.envelope.id !== envelope.id) return 'terminal_conflict';
  if (directTurn && !personConversationTurnVisible(directTurn)) return 'not_presented';
  return 'final';
}

// The semantic classifier is shared, but its consumers intentionally differ.
// A channel badge wakes only for a conversation turn (request/final). A
// standalone readable event may still be a new dynamic inside the open
// viewport without making every public event a channel-level notification.
export function isRailNotifiableDisposition(disposition) {
  return disposition === 'request' || disposition === 'final';
}

export function isViewportNotifiableDisposition(disposition) {
  return disposition === 'request' || disposition === 'final' || disposition === 'event';
}

// 追平在场：四个条件同时成立才算"用户此刻就在这条视图的最新端看着"。
export function readerCaughtUp({
  following = false,
  atTail = false,
  surfaceVisible = false,
  documentVisible = false,
} = {}) {
  return following === true && atTail === true && surfaceVisible === true && documentVisible === true;
}

export function viewportUnseenNotice(unseen, caughtUp = false) {
  if (caughtUp === true) return 0;
  return Math.max(0, Number(unseen) || 0);
}
