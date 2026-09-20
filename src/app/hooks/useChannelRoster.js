import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { actorDisplayName } from '../../model/actor-display.js';
import { argsOf } from '../../protocol/envelope.js';
import { TYPES } from '../../protocol/vocab.js';

function projectActor(item) {
  const declared = item?.declared || {};
  const id = declared.id || item?.key || '';
  const measure = (name) => item?.actual?.measures?.find((row) => row.name === name);
  const bound = measure('bound');
  const device = measure('device_online');
  return {
    id,
    kind: declared.kind || '',
    name: actorDisplayName({ id, name: declared.name }),
    decl_id: declared.decl_id || '',
    description: declared.description || '',
    principal: declared.principal || '',
    bound: bound?.unknown ? null : Boolean(bound?.value),
    deviceOnline: device?.unknown ? null : Boolean(device?.value),
  };
}

function rosterRows(observation) {
  return (observation?.items || []).map(projectActor).filter((row) => row.id);
}

function cacheEntry(rows, owner, channelId) {
  return Object.freeze({
    rows,
    owner,
    generation: Number(owner?.generationFor?.(channelId) || 0),
  });
}

export function useChannelRoster({
  generationFor,
  obsRef,
  onError,
  ownerToken,
  principalId,
  reconcileIdentity,
  rosterRef,
  versionIncompatibleEpochRef,
  versionIncompatibleRef,
}) {
  // This store is the only mutable roster authority. React receives immutable
  // snapshots after a store mutation; it never becomes a second write owner.
  const storeRef = useRef(null);
  if (storeRef.current === null) {
    storeRef.current = {
      cache: new Map(),
      authorities: new Map(),
      selves: new Map(),
      refreshGenerations: new Map(),
      refreshTimers: new Map(),
      attachAuthority: null,
      attachEpoch: 0,
      retiredChannels: new Set(),
    };
  }
  const committedOwnerRef = useRef(null);
  const mountedRef = useRef(false);
  const [snapshot, setSnapshot] = useState(() => ({
    rosters: new Map(),
    authorities: new Map(),
  }));
  const [busy, setBusy] = useState(false);

  const publish = useCallback(() => {
    if (!mountedRef.current) return;
    const store = storeRef.current;
    const rosters = new Map();
    for (const [channelId, entry] of store.cache) rosters.set(channelId, entry.rows);
    setSnapshot({
      rosters,
      authorities: new Map(store.authorities),
    });
  }, []);

  const clearTimers = useCallback(() => {
    const timers = storeRef.current.refreshTimers;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }, []);

  const refreshGenerationFor = useCallback((channelId) => (
    storeRef.current.refreshGenerations.get(channelId) || 0
  ), []);
  const bumpRefreshGeneration = useCallback((channelId) => {
    const store = storeRef.current;
    const next = refreshGenerationFor(channelId) + 1;
    store.refreshGenerations.set(channelId, next);
    return next;
  }, [refreshGenerationFor]);
  const fenceAllRefreshes = useCallback(() => {
    const store = storeRef.current;
    const channelIds = new Set([
      ...store.cache.keys(),
      ...store.authorities.keys(),
      ...store.refreshGenerations.keys(),
      ...store.refreshTimers.keys(),
    ]);
    for (const channelId of channelIds) bumpRefreshGeneration(channelId);
  }, [bumpRefreshGeneration]);

  const owner = useMemo(() => Object.freeze({
    principalId,
    producerOwnerToken: ownerToken,
    generationFor,
  }), [generationFor, ownerToken, principalId]);

  // Same-world reconnects can reuse the server boot while replacing the
  // membership snapshot.  Keep an opaque attach token in this owner so an
  // old Workspace effect or OBS result cannot write after close/reconnect.
  const authorityCurrent = useCallback((channelId, expectedAuthority) => {
    const store = storeRef.current;
    const current = store.attachAuthority;
    if (!current || !expectedAuthority || current !== expectedAuthority) return false;
    if (store.retiredChannels.has(channelId)) return false;
    const currentGeneration = Number(generationFor?.(channelId) || 0);
    return current.generation > 0 && current.generation === currentGeneration
      && (current.channels == null || current.channels.has(channelId));
  }, [generationFor]);

  const attach = useCallback((generation, memberships) => {
    if (committedOwnerRef.current !== owner) return null;
    const nextGeneration = Number(generation);
    if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= 0) return null;
    const channels = Array.isArray(memberships)
      ? new Set(memberships.map((entry) => String(entry?.channel_id || '')).filter(Boolean))
      : null;
    const store = storeRef.current;
    fenceAllRefreshes();
    clearTimers();
    store.attachEpoch += 1;
    store.attachAuthority = Object.freeze({
      token: Object.freeze({}),
      epoch: store.attachEpoch,
      generation: nextGeneration,
      channels,
    });
    store.retiredChannels.clear();
    store.authorities.clear();
    store.selves.clear();
    publish();
    return store.attachAuthority;
  }, [clearTimers, fenceAllRefreshes, owner, publish]);

  const loadRows = useCallback(async (channelId, {
    force = true,
    expectedEpoch,
    expectedRefreshGeneration,
    expectedOwner,
    expectedAuthority,
  } = {}) => {
    const store = storeRef.current;
    if (expectedRefreshGeneration !== undefined
      && refreshGenerationFor(channelId) !== expectedRefreshGeneration) return null;
    const currentOwner = committedOwnerRef.current;
    if (!currentOwner || (expectedOwner && currentOwner !== expectedOwner)) return null;
    if (!authorityCurrent(channelId, expectedAuthority)) return null;
    const cached = store.cache.get(channelId);
    if (!force && cached
      && cached.owner === currentOwner
      && cached.generation === Number(currentOwner.generationFor?.(channelId) || 0)) {
      return cached.rows;
    }
    const obs = obsRef.current;
    if (!obs?.channelActors || !channelId) return [];
    const observation = await obs.channelActors(channelId);
    if (versionIncompatibleRef.current
      || (expectedEpoch !== undefined && expectedEpoch !== versionIncompatibleEpochRef.current)
      || (expectedRefreshGeneration !== undefined
        && refreshGenerationFor(channelId) !== expectedRefreshGeneration)
      || (expectedOwner && committedOwnerRef.current !== expectedOwner)
      || !authorityCurrent(channelId, expectedAuthority)) return null;
    const rows = rosterRows(observation);
    const committedOwner = committedOwnerRef.current;
    const generation = Number(committedOwner?.generationFor?.(channelId) || 0);
    store.cache.set(channelId, cacheEntry(rows, committedOwner, channelId));
    if (generation > 0) {
      store.authorities.set(channelId, {
        principalId,
        channelId,
        generation,
        current: observation?.complete !== false,
      });
    } else store.authorities.delete(channelId);
    const self = rows.find((row) => row.kind === 'human' && row.principal === principalId)?.id;
    if (self) store.selves.set(channelId, self);
    publish();
    return rows;
  }, [authorityCurrent, obsRef, principalId, publish, refreshGenerationFor, versionIncompatibleEpochRef, versionIncompatibleRef]);

  const refresh = useCallback(async (channelId, force = false) => {
    if (versionIncompatibleRef.current || !channelId) return [];
    const expectedEpoch = versionIncompatibleEpochRef.current;
    const expectedOwner = owner;
    const expectedAuthority = storeRef.current.attachAuthority;
    if (!expectedOwner || !authorityCurrent(channelId, expectedAuthority)) return [];
    const expectedRefreshGeneration = bumpRefreshGeneration(channelId);
    if (mountedRef.current) setBusy(true);
    try {
      const rows = await loadRows(channelId, {
        force,
        expectedEpoch,
        expectedOwner,
        expectedRefreshGeneration,
        expectedAuthority,
      });
      if (rows === null) return [];
      if (!authorityCurrent(channelId, expectedAuthority)) return [];
      const selfId = storeRef.current.selves.get(channelId) || '';
      if (selfId) reconcileIdentity(channelId, selfId);
      return rows || [];
    } catch (error) {
      if (!versionIncompatibleRef.current
        && expectedEpoch === versionIncompatibleEpochRef.current
        && expectedRefreshGeneration === refreshGenerationFor(channelId)
        && committedOwnerRef.current === expectedOwner
        && error?.status !== 401) onError(error);
      return [];
    } finally {
      if (mountedRef.current
        && !versionIncompatibleRef.current
        && expectedEpoch === versionIncompatibleEpochRef.current
        && expectedRefreshGeneration === refreshGenerationFor(channelId)
        && committedOwnerRef.current === expectedOwner) setBusy(false);
    }
  }, [authorityCurrent, bumpRefreshGeneration, loadRows, onError, owner, reconcileIdentity, refreshGenerationFor, versionIncompatibleEpochRef, versionIncompatibleRef]);

  const ensure = useCallback((channelId) => {
    const expectedAuthority = storeRef.current.attachAuthority;
    if (!authorityCurrent(channelId, expectedAuthority)) return Promise.resolve(null);
    const expectedRefreshGeneration = bumpRefreshGeneration(channelId);
    return loadRows(channelId, {
      force: false,
      expectedOwner: owner,
      expectedEpoch: versionIncompatibleEpochRef.current,
      expectedRefreshGeneration,
      expectedAuthority,
    });
  }, [authorityCurrent, bumpRefreshGeneration, loadRows, owner, versionIncompatibleEpochRef]);

  const seed = useCallback((rowsByChannel = {}) => {
    if (committedOwnerRef.current !== owner) return;
    const store = storeRef.current;
    for (const [channelId, rows] of Object.entries(rowsByChannel || {})) {
      if (!Array.isArray(rows)) continue;
      store.cache.set(channelId, cacheEntry(rows, owner, channelId));
    }
    publish();
  }, [owner, publish]);

  const clear = useCallback(() => {
    if (committedOwnerRef.current !== owner) return;
    const store = storeRef.current;
    clearTimers();
    store.cache.clear();
    store.authorities.clear();
    store.selves.clear();
    store.attachAuthority = null;
    store.retiredChannels.clear();
    fenceAllRefreshes();
    setBusy(false);
    publish();
  }, [clearTimers, fenceAllRefreshes, owner, publish]);

  const clearChannel = useCallback((channelId) => {
    if (committedOwnerRef.current !== owner) return;
    const store = storeRef.current;
    if (!channelId) return;
    const timer = store.refreshTimers.get(channelId);
    if (timer != null) clearTimeout(timer);
    store.refreshTimers.delete(channelId);
    const currentRows = store.cache.get(channelId)?.rows || [];
    const changed = timer != null
      || !store.cache.has(channelId)
      || (currentRows?.length || 0) > 0
      || store.authorities.has(channelId)
      || store.selves.has(channelId);
    bumpRefreshGeneration(channelId);
    store.retiredChannels.add(channelId);
    store.cache.set(channelId, cacheEntry([], owner, channelId));
    store.authorities.delete(channelId);
    store.selves.delete(channelId);
    if (changed) publish();
  }, [bumpRefreshGeneration, owner, publish]);

  const authority = useCallback((channelId) => storeRef.current.authorities.get(channelId) || null, []);
  const get = useCallback((channelId) => storeRef.current.cache.get(channelId)?.rows || [], []);
  const self = useCallback((channelId) => storeRef.current.selves.get(channelId) || '', []);
  const candidates = useCallback((channelId) => {
    const selfId = self(channelId);
    return get(channelId).filter((row) => row.id !== selfId);
  }, [get, self]);
  const noteSelf = useCallback((channelId, actorId, expectedAuthority) => {
    if (committedOwnerRef.current !== owner
      || !authorityCurrent(channelId, expectedAuthority)) return '';
    if (!channelId || !actorId || storeRef.current.selves.get(channelId) === actorId) return '';
    storeRef.current.selves.set(channelId, actorId);
    return actorId;
  }, [authorityCurrent, owner]);
  const clearSelf = useCallback((channelId, expectedAuthority) => {
    if (committedOwnerRef.current !== owner
      || !authorityCurrent(channelId, expectedAuthority)) return;
    storeRef.current.selves.delete(channelId);
  }, [authorityCurrent, owner]);
  const handleEnvelope = useCallback((channelId, envelope) => {
    if (committedOwnerRef.current !== owner) return;
    const invalidating = [TYPES.narration.memberCreated, TYPES.narration.memberDeleted].includes(envelope?.type)
      || (envelope?.kind === 'response'
        && [TYPES.member.create, TYPES.member.admit, TYPES.member.remove, TYPES.member.restart].includes(envelope.type)
        && argsOf(envelope)?.status === 'completed');
    if (!invalidating) return;
    const timers = storeRef.current.refreshTimers;
    if (timers.has(channelId)) clearTimeout(timers.get(channelId));
    const expectedOwner = owner;
    const expectedEpoch = versionIncompatibleEpochRef.current;
    const expectedAuthority = storeRef.current.attachAuthority;
    if (!authorityCurrent(channelId, expectedAuthority)) return;
    const expectedRefreshGeneration = bumpRefreshGeneration(channelId);
    timers.set(channelId, setTimeout(() => {
      timers.delete(channelId);
      void loadRows(channelId, {
        force: true,
        expectedOwner,
        expectedEpoch,
        expectedRefreshGeneration,
        expectedAuthority,
      }).catch((error) => {
        if (!versionIncompatibleRef.current
          && expectedEpoch === versionIncompatibleEpochRef.current
          && expectedRefreshGeneration === refreshGenerationFor(channelId)
          && committedOwnerRef.current === expectedOwner
          && error?.status !== 401) onError(error);
      });
    }, 300));
  }, [authorityCurrent, bumpRefreshGeneration, loadRows, onError, owner, refreshGenerationFor, versionIncompatibleEpochRef, versionIncompatibleRef]);
  const reset = useCallback(() => {
    if (committedOwnerRef.current !== owner) return;
    const store = storeRef.current;
    clearTimers();
    store.cache.clear();
    store.authorities.clear();
    store.selves.clear();
    store.attachAuthority = null;
    store.retiredChannels.clear();
    fenceAllRefreshes();
    setBusy(false);
    publish();
  }, [clearTimers, fenceAllRefreshes, owner, publish]);
  const close = useCallback(() => {
    if (committedOwnerRef.current !== owner) return;
    const store = storeRef.current;
    fenceAllRefreshes();
    clearTimers();
    store.attachEpoch += 1;
    store.attachAuthority = null;
    store.retiredChannels.clear();
    const hadAuthority = store.authorities.size > 0;
    const hadSelf = store.selves.size > 0;
    store.authorities.clear();
    store.selves.clear();
    if (hadAuthority || hadSelf) publish();
  }, [clearTimers, fenceAllRefreshes, owner, publish]);

  const port = useMemo(() => Object.freeze({
    authority,
    attach,
    candidates,
    clear,
    clearChannel,
    clearSelf,
    close,
    ensure,
    get,
    handleEnvelope,
    noteSelf,
    refresh,
    reset,
    seed,
    self,
  }), [attach, authority, candidates, clear, clearChannel, clearSelf, close, ensure, get, handleEnvelope, noteSelf, refresh, reset, seed, self]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    committedOwnerRef.current = owner;
    rosterRef.current = port;
    return () => {
      mountedRef.current = false;
      clearTimers();
      if (committedOwnerRef.current === owner) {
        const store = storeRef.current;
        fenceAllRefreshes();
        store.attachAuthority = null;
        store.retiredChannels.clear();
        store.authorities.clear();
        store.selves.clear();
        committedOwnerRef.current = null;
      }
      if (rosterRef.current === port) rosterRef.current = null;
    };
  }, [clearTimers, fenceAllRefreshes, owner, port, rosterRef]);

  return {
    authorities: snapshot.authorities,
    busy,
    clear,
    clearChannel,
    principalId,
    refresh,
    rosters: snapshot.rosters,
    seed,
  };
}
