const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECKED_KEY = 'atoll.node-update.checked-at';

async function requestUpdate(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.detail || `升级请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}

export function updateCheckDue(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const checkedAt = Number(storage?.getItem(CHECKED_KEY) || 0);
    return !Number.isFinite(checkedAt) || checkedAt <= 0 || now - checkedAt >= CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function markUpdateChecked(storage = globalThis.localStorage, now = Date.now()) {
  try { storage?.setItem(CHECKED_KEY, String(now)); } catch { /* checking still succeeded */ }
}

export async function readNodeUpdate({ check = false } = {}) {
  return requestUpdate(`/api/update${check ? '?check=1' : ''}`);
}

export async function startNodeUpdate() {
  return requestUpdate('/api/update', { method: 'POST' });
}

export const ACTIVE_UPDATE_STATES = new Set(['starting', 'downloading', 'verifying', 'installing', 'restarting']);

export function nodeUpdateLabel(update, wireState = 'open') {
  if (update?.status === 'restarting' && wireState !== 'open') return '正在重连…';
  return ({
    starting: '准备升级…',
    downloading: '正在下载…',
    verifying: '正在校验…',
    installing: '正在安装…',
    restarting: '正在重启…',
    failed: '升级失败，重试',
  })[update?.status] || `升级到 ${update?.latest_version || ''}`.trim();
}
