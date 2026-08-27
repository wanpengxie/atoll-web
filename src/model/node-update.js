export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
