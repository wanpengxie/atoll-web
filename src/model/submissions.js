const PREFIX = 'atoll.submissions.v1.';
const ACTIVE = new Set(['queued', 'transmitting', 'accepted', 'delayed', 'uncertain', 'rejected']);

export function createSubmission({ id, channelId, text = '', targetLabel = '', frame, state = 'transmitting' }) {
  if (!id || !channelId || !frame) throw new TypeError('submission requires id, channelId and frame');
  return {
    key: id,
    messageId: id,
    channelId,
    text,
    targetLabel,
    frame,
    state,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
  };
}

export function transitionSubmission(item, event, error = null) {
  const allowed = {
    accepted: new Set(['transmitting']),
    queued: new Set(['queued', 'transmitting']),
    transmit: new Set(['queued', 'transmitting', 'uncertain']),
    delayed: new Set(['accepted']),
    uncertain: new Set(['transmitting']),
    rejected: new Set(['queued', 'transmitting', 'uncertain']),
    retry: new Set(['uncertain', 'rejected']),
  };
  if (!allowed[event]?.has(item.state)) return item;
  const next = { ...item, updatedAt: Date.now() };
  next.state = event === 'transmit' || event === 'retry' ? 'transmitting' : event;
  if (event === 'retry') next.error = null;
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

export function removeStoredSubmissions(principalId, storage = globalThis.localStorage) {
  if (!principalId || !storage) return;
  try { storage.removeItem(`${PREFIX}${principalId}`); } catch { /* keep source for a later migration */ }
}

export function restoreSubmissionRecords(items = []) {
  return (items || []).filter((item) => item?.messageId && item?.channelId && item?.frame && ACTIVE.has(item.state)).map((item) => ({
    ...item,
    state: item.state === 'transmitting' ? 'uncertain' : item.state,
    error: item.error || null,
    leaseOwner: '',
    leaseUntil: 0,
  }));
}

export function activeSubmissions(items = []) { return (items || []).filter((item) => ACTIVE.has(item.state)); }

export function isUncertainWireError(error) {
  return error?.code === 'timeout' || error?.code === 'closed';
}
