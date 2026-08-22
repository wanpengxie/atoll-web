import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { capabilityIndexFromState } from './model/capabilities.js';
import { ensureServerBoot } from './model/server-boot.js';
import { artifactKindForMediaType, buildArtifactIndex, previewForMediaType } from './model/artifacts.js';
import { fileTransferURL, uploadChannelFile } from './model/channel-file-transfer.js';
import { unreadCount } from './model/cursors.js';
import { canViewChannelContent, canWriteChannel, CHANNEL_ACCESS, createChannelAccessTracker, isMemberAccess } from './model/channel-access.js';
import { resumeSnapshot } from './model/feed-cache.js';
import { createChannelState, reconcileApprovals } from './model/fold.js';
import { createRoster } from './model/roster.js';
import { readFileTicket } from './model/resources.js';
import { safeDaemonRows } from './model/space-administration.js';
import { buildWorkItemIndex, taskProviders } from './model/work-items.js';
import { parseWorkspaceHash, writeWorkspaceRoute } from './model/workspace-route.js';
import { messagePresentation } from './model/message-presentation.js';
import { isSystemWord, TYPES } from './protocol/vocab.js';
import { newId } from './util/id.js';
import { activeOperations, buildActivityIndex, buildGlobalSearchIndex, buildOperationIndex } from './model/activity.js';
import { normalizeAgentSelection } from './model/agent-selection.js';
import { createObsClient, isUnsupportedMembershipObservation, ObsError } from './net/obs.js';
import { createWire } from './net/wire.js';
import { Auth } from './ui/Auth.jsx';
import { AppShell } from './app/AppShell.jsx';
import { TaskCreateModal } from './ui/TaskCreateModal.jsx';
import { ChannelCreateModal } from './ui/ChannelCreateModal.jsx';
import { GlobalSearch } from './ui/GlobalSearch.jsx';
import { FilePreviewModal } from './ui/FilePreviewModal.jsx';
import { ChannelFilePickerModal } from './ui/ChannelFilePickerModal.jsx';
import { visibleRosterRows } from './ui/roster-visibility.js';
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

// 治理操作 = 写入类的 system 词。读取类（list / get / describe）不进操作台。
const GOVERNANCE_READ_TYPES = new Set([
  TYPES.channel.get, TYPES.channel.list, TYPES.channelTemplate.get, TYPES.channelTemplate.list,
  TYPES.actorTemplate.get, TYPES.actorTemplate.list, TYPES.principal.get, TYPES.principal.list,
  TYPES.device.list, TYPES.member.list, TYPES.member.get, TYPES.log.recent,
]);

function isGovernanceOperation(type = '') {
  return isSystemWord(type) && !GOVERNANCE_READ_TYPES.has(type);
}

function governanceOperationTitle(turn) {
  const type = turn.request?.type || '';
  const payload = turn.request?.payload || {};
  const known = messagePresentation(turn.request || {});
  if (type === TYPES.channel.create) return `创建频道 ${payload.name || ''}`.trim();
  return known.detail ? `${known.text} ${known.detail}`.trim() : known.text || payload.title || type;
}

function governanceOperation(channel, turn, channelRows) {
  const terminal = turn.terminal?.payload;
  let state = terminal?.status === 'failed' ? 'failed' : terminal?.status === 'cancelled' ? 'cancelled' : terminal?.status === 'completed' ? 'completed' : 'waiting_ledger';
  let detail = terminal ? '账本已确认' : '等待账本确认';
  if (turn.request?.type === TYPES.channel.create && terminal?.status === 'completed') {
    const expected = `${channel.qualified_name || channel.name || channel.id}.${turn.request.payload?.name || ''}`;
    const created = channelRows.find((row) => row.id === terminal.value?.channel_id || row.qualified_name === expected);
    if (!created) { state = 'waiting_projection'; detail = '等待频道可观察'; }
    else if (!isMemberAccess(created.access)) { state = 'waiting_projection'; detail = '等待成员关系'; }
    else if (created.open !== true) { state = 'waiting_projection'; detail = '等待服务就绪'; }
    else detail = '四步已经收敛';
  }
  return {
    key: turn.requestId,
    operationId: turn.requestId,
    requestId: turn.requestId,
    channelId: channel.id,
    kind: 'governance',
    title: governanceOperationTitle(turn),
    detail,
    state,
    startedAt: turn.request?.ts || turn.requestSeq,
    updatedAt: turn.terminal?.ts || turn.lastSeq || turn.requestSeq,
    source: { channelId: channel.id, view: 'dynamic', objectType: 'turn', objectId: turn.requestId, requestId: turn.requestId },
  };
}

