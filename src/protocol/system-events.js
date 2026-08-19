import { TYPES } from './vocab.js';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function memberEvent(envelope, kind) {
  const payload = envelope?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const memberId = text(payload.member);
  if (!memberId) return null;
  return {
    kind,
    memberId,
    declarationId: text(payload.decl_id),
    principalId: text(payload.principal),
    reason: kind === 'member_left' ? text(payload.reason) : '',
  };
}

const DECODERS = new Map([
  [TYPES.narration.memberCreated, (envelope) => memberEvent(envelope, 'member_joined')],
  [TYPES.narration.memberDeleted, (envelope) => memberEvent(envelope, 'member_left')],
  [TYPES.narration.channelInbound, (envelope) => {
    const payload = envelope?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const fromChannel = text(payload.from);
    const requestType = text(payload.type);
    const localRequestId = text(payload.local_request_id);
    if (!fromChannel || !requestType || !localRequestId) return null;
    return { kind: 'channel_inbound', fromChannel, requestType, localRequestId };
  }],
]);

// 平台叙事是封闭协议。这里只按 envelope.type 解码其确定字段；未知类型或坏载荷
// 不从任意 JSON 键名猜语义，由上层降级为不可操作的通用记录。
export function decodeSystemEvent(envelope) {
  const type = text(envelope?.type);
  const decoder = DECODERS.get(type);
  if (!decoder) return { kind: 'unknown', type, valid: false };
  const decoded = decoder(envelope);
  return decoded ? { ...decoded, type, valid: true } : { kind: 'invalid', type, valid: false };
}
