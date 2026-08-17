const STORAGE_PREFIX = 'atoll.timers.';

export function timerPayload({ channelId, durationMs, msgType, payload }) {
  const duration = Number(durationMs);
  if (!channelId) throw new TypeError('频道不能为空');
  if (!Number.isSafeInteger(duration) || duration <= 0) throw new TypeError('延迟必须是正整数毫秒');
  if (!String(msgType || '').trim()) throw new TypeError('消息类型不能为空');
  return { channel_id: channelId, duration_ms: duration, msg_type: String(msgType).trim(), ...(payload !== undefined ? { payload } : {}) };
}

export function timerRecord({ timerId, channelId, durationMs, msgType, payload, createdAt = Date.now() }) {
  if (!timerId) throw new TypeError('timer_id 不能为空');
  return { timerId, channelId, durationMs, msgType, payload, createdAt, dueAt: createdAt + durationMs, state: 'scheduled', provenance: '本设备记录' };
}

export function cancelTimerRecord(records, timerId) {
  return records.map((row) => row.timerId === timerId ? { ...row, state: 'cancelled', cancelledAt: Date.now() } : row);
}

export function restoreTimers(principalId) {
  try {
    const value = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${principalId}`) || '[]');
    return Array.isArray(value) ? value.filter(validRecord) : [];
  } catch { return []; }
}

export function saveTimers(principalId, records) {
  if (!principalId) return;
  localStorage.setItem(`${STORAGE_PREFIX}${principalId}`, JSON.stringify(records.filter(validRecord)));
}

function validRecord(row) {
  return row && typeof row.timerId === 'string' && typeof row.channelId === 'string' && Number.isSafeInteger(row.durationMs) && typeof row.msgType === 'string';
}
