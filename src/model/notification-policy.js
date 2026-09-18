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
import { isCanonicalAgentTimerFire } from './timeline-scope.js';

const TIMER_WAKE_TYPE = 'agent.timer.wake';

// Notification classification follows canonical lifecycle/presentation facts,
// not the transport shape alone. In particular, a request that only exists in
// Waiting is not yet new conversation content. Processing and progress may
// install/update that row in Presentation, but they remain lifecycle facts;
// only its terminal content is a new notification for an agent-owned task.
export function notificationDisposition(channelState, envelope, selfId = '') {
  const directTurn = envelope?.kind === KIND.response && envelope.parent_id
    ? channelState?.turns?.get?.(envelope.parent_id)
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
  if (isToolProtocolType(semanticType) && semanticRequest?.parent_id) return 'nested_tool_lifecycle';

  if (envelope?.kind === 'event') {
    return personConversationEventVisible(envelope) ? 'event' : 'not_presented';
  }

  if (envelope?.kind === KIND.request) {
    const turn = envelope?.id ? channelState?.turns?.get?.(envelope.id) : null;
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
