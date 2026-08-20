import { TYPES } from '../protocol/vocab.js';

const DIRECTORY_INVALIDATION_TYPES = new Set([
  TYPES.channel.create,
  TYPES.channel.set,
  TYPES.channel.remove,
  TYPES.member.create,
  TYPES.member.admit,
  TYPES.member.remove,
  TYPES.device.attach,
  TYPES.device.detach,
  TYPES.device.remove,
  TYPES.narration.memberCreated,
  TYPES.narration.memberDeleted,
  TYPES.narration.channelInbound,
]);

// OBS 是当前投影，WS 账本事件是失效信号。请求、过程、终态可能使用同一个
// type，调用方负责防抖合并；这里不从任意 payload 字段猜业务语义。
export function invalidatesChannelDirectory(envelope) {
  return DIRECTORY_INVALIDATION_TYPES.has(envelope?.type || '');
}
