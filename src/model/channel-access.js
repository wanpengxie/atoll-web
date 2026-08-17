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

const ACCESS_PREFIX = 'atoll.channel-access.v1.';

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
  return profile?.id === 'c0.lobby' || profile?.name === 'lobby' || profile?.systemReserved === true;
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

function safeStoredState(raw, principalId) {
  if (!raw || raw.principalId !== principalId || !Array.isArray(raw.channels)) return [];
  return raw.channels.filter((row) => row && typeof row.channelId === 'string').map((row) => ({
    ...initialState(row.channelId, row.profile || null),
    ...row,
    freshness: 'stale',
    sessionEpoch: '',
    unavailable: false,
  }));
}

export function createChannelAccessTracker({
  principalId = '',
  storage = globalThis.localStorage,
  now = () => Date.now(),
  contractVersion = 2,
} = {}) {
  const states = new Map();
  const storageKey = `${ACCESS_PREFIX}${principalId || 'anonymous'}`;
  let connected = false;
  let sessionEpoch = '';
  let membershipSupported = false;

  try {
    const saved = JSON.parse(storage?.getItem(storageKey) || 'null');
    for (const row of safeStoredState(saved, principalId)) states.set(row.channelId, row);
  } catch {
    // 损坏缓存只影响启动占位，不影响权威 OBS/feed 收敛。
  }

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

  function persist() {
    if (!storage || !principalId) return;
    const channels = [...states.values()]
      .filter((state) => state.relationship === 'member' || state.selfActorId || state.existence === 'retired')
      .map((state) => ({
        channelId: state.channelId,
        profile: state.profile,
        existence: state.existence,
        runtime: state.runtime,
        relationship: state.relationship,
        selfActorId: state.selfActorId,
        source: state.source,
        reason: state.reason,
        observedAt: state.observedAt,
        contractVersion,
      }));
    try {
      storage.setItem(storageKey, JSON.stringify({ principalId, contractVersion, channels }));
    } catch {
      // localStorage 满额时保留内存状态。
    }
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
      if (state.relationship === 'unknown') state.relationship = 'discoverable';
      // owner_principal 是频道属性，不是当前 membership 证明。
      stamp(state, 'obs');
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
    persist();
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
        state.relationship = 'denied';
        state.freshness = 'fresh';
        state.selfActorId = '';
        state.unavailable = false;
        stamp(state, 'membership', 'membership_revoked');
      }
    }
    if (complete) {
      for (const state of states.values()) {
        if (state.relationship === 'member' && !active.has(state.channelId)) {
          state.relationship = 'denied';
          state.freshness = 'fresh';
          state.selfActorId = '';
          state.unavailable = false;
          stamp(state, 'membership', 'membership_revoked');
        }
      }
    }
    persist();
  }

  function memberEvidence(channelId, source, selfActorId = '') {
    const state = ensure(channelId);
    if (state.existence !== 'retired') state.existence = 'present';
    state.relationship = 'member';
    state.freshness = connected ? 'fresh' : 'stale';
    state.unavailable = false;
    if (selfActorId) state.selfActorId = selfActorId;
    stamp(state, source);
    persist();
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
      persist();
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
      persist();
    },
    wire(state, epoch = '') {
      connected = state === 'attached';
      if (connected) {
        sessionEpoch = epoch || `${now()}`;
        for (const value of states.values()) {
          if (['membership', 'feed', 'receipt'].includes(value.source)) value.freshness = 'fresh';
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
      persist();
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