export default function App() {
  const initialRouteRef = useRef(parseWorkspaceHash(window.location.hash));
  const routeInitializedRef = useRef(false);
  const [wireState, setWireState] = useState('closed');
  const [topError, setTopError] = useState('');
  const [rosters, setRosters] = useState(new Map());
  const [rosterBusy, setRosterBusy] = useState(false);
  const [channelNotice, setChannelNotice] = useState('');
  const [selectedActor, setSelectedActor] = useState(null);
  const [rightPanel, setRightPanel] = useState('');
  const [contextFocus, setContextFocus] = useState(null);
  const [workspaceView, setWorkspaceView] = useState(initialRouteRef.current.view);
  const workspaceViewsRef = useRef(new Map());
  const [spacePrincipals, setSpacePrincipals] = useState([]);
  const [spaceDeclarations, setSpaceDeclarations] = useState([]);
  const [spaceDaemons, setSpaceDaemons] = useState([]);
  const [draftAttachments, setDraftAttachments] = useState({});
  // 草稿是编辑器私有的临时状态，不是工作区渲染状态。这里仅用 ref 做跨频道、
  // 跨主视图的本地持久化；逐字输入不得触发 App/Timeline 重渲染。
  const draftTextsRef = useRef({});
  const [taskCreateSource, setTaskCreateSource] = useState(undefined);
  const [channelCreateOpen, setChannelCreateOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [mountedFilePreview, setMountedFilePreview] = useState(null);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [mockAdvance, setMockAdvance] = useState({ available: false, busy: false });
  const [agentSelection, setAgentSelection] = useState({ channelId: '', value: null, busy: false });

  const obsRef = useRef(null);
  const wireRef = useRef(null);
  const rosterRef = useRef(null);
  const accessRef = useRef(null);
  const activeChannelRef = useRef('');
  const showSessionError = useCallback((error) => setTopError(displayError(error)), []);
  const { booting, principal: me, identity, accept: handleAuthed, clear: clearSession, logoutRemote } = useAtollSession({ onError: showSessionError });

  useEffect(() => {
    if (!me || !import.meta.env.DEV) return undefined;
    const controller = new AbortController();
    fetch('/mock/control/catalog', { credentials: 'same-origin', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((catalog) => { if (catalog?.agent_advance === true) setMockAdvance({ available: true, busy: false }); })
      .catch((error) => { if (error?.name !== 'AbortError') setMockAdvance({ available: false, busy: false }); });
    return () => controller.abort();
  }, [me]);
  const { records: timerRecords, markFired: markTimerFired, after: handleAfter, cancel: handleCancelTimer, clear: clearTimers } = useLocalAutomation({ principalId: me?.id, wireRef, activeChannelRef });
  const directoryActionsRef = useRef({});
  const submissionActionsRef = useRef({});
  const accessRefreshActionsRef = useRef({});
  const receiveRoster = useCallback((channelId, rows) => setRosters((current) => new Map(current).set(channelId, rows)), []);
  const receiveFeedError = useCallback((error) => setTopError(displayError(error)), []);
  const forwardChannels = useCallback((channelIds) => directoryActionsRef.current.discover?.(channelIds), []);
  const forwardDirectoryInvalidated = useCallback(() => accessRefreshActionsRef.current.schedule?.(), []);
  const forwardSubmissionFeed = useCallback((landed, closed) => submissionActionsRef.current.reconcile?.(landed, closed), []);
  const forwardAccessChanged = useCallback(() => directoryActionsRef.current.bump?.(), []);
  const { statesRef: channelStatesRef, cursorsRef, version: feedVersion, bump: bumpFeed, enqueue: enqueueFeed, cancel: cancelFeedTask, clear: clearFeed } = useChannelFeed({ rosterRef, accessRef, activeChannelRef, onRoster: receiveRoster, onError: receiveFeedError, onChannelsDiscovered: forwardChannels, onDirectoryInvalidated: forwardDirectoryInvalidated, onTimerFired: markTimerFired, onSubmissionFeed: forwardSubmissionFeed, onAccessChanged: forwardAccessChanged });
  const channelChanged = useCallback(() => { setSelectedActor(null); setContextFocus(null); setMountedFilePreview(null); setRightPanel(''); setTaskCreateSource(undefined); setChannelCreateOpen(false); setGlobalSearchOpen(false); }, []);
  const directory = useChannelDirectory({ accessRef, channelStatesRef, cursorsRef, rosterRef, onChannelChanged: channelChanged, onNotice: setChannelNotice });
  const { channels, setChannels, rows: channelList, bump: bumpAccess, activeChannelId, setActiveChannelId, select: selectChannel, clear: clearDirectory } = directory;

  const loadAgentSelection = useCallback(async (actorId = '') => {
    if (!activeChannelId || !obsRef.current) return null;
    const observation = await obsRef.current.channelAgentSelection(activeChannelId, actorId);
    return normalizeAgentSelection(observation?.items?.[0] || observation);
  }, [activeChannelId]);

  useEffect(() => {
    const applyRoute = () => {
      const route = parseWorkspaceHash(window.location.hash);
      if (!route.valid || !channelList.some((channel) => channel.id === route.channelId)) return;
      routeInitializedRef.current = true;
      setActiveChannelId(route.channelId);
      setWorkspaceView(route.view);
      workspaceViewsRef.current.set(route.channelId, route.view);
      if (route.focus?.type === 'channel') {
        setContextFocus(route.focus);
        setRightPanel('governance');
      } else if (route.focus?.type === 'participant') {
        setContextFocus(route.focus);
        setRightPanel('roster-focus');
      } else if (route.focus?.type === 'artifact') {
        setContextFocus(route.focus);
        setRightPanel('artifact-focus');
      } else if (route.focus?.type === 'turn') {
        setContextFocus(route.focus);
        setRightPanel('');
      } else if (route.focus?.type === 'work_item') {
        setContextFocus(route.focus);
        setRightPanel('work-item-focus');
      } else {
        setContextFocus(null);
        setRightPanel((current) => !route.focus && ['space', 'activity'].includes(current) ? current : '');
        if (route.focus) setChannelNotice('对象暂不可用，已保留当前主视图。');
      }
    };
    if (!routeInitializedRef.current) applyRoute();
    window.addEventListener('hashchange', applyRoute);
    window.addEventListener('popstate', applyRoute);
    return () => {
      window.removeEventListener('hashchange', applyRoute);
      window.removeEventListener('popstate', applyRoute);
    };
  }, [channelList, setActiveChannelId]);

  useEffect(() => {
    if (!activeChannelId) return;
    const route = parseWorkspaceHash(window.location.hash);
    if (!route.valid) {
      const view = workspaceViewsRef.current.get(activeChannelId) || workspaceView;
      setWorkspaceView(view);
      writeWorkspaceRoute({ channelId: activeChannelId, view }, { replace: true });
    }
  }, [activeChannelId, workspaceView]);
  const submissions = useSubmissions({ principalId: me?.id, activeChannelId, wireRef, rosterRef, accessRef, channelStatesRef, onError: setTopError, onNotice: setChannelNotice, onFeedChanged: bumpFeed, onAccessChanged: bumpAccess });
  const { pending, approvalStates, controlStates, send: handleSend, retry: handleRetry, resolve: handleResolve, cancel: handleCancel, reconcileFeed: reconcileSubmissionFeed, clear: clearSubmissions } = submissions;
  directoryActionsRef.current.bump = bumpAccess;
  directoryActionsRef.current.discover = (channelIds) => setChannels((current) => {
    const missing = [...channelIds].filter((channelId) => !current.has(channelId));
    if (!missing.length) return current;
    const next = new Map(current);
    for (const channelId of missing) next.set(channelId, { id: channelId, name: channelId.slice(0, 8), status: 'present' });
    accessRefreshActionsRef.current.schedule?.();
    return next;
  });
  submissionActionsRef.current.reconcile = reconcileSubmissionFeed;

  useEffect(() => {
    activeChannelRef.current = activeChannelId;
  }, [activeChannelId]);

  useEffect(() => {
    if (!activeChannelId || wireState !== 'open' || !obsRef.current) {
      setAgentSelection({ channelId: activeChannelId || '', value: null, busy: false });
      return undefined;
    }
    let alive = true;
    setAgentSelection({ channelId: activeChannelId, value: null, busy: false });
    loadAgentSelection().then((value) => {
      if (!alive) return;
      setAgentSelection({ channelId: activeChannelId, value, busy: false });
    }).catch((error) => {
      if (!alive || error?.status === 401) return;
      // 这是待正式化的可选观察面。旧后端缺失时不阻塞消息输入。
      setAgentSelection({ channelId: activeChannelId, value: null, busy: false });
    });
    return () => { alive = false; };
  }, [activeChannelId, wireState, loadAgentSelection]);

  const expireSession = useCallback(() => {
    wireRef.current?.close();
    wireRef.current = null;
    clearFeed();
    clearDirectory();
    accessRef.current = null;
    setRosters(new Map());
    setChannelNotice('');
    setSelectedActor(null);
    setContextFocus(null);
    setMountedFilePreview(null);
    clearSubmissions();
    setRightPanel('');
    setSpacePrincipals([]);
    setSpaceDeclarations([]);
    setSpaceDaemons([]);
    clearTimers();
    setDraftAttachments({});
    draftTextsRef.current = {};
    setTaskCreateSource(undefined);
    setChannelCreateOpen(false);
    setGlobalSearchOpen(false);
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
    let membershipObservationSupported = true;
    const readMemberships = () => {
      if (!membershipObservationSupported) return Promise.resolve({ items: [], complete: false, unsupported: true });
      return obs.spaceMemberships().catch((error) => {
        if (isUnsupportedMembershipObservation(error)) {
          membershipObservationSupported = false;
          return { items: [], complete: false, unsupported: true };
        }
        throw error;
      });
    };
    let refreshTimer = null;
    let refreshInFlight = null;
    let refreshQueued = false;
    let attachedOnce = false;
    const refreshAccess = () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return refreshInFlight;
      }
      refreshInFlight = Promise.all([loadChannelTree(obs), readMemberships()]).then(([result, membershipObservation]) => {
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
      }).catch((error) => { if (alive && error?.status !== 401) setTopError(displayError(error)); }).finally(() => {
        refreshInFlight = null;
        if (alive && refreshQueued) {
          refreshQueued = false;
          scheduleAccessRefresh();
        }
      });
      return refreshInFlight;
    };
    const scheduleAccessRefresh = () => {
      if (!alive || refreshTimer != null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshAccess();
      }, 250);
    };
    accessRefreshActionsRef.current.schedule = scheduleAccessRefresh;
    accessRefreshActionsRef.current.refresh = refreshAccess;
    refreshAccess();

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
      onState: (state, detail) => {
        if (state === 'attached') {
          // 服务器世代变了：本地缓存整体作废后重载一次，恒不要求用户手清。
          if (!ensureServerBoot(detail?.boot)) { window.location.reload(); return; }
          access.wire('attached', newId());
          setWireState('open');
          // 首次 attach 已有登录初始化 OBS；之后每次重连完成才重新对齐投影。
          if (attachedOnce) scheduleAccessRefresh();
          attachedOnce = true;
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
      if (refreshTimer != null) clearTimeout(refreshTimer);
      accessRefreshActionsRef.current = {};
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
    const access = channelList.find((channel) => channel.id === activeChannelId)?.access;
    if (!access || canViewChannelContent(access)) return;
    if (['governance', 'resources', 'roster-focus', 'artifact-focus', 'work-item-focus', 'automation'].includes(rightPanel) || contextFocus?.type === 'turn') {
      setSelectedActor(null);
      setContextFocus(null);
      setRightPanel('');
      writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView }, { replace: true });
    }
    setTaskCreateSource(undefined);
    setChannelCreateOpen(false);
  }, [activeChannelId, channelList, contextFocus, rightPanel, workspaceView]);

  useEffect(() => {
    if (contextFocus?.type !== 'participant' || !activeChannelId) return;
    const actor = (rosters.get(activeChannelId) || []).find((row) => row.id === contextFocus.key);
    if (actor) setSelectedActor(actor);
    else if (rosters.has(activeChannelId)) setChannelNotice('对象暂不可用，已保留当前主视图。');
  }, [activeChannelId, contextFocus, rosters]);

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

  const refreshDaemonData = useCallback(async () => {
    if (!obsRef.current) return [];
    try {
      const observation = await obsRef.current.spaceDaemons();
      const rows = safeDaemonRows(observation);
      setSpaceDaemons(rows);
      return rows;
    } catch (error) {
      if (error?.status !== 401) setTopError(displayError(error));
      return [];
    }
  }, []);

  useEffect(() => {
    if (wireState !== 'open') return;
    refreshDaemonData();
  }, [wireState, refreshDaemonData]);

  useEffect(() => {
    if (!['governance', 'space', 'resources'].includes(rightPanel) && workspaceView !== 'artifacts') return;
    refreshGovernanceData();
  }, [rightPanel, workspaceView, activeChannelId, refreshGovernanceData]);

  const handleResource = useCallback(async (payload) => {
    if (!wireRef.current) throw new TypeError('连接尚未就绪');
    return wireRef.current.resource(payload);
  }, []);

  const handleDownloadResource = useCallback(async (channelId, attachment) => {
    try {
      const receipt = await handleResource(readFileTicket({ channelId, resourceId: attachment.resource_id }));
      if (!receipt.ticket) throw new TypeError('服务端没有返回可下载票据');
      const response = await fetch(fileTransferURL(channelId, receipt.ticket), { credentials: 'include' });
      if (!response.ok) throw new TypeError(`下载失败 (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = attachment.name || 'download'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) { setTopError(displayError(error)); }
  }, [handleResource]);

  const handleTaskControl = useCallback(async ({ channelId, turn, actorId, type, payload }) => {
    if (!channelId || !actorId) return '';
    return handleSend({
      channelId,
      text: payload?.text || `${type} → ${actorId}`,
      msgType: type,
      audience: [actorId],
      targetLabel: actorId,
      payload,
      // replace 请求受理后自身就是队列新行（协议 §4.6）——它是根消息，恒不挂父；
      // 挂父会被时间线折成目标卡的子调用，随原行终态一起消失。其余控制词照旧归属目标。
      parentId: type === TYPES.agentReplace ? '' : (turn?.requestId || ''),
    });
  }, [handleSend]);

  const handleAgentSelection = useCallback(async ({ actorId, model, effort }) => {
    if (!activeChannelId || !actorId) return '';
    const previous = agentSelection.value;
    const selectsPrimary = previous?.actorId === actorId;
    setAgentSelection({ channelId: activeChannelId, value: selectsPrimary ? { ...previous, current: { model, effort } } : previous, busy: true });
    try {
      return await handleSend({
        channelId: activeChannelId,
        text: `切换模型：${model} · ${effort}`,
        msgType: TYPES.agentSelect,
        audience: [actorId],
        targetLabel: actorId,
        payload: { model, effort },
      });
    } catch (error) {
      setAgentSelection({ channelId: activeChannelId, value: previous, busy: false });
      setTopError(displayError(error));
      throw error;
    } finally {
      setAgentSelection((current) => current.channelId === activeChannelId ? { ...current, busy: false } : current);
    }
  }, [activeChannelId, agentSelection.value, handleSend]);

  const changeWorkspaceView = useCallback((view) => {
    if (!activeChannelId) return;
    workspaceViewsRef.current.set(activeChannelId, view);
    setWorkspaceView(view);
    setSelectedActor(null);
    setContextFocus(null);
    setMountedFilePreview(null);
    setRightPanel('');
    writeWorkspaceRoute({ channelId: activeChannelId, view });
  }, [activeChannelId]);

  const selectWorkspaceChannel = useCallback((channelId) => {
    const view = workspaceViewsRef.current.get(channelId) || 'dynamic';
    selectChannel(channelId);
    setWorkspaceView(view);
    writeWorkspaceRoute({ channelId, view });
  }, [selectChannel]);

  const openContext = useCallback((value, focus = null) => {
    setSelectedActor(null);
    setMountedFilePreview(null);
    setRightPanel(value);
    setContextFocus(focus);
    if (focus && activeChannelId) {
      writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView, focus }, { contextEntry: true });
    }
  }, [activeChannelId, workspaceView]);

  const closeContext = useCallback(() => {
    setSelectedActor(null);
    setContextFocus(null);
    setMountedFilePreview(null);
    setRightPanel('');
    if (window.history.state?.atollContextEntry) window.history.back();
    else if (activeChannelId) writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView }, { replace: true });
  }, [activeChannelId, workspaceView]);

  const openTurnDetail = useCallback((requestId) => {
    if (requestId) openContext('', { type: 'turn', key: requestId });
  }, [openContext]);

  const describeActor = useCallback(async (actor, channelId = activeChannelId) => {
    if (!actor || !channelId) return;
    await handleSend({
      channelId,
      text: `读取 ${actor.name || actor.id} 的能力`,
      msgType: TYPES.describe,
      audience: [actor.id],
      targetLabel: actor.name || actor.id,
      payload: {},
    });
  }, [activeChannelId, handleSend]);

  const handleSelectActor = useCallback((actor) => {
    setSelectedActor(actor);
    setRightPanel('roster-focus');
    const focus = { type: 'participant', key: actor.id };
    setContextFocus(focus);
    if (activeChannelId) writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView, focus }, { contextEntry: true });
    const state = channelStatesRef.current.get(activeChannelId);
    const capability = capabilityIndexFromState(state).get(actor.id);
    if (!capability?.describe && !capability?.loading) describeActor(actor, activeChannelId);
  }, [activeChannelId, describeActor, workspaceView]);

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

  const activeArtifactIndex = useMemo(
    () => buildArtifactIndex(channelStatesRef.current.get(activeChannelId)),
    [activeChannelId, feedVersion],
  );

  const globalData = useMemo(() => {
    const channelData = channelList.map((channel) => {
      const state = channelStatesRef.current.get(channel.id) || createChannelState(channel.id);
      const roster = visibleRosterRows(rosters.get(channel.id) || []);
      const capabilityIndex = capabilityIndexFromState(state);
      const selfId = channel.selfActorId || rosterRef.current?.self(channel.id) || '';
      const workItems = buildWorkItemIndex({ state, pending, timers: timerRecords, selfId, access: channel.access, capabilityIndex });
      return { ...channel, state, roster, participants: roster, artifacts: buildArtifactIndex(state), workItems };
    });
    const governanceOperations = channelData.flatMap((channel) => [...channel.state.turns.values()]
      .filter((turn) => isGovernanceOperation(turn.request?.type))
      .map((turn) => governanceOperation(channel, turn, channelList)));
    const submissionOperations = pending.map((item) => ({
      key: item.key,
      operationId: item.messageId,
      channelId: item.channelId,
      kind: 'submission',
      title: item.text || item.frame?.msg_type || '发送消息',
      detail: item.error?.detail || (item.state === 'uncertain' ? '等待账本核对' : '等待消息入账'),
      state: item.state === 'transmitting' ? 'submitting' : ['accepted', 'delayed'].includes(item.state) ? 'waiting_ledger' : item.state === 'rejected' ? 'failed' : item.state,
      startedAt: item.createdAt,
      updatedAt: item.updatedAt,
      source: { channelId: item.channelId, view: 'dynamic', objectType: 'entry', objectId: item.messageId, envelopeId: item.messageId },
    }));
    const rawOperations = [...submissionOperations, ...governanceOperations];
    const names = new Map(channelList.map((channel) => [channel.id, channel.qualified_name || channel.name || channel.id]));
    const activities = [...buildActivityIndex({ channels: channelData, operations: rawOperations }).values()]
      .map((item) => ({ ...item, channelName: names.get(item.channelId), detail: item.summary }));
    const operations = activeOperations(buildOperationIndex({ channels: channelData, operations: rawOperations }))
      .map((item) => ({ ...item, channelName: names.get(item.channelId) }));
    return { channelData, activities, operations, searchIndex: buildGlobalSearchIndex({ channels: channelData, operations: rawOperations }) };
  }, [channelList, feedVersion, pending, rosters, timerRecords]);

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
  const providers = taskProviders(capabilityIndex, activeRoster);
  const workItemIndex = buildWorkItemIndex({ state: activeState, pending, timers: timerRecords, selfId, access: activeAccess, capabilityIndex });
  const artifactIndex = activeArtifactIndex;
  const selectedCapability = selectedActor ? capabilityIndex.get(selectedActor.id) : null;
  const selectedArtifact = contextFocus?.type === 'artifact' ? artifactIndex.get(contextFocus.key) : null;
  const previewArtifact = mountedFilePreview?.channelId === activeChannelId ? mountedFilePreview : null;
  const selectedTurn = contextFocus?.type === 'turn' ? activeState.turns.get(contextFocus.key) : null;
  const selectedWorkItem = contextFocus?.type === 'work_item' ? workItemIndex.get(contextFocus.key) : null;

  const attachToDraft = (attachment) => {
    setDraftAttachments((current) => ({ ...current, [activeChannelId]: [...(current[activeChannelId] || []).filter((row) => row.resource_id !== attachment.resource_id), attachment] }));
    changeWorkspaceView('dynamic');
  };

  const uploadComposerAttachments = async (files) => {
    const channel = activeChannel;
    if (!channel?.id) throw new TypeError('请先选择频道');
    // OPEN 只代表消息通道已就绪，daemon OBS 可能仍在路上。粘贴/拖入不应
    // 因这个短暂竞态失败，所以首次上传可就地等待一次 daemon observation。
    const daemons = spaceDaemons.length ? spaceDaemons : await refreshDaemonData();
    const daemon = daemons[0];
    if (!daemon?.name) throw new TypeError('当前频道没有可用的 daemon 挂载');
    const uploaded = [];
    for (const file of files) uploaded.push(await uploadChannelFile({ file, channel, daemonName: daemon.name, onResource: handleResource }));
    setDraftAttachments((current) => {
      const rows = [...(current[channel.id] || [])];
      for (const attachment of uploaded) {
        const index = rows.findIndex((row) => row.resource_id === attachment.resource_id);
        if (index >= 0) rows[index] = attachment;
        else rows.push(attachment);
      }
      return { ...current, [channel.id]: rows };
    });
    return uploaded;
  };

  const previewMessageAttachment = (channelId, attachment) => {
    const resourceId = attachment?.resource_id;
    if (!channelId || !resourceId) return;
    const mediaType = attachment.media_type || 'application/octet-stream';
    const artifact = artifactIndex.get(`artifact:${channelId}:${resourceId}`) || {
      key: `message-file:${channelId}:${resourceId}`,
      channelId,
      resourceId,
      name: attachment.name || resourceId,
      mediaType,
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : undefined,
      kind: artifactKindForMediaType(mediaType),
      preview: previewForMediaType(mediaType),
      state: 'available',
      provenance: { source: 'feed' },
    };
    setSelectedActor(null);
    setContextFocus(null);
    setRightPanel('');
    setMountedFilePreview(artifact);
  };

  const openArtifactSource = (source) => {
    setSelectedActor(null);
    setContextFocus(null);
    setRightPanel('');
    workspaceViewsRef.current.set(activeChannelId, 'dynamic');
    setWorkspaceView('dynamic');
    writeWorkspaceRoute({ channelId: activeChannelId, view: 'dynamic' }, { replace: true });
    window.setTimeout(() => document.querySelector(`[data-entry-id="${CSS.escape(source.objectId || '')}"]`)?.scrollIntoView({ block: 'center' }), 0);
  };

  const openDynamicSource = (source) => {
    setSelectedActor(null);
    setContextFocus(null);
    setRightPanel('');
    workspaceViewsRef.current.set(activeChannelId, 'dynamic');
    setWorkspaceView('dynamic');
    writeWorkspaceRoute({ channelId: activeChannelId, view: 'dynamic' }, { replace: true });
    window.setTimeout(() => document.querySelector(`[data-entry-id="${CSS.escape(source.objectId || '')}"]`)?.scrollIntoView({ block: 'center' }), 0);
  };

  const openWorkItemSource = (source) => {
    if (source?.view !== 'tasks') { openDynamicSource(source); return; }
    setSelectedActor(null);
    setContextFocus(null);
    setRightPanel('');
    workspaceViewsRef.current.set(activeChannelId, 'tasks');
    setWorkspaceView('tasks');
    writeWorkspaceRoute({ channelId: activeChannelId, view: 'tasks' }, { replace: true });
  };

  const createTaskFromSource = providers.length ? (source) => setTaskCreateSource(source || null) : null;

  const advanceMockComputation = async () => {
    if (!activeChannelId || mockAdvance.busy) return;
    setMockAdvance((current) => ({ ...current, busy: true }));
    try {
      const response = await fetch('/mock/control/advance', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ms: 0, compute: { channel_id: activeChannelId } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.detail || '推进计算失败');
      // The ledger progress is the feedback. A success banner changes the
      // workspace row height on every demo step and makes the conversation
      // appear to jump; only actual failures belong in the notice stack.
    } catch (error) {
      setTopError(displayError(error));
    } finally {
      setMockAdvance((current) => ({ ...current, busy: false }));
    }
  };

  const submitTask = async ({ title, description, providerId, dueAt, source }) => {
    const provider = providers.find((row) => row.actorId === providerId);
    if (!provider) throw new TypeError('所选成员不再提供正式任务能力');
    await handleSend({
      channelId: activeChannelId,
      text: title,
      msgType: 'task.create',
      audience: [provider.actorId],
      targetLabel: provider.name,
      payload: { title, ...(description ? { description } : {}), ...(dueAt ? { due_at: dueAt } : {}), ...(source ? { source: { ...source, channelId: activeChannelId } } : {}) },
    });
    changeWorkspaceView('tasks');
    setChannelNotice('任务创建请求已提交；正式任务会在 provider 返回稳定任务编号后进入列表。');
  };

  const selectedTurnActorId = selectedTurn?.request?.audience?.length === 1 ? selectedTurn.request.audience[0] : '';
  const selectedTurnControlKey = selectedTurn ? `${activeChannelId}:${selectedTurn.requestId}:cancel` : '';

  const navigateToSource = (source) => {
    const channel = channelList.find((row) => row.id === source?.channelId);
    if (!channel || (!isMemberAccess(channel.access) && !String(channel.access || '').startsWith('observer_'))) {
      setChannelNotice('来源频道当前不可访问，未打开缓存内容。');
      setGlobalSearchOpen(false);
      setRightPanel('');
      return;
    }
    const view = ['dynamic', 'artifacts', 'tasks'].includes(source.view) ? source.view : 'dynamic';
    const focusType = source.objectType === 'entry' ? '' : source.objectType;
    const focus = ['channel', 'participant', 'artifact', 'turn', 'work_item'].includes(focusType) && source.objectId
      ? { type: focusType, key: source.objectId }
      : null;
    selectChannel(channel.id);
    workspaceViewsRef.current.set(channel.id, view);
    setWorkspaceView(view);
    setSelectedActor(null);
    setContextFocus(focus);
    setRightPanel(focusType === 'channel' ? 'governance'
      : focusType === 'participant' ? 'roster-focus'
        : focusType === 'artifact' ? 'artifact-focus'
          : focusType === 'turn' ? ''
            : focusType === 'work_item' ? 'work-item-focus' : '');
    setGlobalSearchOpen(false);
    writeWorkspaceRoute({ channelId: channel.id, view, focus }, { contextEntry: Boolean(focus) });
    if (!focus && source.objectId) window.setTimeout(() => {
      const row = document.querySelector(`[data-entry-id="${CSS.escape(source.objectId)}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
      else setChannelNotice('来源对象暂不可用，已返回所属频道。');
    }, 0);
  };

  const host = {
    panel: { value: rightPanel, focus: contextFocus, close: closeContext, turn: { selected: selectedTurn, capability: capabilityIndex.get(selectedTurnActorId), controlState: controlStates[selectedTurnControlKey], onCancel: () => handleCancel(activeChannelId, selectedTurn?.requestId), onControl: (type, payload) => handleTaskControl({ channelId: activeChannelId, turn: selectedTurn, actorId: selectedTurnActorId, type, payload }), onDownload: (attachment) => handleDownloadResource(activeChannelId, attachment), onSource: openDynamicSource, onCreateTask: createTaskFromSource } },
    active: { channel: activeChannel, state: activeState, roster: activeRoster, access: activeAccess, selfId, wireState, automation: { records: timerRecords, disabled: wireState !== 'open' || !canWriteChannel(activeAccess), onAfter: handleAfter, onCancel: handleCancelTimer } },
    directory: { channels: channelList },
    governance: { principals: spacePrincipals, declarations: spaceDeclarations, daemons: spaceDaemons, registrarRoster: rosters.get('c0') || (activeChannelId === 'c0' ? activeRoster : []), rootState: channelStatesRef.current.get('c0'), version: feedVersion, onSubmit: handleSend, onRefresh: refreshGovernanceData },
    artifacts: { selected: selectedArtifact, authorName: activeRoster.find((row) => row.id === selectedArtifact?.authorActorId)?.name, onResource: handleResource, onDownload: (attachment) => handleDownloadResource(activeChannelId, attachment), onAttach: attachToDraft, onSource: openArtifactSource },
    workItems: { selected: selectedWorkItem, roster: activeRoster, onSource: openWorkItemSource, onResolve: (item, decision) => handleResolve(activeChannelId, item.nativeId, decision, {}), onOpenTurn: openTurnDetail, onRetry: (item) => { const submission = pending.find((row) => row.key === item.diagnostic?.submissionKey); if (submission) handleRetry(submission); }, onCancelAutomation: handleCancelTimer },
    roster: { busy: rosterBusy, onRefresh: () => refreshRoster(activeChannelId, true), selectedActor, capability: selectedCapability, onSelectActor: handleSelectActor, onCloseActor: () => {
      setSelectedActor(null);
      const focus = { type: 'channel', key: activeChannelId };
      setContextFocus(focus);
      writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView, focus }, { replace: true, contextEntry: true });
    }, onDescribe: () => describeActor(selectedActor, activeChannelId), onInvoke: handleInvokeActor },
    activity: { activities: globalData.activities, operations: globalData.operations, onOpen: navigateToSource },
  };
  return <>
  <AppShell
    session={{ me, wireState, onLogout: handleLogout }}
    navigation={{ channels: channelList, activeChannelId, unread, onSelect: selectWorkspaceChannel, onCreate: () => { setRightPanel(''); setContextFocus(null); setChannelCreateOpen(true); }, onSearch: () => { setRightPanel(''); setContextFocus(null); setGlobalSearchOpen(true); }, onActivity: () => openContext('activity'), onSpaceManage: () => openContext('space') }}
    workspace={{ channel: activeChannel, view: workspaceView, onViewChange: changeWorkspaceView, state: activeState, access: activeAccess, roster: activeRoster, selfId, pending: pending.filter((item) => item.channelId === activeChannelId), approvalStates, controlStates, capabilityIndex, mockAdvance: { ...mockAdvance, onAdvance: advanceMockComputation }, agentSelection: agentSelection.channelId === activeChannelId ? { ...agentSelection, onLoad: loadAgentSelection, onChange: handleAgentSelection } : null, onResolve: handleResolve, onRetry: handleRetry, onCancel: handleCancel, onTaskControl: handleTaskControl, onDownloadResource: handleDownloadResource, onPreviewResource: previewMessageAttachment, onOpenTurn: (turn) => openTurnDetail(turn.requestId), onCreateTask: createTaskFromSource, onSend: handleSend, draft: draftTextsRef.current[activeChannelId] || '', onDraftChange: (value) => { draftTextsRef.current[activeChannelId] = value; }, attachments: draftAttachments[activeChannelId] || [], onPreviewAttachment: (attachment) => previewMessageAttachment(activeChannelId, attachment), onUploadAttachments: uploadComposerAttachments, onOpenChannelFiles: () => setAttachmentPickerOpen(true), onRemoveAttachment: (resourceId) => setDraftAttachments((current) => ({ ...current, [activeChannelId]: (current[activeChannelId] || []).filter((row) => row.resource_id !== resourceId) })), onClearAttachments: () => setDraftAttachments((current) => ({ ...current, [activeChannelId]: [] })), turnDetail: { selected: selectedTurn, capability: capabilityIndex.get(selectedTurnActorId), controlState: controlStates[selectedTurnControlKey], onCancel: () => handleCancel(activeChannelId, selectedTurn?.requestId), onControl: (type, payload) => handleTaskControl({ channelId: activeChannelId, turn: selectedTurn, actorId: selectedTurnActorId, type, payload }), onDownload: (attachment) => handleDownloadResource(activeChannelId, attachment), onSource: openDynamicSource, onCreateTask: createTaskFromSource, onClose: closeContext }, resources: { daemons: spaceDaemons, disabled: wireState !== 'open' || !canWriteChannel(activeAccess), onResource: handleResource, onAttach: attachToDraft, onOpen: (artifact) => openContext('artifact-focus', { type: 'artifact', key: artifact.key }), onPreview: (artifact) => { setSelectedActor(null); setContextFocus(null); setRightPanel(''); setMountedFilePreview(artifact); } }, tasks: { items: [...workItemIndex.values()], providers, canWrite: wireState === 'open' && canWriteChannel(activeAccess), onNewTask: createTaskFromSource, onOpen: (item) => openContext('work-item-focus', { type: 'work_item', key: item.key }), onNewAutomation: () => openContext('automation') }, automation: { records: timerRecords, disabled: wireState !== 'open' || !canWriteChannel(activeAccess), onAfter: handleAfter, onCancel: handleCancelTimer } }}
    notices={{ error: topError, channel: channelNotice, dismissError: () => setTopError(''), dismissChannel: () => setChannelNotice('') }}
    panel={{ value: rightPanel, open: openContext, host }}
  />
  {taskCreateSource !== undefined && <TaskCreateModal providers={providers} source={taskCreateSource} onSubmit={submitTask} onClose={() => setTaskCreateSource(undefined)} />}
  {channelCreateOpen && activeChannel && <ChannelCreateModal channel={activeChannel} channels={channelList} roster={activeRoster} state={activeState} disabled={wireState !== 'open' || !canWriteChannel(activeAccess)} onSubmit={handleSend} onClose={() => setChannelCreateOpen(false)} onEnterChannel={(channel) => { setChannelCreateOpen(false); selectWorkspaceChannel(channel.id); }} />}
  {globalSearchOpen && <GlobalSearch index={globalData.searchIndex} onOpen={navigateToSource} onClose={() => setGlobalSearchOpen(false)} />}
  {attachmentPickerOpen && activeChannel && <ChannelFilePickerModal channel={activeChannel} daemons={spaceDaemons} disabled={wireState !== 'open' || !canWriteChannel(activeAccess)} onResource={handleResource} onChoose={attachToDraft} onClose={() => setAttachmentPickerOpen(false)} />}
  {previewArtifact && <FilePreviewModal artifact={previewArtifact} onResource={handleResource} onAttach={(attachment) => { setMountedFilePreview(null); attachToDraft(attachment); }} onDownload={(attachment) => handleDownloadResource(activeChannelId, attachment)} onClose={() => setMountedFilePreview(null)} />}
  </>;
}
