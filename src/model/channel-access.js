export const CHANNEL_ACCESS = Object.freeze({
  memberActive: 'member_active',
  memberStale: 'member_stale',
  memberUnavailable: 'member_unavailable',
  observerActive: 'observer_active',
  observerStale: 'observer_stale',
  discoverable: 'discoverable',
  accessDenied: 'access_denied',
  retired: 'retired',
  loading: 'loading',
  // 兼容阶段 A 的调用方；新代码使用 observerActive。
  observer: 'observer_active',
});


function initialState(channelId, profile = null) {
  return {
    channelId,
    profile,
    existence: profile ? 'present' : 'unknown',
    runtime: profile?.open === true ? 'open' : profile?.open === false ? 'closed' : 'unknown',
    relationship: 'unknown',
    freshness: 'initial',
    unavailable: false,
    selfActorId: '',
    source: profile ? 'obs' : 'cache',
    reason: '',
    observedAt: 0,
    sessionEpoch: '',
  };
}

export function deriveChannelMode(state, { connected = true } = {}) {
  if (!state || state.existence === 'unknown') return CHANNEL_ACCESS.loading;
  if (state.existence === 'retired') return CHANNEL_ACCESS.retired;
  if (state.relationship === 'denied') return CHANNEL_ACCESS.accessDenied;
  if (state.relationship === 'member') {
    if (!connected || state.freshness !== 'fresh') return CHANNEL_ACCESS.memberStale;
    if (state.unavailable || state.runtime !== 'open') return CHANNEL_ACCESS.memberUnavailable;
    return CHANNEL_ACCESS.memberActive;
  }
  if (state.relationship === 'observer') {
    return connected && state.freshness === 'fresh' && state.runtime === 'open'
      ? CHANNEL_ACCESS.observerActive
      : CHANNEL_ACCESS.observerStale;
  }
  if (state.relationship === 'discoverable') return CHANNEL_ACCESS.discoverable;
  return CHANNEL_ACCESS.loading;
}

// 兼容阶段 A 的纯 selector；复杂事件合成由 createChannelAccessTracker 负责。
export function deriveChannelAccess(channel, membership, { observing = false, connected = true } = {}) {
  const state = initialState(channel?.id || '', channel || null);
  if (!channel || channel.status === 'retired') state.existence = 'retired';
  if (membership?.status === 'active') {
    state.relationship = 'member';
    state.freshness = 'fresh';
  } else if (membership?.status === 'revoked') {
    state.relationship = 'denied';
    state.freshness = 'fresh';
  } else if (observing) {
    state.relationship = 'observer';
    state.freshness = 'fresh';
  } else if (channel) {
    state.relationship = 'discoverable';
    state.freshness = 'fresh';
  }
  return deriveChannelMode(state, { connected });
}

function publicRow(state, connected) {
  const profile = state.profile || { id: state.channelId, name: state.channelId };
  const access = deriveChannelMode(state, { connected });
  return {
    ...profile,
    id: state.channelId,
    access,
    accessState: { ...state, mode: access },
    selfActorId: state.selfActorId,
  };
}

function isReserved(profile) {
  // c0 是空间根频道。后端可以把根频道标成 systemReserved，但这不代表它
  // 是内部 lobby；产品必须始终保留它。只有真正的 lobby/内部占位频道隐藏。
  if (profile?.id === 'c0') return false;
  return profile?.id === 'c0.lobby' || profile?.name === 'lobby' || profile?.systemReserved === true;
}

function isRootOwner(state, principalId) {
  return state?.channelId === 'c0' && state.profile?.owner_principal === principalId;
}

export function channelAccessRows(channels, memberships = [], options = {}) {
  const byChannel = new Map(memberships.map((membership) => [membership.channel_id, membership]));
  return channels
    .filter((channel) => !isReserved(channel))
    .map((channel) => {
      const state = initialState(channel.id, channel);
      const membership = byChannel.get(channel.id);
      state.relationship = membership?.status === 'active'
        ? 'member'
        : membership?.status === 'revoked' ? 'denied' : 'discoverable';
      state.freshness = 'fresh';
      return { ...publicRow(state, options.connected !== false), membership: membership || null };
    });
}

export const isMemberAccess = (access) => [
  CHANNEL_ACCESS.memberActive,
  CHANNEL_ACCESS.memberStale,
  CHANNEL_ACCESS.memberUnavailable,
].includes(access);

export const canWriteChannel = (access) => access === CHANNEL_ACCESS.memberActive;
export const canReadLiveChannel = (access) => [CHANNEL_ACCESS.memberActive, CHANNEL_ACCESS.observerActive].includes(access);
export const canViewChannelContent = (access) => isMemberAccess(access) || [CHANNEL_ACCESS.observerActive, CHANNEL_ACCESS.observerStale].includes(access);

