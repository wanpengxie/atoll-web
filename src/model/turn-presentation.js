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
