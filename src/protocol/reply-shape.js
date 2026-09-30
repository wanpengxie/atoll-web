import { TYPES } from './vocab.js';

// 回复的形状由词决定，恒不猜：c0 的 registrar 答的词（空间面，以及改频道描述的
// member.create/admit/set/delete、service.set）回 {status, value}；本频道 system
// actor 自己答的词把回复平铺在 status 旁边。
const REGISTRAR_WORD_PREFIXES = Object.freeze(['system.channel.', 'system.principal.', 'system.actor.description.', 'system.device.', 'system.class.', 'system.credential.']);
const REGISTRAR_DESCRIPTION_WORDS = new Set([TYPES.member.create, TYPES.member.admit, TYPES.member.set, TYPES.member.remove, 'system.service.set']);

export function answeredByRegistrar(msgType) {
  const word = String(msgType || '');
  return REGISTRAR_DESCRIPTION_WORDS.has(word) || REGISTRAR_WORD_PREFIXES.some((prefix) => word.startsWith(prefix));
}

export function systemReplyValue(payload, msgType) {
  if (answeredByRegistrar(msgType)) return payload?.value;
  const { status: _status, ...value } = payload || {};
  return value;
}
