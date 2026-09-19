import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChannelAccessTracker } from '../../model/channel-access.js';
import { rememberChannelNames } from '../../model/channel-name-cache.js';
import { describeClient } from '../../model/client-label.js';
import { isMobileProfile } from '../../model/device-profile.js';
import { diagnostic } from '../../model/diagnostics.js';
import { ensureServerBoot, readServerBoot } from '../../model/server-boot.js';
import { readWorkspaceBootstrap, writeWorkspaceBootstrap } from '../../model/workspace-bootstrap-cache.js';
import { createObsClient } from '../../net/obs.js';
import { foregroundWake } from '../../net/wake.js';
import { createWire } from '../../net/wire.js';
import { createRoster } from '../../model/roster.js';
import { newId } from '../../util/id.js';

async function loadChannelTree(obs) {
  const found = new Map();
  let level = [undefined];
  const expanded = new Set();
  let complete = true;
  while (level.length) {
    const parents = level.filter((parentId) => {
      const marker = parentId || '__root__';
      if (expanded.has(marker)) return false;
      expanded.add(marker);
      return true;
    });
    const observations = [];
    for (let offset = 0; offset < parents.length; offset += 6) {
      observations.push(...await Promise.all(parents.slice(offset, offset + 6).map(async (parentId) => ({
        observation: await obs.spaceChannels(parentId),
      }))));
    }
    const next = [];
    for (const { observation } of observations) {
      if (observation.complete === false) complete = false;
      for (const item of observation.items || []) {
        const row = item.declared || {};
        if (row.status !== 'present' || !row.id) continue;
        const openMeasure = (item.actual?.measures || []).find((measure) => measure.name === 'open');
        found.set(row.id, { ...row, open: openMeasure?.unknown ? undefined : openMeasure?.value });
        if (!expanded.has(row.id)) next.push(row.id);
      }
    }
    level = next;
  }
  return { channels: found, complete };
}

export function useWireSessionPort() {
  const [state, setState] = useState('closed');
  const [incompatible, setIncompatible] = useState(null);
  const incompatibleRef = useRef(null);
  const incompatibleEpochRef = useRef(0);
  const obsRef = useRef(null);
  const wireRef = useRef(null);
  const rosterRef = useRef(null);
  const accessRef = useRef(null);

  const close = useCallback(() => {
    wireRef.current?.close();
    wireRef.current = null;
    setState('closed');
  }, []);

  return useMemo(() => ({
    accessRef,
    close,
    incompatible,
    incompatibleEpochRef,
    incompatibleRef,
    obsRef,
    rosterRef,
    setIncompatible,
    setState,
    state,
    wireRef,
  }), [close, incompatible, state]);
}

