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
  const anomalies = turn?.anomalies?.length || 0;
  const parts = [];
  if (provisional) parts.push(`${provisional} 条进展`);
  if (anomalies) parts.push(`${anomalies} 个异常`);
  return parts.join(' · ') || '没有过程记录';
}

export function latestHumanProgress(turn) {
  // 过程节点有自己的 ProcessTrail；主消息摘要只读面向人的状态更新，不能被
  // 最后一条 tool/stage progress 覆盖成泛化的“处理中”。
  const latest = [...(turn?.provisional || [])].reverse().find((item) => !item.envelope?.payload?.process);
  if (!latest) return '';
  const payload = latest.envelope?.payload || {};
  return payload.detail || payload.message || payload.text || TURN_STATUS_LABELS[latest.status] || latest.status || '';
}
