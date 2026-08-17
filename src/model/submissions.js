const PREFIX = 'atoll.submissions.v1.';
const ACTIVE = new Set(['transmitting', 'accepted', 'delayed', 'uncertain', 'rejected']);

export function createSubmission({ id, channelId, text = '', targetLabel = '', frame }) {
  if (!id || !channelId || !frame) throw new TypeError('submission requires id, channelId and frame');
  return {
    key: id,
    messageId: id,
    channelId,
    text,
    targetLabel,
    frame,
    state: 'transmitting',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
  };
}

export function transitionSubmission(item, event, error = null) {
  const next = { ...item, updatedAt: Date.now() };
  if (event === 'accepted' && item.state !== 'landed') next.state = 'accepted';
  else if (event === 'delayed' && item.state === 'accepted') next.state = 'delayed';
  else if (event === 'uncertain' && item.state !== 'landed') next.state = 'uncertain';
  else if (event === 'rejected' && item.state !== 'landed') next.state = 'rejected';
  else if (event === 'retry') {
    next.state = 'transmitting';
    next.error = null;
  }
  if (error) next.error = { code: error.code || 'unknown', detail: error.detail || error.message || String(error) };
  return next;
}

export function reconcileLanded(items, messageIds) {
  const landed = messageIds instanceof Set ? messageIds : new Set(messageIds || []);
  return items.filter((item) => !landed.has(item.messageId));
}

export function restoreSubmissions(principalId, storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(`${PREFIX}${principalId}`) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item?.messageId && item?.channelId && item?.frame && ACTIVE.has(item.state)).map((item) => ({
      ...item,
      state: item.state === 'transmitting' ? 'uncertain' : item.state,
      error: item.error || null,
    }));
  } catch {
    return [];
  }
}

export function saveSubmissions(principalId, items, storage = globalThis.localStorage) {
  if (!principalId || !storage) return;
  const active = (items || []).filter((item) => ACTIVE.has(item.state));
  try {
    storage.setItem(`${PREFIX}${principalId}`, JSON.stringify(active));
  } catch {
    // 持久化失败不改变当前会话中的提交事实。
  }
}

export function isUncertainWireError(error) {
  return error?.code === 'timeout' || error?.code === 'closed';
}
