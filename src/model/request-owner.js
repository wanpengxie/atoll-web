export const REQUEST_PHASE = Object.freeze({
  acquire: 'acquire',
  persist: 'persist',
  submit: 'submit',
  settle: 'settle',
});

function accessSnapshot(state) {
  return Object.freeze({
    epoch: Number(state?.authorityEpoch || 0),
    relationship: String(state?.relationship || ''),
    existence: String(state?.existence || ''),
    runtime: String(state?.runtime || ''),
    unavailable: state?.unavailable === true,
  });
}

export function captureRequestOwner({
  principalId = '', principalEpoch = 0, channelId = '', worldEpoch = 0,
  attemptEpoch = 0, accessState = null, transport = null, transportEpoch = 0, draft = null,
} = {}) {
  if (!principalId || !channelId) throw new TypeError('request owner requires principal and channel');
  return Object.freeze({
    principalId,
    principalEpoch,
    channelId,
    worldEpoch,
    attemptEpoch,
    access: accessSnapshot(accessState),
    transport,
    transportEpoch,
    draft: draft ? Object.freeze({ ...draft }) : null,
  });
}

function invalid(code, detail) {
  return Object.freeze({ current: false, code, detail });
}

export function assessRequestOwner(owner, current, phase = REQUEST_PHASE.submit, {
  requireAccess = phase !== REQUEST_PHASE.settle,
  requireTransport = [REQUEST_PHASE.acquire, REQUEST_PHASE.persist, REQUEST_PHASE.submit].includes(phase),
  requireDraft = false,
} = {}) {
  if (!owner || !current) return invalid('owner_missing', '请求事务 owner 不存在');
  if (owner.principalId !== current.principalId || owner.principalEpoch !== current.principalEpoch) {
    return invalid('identity_changed', '当前登录身份已变化');
  }
  if (owner.channelId !== current.channelId) return invalid('channel_changed', '请求目标频道已变化');
  if (owner.worldEpoch !== current.worldEpoch) return invalid('world_changed', '服务端数据世界已变化');
  if (owner.attemptEpoch !== current.attemptEpoch) return invalid('attempt_changed', '当前请求上下文已重置');
  if (requireAccess) {
    const access = current.access || accessSnapshot(current.accessState);
    if (owner.access.epoch !== Number(access?.epoch || 0)) {
      return invalid('access_changed', '频道授权事实已变化');
    }
    if (access.relationship !== 'member') return invalid('forbidden', '频道成员权限已撤销');
    if (access.existence === 'retired') return invalid('channel_not_found', '频道已退役');
    if (access.unavailable || access.runtime === 'closed') return invalid('channel_unavailable', '频道暂不可用');
  }
  if (requireTransport && (
    owner.transport !== current.transport
    || owner.transportEpoch !== current.transportEpoch
    || current.transportOpen !== true
  )) return invalid('transport_changed', '消息连接已变化');
  if (requireDraft) {
    const expected = owner.draft || {};
    const observed = current.draft || {};
    const keys = new Set([...Object.keys(expected), ...Object.keys(observed)]);
    if ([...keys].some((key) => !Object.is(expected[key], observed[key]))) {
      return invalid('draft_changed', '草稿所有权已变化');
    }
  }
  return Object.freeze({ current: true, code: '', detail: '' });
}

export async function executeOwnedPhase({ owner, current, phase, effect, options }) {
  const before = assessRequestOwner(owner, current(), phase, options);
  if (!before.current) return Object.freeze({ started: false, current: false, invalidation: before });
  const value = await effect();
  const after = assessRequestOwner(owner, current(), phase, options);
  return Object.freeze({
    started: true,
    current: after.current,
    invalidation: after.current ? null : after,
    value,
  });
}

export async function executeOwnedGroupPhase({ owners, current, phase, effect, options }) {
  const assess = () => {
    for (const owner of owners || []) {
      const result = assessRequestOwner(owner, current(owner), phase, options);
      if (!result.current) return result;
    }
    return Object.freeze({ current: true, code: '', detail: '' });
  };
  const before = assess();
  if (!before.current) return Object.freeze({ started: false, current: false, invalidation: before });
  const value = await effect();
  const after = assess();
  return Object.freeze({
    started: true,
    current: after.current,
    invalidation: after.current ? null : after,
    value,
  });
}

export function requestAccessError(invalidation) {
  const error = new Error(invalidation?.detail || '请求事务授权已失效');
  error.code = invalidation?.code || 'owner_stale';
  error.detail = error.message;
  return error;
}
