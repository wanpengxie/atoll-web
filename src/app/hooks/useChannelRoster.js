import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export function useChannelRoster({
  generationFor,
  onError,
  ownerToken,
  principalId,
  reconcileIdentity,
  rosterRef,
  versionIncompatibleEpochRef,
  versionIncompatibleRef,
}) {
  const [rosters, setRosters] = useState(new Map());
  const [authorities, setAuthorities] = useState(new Map());
  const [busy, setBusy] = useState(false);
  const committedOwnerRef = useRef(null);
  useLayoutEffect(() => {
    const owner = Object.freeze({ principalId, producerOwnerToken: ownerToken, generationFor });
    committedOwnerRef.current = owner;
    return () => {
      if (committedOwnerRef.current === owner) committedOwnerRef.current = null;
    };
  }, [generationFor, ownerToken, principalId]);

  const publishAuthority = useCallback((channelId, authority, owner, generation) => {
    setAuthorities((current) => {
      const next = new Map(current);
      if (authority?.principalId === owner.principalId && generation > 0) {
        next.set(channelId, Object.freeze({
          principalId: owner.principalId,
          channelId,
          generation,
          current: authority.complete === true,
        }));
      } else {
        next.delete(channelId);
      }
      return next;
    });
  }, []);

  const receive = useCallback((channelId, rows, producerOwnerToken) => {
    const owner = committedOwnerRef.current;
    if (!owner || owner.producerOwnerToken !== producerOwnerToken) return;
    setRosters((current) => new Map(current).set(channelId, rows));
    publishAuthority(
      channelId,
      rosterRef.current?.authority?.(channelId),
      owner,
      Number(owner.generationFor(channelId) || 0),
    );
  }, [committedOwnerRef, publishAuthority, rosterRef]);

  const refresh = useCallback(async (channelId, force) => {
    if (versionIncompatibleRef.current || !channelId || !rosterRef.current) return;
    const incompatibilityEpoch = versionIncompatibleEpochRef.current;
    const owner = committedOwnerRef.current;
    if (!owner) return;
    const generation = Number(owner.generationFor(channelId) || 0);
    setBusy(true);
    try {
      const rows = force
        ? await rosterRef.current.refresh(channelId)
        : await rosterRef.current.ensure(channelId);
      if (versionIncompatibleRef.current
        || incompatibilityEpoch !== versionIncompatibleEpochRef.current
        || committedOwnerRef.current !== owner) return;
      setRosters((current) => new Map(current).set(channelId, rows));
      if (force) {
        const generationStillCurrent = generation > 0
          && Number(owner.generationFor(channelId) || 0) === generation;
        publishAuthority(
          channelId,
          generationStillCurrent ? rosterRef.current.authority?.(channelId) : null,
          owner,
          generation,
        );
      }
      const selfId = rosterRef.current.self(channelId);
      if (selfId) reconcileIdentity(channelId, selfId);
    } catch (error) {
      if (!versionIncompatibleRef.current
        && incompatibilityEpoch === versionIncompatibleEpochRef.current
        && error?.status !== 401) onError(error);
    } finally {
      if (!versionIncompatibleRef.current
        && incompatibilityEpoch === versionIncompatibleEpochRef.current) setBusy(false);
    }
  }, [committedOwnerRef, onError, publishAuthority, reconcileIdentity, rosterRef, versionIncompatibleEpochRef, versionIncompatibleRef]);

  const seed = useCallback((rows) => {
    setRosters(new Map(Object.entries(rows || {})));
  }, []);

  const clear = useCallback(() => {
    setRosters(new Map());
    setAuthorities(new Map());
    setBusy(false);
  }, []);

  const clearChannel = useCallback((channelId) => {
    setRosters((current) => new Map(current).set(channelId, []));
    setAuthorities((current) => {
      if (!current.has(channelId)) return current;
      const next = new Map(current);
      next.delete(channelId);
      return next;
    });
  }, []);

  return {
    authorities,
    busy,
    clear,
    clearChannel,
    principalId,
    receive,
    refresh,
    rosters,
    seed,
  };
}
