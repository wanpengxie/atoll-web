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

  const loadRows = useCallback(async (channelId, {
    force = true,
    expectedEpoch,
    expectedRefreshGeneration,
    expectedOwner,
  } = {}) => {
    const store = storeRef.current;
    if (expectedRefreshGeneration !== undefined
      && refreshGenerationFor(channelId) !== expectedRefreshGeneration) return null;
    const currentOwner = committedOwnerRef.current;
    if (!currentOwner || (expectedOwner && currentOwner !== expectedOwner)) return null;
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
      || (expectedOwner && committedOwnerRef.current !== expectedOwner)) return null;
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
  }, [obsRef, principalId, publish, refreshGenerationFor, versionIncompatibleEpochRef, versionIncompatibleRef]);

  const refresh = useCallback(async (channelId, force = false) => {
    if (versionIncompatibleRef.current || !channelId) return [];
    const expectedEpoch = versionIncompatibleEpochRef.current;
    const expectedOwner = owner;
    if (!expectedOwner) return [];
    const expectedRefreshGeneration = bumpRefreshGeneration(channelId);
    if (mountedRef.current) setBusy(true);
    try {
      const rows = await loadRows(channelId, {
        force,
        expectedEpoch,
        expectedOwner,
        expectedRefreshGeneration,
      });
      if (rows === null) return [];
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
  }, [bumpRefreshGeneration, loadRows, onError, owner, reconcileIdentity, refreshGenerationFor, versionIncompatibleEpochRef, versionIncompatibleRef]);

  const ensure = useCallback((channelId) => {
    const expectedRefreshGeneration = bumpRefreshGeneration(channelId);
    return loadRows(channelId, {
      force: false,
      expectedOwner: owner,
      expectedEpoch: versionIncompatibleEpochRef.current,
      expectedRefreshGeneration,
    });
  }, [bumpRefreshGeneration, loadRows, owner, versionIncompatibleEpochRef]);

  const seed = useCallback((rowsByChannel = {}) => {
    if (committedOwnerRef.current !== owner) return;
    const store = storeRef.current;
    for (const [channelId, rows] of Object.entries(rowsByChannel || {})) {
      if (Array.isArray(rows)) store.cache.set(channelId, cacheEntry(rows, owner, channelId));
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
    store.cache.set(channelId, cacheEntry([], owner, channelId));
    store.authorities.delete(channelId);
    store.selves.delete(channelId);
    if (changed) publish();
  }, [bumpRefreshGeneration, owner, publish]);

  const authority = useCallback((channelId) => storeRef.current.authorities.get(channelId) || null, []);
  const get = useCallback((channelId) => storeRef.current.cache.get(channelId)?.rows || [], []);
  const self = useCallback((channelId) => {
    const rows = storeRef.current.cache.get(channelId)?.rows || [];
    return rows.find((row) => row.kind === 'human' && row.principal === principalId)?.id
      || storeRef.current.selves.get(channelId)
      || '';
  }, [principalId]);
  const candidates = useCallback((channelId) => {
    const selfId = self(channelId);
    return get(channelId).filter((row) => row.id !== selfId);
  }, [get, self]);
  const noteSelf = useCallback((channelId, actorId) => {
    if (committedOwnerRef.current !== owner) return '';
    if (!channelId || !actorId || storeRef.current.selves.get(channelId) === actorId) return '';
    storeRef.current.selves.set(channelId, actorId);
    return actorId;
  }, [owner]);
  const clearSelf = useCallback((channelId) => {
    if (committedOwnerRef.current !== owner) return;
    storeRef.current.selves.delete(channelId);
  }, [owner]);
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
    const expectedRefreshGeneration = bumpRefreshGeneration(channelId);
    timers.set(channelId, setTimeout(() => {
      timers.delete(channelId);
      void loadRows(channelId, {
        force: true,
        expectedOwner,
        expectedEpoch,
        expectedRefreshGeneration,
      }).catch((error) => {
        if (!versionIncompatibleRef.current
          && expectedEpoch === versionIncompatibleEpochRef.current
          && expectedRefreshGeneration === refreshGenerationFor(channelId)
          && committedOwnerRef.current === expectedOwner
          && error?.status !== 401) onError(error);
      });
    }, 300));
  }, [bumpRefreshGeneration, loadRows, onError, owner, refreshGenerationFor, versionIncompatibleEpochRef, versionIncompatibleRef]);
  const reset = useCallback(() => {
    if (committedOwnerRef.current !== owner) return;
    const store = storeRef.current;
    clearTimers();
    store.cache.clear();
    store.authorities.clear();
    store.selves.clear();
    fenceAllRefreshes();
    setBusy(false);
    publish();
  }, [clearTimers, fenceAllRefreshes, owner, publish]);
  const close = useCallback(() => {
    if (committedOwnerRef.current !== owner) return;
    fenceAllRefreshes();
    clearTimers();
  }, [clearTimers, fenceAllRefreshes, owner]);

  const port = useMemo(() => Object.freeze({
    authority,
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
  }), [authority, candidates, clear, clearChannel, clearSelf, close, ensure, get, handleEnvelope, noteSelf, refresh, reset, seed, self]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    committedOwnerRef.current = owner;
    rosterRef.current = port;
    return () => {
      mountedRef.current = false;
      clearTimers();
      if (committedOwnerRef.current === owner) committedOwnerRef.current = null;
      if (rosterRef.current === port) rosterRef.current = null;
    };
  }, [clearTimers, owner, port, rosterRef]);

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