export function useWireConnection({
  accessActionsRef,
  activeChannelRef,
  agentActivityRef,
  bumpAccess,
  cancelFeedTask,
  clearRoster,
  disconnectHistory,
  displayError,
  enqueueFeed,
  expireSession,
  finishHistoryPage,
  finishLiveCheckpoint,
  onServerWorld,
  onSession,
  onWorldChanged,
  port,
  prepareLocalReplica,
  principalId,
  reconcileIdentity,
  resetSubmissionWorld,
  resumeLocalReplica,
  seedRoster,
  setActiveChannelId,
  setChannels,
  setHistoryGrants,
  setTopError,
  stopIncompatibleFeed,
}) {
  const internalAccessActionsRef = useRef({});
  const accessRefreshActionsRef = accessActionsRef || internalAccessActionsRef;
  const {
    accessRef,
    incompatibleEpochRef,
    incompatibleRef,
    obsRef,
    rosterRef,
    setIncompatible,
    setState,
    wireRef,
  } = port;

  useEffect(() => {
    if (!principalId) return undefined;
    setTopError('');
    const obs = createObsClient({ onUnauthorized: expireSession });
    const roster = createRoster({ obs, me: principalId });
    const access = createChannelAccessTracker({ principalId });
    obsRef.current = obs;
    rosterRef.current = roster;
    accessRef.current = access;

    const cachedBootstrap = readWorkspaceBootstrap(principalId);
    let localFocus = activeChannelRef.current;
    if (cachedBootstrap.memberships.length) {
      roster.seed(cachedBootstrap.rosters);
      for (const entry of cachedBootstrap.memberships) roster.noteSelf(entry.channel_id, entry.actor_id);
      seedRoster(cachedBootstrap.rosters);
      access.channelsObserved(cachedBootstrap.profiles, { complete: false });
      access.membershipsObserved(cachedBootstrap.memberships, { complete: false, supported: true });
      access.wire('disconnected');
      setChannels(new Map(cachedBootstrap.profiles.map((row) => [row.id, row])));
      if (!localFocus) {
        localFocus = cachedBootstrap.memberships[0]?.channel_id || '';
        activeChannelRef.current = localFocus;
        if (localFocus) setActiveChannelId(localFocus);
      }
      bumpAccess();
    }

    let alive = true;
    let refreshTimer = null;
    let refreshInFlight = null;
    let refreshQueued = false;
    let attachedOnce = false;
    let wire = null;
    let versionBlocked = false;
    const scheduleAccessRefresh = () => {
      if (!alive || versionBlocked || refreshTimer != null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshAccess();
      }, 250);
    };
    const refreshAccess = () => {
      if (versionBlocked) return Promise.resolve();
      if (refreshInFlight) {
        refreshQueued = true;
        return refreshInFlight;
      }
      refreshInFlight = loadChannelTree(obs).then((result) => {
        if (!alive || versionBlocked) return;
        const profiles = [...result.channels.values()];
        rememberChannelNames(profiles);
        access.channelsObserved(profiles, { complete: result.complete });
        writeWorkspaceBootstrap(principalId, access.snapshot());
        setChannels((current) => result.complete ? result.channels : new Map([...current, ...result.channels]));
        bumpAccess();
      }).catch((error) => {
        if (alive && error?.status !== 401) {
          diagnostic('error', 'directory.refresh_failed', { error });
          setTopError(displayError(error));
        }
      }).finally(() => {
        refreshInFlight = null;
        if (alive && refreshQueued) {
          refreshQueued = false;
          scheduleAccessRefresh();
        }
      });
      return refreshInFlight;
    };
    accessRefreshActionsRef.current = { schedule: scheduleAccessRefresh, refresh: refreshAccess };
    void refreshAccess();

    setState('connecting');
    void prepareLocalReplica(principalId, { focus: localFocus });
    const wireOptions = {
      label: describeClient(),
      maxReconnectDelayMs: isMobileProfile() ? 5_000 : 30_000,
      wake: foregroundWake(),
      since: resumeLocalReplica,
      focus: () => activeChannelRef.current,
      onAttach: (detail) => {
        const sameServerWorld = ensureServerBoot(detail?.boot);
        onServerWorld(String(detail?.boot || readServerBoot()));
        if (!sameServerWorld) {
          access.reset();
          roster.reset();
          resetSubmissionWorld();
          clearRoster();
          setChannels(new Map());
          onWorldChanged();
          bumpAccess();
        }
        return setHistoryGrants(detail?.history_meta || [], {
          ...detail,
          focus: activeChannelRef.current,
          forceReset: !sameServerWorld,
        });
      },
      onFeed: enqueueFeed,
      onCheckpoint: finishLiveCheckpoint,
      onPageEnd: finishHistoryPage,
      onError: (error) => {
        if (error?.code !== 'closed') {
          diagnostic('error', 'wire.failed', { error });
          setTopError(`${error.code}: ${displayError(error)}`);
        }
      },
      onObserveEnded: (channelId, reason) => {
        diagnostic('warn', 'wire.observe_ended', { channelId, reason });
        if (reason === 'channel_retired') access.retire(channelId, reason);
        setTopError(`${channelId} 旁听已结束：${reason}`);
        bumpAccess();
      },
      onState: (state, detail) => {
        if (state === 'incompatible') {
          if (incompatibleRef.current) return;
          versionBlocked = true;
          incompatibleRef.current = detail || {};
          incompatibleEpochRef.current += 1;
          if (refreshTimer != null) clearTimeout(refreshTimer);
          refreshTimer = null;
          accessRefreshActionsRef.current = {};
          agentActivityRef.current.disconnect();
          roster.close();
          access.wire('disconnected');
          stopIncompatibleFeed(detail?.generation);
          setState('incompatible');
          setIncompatible((current) => current || detail || {});
        } else if (state === 'attached') {
          onSession({ id: detail?.session || '', label: detail?.session_label || '' });
          agentActivityRef.current.attach(detail);
          access.wire('attached', newId());
          if (Array.isArray(detail?.memberships)) {
            const rows = detail.memberships
              .filter((entry) => entry?.channel_id)
              .map((entry) => ({ channel_id: entry.channel_id, status: 'active', actor_id: entry.actor_id || '' }));
            const memberedBefore = access.rows()
              .filter((row) => row.accessState?.relationship === 'member')
              .map((row) => row.id);
            access.membershipsObserved(rows, { complete: detail.memberships_complete === true, supported: true });
            writeWorkspaceBootstrap(principalId, access.snapshot());
            for (const entry of rows) {
              if (!roster.noteSelf(entry.channel_id, entry.actor_id)) continue;
              reconcileIdentity(entry.channel_id, entry.actor_id);
            }
            for (const channelId of memberedBefore) {
              if (access.state(channelId)?.relationship !== 'member') roster.clearSelf(channelId);
            }
          }
          setState('open');
          if (attachedOnce) scheduleAccessRefresh();
          attachedOnce = true;
        } else if (state === 'disconnected') {
          agentActivityRef.current.disconnect();
          disconnectHistory(detail?.generation);
        } else if (state === 'reconnecting') {
          agentActivityRef.current.disconnect();
          access.wire('disconnected');
          setState('reconnecting');
        } else if (state === 'closed') {
          agentActivityRef.current.disconnect();
          access.wire('disconnected');
          setState('closed');
        } else if (state === 'open') {
          setState((current) => current === 'open' ? current : 'connecting');
        }
        bumpAccess();
      },
    };
    queueMicrotask(() => {
      if (!alive) return;
      wire = createWire(wireOptions);
      wireRef.current = wire;
    });

    return () => {
      alive = false;
      if (refreshTimer != null) clearTimeout(refreshTimer);
      accessRefreshActionsRef.current = {};
      wire?.close();
      roster.close();
      cancelFeedTask();
      obsRef.current = null;
      rosterRef.current = null;
      accessRef.current = null;
      wireRef.current = null;
    };
  }, [accessRef, accessRefreshActionsRef, activeChannelRef, agentActivityRef, bumpAccess, cancelFeedTask, clearRoster, disconnectHistory, displayError, enqueueFeed, expireSession, finishHistoryPage, finishLiveCheckpoint, incompatibleEpochRef, incompatibleRef, obsRef, onServerWorld, onSession, onWorldChanged, prepareLocalReplica, principalId, reconcileIdentity, resetSubmissionWorld, resumeLocalReplica, rosterRef, seedRoster, setActiveChannelId, setChannels, setHistoryGrants, setIncompatible, setState, setTopError, stopIncompatibleFeed, wireRef]);

  return accessRefreshActionsRef;
}
