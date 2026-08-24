import { actorDisplayName } from './actor-display.js';
import { messagePresentation } from './message-presentation.js';

const REPLY_KINDS = new Set(['agent', 'human']);

function excerptOf(envelope) {
  const text = messagePresentation(envelope).text.replace(/\s+/g, ' ').trim();
  if (text.length <= 96) return text;
  return `${text.slice(0, 95)}…`;
}

export function replyTargetOf(envelope, { roster = [], selfId = '', fallbackSenderId = '', fallbackSenderKind = '' } = {}) {
  const senderId = envelope?.sender?.id || fallbackSenderId;
  const rosterSender = roster.find((row) => row.id === senderId);
  const senderKind = envelope?.sender?.kind || rosterSender?.kind || fallbackSenderKind;
  if (!envelope?.id || !senderId || senderId === selfId || !REPLY_KINDS.has(senderKind) || !rosterSender) return null;
  return {
    sourceId: envelope.id,
    senderId,
    senderKind,
    senderName: actorDisplayName(rosterSender),
    excerpt: excerptOf(envelope),
  };
}

export function replyRecipient(replyTarget, roster = []) {
  if (!replyTarget) return null;
  const row = roster.find((candidate) => candidate.id === replyTarget.senderId);
  return row && REPLY_KINDS.has(row.kind) ? row : null;
}
