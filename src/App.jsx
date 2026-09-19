import { argsOf } from './protocol/envelope.js';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { capabilityIndexFromState } from './model/capabilities.js';
import { attachmentFromFileReference } from './model/file-references.js';
import { readServerBoot } from './model/server-boot.js';
import { artifactKindForMediaType, buildArtifactIndex, previewForMediaType } from './model/artifacts.js';
import { openFromPreview, snapshot as uiSnapshot } from './model/ui-words.js';
import { UiActivityOverlay } from './ui/UiActivityOverlay.jsx';
import { useUiWords } from './app/hooks/useUiWords.js';
import { fileTransferURL } from './model/channel-file-transfer.js';
import { canViewChannelContent, canWriteChannel, CHANNEL_ACCESS, isMemberAccess } from './model/channel-access.js';
import { createChannelState } from './model/fold.js';
import { terminalResultPayload, terminalResultState } from './model/terminal-result.js';
import { readFileTicket } from './model/resources.js';
import { safeChannelDeviceRows, safeDaemonRows } from './model/space-administration.js';
import { buildWorkItemIndex, taskProviders } from './model/work-items.js';
import { parseWorkspaceHash, writeWorkspaceRoute } from './model/workspace-route.js';
import { messagePresentation } from './model/message-presentation.js';
import { isSystemWord, SYSTEM_ACTOR_ID, TYPES } from './protocol/vocab.js';
import { newId } from './util/id.js';
import { activeOperations, buildActivityIndex, buildGlobalSearchIndex, buildOperationIndex } from './model/activity.js';
import { createWaitingTargetAuthority } from './model/task-controls.js';
import { agentSelectionView, latestAgentOptions, latestAgentUsage, resolveParameterAgent } from './model/agent-selection.js';
import { createAgentActivityTracker } from './model/agent-activity.js';
import { ObsError } from './net/obs.js';
import { Auth } from './ui/Auth.jsx';
import { VersionIncompatible } from './ui/VersionIncompatible.jsx';
import { AppShell } from './app/AppShell.jsx';
import { TaskCreateModal } from './ui/TaskCreateModal.jsx';
import { ChannelCreateModal } from './ui/ChannelCreateModal.jsx';
import { GlobalSearch } from './ui/GlobalSearch.jsx';
import { ChannelFilePickerModal } from './ui/ChannelFilePickerModal.jsx';
import { visibleRosterRows } from './ui/roster-visibility.js';
import { useLocalAutomation } from './app/hooks/useLocalAutomation.js';
import { useSubmissions } from './app/hooks/useSubmissions.js';
import { useAtollSession } from './app/hooks/useAtollSession.js';
import { useChannelDirectory } from './app/hooks/useChannelDirectory.js';
import { useChannelFeed } from './app/hooks/useChannelFeed.js';
import { useNodeUpdate } from './app/hooks/useNodeUpdate.js';
import { useAgentProbes } from './app/hooks/useAgentProbes.js';
import { useChannelRoster } from './app/hooks/useChannelRoster.js';
import { useWireConnection, useWireSessionPort } from './app/hooks/useWireSession.js';
import { useAttachmentTransactions } from './app/hooks/useAttachmentTransactions.js';
import { diagnostic } from './model/diagnostics.js';
import { readFileReadingHistory, rememberFileRead, writeFileReadingHistory } from './model/file-reading-history.js';
import { popFilePreview, pushFilePreview } from './model/file-preview-stack.js';
import { createHistoryDemandPort, HISTORY_INTENT, HISTORY_URGENCY } from './model/history-demand.js';

function displayError(error) {
  if (error instanceof ObsError && error.status === 503) return '频道未在服务';
  return error?.detail || error?.message || String(error);
}

// 治理操作 = 写入类的 system 词。读取类（list / get / describe）不进操作台。
const GOVERNANCE_READ_TYPES = new Set([
  TYPES.channel.get, TYPES.channel.list, TYPES.channelTemplate.get, TYPES.channelTemplate.list,
  TYPES.actorTemplate.get, TYPES.actorTemplate.list, TYPES.principal.get, TYPES.principal.list,
  TYPES.device.list, TYPES.member.list, TYPES.member.get, TYPES.log.recent, TYPES.log.query,
]);

const EMPTY_INDEX = new Map();
const EMPTY_GLOBAL_DATA = Object.freeze({ channelData: [], activities: [], operations: [], searchIndex: EMPTY_INDEX });

function isGovernanceOperation(type = '') {
  return isSystemWord(type) && !GOVERNANCE_READ_TYPES.has(type);
}

function governanceOperationTitle(turn) {
  const type = turn.request?.type || '';
  const payload = argsOf(turn.request) || {};
  const known = messagePresentation(turn.request || {});
  if (type === TYPES.channel.create) return `创建频道 ${payload.name || ''}`.trim();
  return known.detail ? `${known.text} ${known.detail}`.trim() : known.text || payload.title || type;
}

