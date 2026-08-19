import { decodeSystemEvent } from '../protocol/system-events.js';
import { isStandardActorIdentity } from './actor-visibility.js';

function actorName(names, id) {
  return names?.get?.(id) || id || '未知成员';
}

export function systemEventPresentation(envelope, names) {
  const event = decodeSystemEvent(envelope);
  if (event.kind === 'member_joined' || event.kind === 'member_left') {
    const hidden = isStandardActorIdentity({ id: event.memberId, declarationId: event.declarationId });
    const name = actorName(names, event.memberId);
    return {
      hidden,
      tier: 'important',
      title: event.kind === 'member_joined' ? `${name} 已加入频道` : `${name} 已离开频道`,
      detail: event.kind === 'member_left' && event.reason ? `原因：${event.reason}` : '',
      event,
    };
  }
  if (event.kind === 'channel_inbound') {
    return {
      hidden: false,
      tier: 'diagnostic',
      title: `收到来自 ${event.fromChannel} 的频道请求`,
      detail: event.requestType,
      event,
    };
  }
  return {
    hidden: false,
    tier: 'diagnostic',
    title: event.kind === 'invalid' ? '无法识别的频道活动' : '后台状态已更新',
    detail: '',
    event,
  };
}

export const systemEventTier = (envelope) => systemEventPresentation(envelope).tier;
export const systemEventLabel = (envelope) => systemEventPresentation(envelope).title;
