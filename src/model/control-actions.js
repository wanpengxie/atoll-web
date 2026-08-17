const PREFIX = 'atoll.controls.v1.';
const ACTIVE = new Set(['sending', 'accepted', 'uncertain', 'error']);

function normalizedError(error) {
  if (!error) return null;
  return {
    code: error.code || 'unknown',
    detail: error.detail || error.message || String(error),
  };
}

export function createControlState(status, error = null, now = Date.now()) {
  return {
    status,
    error: normalizedError(error),
    updatedAt: now,
  };
}

export function restoreControlStates(principalId, storage = globalThis.localStorage) {
  if (!principalId || !storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(`${PREFIX}${principalId}`) || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([key, value]) => key && value && ACTIVE.has(value.status))
      .map(([key, value]) => [key, {
        ...value,
        // 刷新发生在 receipt 返回前时，不能把旧的“发送中”继续显示成确定事实。
        status: value.status === 'sending' ? 'uncertain' : value.status,
        error: normalizedError(value.error),
      }]));
  } catch {
    return {};
  }
}

export function saveControlStates(principalId, states, storage = globalThis.localStorage) {
  if (!principalId || !storage) return;
  const active = Object.fromEntries(Object.entries(states || {})
    .filter(([, value]) => value && ACTIVE.has(value.status))
    .map(([key, value]) => [key, { ...value, error: normalizedError(value.error) }]));
  try {
    storage.setItem(`${PREFIX}${principalId}`, JSON.stringify(active));
  } catch {
    // 控制状态持久化失败不能改变账本事实；feed 重放仍会给出最终结果。
  }
}