function governanceOperation(channel, turn, channelRows) {
  const lifecycle = argsOf(turn.terminal);
  const terminal = terminalResultPayload(turn);
  if (turn.terminalClosureOnly) {
    const resultState = terminalResultState(turn);
    return {
      key: turn.requestId,
      operationId: turn.requestId,
      requestId: turn.requestId,
      channelId: channel.id,
      kind: 'governance',
      title: governanceOperationTitle(turn),
      detail: resultState.error,
      state: 'uncertain',
      startedAt: turn.request?.ts || turn.requestSeq,
      updatedAt: turn.terminal?.ts || turn.lastSeq || turn.requestSeq,
      source: { channelId: channel.id, view: 'dynamic', objectType: 'turn', objectId: turn.requestId, requestId: turn.requestId },
    };
  }
  let state = lifecycle?.status === 'failed' ? 'failed' : lifecycle?.status === 'cancelled' ? 'cancelled' : lifecycle?.status === 'completed' ? 'completed' : 'waiting_ledger';
  let detail = turn.terminal ? '账本已确认' : '等待账本确认';
  if (turn.request?.type === TYPES.channel.create && lifecycle?.status === 'completed') {
    const expected = `${channel.qualified_name || channel.name || channel.id}.${argsOf(turn.request)?.name || ''}`;
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
  const wireSession = useWireSessionPort();
  const {
    accessRef,
    close: closeWireSession,
    incompatible: versionIncompatible,
    incompatibleEpochRef: versionIncompatibleEpochRef,
    incompatibleRef: versionIncompatibleRef,
    obsRef,
    rosterRef,
    state: wireState,
    wireRef,
  } = wireSession;
  const [serverWorld, setServerWorld] = useState(() => readServerBoot());
  const [topError, setTopError] = useState('');
  const [channelNotice, setChannelNotice] = useState('');
  const [selectedActor, setSelectedActor] = useState(null);
  const [rightPanel, setRightPanel] = useState('');
  const [contextFocus, setContextFocus] = useState(null);
  const [workspaceView, setWorkspaceView] = useState(initialRouteRef.current.view);
  const workspaceViewsRef = useRef(new Map());
  // 早返回(booting / 未登录)之后的那一段恒不能再调 hook——hook 的条数在两次渲染
  // 之间必须一样,多一条就是 "Rendered more hooks than during the previous render"。
  // 那一段里要缓存派生值,就用这张自己管的表:它是在早返回**之前**建的,而 derived()
  // 只是个普通函数,恒不新增 hook。
  const derivedRef = useRef(new Map());
  function derived(key, deps, compute) {
    const cached = derivedRef.current.get(key);
    if (cached && cached.deps.length === deps.length && cached.deps.every((value, index) => Object.is(value, deps[index]))) {
      return cached.value;
    }
    const value = compute();
    derivedRef.current.set(key, { deps, value });
    return value;
  }
  const [spacePrincipals, setSpacePrincipals] = useState([]);
  const [spaceDeclarations, setSpaceDeclarations] = useState([]);
  const [spaceDaemons, setSpaceDaemons] = useState([]);
  const [channelDevices, setChannelDevices] = useState([]);
  const editReleaseObligationsRef = useRef(new Map());
  const serverWorldCommittedRef = useRef(serverWorld);
  const wireStateCommittedRef = useRef(wireState);
  // 草稿是编辑器私有的临时状态，不是工作区渲染状态。这里仅用 ref 做跨频道、
  // 跨主视图的本地持久化；逐字输入不得触发 App/Timeline 重渲染。
  const [taskCreateSource, setTaskCreateSource] = useState(undefined);
  const [channelCreateOpen, setChannelCreateOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [filePreviewStack, setFilePreviewStack] = useState([]);
  const mountedFilePreview = filePreviewStack.at(-1) || null;
  const [recentFiles, setRecentFiles] = useState([]);
  const [uiSession, setUiSession] = useState({ id: '', label: '' });
  // 频道对这块屏做过什么。只留最近几条:这是一条回执,不是审计日志——
  // 完整的记录本来就在账本里,这里只回答"刚才那一下是什么"。
  const [uiActivity, setUiActivity] = useState([]);
  const [mockAdvance, setMockAdvance] = useState({ available: false, busy: false });
  // 参数面板（协议 §2/§4）：目标 = Composer 回报的判据链结果；值域走 describe、
  // 当前值走账本 usage；select 的 pending/failed 三态由账本终态驱动。
  const [pendingSelect, setPendingSelect] = useState(null); // {channelId, actorId, requestId, value:{model,effort}}
  const [, setAgentActivityVersion] = useState(0);
  const agentActivityRef = useRef(null);
  if (agentActivityRef.current === null) {
    agentActivityRef.current = createAgentActivityTracker({
      onChange: () => setAgentActivityVersion((value) => value + 1),
    });
  }

  // Callbacks owned by Wire/roster outlive an individual React render. Publish
  // their authority as one committed port: a suspended principal candidate
  // must not redirect a frame received by the still-painted session.
  const committedFeedOwnerRef = useRef(null);
  const activeChannelRef = useRef(initialRouteRef.current.channelId || '');
  const channelDeviceActionsRef = useRef({});
  const workspaceActionsRef = useRef({});
  const showSessionError = useCallback((error) => {
    diagnostic('error', 'session.failed', { error });
    setTopError(displayError(error));
  }, []);
  const showRosterError = useCallback((error) => setTopError(displayError(error)), []);
  const { booting, principal: me, identity, accept: handleAuthed, clear: clearSession, logoutRemote } = useAtollSession({ onError: showSessionError });
  const principalId = me?.id || '';
  const feedProducerOwnerToken = useMemo(
    () => Object.freeze({ principalId }),
    [principalId],
  );
  const nodeUpdate = useNodeUpdate({ principalId: me?.id, wireState });

  const roster = useChannelRoster({
    committedOwnerRef: committedFeedOwnerRef,
    onError: showRosterError,
    principalId,
    rosterRef,
    versionIncompatibleEpochRef,
    versionIncompatibleRef,
  });
  const {
    authorities: rosterAuthorities,
    busy: rosterBusy,
    clear: clearRoster,
    clearChannel: clearRosterChannel,
    publishRows: setRosters,
    receive: receiveRoster,
    refresh: refreshRosterOwner,
    rosters,
    seed: seedRoster,
  } = roster;

  useEffect(() => {
    setRecentFiles(readFileReadingHistory(me?.id, serverWorld));
  }, [me?.id, serverWorld]);

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
  const accessRefreshActionsRef = useRef({});
  const receiveFeedError = useCallback((error) => {
    diagnostic('error', 'feed.failed', { error });
    setTopError(displayError(error));
  }, []);
  const receiveSubmissionError = useCallback((error) => {
    diagnostic('error', 'submission.failed', { error });
    setTopError(displayError(error));
  }, []);
  const forwardChannels = useCallback((channelIds) => directoryActionsRef.current.discover?.(channelIds), []);
  const forwardDirectoryInvalidated = useCallback(() => accessRefreshActionsRef.current.schedule?.(), []);
  const forwardSubmissionFeed = useCallback((landed, closed, producerOwnerToken) => {
    const owner = committedFeedOwnerRef.current;
    if (!owner || owner.producerOwnerToken !== producerOwnerToken) return false;
    return owner?.reconcile?.(landed, closed);
  }, []);
  const forwardAccessChanged = useCallback(() => directoryActionsRef.current.bump?.(), []);
  const forwardAgentActivity = useCallback((payload, context) => agentActivityRef.current.observe(payload, context), []);
  const { statesRef: channelStatesRef, version: feedVersion, indexVersion: feedIndexVersion, bump: bumpFeed, enqueue: enqueueFeed, cancel: cancelFeedTask, clear: clearFeed, prepareLocalReplica, resumeLocalReplica, localReplicaReady, localReplicaError, localReplicaErrorCode, setHistoryGrants, pageEnd: finishHistoryPage, liveCheckpoint: finishLiveCheckpoint, disconnectHistory, stopIncompatible: stopIncompatibleFeed, focusHistory, generationFor, refreshChannel, historyFor, coldEntryDiagnosticsFor, loadHistory, markRead, acknowledgeNotifications, unreadFor } = useChannelFeed({ wireRef, rosterRef, accessRef, activeChannelRef, ownerToken: feedProducerOwnerToken, onRoster: receiveRoster, onError: receiveFeedError, onChannelsDiscovered: forwardChannels, onDirectoryInvalidated: forwardDirectoryInvalidated, onTimerFired: markTimerFired, onSubmissionFeed: forwardSubmissionFeed, onAccessChanged: forwardAccessChanged, onAgentActivity: forwardAgentActivity });
  const channelChanged = useCallback(() => { setSelectedActor(null); setContextFocus(null); setFilePreviewStack([]); setRightPanel(''); setTaskCreateSource(undefined); setChannelCreateOpen(false); setGlobalSearchOpen(false); }, []);
  const directory = useChannelDirectory({ accessRef, rosterRef, onChannelChanged: channelChanged, onNotice: setChannelNotice, initialChannelId: initialRouteRef.current.channelId });
  const { channels, setChannels, rows: channelList, bump: bumpAccess, activeChannelId, setActiveChannelId, select: selectChannel, clear: clearDirectory } = directory;

  useEffect(() => {
    focusHistory(activeChannelId);
    void refreshChannel(activeChannelId);
  }, [activeChannelId, focusHistory, refreshChannel]);

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
  const submissions = useSubmissions({ principalId: me?.id, serverWorld, activeChannelId, wireState, wireRef, rosterRef, accessRef, accessVersion: directory.version, channelStatesRef, onError: receiveSubmissionError, onNotice: setChannelNotice, onFeedChanged: bumpFeed, onAccessChanged: bumpAccess });
  const { pending, drafts, draftFor, updateDraft, persistDraftAttachments, approvalStates, controlStates, send: handleSend, retry: handleRetry, resolve: handleResolve, cancel: handleCancel, reconcileFeed: reconcileSubmissionFeed, clear: clearSubmissions, resetWorld: resetSubmissionWorld } = submissions;
  const {
    composerAgent,
    contextProbedRef,
    describeActor,
    liveRequestIds: liveProbeRequestIds,
    manualAgentIdFor,
    optionsProbedRef,
    pickAgent: handlePickAgent,
    probeRequestKey,
    reset: resetAgentProbes,
    selectorOpened: handleSelectorOpen,
    targetChanged: handleComposerAgentChange,
    version: manualAgentVersion,
  } = useAgentProbes({
    activeChannelId,
    activeChannelRef,
    accessRef,
    channelStatesRef,
    feedVersion,
    handleSend,
    pending,
    rosterRef,
    rosters,
    wireState,
  });
  const feedOwnerCandidate = useMemo(() => ({
    principalId,
    producerOwnerToken: feedProducerOwnerToken,
    generationFor,
    reconcile: reconcileSubmissionFeed,
  }), [feedProducerOwnerToken, generationFor, principalId, reconcileSubmissionFeed]);
  useLayoutEffect(() => {
    const committed = feedOwnerCandidate;
    committedFeedOwnerRef.current = committed;
    serverWorldCommittedRef.current = serverWorld;
    wireStateCommittedRef.current = wireState;
    return () => {
      if (committedFeedOwnerRef.current === committed) committedFeedOwnerRef.current = null;
    };
  }, [feedOwnerCandidate, serverWorld, wireState]);
  const handleResource = useCallback(async (payload) => {
    if (!wireRef.current) throw new TypeError('连接尚未就绪');
    return wireRef.current.resource(payload);
  }, []);
  const activeChannel = channelList.find((channel) => channel.id === activeChannelId)
    || channels.get(activeChannelId);
  const attachmentTransactions = useAttachmentTransactions({
    activeChannel,
    activeChannelId,
    activeChannelRef,
    accessRef,
    channelDevices,
    committedOwnerRef: committedFeedOwnerRef,
    deviceActionsRef: channelDeviceActionsRef,
    directoryVersion: directory.version,
    draftFor,
    drafts,
    onNotice: setChannelNotice,
    onOpenDynamic: () => workspaceActionsRef.current.openDynamic?.(),
    onResource: handleResource,
    persistDraftAttachments,
    serverWorld,
    serverWorldCommittedRef,
    wireRef,
    wireState,
    wireStateCommittedRef,
  });
  const {
    abortChannel: abortAttachmentChannel,
    attach: attachToDraft,
    clear: clearDraftAttachments,
    composerAttachments: composerAttachmentProjection,
    composerDraft: composerDraftProjection,
    mutate: mutateDraftAttachments,
    pickerOpen: attachmentPickerOpen,
    publishComposerEdit,
    reset: resetAttachmentTransactions,
    runFileOperation,
    setPickerOpen: setAttachmentPickerOpen,
    tagForCurrentWorld: tagAttachmentsForCurrentWorld,
    upload: uploadComposerAttachments,
  } = attachmentTransactions;
  directoryActionsRef.current.bump = bumpAccess;
  directoryActionsRef.current.discover = (channelIds) => setChannels((current) => {
    const missing = [...channelIds].filter((channelId) => !current.has(channelId));
    if (!missing.length) return current;
    const next = new Map(current);
    for (const channelId of missing) next.set(channelId, { id: channelId, name: channelId.slice(0, 8), status: 'present' });
    accessRefreshActionsRef.current.schedule?.();
    return next;
  });
  useEffect(() => {
    activeChannelRef.current = activeChannelId;
  }, [activeChannelId]);

  const expireSession = useCallback(() => {
    closeWireSession();
    clearFeed();
    clearDirectory();
    accessRef.current = null;
    // 参数面板态是会话私有的：换账号不得继承上一账号的手选/切换中/探测标记。
    resetAgentProbes();
    setPendingSelect(null);
    clearRoster();
    setChannelNotice('');
    setSelectedActor(null);
    setContextFocus(null);
    setFilePreviewStack([]);
    clearSubmissions();
    setRightPanel('');
    setSpacePrincipals([]);
    setSpaceDeclarations([]);
    setSpaceDaemons([]);
    setChannelDevices([]);
    clearTimers();
    agentActivityRef.current.clear();
    resetAttachmentTransactions();
    for (const obligation of editReleaseObligationsRef.current.values()) {
      if (obligation.retryTimer != null) clearTimeout(obligation.retryTimer);
    }
    editReleaseObligationsRef.current.clear();
    setTaskCreateSource(undefined);
    setChannelCreateOpen(false);
    setGlobalSearchOpen(false);
    clearSession();
  }, [clearDirectory, clearFeed, clearRoster, clearSession, clearSubmissions, clearTimers, closeWireSession, resetAgentProbes, resetAttachmentTransactions]);

  const resetWorldSurfaces = useCallback(() => {
    clearTimers();
    resetAttachmentTransactions();
    for (const obligation of editReleaseObligationsRef.current.values()) {
      if (obligation.retryTimer != null) clearTimeout(obligation.retryTimer);
    }
    editReleaseObligationsRef.current.clear();
    setRecentFiles([]);
    setFilePreviewStack([]);
    setAttachmentPickerOpen(false);
    setContextFocus(null);
    setRightPanel('');
  }, [clearTimers, resetAttachmentTransactions, setAttachmentPickerOpen]);

  useWireConnection({
    accessActionsRef: accessRefreshActionsRef,
    activeChannelRef,
    agentActivityRef,
    bumpAccess,
    bumpFeed,
    cancelFeedTask,
    channelStatesRef,
    clearRoster,
    disconnectHistory,
    displayError,
    enqueueFeed,
    expireSession,
    finishHistoryPage,
    finishLiveCheckpoint,
    onServerWorld: setServerWorld,
    onSession: setUiSession,
    onWorldChanged: resetWorldSurfaces,
    port: wireSession,
    prepareLocalReplica,
    principalId,
    resetSubmissionWorld,
    resumeLocalReplica,
    seedRoster,
    setActiveChannelId,
    setChannels,
    setHistoryGrants,
    setTopError,
    stopIncompatibleFeed,
  });

  const refreshRoster = useCallback((channelId, force = false) => refreshRosterOwner(
    channelId,
    force,
    { channelStatesRef, onFeedChanged: bumpFeed },
  ), [bumpFeed, channelStatesRef, refreshRosterOwner]);

  const activeRosterGeneration = Number(generationFor(activeChannelId) || 0);
  const activeHistoryStatus = historyFor(activeChannelId);
  useEffect(() => {
    if (versionIncompatibleRef.current || !activeChannelId || !me) return;
    const access = channelList.find((channel) => channel.id === activeChannelId)?.access;
    if (!isMemberAccess(access)) {
      clearRosterChannel(activeChannelId);
      return;
    }
    const authority = rosterAuthorities.get(activeChannelId);
    const authorityAttempted = authority?.principalId === principalId
      && authority?.channelId === activeChannelId
      && authority?.generation === activeRosterGeneration;
    void refreshRoster(activeChannelId, activeRosterGeneration > 0 && !authorityAttempted);
  }, [activeChannelId, activeRosterGeneration, channelList, clearRosterChannel, me, principalId, refreshRoster, rosterAuthorities]);

  useEffect(() => {
    const access = channelList.find((channel) => channel.id === activeChannelId)?.access;
    if (!access || canViewChannelContent(access)) return;
    abortAttachmentChannel(activeChannelId);
    setAttachmentPickerOpen(false);
    setFilePreviewStack([]);
    if (['governance', 'resources', 'reading-history', 'roster-focus', 'artifact-focus', 'work-item-focus', 'automation'].includes(rightPanel) || contextFocus?.type === 'turn') {
      setSelectedActor(null);
      setContextFocus(null);
      setRightPanel('');
      writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView }, { replace: true });
    }
    setTaskCreateSource(undefined);
    setChannelCreateOpen(false);
  }, [abortAttachmentChannel, activeChannelId, channelList, contextFocus, rightPanel, workspaceView]);

  useEffect(() => {
    if (contextFocus?.type !== 'participant' || !activeChannelId) return;
    const actor = (rosters.get(activeChannelId) || []).find((row) => row.id === contextFocus.key);
    if (actor) setSelectedActor(actor);
    else if (rosters.has(activeChannelId)) setChannelNotice('对象暂不可用，已保留当前主视图。');
  }, [activeChannelId, contextFocus, rosters]);

  const handleLogout = useCallback(async () => {
    await logoutRemote();
    expireSession();
  }, [expireSession, logoutRemote]);

  const refreshGovernanceData = useCallback(async () => {
    if (versionIncompatibleRef.current || !obsRef.current) return;
    const incompatibilityEpoch = versionIncompatibleEpochRef.current;
    try {
      const [principalObservation, declarationObservation, daemonObservation] = await Promise.all([
        obsRef.current.spacePrincipals(),
        obsRef.current.spaceDecls(),
        obsRef.current.spaceDaemons(),
      ]);
      if (versionIncompatibleRef.current
        || incompatibilityEpoch !== versionIncompatibleEpochRef.current) return;
      setSpacePrincipals(principalObservation.items || []);
      setSpaceDeclarations(declarationObservation.items || []);
      setSpaceDaemons(safeDaemonRows(daemonObservation));
      const channelID = activeChannelRef.current;
      if (channelID) {
        const deviceObservation = await obsRef.current.channelDevices(channelID);
        if (versionIncompatibleRef.current
          || incompatibilityEpoch !== versionIncompatibleEpochRef.current) return;
        if (activeChannelRef.current === channelID) setChannelDevices(safeChannelDeviceRows(deviceObservation));
      }
      await Promise.all([refreshRoster(activeChannelRef.current, true), activeChannelRef.current !== 'c0' ? refreshRoster('c0', true) : Promise.resolve()]);
    } catch (error) {
      if (!versionIncompatibleRef.current
        && incompatibilityEpoch === versionIncompatibleEpochRef.current
        && error?.status !== 401) setTopError(displayError(error));
    }
  }, [refreshRoster]);

  const refreshDaemonData = useCallback(async () => {
    if (versionIncompatibleRef.current || !obsRef.current) return [];
    const incompatibilityEpoch = versionIncompatibleEpochRef.current;
    try {
      const observation = await obsRef.current.spaceDaemons();
      if (versionIncompatibleRef.current
        || incompatibilityEpoch !== versionIncompatibleEpochRef.current) return [];
      const rows = safeDaemonRows(observation);
      setSpaceDaemons(rows);
      return rows;
    } catch (error) {
      if (!versionIncompatibleRef.current
        && incompatibilityEpoch === versionIncompatibleEpochRef.current
        && error?.status !== 401) setTopError(displayError(error));
      return [];
    }
  }, []);

  const refreshChannelDeviceData = useCallback(async (channelID = activeChannelRef.current) => {
    if (versionIncompatibleRef.current || !obsRef.current || !channelID) return [];
    const incompatibilityEpoch = versionIncompatibleEpochRef.current;
    try {
      const observation = await obsRef.current.channelDevices(channelID);
      if (versionIncompatibleRef.current
        || incompatibilityEpoch !== versionIncompatibleEpochRef.current) return [];
      const rows = safeChannelDeviceRows(observation);
      if (activeChannelRef.current === channelID) setChannelDevices(rows);
      return rows;
    } catch (error) {
      if (!versionIncompatibleRef.current
        && incompatibilityEpoch === versionIncompatibleEpochRef.current) {
        if (activeChannelRef.current === channelID) setChannelDevices([]);
        if (error?.status !== 401) setTopError(displayError(error));
      }
      return [];
    }
  }, []);
  channelDeviceActionsRef.current.refresh = refreshChannelDeviceData;

  useEffect(() => {
    if (wireState !== 'open') return;
    refreshDaemonData();
  }, [wireState, refreshDaemonData]);

  useEffect(() => {
    setChannelDevices([]);
    if (wireState !== 'open' || !activeChannelId) return;
    refreshChannelDeviceData(activeChannelId);
  }, [wireState, activeChannelId, refreshChannelDeviceData]);

  useEffect(() => {
    if (!['governance', 'space', 'resources'].includes(rightPanel) && workspaceView !== 'artifacts') return;
    refreshGovernanceData();
  }, [rightPanel, workspaceView, activeChannelId, refreshGovernanceData]);

  const handleDownloadResource = useCallback(async (channelId, attachment) => {
    try {
      const blob = await runFileOperation({ channelId, access: 'read' }, async (operation) => {
        const receipt = await operation.resource(readFileTicket({ channelId, resourceId: attachment.resource_id }));
        if (!receipt.ticket) throw new TypeError('服务端没有返回可下载票据');
        const response = await operation.fetch(fileTransferURL(channelId, receipt.ticket), { credentials: 'include' });
        if (!response.ok) throw new TypeError(`下载失败 (${response.status})`);
        return response.blob();
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = attachment.name || 'download'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) { setTopError(displayError(error)); }
  }, [runFileOperation]);

  const runEditReleaseObligation = useCallback((obligation) => {
    if (obligation.inFlight) return obligation.inFlight;
    if (committedFeedOwnerRef.current?.principalId !== obligation.principalId) {
      if (obligation.retryTimer != null) clearTimeout(obligation.retryTimer);
      editReleaseObligationsRef.current.delete(obligation.messageId);
      const error = new Error('编辑锁释放义务的登录身份已变化');
      error.code = 'identity_changed';
      return Promise.reject(error);
    }
    const attempt = handleSend({
      ...obligation.request,
      messageId: obligation.messageId,
    }).then((messageId) => {
      if (!messageId) throw new Error('解除编辑锁请求未进入发送队列');
      if (obligation.retryTimer != null) clearTimeout(obligation.retryTimer);
      editReleaseObligationsRef.current.delete(obligation.messageId);
      return messageId;
    }).catch((error) => {
      obligation.error = error;
      setChannelNotice(`解除编辑锁未持久：${displayError(error)}；保留原请求编号等待重试。`);
      const access = accessRef.current?.state?.(obligation.request.channelId);
      if (editReleaseObligationsRef.current.get(obligation.messageId) === obligation
        && wireStateCommittedRef.current === 'open'
        && access?.relationship === 'member'
        && access?.existence !== 'retired'
        && obligation.retryTimer == null) {
        obligation.retryTimer = setTimeout(() => {
          obligation.retryTimer = null;
          void runEditReleaseObligation(obligation).catch((retryError) => {
            diagnostic('warn', 'edit.release_retry_failed', {
              channelId: obligation.request.channelId,
              messageId: obligation.messageId,
              error: retryError,
            });
          });
        }, 2_000);
      }
      throw error;
    }).finally(() => {
      if (obligation.inFlight === attempt) obligation.inFlight = null;
    });
    obligation.inFlight = attempt;
    return attempt;
  }, [handleSend]);

  useEffect(() => {
    if (wireState !== 'open') return;
    for (const obligation of editReleaseObligationsRef.current.values()) {
      if (obligation.inFlight) continue;
      const access = accessRef.current?.state?.(obligation.request.channelId);
      if (access?.relationship !== 'member' || access?.existence === 'retired') continue;
      void runEditReleaseObligation(obligation).catch((error) => {
        diagnostic('warn', 'edit.release_retry_failed', {
          channelId: obligation.request.channelId,
          messageId: obligation.messageId,
          error,
        });
      });
    }
  }, [directory.version, runEditReleaseObligation, wireState]);

  const handleTaskControl = useCallback(async ({ channelId, turn, actorId, type, payload, messageId = '' }) => {
    if (!channelId || !actorId) return '';
    const request = {
      channelId,
      text: payload?.text || `${type} → ${actorId}`,
      msgType: type,
      audience: [actorId],
      targetLabel: actorId,
      payload,
      // replace 请求受理后自身就是队列新行（协议 §4.6）——它是根消息，恒不挂父；
      // 挂父会被时间线折成目标卡的子调用，随原行终态一起消失。其余控制词照旧归属目标。
      parentId: type === TYPES.agentReplace ? '' : (turn?.requestId || ''),
    };
    if (type !== TYPES.agentUnhold) return handleSend({ ...request, ...(messageId ? { messageId } : {}) });
    const fixedId = messageId || newId();
    let obligation = editReleaseObligationsRef.current.get(fixedId);
    if (!obligation) {
      obligation = { messageId: fixedId, principalId, request, inFlight: null, retryTimer: null, error: null };
      editReleaseObligationsRef.current.set(fixedId, obligation);
    }
    return runEditReleaseObligation(obligation);
  }, [handleSend, principalId, runEditReleaseObligation]);

  // 「取消」按钮背后的两条路。自己发的那条走 wire.cancel（调用方给自己开的账写
  // 终态）；别人发的没有那一臂——第三方不是合法的终态作者——所以改为请**持有它
  // 的 actor** 自己把它答掉。同一个按钮，事实不同：一个是撤回，一个是对方放弃。
  const handleCancelAny = useCallback(async (channelId, reqId, asDismiss) => {
    if (!channelId || !reqId) return '';
    if (!asDismiss) return handleCancel(channelId, reqId);
    const turn = channelStatesRef.current.get(channelId)?.turns.get(reqId);
    const holder = turn?.request?.audience?.length === 1 ? turn.request.audience[0] : '';
    if (!holder) return '';
    return handleSend({
      channelId,
      text: `请放弃等待中的任务 ${reqId}`,
      msgType: TYPES.agentDismiss,
      audience: [holder],
      targetLabel: holder,
      payload: { target: reqId },
    });
  }, [channelStatesRef, handleCancel, handleSend]);

  // 破窗恢复：把"重启这个频道"作为一条普通控制请求发给 system actor。它和其它
  // 控制词走同一条路，所以请求与终态自然落在时间线上——不需要另造一套结果 UI，
  // 谁重启了、谁失败了、谁被跳过都在那条终态里。
  const handleRestartChannel = useCallback(async () => {
    if (!activeChannelId) return '';
    return handleSend({
      channelId: activeChannelId,
      text: '重启本频道内全部成员',
      msgType: TYPES.member.restartAll,
      audience: [SYSTEM_ACTOR_ID],
      targetLabel: SYSTEM_ACTOR_ID,
      payload: {},
    });
  }, [activeChannelId, handleSend]);

  // 发起切换：提交成功 ≠ 参数已生效（select 是排队 turn，§4.3 三态）。提交后记
  // pendingSelect，busy 与回滚由"观察该请求的账本终态"驱动（Promise 拿不到异步终态）。
  const handleAgentSelection = useCallback(async ({ actorId, model, effort }) => {
    if (!activeChannelId || !actorId) return '';
    try {
      const requestId = await handleSend({
        channelId: activeChannelId,
        text: `切换模型：${model}${effort ? ` · ${effort}` : ''}`,
        msgType: TYPES.agentSelect,
        audience: [actorId],
        targetLabel: actorId,
        payload: { model, ...(effort ? { effort } : {}) },
      });
      setPendingSelect({ channelId: activeChannelId, actorId, requestId, value: { model, effort } });
      return requestId;
    } catch (error) {
      setTopError(displayError(error));
      throw error;
    }
  }, [activeChannelId, handleSend]);

  // 观察 pending select 的两层结局：入账前被拒（gate/网络——提交层吞错，Promise
  // 拿不到，只有 submission 状态知道）与入账后的终态（failed 回落报错 /
  // completed 由 turn.ended usage 保鲜自动接管）。缺前一层会让"切换中"永久卡死。
  useEffect(() => {
    if (!pendingSelect) return;
    const submission = pending.find((item) => item.messageId === pendingSelect.requestId);
    if (submission?.state === 'rejected') {
      setTopError(`切换模型失败：${submission.error?.detail || submission.error?.code || '提交被拒绝'}`);
      setPendingSelect(null);
      return;
    }
    const state = channelStatesRef.current.get(pendingSelect.channelId);
    if (!state) return;
    for (const row of state.rows.values()) {
      if (row.kind !== 'response' || row.parent_id !== pendingSelect.requestId) continue;
      const status = argsOf(row)?.status;
      if (status === 'failed') {
        setTopError(`切换模型失败：${argsOf(row)?.detail || argsOf(row)?.error_code || argsOf(row)?.reason || '未知原因'}`);
        setPendingSelect(null);
        return;
      }
      if (status === 'completed') {
        setPendingSelect(null);
        return;
      }
    }
  }, [pendingSelect, feedIndexVersion, pending]);

  // 手选目标（判据链 §2.1.2）：per-channel 内存态。
  // 动态过滤条选中的那一个 agent。它住在 Timeline（按频道 key 挂载，切频道天然
  // 重置），这里只做观察点：默认收件人的判据链在 App 算，需要读到它。
  const [focusAgentId, setFocusAgentId] = useState('');
  const handleFocusAgentChange = useCallback((actorId) => setFocusAgentId(actorId || ''), []);
  // Timeline 重挂载会以空值回报，但那发生在下一帧；频道一换就先自己清，恒不让
  // 上一个频道的筛选决定这个频道的第一条消息发给谁。
  useEffect(() => { setFocusAgentId(''); }, [activeChannelId]);

  const changeWorkspaceView = useCallback((view) => {
    if (!activeChannelId) return;
    workspaceViewsRef.current.set(activeChannelId, view);
    setWorkspaceView(view);
    setSelectedActor(null);
    setContextFocus(null);
    setFilePreviewStack([]);
    setRightPanel('');
    writeWorkspaceRoute({ channelId: activeChannelId, view });
  }, [activeChannelId]);
  workspaceActionsRef.current.openDynamic = () => changeWorkspaceView('dynamic');

  const selectWorkspaceChannel = useCallback((channelId) => {
    const view = workspaceViewsRef.current.get(channelId) || 'dynamic';
    // A deliberate re-selection is a new foreground freshness obligation.
    // A real channel change is handled once by the activeChannelId effect;
    // firing here as well would turn one click into two sequential probes.
    const reselected = channelId === activeChannelRef.current;
    selectChannel(channelId);
    if (reselected) {
      focusHistory(channelId);
      void refreshChannel(channelId);
    }
    setWorkspaceView(view);
    writeWorkspaceRoute({ channelId, view });
  }, [focusHistory, refreshChannel, selectChannel]);

  // ui.* —— 频道可以反过来操作 UI。实验性原型（DEV_BACKLOG 附录 A）。
  //
  // 快照从**渲染真正读的那几个 state** 算出来，不另建影子状态：两份必然漂移，
  // 而 agent"先看再动"看到一份漂移的状态比它不看更糟。
  // 稳定引用:内联箭头每次渲染都是新的,effect 就会每次渲染清理重跑,把正在飞的
  // 那次异步执行掐死在"算出答案了、还没发出去"。
  const uiSelfIdFor = useCallback((channelId) => rosterRef.current.self(channelId), []);
  const uiSnapshotRef = useRef(null);
  const readUiSnapshot = useCallback(() => {
    // 路由的真身是 URL:writeWorkspaceRoute 同步写 hash,刷新后也是从它恢复。
    // activeChannelId / workspaceView 只是它的 React 缓存,而缓存要等提交才追上
    // ——从真身读,"操作之后的状态"就没有时序可言。
    const route = parseWorkspaceHash(typeof window === 'undefined' ? '' : window.location.hash);
    return uiSnapshot({
    session: uiSession,
    channelId: route.valid ? route.channelId : activeChannelId,
    view: route.valid ? route.view : workspaceView,
    channels: channelList,
    open: openFromPreview(mountedFilePreview),
    viewport: typeof window === 'undefined' ? {} : { width: window.innerWidth, height: window.innerHeight },
    });
  }, [activeChannelId, channelList, mountedFilePreview, uiSession, workspaceView]);
  // 每次提交后把快照存进 ref。ui.* 的动作是 setState,是异步的,而 readUiSnapshot
  // 闭包里的值属于**发起那次操作的那一帧**——直接读它,回的是操作之前的状态,而
  // 这组词的契约恰恰是"回操作之后的状态,调用方不用再读一次"。
  uiSnapshotRef.current = readUiSnapshot();

  // committed 等 React 把这次 setState 提交完。路由从 URL 读,不需要它;但打开
  // 文件那类状态的真身就在 React 里,没有别的地方可读,只能等它提交。
  const committed = useCallback(() => new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') { setTimeout(resolve, 0); return; }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }), []);

  useUiWords({
    channelStatesRef,
    version: feedIndexVersion,
    session: uiSession,
    selfIdFor: uiSelfIdFor,
    wireRef,
    readSnapshot: () => uiSnapshotRef.current,
    onActivity: useCallback((entry) => {
      setUiActivity((current) => [...current.filter((row) => row.id !== entry.id), entry].slice(-6));
    }, []),
    actions: {
      navigate: async (channelId, view) => {
        // 先把视图记给**目标**频道,再切——不要切完再调 changeWorkspaceView。
        // 后者用的是闭包里的 activeChannelId,而这一刻 React 还没重渲染,它仍是
        // 旧频道,于是第二次写路由会把第一次写的目标频道盖掉:换频道又指定视图时,
        // 视图变了、频道没动。selectWorkspaceChannel 本来就会读这个 ref 里
        // "这个频道上次看的是哪个视图",所以先记后切,一次写完。
        if (view) workspaceViewsRef.current.set(channelId, view);
        selectWorkspaceChannel(channelId);
        await committed();
      },
      open: async (attachment) => {
        previewMessageAttachment(activeChannelRef.current, attachment);
        await committed();
      },
    },
    enabled: wireState === 'open',
  });

  const openContext = useCallback((value, focus = null) => {
    setSelectedActor(null);
    setFilePreviewStack([]);
    setRightPanel(value);
    setContextFocus(focus);
    if (focus && activeChannelId) {
      writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView, focus }, { contextEntry: true });
    }
  }, [activeChannelId, workspaceView]);

  const closeContext = useCallback(() => {
    setSelectedActor(null);
    setContextFocus(null);
    setFilePreviewStack([]);
    setRightPanel('');
    if (window.history.state?.atollContextEntry) window.history.back();
    else if (activeChannelId) writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView }, { replace: true });
  }, [activeChannelId, workspaceView]);

  const openTurnDetail = useCallback((requestId) => {
    if (requestId) openContext('', { type: 'turn', key: requestId });
  }, [openContext]);

  const handleSelectActor = useCallback((actor) => {
    setSelectedActor(actor);
    setRightPanel('roster-focus');
    const focus = { type: 'participant', key: actor.id };
    setContextFocus(focus);
    if (activeChannelId) writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView, focus }, { contextEntry: true });
    const state = channelStatesRef.current.get(activeChannelId);
    const capability = capabilityIndexFromState(state, liveProbeRequestIds).get(actor.id);
    // 点开某个成员看它的能力是真人动作，force 绕过频次闸门：限流只管自动探测。
    if (!capability?.describe && !capability?.loading) describeActor(actor, activeChannelId, { force: true });
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

  // 文件索引要走完整本账。只有真的打开某个账本产物时才需要它；普通聊天帧
  // 恒不为了一个关闭着的右侧面板重扫几万条消息。
  const activeArtifactIndex = useMemo(
    () => contextFocus?.type === 'artifact'
      ? buildArtifactIndex(channelStatesRef.current.get(activeChannelId))
      : EMPTY_INDEX,
    [activeChannelId, feedVersion, contextFocus?.type],
  );

  // 全局搜索和活动中心是按需投影，不是 feed 的写入索引。旧实现即便两个界面
  // 都关着，也会在每个流式响应上遍历所有频道、重建 work/artifact/activity/
  // search 四套数据；这会直接和 Composer 在主线程上抢时间。
  const globalProjection = globalSearchOpen ? 'search' : rightPanel === 'activity' ? 'activity' : '';
  const searchDemandChannels = globalSearchOpen
    ? channelList.filter((channel) => canViewChannelContent(channel.access)).map((channel) => channel.id).sort().join('\u0000')
    : '';
  useEffect(() => {
    if (!globalSearchOpen || !searchDemandChannels) return undefined;
    const controller = new AbortController();
    // Search asks the data plane for visible channel material; it never scans
    // ledgers or schedules pages itself. The scheduler remains free to choose
    // local/remote sources, batch sizes and execution order.
    for (const channelId of searchDemandChannels.split('\u0000')) {
      void loadHistory(channelId, {
        intent: HISTORY_INTENT.searchContext,
        urgency: HISTORY_URGENCY.interactive,
        signal: controller.signal,
      });
    }
    return () => controller.abort('search-closed');
  }, [globalSearchOpen, searchDemandChannels, loadHistory]);
  const globalData = useMemo(() => {
    if (!globalProjection) return EMPTY_GLOBAL_DATA;
    const channelData = channelList.map((channel) => {
      const state = channelStatesRef.current.get(channel.id) || createChannelState(channel.id);
      const roster = visibleRosterRows(rosters.get(channel.id) || []);
      const capabilityIndex = capabilityIndexFromState(state, liveProbeRequestIds);
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
    const activities = globalProjection === 'activity'
      ? [...buildActivityIndex({ channels: channelData, operations: rawOperations }).values()]
        .map((item) => ({ ...item, channelName: names.get(item.channelId), detail: item.summary }))
      : [];
    const operations = globalProjection === 'activity'
      ? activeOperations(buildOperationIndex({ channels: channelData, operations: rawOperations }))
        .map((item) => ({ ...item, channelName: names.get(item.channelId) }))
      : [];
    const searchIndex = globalProjection === 'search'
      ? buildGlobalSearchIndex({ channels: channelData, operations: rawOperations })
      : EMPTY_INDEX;
    return { channelData, activities, operations, searchIndex };
  }, [globalProjection, channelList, feedIndexVersion, pending, rosters, timerRecords]);

  if (booting) return <div className="boot-screen"><span className="brand-dot" />正在恢复会话…</div>;
  if (!me) return <Auth identity={identity} onAuthed={handleAuthed} />;
  if (versionIncompatible) return <VersionIncompatible
    expectedVersion={versionIncompatible.expectedVersion}
    receivedVersion={versionIncompatible.receivedVersion}
    onRefresh={() => window.location.reload()}
  />;

  const activeState = channelStatesRef.current.get(activeChannelId) || createChannelState(activeChannelId);
  const agentActivity = agentActivityRef.current.snapshot();
  const acknowledgeAgentActivity = (channelId, agentId) => agentActivityRef.current.acknowledge(channelId, agentId);
  const readActiveLatest = derived(
    'readActiveLatest',
    [activeChannelId, markRead],
    () => (acknowledgement) => markRead(activeChannelId, acknowledgement),
  );
  const acknowledgeActiveNotifications = derived(
    'acknowledgeActiveNotifications',
    [activeChannelId, acknowledgeNotifications],
    () => (confirmation) => acknowledgeNotifications(activeChannelId, confirmation),
  );
  const loadActiveOlder = derived(
    'loadActiveOlder',
    [activeChannelId, loadHistory],
    () => (options) => loadHistory(activeChannelId, options),
  );
  const refreshActiveLatest = derived(
    'refreshActiveLatest',
    [activeChannelId, refreshChannel],
    () => () => refreshChannel(activeChannelId),
  );
  const retryActiveLocalReplica = derived(
    'retryActiveLocalReplica',
    [activeChannelId, prepareLocalReplica, principalId],
    () => () => prepareLocalReplica(principalId, { focus: activeChannelId }),
  );
  const activeHistory = createHistoryDemandPort({
    channelId: activeChannelId,
    status: {
      ...activeHistoryStatus,
      localReplicaReady,
      localReplicaError,
      localReplicaErrorCode,
    },
    open: loadActiveOlder,
    refreshLatest: refreshActiveLatest,
    retryLocalReplica: retryActiveLocalReplica,
    debugSnapshot: () => coldEntryDiagnosticsFor(activeChannelId),
    markRead: readActiveLatest,
    markNotificationsRead: acknowledgeActiveNotifications,
  });
  const activeRow = channelList.find((channel) => channel.id === activeChannelId);
  const activeRoster = isMemberAccess(activeRow?.access) ? rosters.get(activeChannelId) || [] : [];
  const selfId = activeRow?.selfActorId || rosterRef.current?.self(activeChannelId) || '';
  const activeRosterAuthority = rosterAuthorities.get(activeChannelId);
  const waitingRosterAuthority = createWaitingTargetAuthority({
    principalId,
    channelId: activeChannelId,
    generation: activeRosterGeneration,
    rosterAuthority: activeRosterAuthority,
    roster: activeRoster,
  });
  // ChannelReplica 按频道 revision/notification high-water 缓存未读投影。频道栏仍遍历轻量
  // channel 列表，但后台一条 live 不再让每个频道各自重扫整本账。
  //
  // rail 恒只从持久 notification high-water 派生，不再用 viewport 状态临时压零；
  // 因此切频道、刷新或迟到 hydration 都不能把已确认通知复活。
  const unread = derived('unread', [channelList, feedIndexVersion, rosters], () => Object.fromEntries(channelList.map((channel) => {
    const loaded = unreadFor(channel.id, channel.selfActorId || rosterRef.current?.self(channel.id) || '');
    return [channel.id, loaded];
  })));
  const activeAccess = activeRow?.access || CHANNEL_ACCESS.loading;
  const requestVersion = activeState._requestVersion ?? activeState.turns.size;
  const terminalVersion = activeState._terminalVersion ?? activeState.lastSeq;
  const capabilityIndex = derived(
    'activeCapabilities',
    [activeState, requestVersion, terminalVersion, liveProbeRequestIds.size, manualAgentVersion],
    () => capabilityIndexFromState(activeState, liveProbeRequestIds),
  );
  // 参数面板数据（协议 §4）：值域与当前值都是活状态读数，恒只认本连接证据
  // （describe = liveDescribesRef；options = generation 快照；usage = 本连接
  // context 探测起算）。
  // manualAgentVersion 只为触发重渲染（手选存 ref）。
  void manualAgentVersion;
  const composerAgentId = composerAgent.channelId === activeChannelId ? composerAgent.actorId : '';
  // 读数按"新在前"的一列探测 id 取第一份完成的：手动刷新期间新的还没回、旧的
  // 仍是当前真值。derived 按 Object.is 比较依赖，所以这里传拼接后的字符串键。
  const composerProbeKey = probeRequestKey(contextProbedRef, activeChannelId, composerAgentId);
  const composerOptionsProbeKey = probeRequestKey(optionsProbedRef, activeChannelId, composerAgentId);
  const composerAgentUsage = derived(
    'composerAgentUsage',
    [activeState, terminalVersion, composerAgentId, composerProbeKey],
    () => composerAgentId ? latestAgentUsage(activeState, composerAgentId, composerProbeKey.split('|')) : null,
  );
  const composerAgentOptions = derived(
    'composerAgentOptions',
    [activeState, terminalVersion, composerAgentId, composerOptionsProbeKey],
    () => composerAgentId ? latestAgentOptions(activeState, composerAgentId, composerOptionsProbeKey.split('|')) : null,
  );
  const composerSelectionView = derived(
    'composerSelectionView',
    [composerAgentId, capabilityIndex, composerAgentOptions, composerAgentUsage],
    () => composerAgentId
      ? agentSelectionView({ actorId: composerAgentId, options: composerAgentOptions, usage: composerAgentUsage })
      : null,
  );
  const composerSupportedTypes = derived(
    'composerSupportedTypes',
    [composerAgentId, capabilityIndex],
    () => composerAgentId ? [...(capabilityIndex.get(composerAgentId)?.describe?.types?.keys?.() || [])] : [],
  );
  const selectPendingHere = pendingSelect && pendingSelect.channelId === activeChannelId ? pendingSelect : null;
  const manualAgentId = manualAgentIdFor(activeChannelId);
  // 无 @ 时的默认目标（判据链 §2.1 的 2-5 环：筛选 > 手选 > 最近交互 > 唯一 agent）。
  // mention 环在 Composer 判（它持有编辑框状态），终判结果经 onTargetChange 回报。
  const fallbackAgent = derived(
    'fallbackAgent',
    [focusAgentId, manualAgentId, activeRoster, activeState, requestVersion, selfId],
    () => resolveParameterAgent({ recipients: [], filterAgentId: focusAgentId, manualAgentId, roster: activeRoster, state: activeState, selfId }),
  );
  const fallbackAgentId = fallbackAgent.kind === 'single' ? fallbackAgent.agent.id : '';
  const fallbackAgentSource = fallbackAgent.kind === 'single' ? (fallbackAgent.source || '') : '';
  const providers = taskProviders(capabilityIndex, activeRoster);
  const activePending = derived('activePending', [pending, activeChannelId], () => pending.filter((item) => item.channelId === activeChannelId));
  const composerAgentSelection = derived(
    'composerAgentSelection',
    [composerSelectionView, composerAgentUsage, composerSupportedTypes, selectPendingHere, fallbackAgentId, fallbackAgentSource, handleAgentSelection, handlePickAgent, handleComposerAgentChange, handleSelectorOpen],
    () => ({ view: composerSelectionView, usage: composerAgentUsage, supportedTypes: composerSupportedTypes, pending: selectPendingHere, fallbackAgentId, fallbackAgentSource, onChange: handleAgentSelection, onPickAgent: handlePickAgent, onTargetChange: handleComposerAgentChange, onOpen: handleSelectorOpen }),
  );
  // 同上:它走一遍当前频道的全部 turn,而每次渲染都走。同一个答案,不再算 N 遍。
  const needsWorkItemIndex = workspaceView === 'tasks' || contextFocus?.type === 'work_item';
  const workItemIndex = derived(
    'workItems',
    [needsWorkItemIndex, activeState, feedVersion, pending, timerRecords, selfId, activeAccess, capabilityIndex],
    () => needsWorkItemIndex
      ? buildWorkItemIndex({ state: activeState, pending, timers: timerRecords, selfId, access: activeAccess, capabilityIndex })
      : EMPTY_INDEX,
  );
  const artifactIndex = activeArtifactIndex;
  const selectedCapability = selectedActor ? capabilityIndex.get(selectedActor.id) : null;
  const selectedArtifact = contextFocus?.type === 'artifact' ? artifactIndex.get(contextFocus.key) : null;
  const previewArtifact = mountedFilePreview?.channelId === activeChannelId ? mountedFilePreview : null;
  const selectedTurn = contextFocus?.type === 'turn' ? activeState.turns.get(contextFocus.key) : null;
  const selectedWorkItem = contextFocus?.type === 'work_item' ? workItemIndex.get(contextFocus.key) : null;


  const rememberFilePreview = (artifact) => {
    if (!artifact?.channelId || !artifact?.resourceId) return;
    setRecentFiles((current) => {
      const next = rememberFileRead(current, artifact);
      writeFileReadingHistory(me?.id, serverWorldCommittedRef.current, next);
      return next;
    });
  };

  const showFilePreview = (artifact) => {
    if (!artifact) return;
    rememberFilePreview(artifact);
    setSelectedActor(null);
    setFilePreviewStack((current) => pushFilePreview(current, artifact, selectedArtifact));
    setRightPanel('artifact-focus');
  };

  const backFilePreview = () => {
    setFilePreviewStack((current) => popFilePreview(current));
  };

  const closeFilePreview = () => {
    if (filePreviewStack.length > 1) backFilePreview();
    else closeContext();
  };

  const previewMessageAttachment = (channelId, attachment) => {
    const resourceId = attachment?.resource_id;
    if (!channelId || !resourceId) return;
    const mediaType = attachment.media_type || 'application/octet-stream';
    const indexedArtifact = artifactIndex.get(`artifact:${channelId}:${resourceId}`);
    const referenceLine = Number(attachment.line);
    const referenceFields = {
      ...(Number.isSafeInteger(referenceLine) && referenceLine > 0 ? { line: referenceLine } : {}),
      ...(attachment.file_reference ? { provenance: { source: 'file_reference' } } : {}),
    };
    const artifact = indexedArtifact ? { ...indexedArtifact, ...referenceFields } : {
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
      ...referenceFields,
    };
    showFilePreview(artifact);
  };

  const openArtifactSource = () => {
    setSelectedActor(null);
    setContextFocus(null);
    setRightPanel('');
    workspaceViewsRef.current.set(activeChannelId, 'dynamic');
    setWorkspaceView('dynamic');
    writeWorkspaceRoute({ channelId: activeChannelId, view: 'dynamic' }, { replace: true });
  };

  const openDynamicSource = () => {
    setSelectedActor(null);
    setContextFocus(null);
    setRightPanel('');
    workspaceViewsRef.current.set(activeChannelId, 'dynamic');
    setWorkspaceView('dynamic');
    writeWorkspaceRoute({ channelId: activeChannelId, view: 'dynamic' }, { replace: true });
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
    const reselected = channel.id === activeChannelRef.current;
    selectChannel(channel.id);
    if (reselected) {
      focusHistory(channel.id);
      void refreshChannel(channel.id);
    }
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
  };

  const host = {
    panel: { value: rightPanel, focus: contextFocus, close: closeContext, turn: { selected: selectedTurn, capability: capabilityIndex.get(selectedTurnActorId), controlState: controlStates[selectedTurnControlKey], onCancel: () => handleCancel(activeChannelId, selectedTurn?.requestId), onControl: (type, payload) => handleTaskControl({ channelId: activeChannelId, turn: selectedTurn, actorId: selectedTurnActorId, type, payload }), onDownload: (attachment) => handleDownloadResource(activeChannelId, attachment), onSource: openDynamicSource, onCreateTask: createTaskFromSource } },
    active: { channel: activeChannel, state: activeState, roster: activeRoster, access: activeAccess, selfId, wireState, automation: { records: timerRecords, disabled: wireState !== 'open' || !canWriteChannel(activeAccess), onAfter: handleAfter, onCancel: handleCancelTimer } },
    directory: { channels: channelList },
    governance: { principals: spacePrincipals, declarations: spaceDeclarations, daemons: spaceDaemons, channelDevices, registrarRoster: rosters.get('c0') || (activeChannelId === 'c0' ? activeRoster : []), rootState: channelStatesRef.current.get('c0'), version: feedIndexVersion, onSubmit: handleSend, onRefresh: refreshGovernanceData },
    artifacts: { selected: previewArtifact || selectedArtifact, authorName: activeRoster.find((row) => row.id === (previewArtifact || selectedArtifact)?.authorActorId)?.name, recentFiles: recentFiles.filter((row) => row.channelId === activeChannelId), canGoBack: filePreviewStack.length > 1, onBack: backFilePreview, onClose: closeFilePreview, onPreview: showFilePreview, onResource: handleResource, onFileOperation: runFileOperation, onDownload: (attachment) => handleDownloadResource((previewArtifact || selectedArtifact)?.channelId || activeChannelId, attachment), onAttach: attachToDraft, onSource: openArtifactSource, onFileReference: (reference) => previewMessageAttachment(activeChannelId, attachmentFromFileReference(reference)) },
    workItems: { selected: selectedWorkItem, roster: activeRoster, onSource: openWorkItemSource, onResolve: (item, decision) => handleResolve(activeChannelId, item.nativeId, decision, {}), onOpenTurn: openTurnDetail, onRetry: (item) => { const submission = pending.find((row) => row.key === item.diagnostic?.submissionKey); if (submission) handleRetry(submission); }, onCancelAutomation: handleCancelTimer },
    roster: { busy: rosterBusy, onRefresh: () => refreshRoster(activeChannelId, true), selectedActor, capability: selectedCapability, onSelectActor: handleSelectActor, onCloseActor: () => {
      setSelectedActor(null);
      const focus = { type: 'channel', key: activeChannelId };
      setContextFocus(focus);
      writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView, focus }, { replace: true, contextEntry: true });
    }, onDescribe: () => describeActor(selectedActor, activeChannelId, { force: true }), onInvoke: handleInvokeActor },
    activity: { activities: globalData.activities, operations: globalData.operations, onOpen: navigateToSource },
  };
  return <>
  <AppShell
    session={{ me, wireState, update: nodeUpdate, onLogout: handleLogout }}
    navigation={{ channels: channelList, activeChannelId, unread, agentActivity, onSelect: selectWorkspaceChannel, onCreate: () => { setRightPanel(''); setContextFocus(null); setChannelCreateOpen(true); }, onSearch: () => { setRightPanel(''); setContextFocus(null); setGlobalSearchOpen(true); }, onActivity: () => openContext('activity'), onSpaceManage: () => openContext('space') }}
    workspace={{ channel: activeChannel, view: workspaceView, onViewChange: changeWorkspaceView, state: activeState, history: activeHistory, access: activeAccess, roster: activeRoster, waitingRosterAuthority, selfId, agentActivity: agentActivity.byChannel[activeChannelId], onAcknowledgeAgentActivity: (agentId) => acknowledgeAgentActivity(activeChannelId, agentId), pending: activePending, approvalStates, controlStates, capabilityIndex, mockAdvance: { ...mockAdvance, onAdvance: advanceMockComputation }, agentSelection: composerAgentSelection, onResolve: handleResolve, onRetry: handleRetry, onCancel: handleCancelAny, onTaskControl: handleTaskControl, onDownloadResource: handleDownloadResource, onPreviewResource: previewMessageAttachment, onOpenTurn: (turn) => openTurnDetail(turn.requestId), onCreateTask: createTaskFromSource, onFocusAgentChange: handleFocusAgentChange, onSend: handleSend, onRestartChannel: handleRestartChannel, draft: composerDraftProjection, onDraftChange: (value) => updateDraft(activeChannelId, { ...value, attachments: tagAttachmentsForCurrentWorld(value?.attachments) }), draftRevision: drafts.get(activeChannelId)?.revision || 0, attachments: composerAttachmentProjection, onPreviewAttachment: (attachment) => previewMessageAttachment(activeChannelId, attachment), onUploadAttachments: uploadComposerAttachments, onOpenChannelFiles: ({ editing = false } = {}) => { if (editing) { setChannelNotice('编辑已有消息时不能附加频道文件；请先完成或取消编辑。'); return; } setAttachmentPickerOpen(true); }, onComposerEditChange: publishComposerEdit, onRemoveAttachment: (resourceId) => mutateDraftAttachments(activeChannelId, (rows) => rows.filter((row) => row.resource_id !== resourceId)), onClearAttachments: () => clearDraftAttachments(activeChannelId), turnDetail: { selected: selectedTurn, capability: capabilityIndex.get(selectedTurnActorId), controlState: controlStates[selectedTurnControlKey], onCancel: () => handleCancel(activeChannelId, selectedTurn?.requestId), onControl: (type, payload) => handleTaskControl({ channelId: activeChannelId, turn: selectedTurn, actorId: selectedTurnActorId, type, payload }), onDownload: (attachment) => handleDownloadResource(activeChannelId, attachment), onSource: openDynamicSource, onCreateTask: createTaskFromSource, onClose: closeContext }, resources: { devices: channelDevices, disabled: wireState !== 'open' || !canWriteChannel(activeAccess), onResource: handleResource, onFileOperation: runFileOperation, onAttach: attachToDraft, recentFiles: recentFiles.filter((row) => row.channelId === activeChannelId), onOpen: (artifact) => { rememberFilePreview(artifact); openContext('artifact-focus', { type: 'artifact', key: artifact.key }); }, onPreview: showFilePreview }, tasks: { items: [...workItemIndex.values()], providers, canWrite: wireState === 'open' && canWriteChannel(activeAccess), onNewTask: createTaskFromSource, onOpen: (item) => openContext('work-item-focus', { type: 'work_item', key: item.key }), onNewAutomation: () => openContext('automation') }, automation: { records: timerRecords, disabled: wireState !== 'open' || !canWriteChannel(activeAccess), onAfter: handleAfter, onCancel: handleCancelTimer } }}
    notices={{ error: topError, channel: channelNotice, dismissError: () => setTopError(''), dismissChannel: () => setChannelNotice('') }}
    panel={{ value: rightPanel, open: openContext, host }}
  />
  {taskCreateSource !== undefined && <TaskCreateModal providers={providers} source={taskCreateSource} onSubmit={submitTask} onClose={() => setTaskCreateSource(undefined)} />}
  {channelCreateOpen && activeChannel && <ChannelCreateModal channel={activeChannel} channels={channelList} roster={activeRoster} selfId={selfId} state={activeState} disabled={wireState !== 'open' || !canWriteChannel(activeAccess)} onSubmit={handleSend} onClose={() => setChannelCreateOpen(false)} onEnterChannel={(channel) => { setChannelCreateOpen(false); selectWorkspaceChannel(channel.id); }} />}
  {globalSearchOpen && <GlobalSearch index={globalData.searchIndex} onOpen={navigateToSource} onClose={() => setGlobalSearchOpen(false)} />}
  <UiActivityOverlay entries={uiActivity} />
  {attachmentPickerOpen && activeChannel && <ChannelFilePickerModal channel={activeChannel} devices={channelDevices} disabled={wireState !== 'open' || !canWriteChannel(activeAccess)} onResource={handleResource} onFileOperation={runFileOperation} onChoose={(attachment) => attachToDraft(attachment, activeChannel.id)} onClose={() => setAttachmentPickerOpen(false)} />}
  </>;
}