// 访问关系是活状态读数，恒只活在内存：attach 回执每次连接权威交付成员清单，
// 页面刷新即全量重取。恒不落 localStorage——持久化只会让上一个生命期的旧
// 关系还魂（正是"重启后端后前端不知道自己在 c0"一族病的温床）。
export function createChannelAccessTracker({
  principalId = '',
  now = () => Date.now(),
} = {}) {
  const states = new Map();
  let connected = false;
  let sessionEpoch = '';
  let membershipSupported = false;

  function ensure(channelId, profile = null) {
    let state = states.get(channelId);
    if (!state) {
      state = initialState(channelId, profile);
      states.set(channelId, state);
    } else if (profile) {
      state.profile = profile;
    }
    return state;
  }

  function stamp(state, source, reason = '') {
    state.source = source;
    state.reason = reason;
    state.observedAt = now();
    state.sessionEpoch = sessionEpoch;
    return state;
  }


  function channelsObserved(channels, { complete = true } = {}) {
    const seen = new Set();
    for (const profile of channels || []) {
      if (!profile?.id || isReserved(profile)) continue;
      seen.add(profile.id);
      const state = ensure(profile.id, profile);
      state.profile = profile;
      state.existence = profile.status === 'retired' ? 'retired' : 'present';
      state.runtime = profile.open === true ? 'open' : profile.open === false ? 'closed' : 'unknown';
      if (profile.id === 'c0' && profile.owner_principal === principalId) {
        // Atoll 的 c0 是节点 owner 的既定 home/root 频道。这里仅承认这一个
        // 启动不变式，不把普通频道的 owner_principal 泛化成 membership。
        state.relationship = 'member';
        state.freshness = connected ? 'fresh' : 'stale';
        state.unavailable = false;
        stamp(state, 'root_owner');
      } else {
        if (state.relationship === 'unknown') state.relationship = 'discoverable';
        // 普通频道的 owner_principal 仍不是当前 membership 证明。
        stamp(state, 'obs');
      }
    }
    if (complete) {
      for (const state of states.values()) {
        if (state.existence === 'present' && state.profile && !seen.has(state.channelId)) {
          state.existence = 'retired';
          state.runtime = 'closed';
          state.freshness = 'fresh';
          state.unavailable = false;
          stamp(state, 'obs', 'channel_retired');
        }
      }
    }
  }

  function membershipsObserved(rows, { complete = true, supported = true } = {}) {
    membershipSupported = supported;
    if (!supported) return;
    const active = new Set();
    for (const row of rows || []) {
      if (!row?.channel_id) continue;
      const state = ensure(row.channel_id);
      if (row.status === 'active') {
        active.add(row.channel_id);
        state.relationship = 'member';
        state.freshness = connected ? 'fresh' : 'stale';
        state.unavailable = false;
        if (row.actor_id) state.selfActorId = row.actor_id;
        stamp(state, 'membership');
      } else if (row.status === 'revoked') {
        if (isRootOwner(state, principalId)) continue;
        state.relationship = 'denied';
        state.freshness = 'fresh';
        state.selfActorId = '';
        state.unavailable = false;
        stamp(state, 'membership', 'membership_revoked');
      }
    }
    if (complete) {
      for (const state of states.values()) {
        if (state.relationship === 'member' && !active.has(state.channelId) && !isRootOwner(state, principalId)) {
          state.relationship = 'denied';
          state.freshness = 'fresh';
          state.selfActorId = '';
          state.unavailable = false;
          stamp(state, 'membership', 'membership_revoked');
        }
      }
    }
  }

  function memberEvidence(channelId, source, selfActorId = '') {
    const state = ensure(channelId);
    if (state.existence !== 'retired') state.existence = 'present';
    state.relationship = 'member';
    state.freshness = connected ? 'fresh' : 'stale';
    state.unavailable = false;
    if (selfActorId) state.selfActorId = selfActorId;
    stamp(state, source);
  }

  return {
    channelsObserved,
    membershipsObserved,
    feed(channelId) { memberEvidence(channelId, 'feed'); },
    receipt(channelId) { memberEvidence(channelId, 'receipt'); },
    self(channelId, actorId) { memberEvidence(channelId, 'feed', actorId); },
    forbidden(channelId) {
      const state = ensure(channelId);
      state.relationship = 'denied';
      state.freshness = 'fresh';
      state.selfActorId = '';
      state.unavailable = false;
      stamp(state, 'error', 'forbidden');
    },
    unavailable(channelId, reason = 'unavailable') {
      const state = ensure(channelId);
      state.unavailable = true;
      state.freshness = connected ? 'fresh' : 'stale';
      stamp(state, 'error', reason);
    },
    retire(channelId, reason = 'channel_retired') {
      const state = ensure(channelId);
      state.existence = 'retired';
      state.runtime = 'closed';
      state.freshness = 'fresh';
      state.unavailable = false;
      stamp(state, 'event', reason);
    },
    wire(state, epoch = '') {
      connected = state === 'attached';
      if (connected) {
        sessionEpoch = epoch || `${now()}`;
        for (const value of states.values()) {
          if (['membership', 'feed', 'receipt', 'root_owner'].includes(value.source)) value.freshness = 'fresh';
        }
      } else {
        for (const value of states.values()) {
          if (value.relationship === 'member' || value.relationship === 'observer') value.freshness = 'stale';
        }
      }
    },
    clearSelf(channelId) {
      const state = states.get(channelId);
      if (state) state.selfActorId = '';
    },
    state(channelId) { return states.get(channelId) || null; },
    rows({ includeRetired = false } = {}) {
      return [...states.values()]
        .filter((state) => !isReserved(state.profile))
        .filter((state) => includeRetired || state.existence !== 'retired')
        .map((state) => publicRow(state, connected));
    },
    snapshot() {
      return {
        connected,
        sessionEpoch,
        membershipSupported,
        channels: [...states.values()].map((state) => ({ ...state, mode: deriveChannelMode(state, { connected }) })),
      };
    },
  };
}
