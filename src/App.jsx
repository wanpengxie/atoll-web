import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { capabilityIndexFromState } from './model/capabilities.js';
import { unreadCount } from './model/cursors.js';
import { CHANNEL_ACCESS, createChannelAccessTracker, isMemberAccess } from './model/channel-access.js';
import { resumeSnapshot } from './model/feed-cache.js';
import { createChannelState, reconcileApprovals } from './model/fold.js';
import { createRoster } from './model/roster.js';
import { readFileTicket } from './model/resources.js';
import { safeDaemonRows } from './model/space-administration.js';
import { createObsClient, ObsError } from './net/obs.js';
import { createWire } from './net/wire.js';
import { Auth } from './ui/Auth.jsx';
import { AppShell } from './app/AppShell.jsx';
import { useLocalAutomation } from './app/hooks/useLocalAutomation.js';
import { useSubmissions } from './app/hooks/useSubmissions.js';
import { useAtollSession } from './app/hooks/useAtollSession.js';
import { useChannelDirectory } from './app/hooks/useChannelDirectory.js';
import { useChannelFeed } from './app/hooks/useChannelFeed.js';

function displayError(error) {
  if (error instanceof ObsError && error.status === 503) return '频道未在服务';
  return error?.detail || error?.message || String(error);
}

async function loadChannelTree(obs) {
  const found = new Map();
  const queue = [undefined];
  const expanded = new Set();
  let complete = true;
  while (queue.length) {
    const parentId = queue.shift();
    const marker = parentId || '__root__';
    if (expanded.has(marker)) continue;
    expanded.add(marker);
    const observation = await obs.spaceChannels(parentId);
    if (observation.complete === false) complete = false;
    for (const item of observation.items || []) {
      const row = item.declared || {};
      if (row.status !== 'present' || !row.id) continue;
      const openMeasure = (item.actual?.measures || []).find((measure) => measure.name === 'open');
      found.set(row.id, { ...row, open: openMeasure?.unknown ? undefined : openMeasure?.value });
      if (!expanded.has(row.id)) queue.push(row.id);
    }
  }
  return { channels: found, complete };
}

