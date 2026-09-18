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
import { isCanonicalAgentTimerFire, TIMELINE_SCOPE } from './timeline-scope.js';

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

// ---------------------------------------------------------------------------
// IM 读侧兜底（监理 2026-09-18 14:58 补充裁定）。用户只有三种状态：在底部且页面
// 可见（新到达即读，恒不产生未读计数）、不在底部/在别的频道/页面不可见（计入
// 未读）、回到底部（该范围已装入的积压一次清）。
//
// 这几个函数只压**显示值**。未读的真相仍然是 ReadingSession 的回执——unseen
// 记录、exact identities、频道物理游标都不在这里被改写，刷新与跨设备看到的仍
// 是回执落地后的结果。兜底存在的唯一理由是：用户明明就在最新端看着，计数不该
// 因为某一条回执还在路上而闪一下。
// ---------------------------------------------------------------------------

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

// 在场兜底只能覆盖它能证明的 scope。all 覆盖频道；mine 只覆盖 related，且 total
// 同步扣掉这一层，避免把同一批 related 重标成 other。actorFilter 是 related/other
// 两层里的任意子集，现有 rail 聚合无法无损拆出它，因此绝不以显示双零掩盖过滤外真值；
// 它只靠 ReadingSession 的 exact identities 清自身已安装行。
export function projectChannelUnread(counts, channelId, caughtUp) {
  if (!counts
    || caughtUp?.caughtUp !== true
    || !channelId
    || channelId !== caughtUp.channelId
    || caughtUp.actorFiltered === true) return counts;
  if (caughtUp.scope === TIMELINE_SCOPE.all) {
    return { ...counts, related: 0, total: 0, pending: false, unknown: false };
  }
  if (caughtUp.scope === TIMELINE_SCOPE.mine) {
    const related = Math.max(0, Number(counts.related) || 0);
    return { ...counts, related: 0, total: Math.max(0, (Number(counts.total) || 0) - related) };
  }
  return counts;
}
