const IMPORTANT_SYSTEM_EVENT = /(member|membership|access|permission|channel\.(?:retired|closed|opened)|actor\.(?:joined|left))/i;

const SYSTEM_EVENT_TITLES = {
  'system.actor.registered': '成员已连接到频道',
  'system.actor.deregistered': '成员已离开频道',
  'system.actor.ended': '成员会话已经结束',
  'mock.channel.pulse': '频道状态已同步',
  'runtime.trace': '运行状态已经记录',
};

export const TURN_STATUS_LABELS = {
  open: '等待处理',
  received: '已收到',
  queued: '排队中',
  processing: '处理中',
  deferred: '等待条件',
  unavailable: '暂时不可处理',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function turnStatusLabel(turn) {
  const status = turn?.terminal?.payload?.status || turn?.latestStatus || turn?.status || 'open';
  return TURN_STATUS_LABELS[status] || status;
}

export function turnProcessSummary(turn) {
  const provisional = turn?.provisional?.length || 0;
  const activity = turn?.activity?.length || 0;
  const anomalies = turn?.anomalies?.length || 0;
  const parts = [];
  if (provisional) parts.push(`${provisional} 条进展`);
  if (activity) parts.push(`${activity} 条技术活动`);
  if (anomalies) parts.push(`${anomalies} 个异常`);
  return parts.join(' · ') || '没有过程记录';
}

export function latestHumanProgress(turn) {
  const latest = turn?.provisional?.at(-1);
  if (!latest) return '';
  const payload = latest.envelope?.payload || {};
  return payload.detail || payload.message || payload.text || TURN_STATUS_LABELS[latest.status] || latest.status || '';
}

export function systemEventTier(envelope) {
  if (envelope?.payload?.severity === 'critical' || envelope?.payload?.severity === 'warning') return 'important';
  return IMPORTANT_SYSTEM_EVENT.test(envelope?.type || '') ? 'important' : 'diagnostic';
}

export function systemEventLabel(envelope) {
  const payload = envelope?.payload || {};
  return payload.text || payload.detail || payload.message || SYSTEM_EVENT_TITLES[envelope?.type] || '后台状态已更新';
}

export function systemEventDetail(envelope) {
  const payload = envelope?.payload || {};
  const subject = payload.actor_name || payload.actor_id || payload.principal_name || payload.principal_id || payload.channel_name || payload.channel_id;
  if (subject && ![payload.text, payload.detail, payload.message].includes(subject)) return String(subject);
  return '';
}