export default function App() {
  const [wireState, setWireState] = useState('closed');
  const [topError, setTopError] = useState('');
  const [rosters, setRosters] = useState(new Map());
  const [rosterBusy, setRosterBusy] = useState(false);
  const [channelNotice, setChannelNotice] = useState('');
  const [selectedActor, setSelectedActor] = useState(null);
  const [rightPanel, setRightPanel] = useState('roster');
  const [spacePrincipals, setSpacePrincipals] = useState([]);
  const [spaceDeclarations, setSpaceDeclarations] = useState([]);
  const [spaceDaemons, setSpaceDaemons] = useState([]);
  const [draftAttachments, setDraftAttachments] = useState({});

  const obsRef = useRef(null);
  const wireRef = useRef(null);
  const rosterRef = useRef(null);
  const accessRef = useRef(null);
  const activeChannelRef = useRef('');
  const showSessionError = useCallback((error) => setTopError(displayError(error)), []);
  const { booting, principal: me, identity, accept: handleAuthed, clear: clearSession, logoutRemote } = useAtollSession({ onError: showSessionError });
  const { records: timerRecords, markFired: markTimerFired, after: handleAfter, cancel: handleCancelTimer, clear: clearTimers } = useLocalAutomation({ principalId: me?.id, wireRef, activeChannelRef });
  const directoryActionsRef = useRef({});
  const submissionActionsRef = useRef({});
  const receiveRoster = useCallback((channelId, rows) => setRosters((current) => new Map(current).set(channelId, rows)), []);
  const receiveFeedError = useCallback((error) => setTopError(displayError(error)), []);
  const forwardChannels = useCallback((channelIds) => directoryActionsRef.current.discover?.(channelIds), []);
  const forwardSubmissionFeed = useCallback((landed, closed) => submissionActionsRef.current.reconcile?.(landed, closed), []);
  const forwardAccessChanged = useCallback(() => directoryActionsRef.current.bump?.(), []);
  const { statesRef: channelStatesRef, cursorsRef, version: feedVersion, bump: bumpFeed, enqueue: enqueueFeed, cancel: cancelFeedTask, clear: clearFeed } = useChannelFeed({ rosterRef, accessRef, activeChannelRef, onRoster: receiveRoster, onError: receiveFeedError, onChannelsDiscovered: forwardChannels, onTimerFired: markTimerFired, onSubmissionFeed: forwardSubmissionFeed, onAccessChanged: forwardAccessChanged });
  const channelChanged = useCallback(() => { setSelectedActor(null); setRightPanel('roster'); }, []);
  const directory = useChannelDirectory({ accessRef, channelStatesRef, cursorsRef, rosterRef, onChannelChanged: channelChanged, onNotice: setChannelNotice });
  const { channels, setChannels, rows: channelList, bump: bumpAccess, activeChannelId, setActiveChannelId, select: selectChannel, clear: clearDirectory } = directory;
  const submissions = useSubmissions({ principalId: me?.id, activeChannelId, wireRef, rosterRef, accessRef, channelStatesRef, onError: setTopError, onNotice: setChannelNotice, onFeedChanged: bumpFeed, onAccessChanged: bumpAccess });
  const { pending, approvalStates, controlStates, send: handleSend, retry: handleRetry, resolve: handleResolve, cancel: handleCancel, reconcileFeed: reconcileSubmissionFeed, clear: clearSubmissions } = submissions;
  directoryActionsRef.current.bump = bumpAccess;
  directoryActionsRef.current.discover = (channelIds) => setChannels((current) => {
    const missing = [...channelIds].filter((channelId) => !current.has(channelId));
    if (!missing.length) return current;
    const next = new Map(current);
    for (const channelId of missing) next.set(channelId, { id: channelId, name: channelId.slice(0, 8), status: 'present' });
    return next;
  });
  submissionActionsRef.current.reconcile = reconcileSubmissionFeed;

  useEffect(() => {
    activeChannelRef.current = activeChannelId;
  }, [activeChannelId]);

  const expireSession = useCallback(() => {
    wireRef.current?.close();
    wireRef.current = null;
    clearFeed();
    clearDirectory();
    accessRef.current = null;
    setRosters(new Map());
    setChannelNotice('');
    setSelectedActor(null);
    clearSubmissions();
    setRightPanel('roster');
    setSpacePrincipals([]);
    setSpaceDeclarations([]);
    setSpaceDaemons([]);
    clearTimers();
    setDraftAttachments({});
    clearSession();
    setWireState('closed');
  }, [clearDirectory, clearFeed, clearSession, clearSubmissions, clearTimers]);

  useEffect(() => {
    if (!me) return undefined;
    setTopError('');
    const obs = createObsClient({ onUnauthorized: expireSession });
    const roster = createRoster({ obs, me: me.id });
    const access = createChannelAccessTracker({ principalId: me.id });
    obsRef.current = obs;
    rosterRef.current = roster;
    accessRef.current = access;

    let alive = true;
    const refreshAccess = () => Promise.all([
      loadChannelTree(obs),
      obs.spaceMemberships().catch((error) => {
        if (error?.status === 404) return { items: [], complete: false, unsupported: true };
        throw error;
      }),
    ]).then(([result, membershipObservation]) => {
      if (!alive) return;
      const profiles = [...result.channels.values()];
      access.channelsObserved(profiles, { complete: result.complete });
      const membershipRows = (membershipObservation.items || []).map((item) => item.declared || {}).filter((row) => row.channel_id);
      access.membershipsObserved(membershipRows, {
        complete: membershipObservation.complete !== false,
        supported: !membershipObservation.unsupported,
      });
      for (const membership of membershipRows.filter((row) => row.status === 'revoked')) roster.clearSelf(membership.channel_id);
      setChannels((current) => result.complete ? result.channels : new Map([...current, ...result.channels]));
      bumpAccess();
    }).catch((error) => { if (alive && error?.status !== 401) setTopError(displayError(error)); });
    refreshAccess();
    const accessTimer = setInterval(refreshAccess, 1_500);

    setWireState('connecting');
    const wire = createWire({
      since: () => resumeSnapshot(channelStatesRef.current),
      onFeed: enqueueFeed,
      onError: (error) => {
        if (error?.code !== 'closed') setTopError(`${error.code}: ${displayError(error)}`);
      },
      onObserveEnded: (channelId, reason) => {
        if (reason === 'channel_retired') access.retire(channelId, reason);
        setTopError(`${channelId} 旁听已结束：${reason}`);
        bumpAccess();
      },
      onState: (state) => {
        if (state === 'attached') {
          access.wire('attached', crypto.randomUUID());
          setWireState('open');
        } else if (state === 'reconnecting') {
          access.wire('disconnected');
          setWireState('reconnecting');
        } else if (state === 'closed') {
          access.wire('disconnected');
          setWireState('closed');
        }
        else if (state === 'open') setWireState((current) => current === 'open' ? current : 'connecting');
        bumpAccess();
      },
    });
    wireRef.current = wire;

    return () => {
      alive = false;
      clearInterval(accessTimer);
      wire.close();
      roster.close();
      cancelFeedTask();
      obsRef.current = null;
      rosterRef.current = null;
      accessRef.current = null;
      wireRef.current = null;
    };
  }, [bumpAccess, cancelFeedTask, enqueueFeed, expireSession, me]);

  const refreshRoster = useCallback(async (channelId, force = false) => {
    if (!channelId || !rosterRef.current) return;
    setRosterBusy(true);
    try {
      const rows = force
        ? await rosterRef.current.refresh(channelId)
        : await rosterRef.current.ensure(channelId);
      setRosters((current) => new Map(current).set(channelId, rows));
      const selfId = rosterRef.current.self(channelId);
      const state = channelStatesRef.current.get(channelId);
      if (state && selfId) {
        reconcileApprovals(state, selfId);
        bumpFeed();
      }
    } catch (error) {
      if (error?.status !== 401) setTopError(displayError(error));
    } finally {
      setRosterBusy(false);
    }
  }, [bumpFeed]);

  useEffect(() => {
    if (!activeChannelId || !me) return;
    const access = channelList.find((channel) => channel.id === activeChannelId)?.access;
    if (!isMemberAccess(access)) {
      setRosters((current) => new Map(current).set(activeChannelId, []));
      return;
    }
    refreshRoster(activeChannelId);
  }, [activeChannelId, channelList, me, refreshRoster]);

  useEffect(() => {
    if (!activeChannelId) return;
    const lastSeq = channelStatesRef.current.get(activeChannelId)?.lastSeq || 0;
    cursorsRef.current.markRead(activeChannelId, lastSeq);
  }, [activeChannelId, feedVersion]);

  const handleLogout = useCallback(async () => {
    await logoutRemote();
    expireSession();
  }, [expireSession, logoutRemote]);

  const refreshGovernanceData = useCallback(async () => {
    if (!obsRef.current) return;
    try {
      const [principalObservation, declarationObservation, daemonObservation] = await Promise.all([
        obsRef.current.spacePrincipals(),
        obsRef.current.spaceDecls(),
        obsRef.current.spaceDaemons(),
      ]);
      setSpacePrincipals(principalObservation.items || []);
      setSpaceDeclarations(declarationObservation.items || []);
      setSpaceDaemons(safeDaemonRows(daemonObservation));
      await Promise.all([refreshRoster(activeChannelRef.current, true), activeChannelRef.current !== 'c0' ? refreshRoster('c0', true) : Promise.resolve()]);
    } catch (error) {
      if (error?.status !== 401) setTopError(displayError(error));
    }
  }, [refreshRoster]);

  useEffect(() => {
    if (!['create-channel', 'governance', 'space', 'resources'].includes(rightPanel)) return;
    refreshGovernanceData();
  }, [rightPanel, activeChannelId, refreshGovernanceData]);

  const handleResource = useCallback(async (payload) => {
    if (!wireRef.current) throw new TypeError('连接尚未就绪');
    return wireRef.current.resource(payload);
  }, []);

  const handleDownloadResource = useCallback(async (channelId, attachment) => {
    try {
      const receipt = await handleResource(readFileTicket({ channelId, resourceId: attachment.resource_id }));
      const address = receipt.address || attachment.address;
      if (!receipt.ticket || !address) throw new TypeError('服务端没有返回可下载票据');
      const response = await fetch(`/files/${encodeURIComponent(address)}?t=${encodeURIComponent(receipt.ticket)}`, { credentials: 'include' });
      if (!response.ok) throw new TypeError(`下载失败 (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = attachment.name || 'download'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) { setTopError(displayError(error)); }
  }, [handleResource]);

  const handleTaskControl = useCallback(async ({ channelId, turn, actorId, type, payload }) => {
    if (!channelId || !turn || !actorId) return;
    await handleSend({
      channelId,
      text: payload?.text || `${type} → ${actorId}`,
      msgType: type,
      audience: [actorId],
      targetLabel: actorId,
      payload,
      parentId: turn.requestId,
    });
  }, [handleSend]);

  const describeActor = useCallback(async (actor, channelId = activeChannelId) => {
    if (!actor || !channelId) return;
    await handleSend({
      channelId,
      text: `读取 ${actor.name || actor.id} 的能力`,
      msgType: 'actor.describe',
      audience: [actor.id],
      targetLabel: actor.name || actor.id,
      payload: {},
    });
  }, [activeChannelId, handleSend]);

  const handleSelectActor = useCallback((actor) => {
    setSelectedActor(actor);
    const state = channelStatesRef.current.get(activeChannelId);
    const capability = capabilityIndexFromState(state).get(actor.id);
    if (!capability?.describe && !capability?.loading) describeActor(actor, activeChannelId);
  }, [activeChannelId, describeActor]);

  const handleInvokeActor = useCallback(async (type, payload) => {
    if (!selectedActor || !activeChannelId) return;
    await handleSend({
      channelId: activeChannelId,
      text: payload?.text || `${type} → ${selectedActor.name || selectedActor.id}`,
      msgType: type,
      audience: [selectedActor.id],
      targetLabel: selectedActor.name || selectedActor.id,
      payload,
    });
  }, [activeChannelId, handleSend, selectedActor]);

  if (booting) return <div className="boot-screen"><span className="brand-dot" />正在恢复会话…</div>;
  if (!me) return <Auth identity={identity} onAuthed={handleAuthed} />;

  const activeState = channelStatesRef.current.get(activeChannelId) || createChannelState(activeChannelId);
  const activeRow = channelList.find((channel) => channel.id === activeChannelId);
  const activeRoster = isMemberAccess(activeRow?.access) ? rosters.get(activeChannelId) || [] : [];
  const selfId = activeRow?.selfActorId || rosterRef.current?.self(activeChannelId) || '';
  const unread = Object.fromEntries(channelList.map((channel) => [
    channel.id,
    unreadCount(
      channelStatesRef.current.get(channel.id),
      cursorsRef.current.read(channel.id),
      rosterRef.current?.self(channel.id) || '',
    ),
  ]));
  const activeChannel = activeRow || channels.get(activeChannelId);
  const activeAccess = activeRow?.access || CHANNEL_ACCESS.loading;
  const capabilityIndex = capabilityIndexFromState(activeState);
  const selectedCapability = selectedActor ? capabilityIndex.get(selectedActor.id) : null;

  const setPanel = (value) => { setSelectedActor(null); setRightPanel(value); };
  const togglePanel = (value) => setPanel(rightPanel === value ? 'roster' : value);
  const host = {
    panel: { value: rightPanel, set: setRightPanel },
    active: { channel: activeChannel, state: activeState, roster: activeRoster, access: activeAccess, selfId, wireState },
    directory: { channels: channelList },
    governance: { principals: spacePrincipals, declarations: spaceDeclarations, daemons: spaceDaemons, registrarRoster: rosters.get('c0') || (activeChannelId === 'c0' ? activeRoster : []), rootState: channelStatesRef.current.get('c0'), version: feedVersion, onSubmit: handleSend, onRefresh: refreshGovernanceData },
    resources: { onResource: handleResource, onAttach: (attachment) => setDraftAttachments((current) => ({ ...current, [activeChannelId]: [...(current[activeChannelId] || []).filter((row) => row.resource_id !== attachment.resource_id), attachment] })) },
    automation: { records: timerRecords, onAfter: handleAfter, onCancel: handleCancelTimer },
    roster: { busy: rosterBusy, onRefresh: () => refreshRoster(activeChannelId, true), selectedActor, capability: selectedCapability, onSelectActor: handleSelectActor, onCloseActor: () => setSelectedActor(null), onDescribe: () => describeActor(selectedActor, activeChannelId), onInvoke: handleInvokeActor },
  };
  return <AppShell
    session={{ me, wireState, onLogout: handleLogout }}
    navigation={{ channels: channelList, activeChannelId, unread, onSelect: selectChannel, onCreate: () => setPanel('create-channel'), onSpaceManage: () => setPanel('space') }}
    workspace={{ channel: activeChannel, state: activeState, access: activeAccess, roster: activeRoster, selfId, pending: pending.filter((item) => item.channelId === activeChannelId), approvalStates, controlStates, capabilityIndex, onResolve: handleResolve, onRetry: handleRetry, onCancel: handleCancel, onTaskControl: handleTaskControl, onDownloadResource: handleDownloadResource, onSend: handleSend, attachments: draftAttachments[activeChannelId] || [], onRemoveAttachment: (resourceId) => setDraftAttachments((current) => ({ ...current, [activeChannelId]: (current[activeChannelId] || []).filter((row) => row.resource_id !== resourceId) })), onClearAttachments: () => setDraftAttachments((current) => ({ ...current, [activeChannelId]: [] })) }}
    notices={{ error: topError, channel: channelNotice, dismissError: () => setTopError(''), dismissChannel: () => setChannelNotice('') }}
    panel={{ value: rightPanel, toggle: togglePanel, host }}
  />;
}
