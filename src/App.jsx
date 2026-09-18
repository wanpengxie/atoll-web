import { argsOf } from './protocol/envelope.js';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { capabilityIndexFromState } from './model/capabilities.js';
import { attachmentFromFileReference } from './model/file-references.js';
import { rememberChannelNames } from './model/channel-name-cache.js';
import { ensureServerBoot, readServerBoot } from './model/server-boot.js';
import { isMobileProfile } from './model/device-profile.js';
import { foregroundWake } from './net/wake.js';
import { artifactKindForMediaType, buildArtifactIndex, previewForMediaType } from './model/artifacts.js';
import { describeClient } from './model/client-label.js';
import { openFromPreview, snapshot as uiSnapshot } from './model/ui-words.js';
import { UiActivityOverlay } from './ui/UiActivityOverlay.jsx';
import { useUiWords } from './app/hooks/useUiWords.js';
import {
  availableUploadName,
  fileTransferURL,
  uploadChannelFile,
} from './model/channel-file-transfer.js';
import { availableDefaultStorageDeviceId } from './model/channel-files.js';
import { canViewChannelContent, canWriteChannel, CHANNEL_ACCESS, createChannelAccessTracker, isMemberAccess } from './model/channel-access.js';
import { createChannelState, reconcileApprovals } from './model/fold.js';
import { createRoster } from './model/roster.js';
import { readFileTicket } from './model/resources.js';
import { safeChannelDeviceRows, safeDaemonRows } from './model/space-administration.js';
import { buildWorkItemIndex, taskProviders } from './model/work-items.js';
import { parseWorkspaceHash, writeWorkspaceRoute } from './model/workspace-route.js';
import { messagePresentation } from './model/message-presentation.js';
import { isSystemWord, SYSTEM_ACTOR_ID, TYPES } from './protocol/vocab.js';
import { newId } from './util/id.js';
import { activeOperations, buildActivityIndex, buildGlobalSearchIndex, buildOperationIndex } from './model/activity.js';
import { createWaitingTargetAuthority } from './model/task-controls.js';
import { agentSelectionView, latestAgentOptions, latestAgentUsage, latestInteractedAgentId, resolveParameterAgent } from './model/agent-selection.js';
import { createAgentActivityTracker } from './model/agent-activity.js';
import {
  acceptAgentProbe,
  advanceAgentProbeGeneration,
  beginAgentProbe,
  clearProbeSlots,
  createAgentProbeLifecycle,
  failAgentProbe,
  observeAgentProbe,
  PROBE_TIMEOUT_MS,
  releaseAgentProbe,
  reserveProbeSlot,
} from './model/agent-probe-lifecycle.js';
import { createObsClient, ObsError } from './net/obs.js';
import { createWire } from './net/wire.js';
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
import { diagnostic } from './model/diagnostics.js';
import { readFileReadingHistory, rememberFileRead, writeFileReadingHistory } from './model/file-reading-history.js';
import { popFilePreview, pushFilePreview } from './model/file-preview-stack.js';
import { createHistoryDemandPort, HISTORY_INTENT, HISTORY_URGENCY } from './model/history-demand.js';
import { readWorkspaceBootstrap, writeWorkspaceBootstrap } from './model/workspace-bootstrap-cache.js';
import {
  assessRequestOwner,
  captureRequestOwner,
  executeOwnedPhase,
  REQUEST_PHASE,
  requestAccessError,
} from './model/request-owner.js';

function displayError(error) {
  if (error instanceof ObsError && error.status === 503) return '频道未在服务';
  return error?.detail || error?.message || String(error);
}

const FILE_ATTACHMENT_WORLD_FIELD = '_atoll_world_epoch';

async function loadChannelTree(obs) {
  const found = new Map();
  let level = [undefined];
  const expanded = new Set();
  let complete = true;
  // Parent discovery is ordered, siblings are independent. Fetching one whole
  // level concurrently avoids an RTT per channel without guessing descendants
  // or changing the resulting tree.
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
        parentId,
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
  const terminal = argsOf(turn.terminal);
  let state = terminal?.status === 'failed' ? 'failed' : terminal?.status === 'cancelled' ? 'cancelled' : terminal?.status === 'completed' ? 'completed' : 'waiting_ledger';
  let detail = turn.terminal ? '账本已确认' : '等待账本确认';
  if (turn.request?.type === TYPES.channel.create && terminal?.status === 'completed') {
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
  const [wireState, setWireState] = useState('closed');
  const [versionIncompatible, setVersionIncompatible] = useState(null);
  // A protocol mismatch is terminal for this document lifetime. Keep the
  // revocation synchronous so effects and async OBS continuations cannot use
  // the render-delayed state value to restart old-page data work.
  const versionIncompatibleRef = useRef(null);
  const versionIncompatibleEpochRef = useRef(0);
  const [serverWorld, setServerWorld] = useState(() => readServerBoot());
  const [topError, setTopError] = useState('');
  const [rosters, setRosters] = useState(new Map());
  const [rosterAuthorities, setRosterAuthorities] = useState(new Map());
  const [rosterBusy, setRosterBusy] = useState(false);
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
  const [draftAttachments, setDraftAttachments] = useState({});
  // Imperative attachment commands and async uploads need a ledger that is
  // updated only by committed user actions. A render mirror lets a suspended
  // candidate overwrite what the still-painted Composer observes.
  const draftAttachmentLedgerRef = useRef(new Map());
  const attachmentDraftEpochsRef = useRef(new Map());
  const attachmentWorldRevisionRef = useRef(0);
  const attachmentUploadQueuesRef = useRef(new Map());
  const attachmentActiveUploadsRef = useRef(new Map());
  const fileActiveOperationsRef = useRef(new Map());
  const editReleaseObligationsRef = useRef(new Map());
  const serverWorldCommittedRef = useRef(serverWorld);
  const wireStateCommittedRef = useRef(wireState);
  const abortAttachmentUploads = useCallback((channelId = '') => {
    for (const [key, active] of attachmentActiveUploadsRef.current) {
      if (channelId && active.owner.channelId !== channelId) continue;
      active.controller.abort();
      attachmentActiveUploadsRef.current.delete(key);
    }
  }, []);
  const abortFileOperations = useCallback((channelId = '') => {
    for (const [key, active] of fileActiveOperationsRef.current) {
      if (channelId && active.owner.channelId !== channelId) continue;
      active.controller.abort();
      fileActiveOperationsRef.current.delete(key);
    }
  }, []);
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
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const composerEditRef = useRef(null);
  const publishComposerEdit = useCallback((value) => {
    const entering = Boolean(value) && !composerEditRef.current;
    composerEditRef.current = value;
    if (!entering) return;
    const channelId = activeChannelRef.current;
    if (channelId) {
      abortAttachmentUploads(channelId);
      attachmentDraftEpochsRef.current.set(
        channelId,
        Number(attachmentDraftEpochsRef.current.get(channelId) || 0) + 1,
      );
    }
    setAttachmentPickerOpen(false);
  }, [abortAttachmentUploads]);
  const [mockAdvance, setMockAdvance] = useState({ available: false, busy: false });
  // 参数面板（协议 §2/§4）：目标 = Composer 回报的判据链结果；值域走 describe、
  // 当前值走账本 usage；select 的 pending/failed 三态由账本终态驱动。
  const [composerAgent, setComposerAgent] = useState({ channelId: '', actorId: '' });
  const [pendingSelect, setPendingSelect] = useState(null); // {channelId, actorId, requestId, value:{model,effort}}
  const manualAgentsRef = useRef(new Map()); // channelId -> 手选 agent id（首条 ask 入账即清）
  const contextProbedRef = useRef(new Map()); // `${channelId}:${actorId}` -> {requestId, failed}，重连时清
  const optionsProbedRef = useRef(new Map()); // 同上；agent.options 是 incarnation 级活快照
  // describe 的 guard 覆盖本地提交、回执先于 feed 的空窗和账本终态。失败留在
  // 当前连接代中，只有明确用户手势或下一连接代才能重试。
  const describeProbesRef = useRef(null);
  if (describeProbesRef.current === null) describeProbesRef.current = createAgentProbeLifecycle();
  const liveDescribesRef = useRef(describeProbesRef.current.liveRequestIds);
  // 手动挡（owner 2026-09-18 拍定）：**没有任何自动探测**。这里装着"用户刚刚
  // 要求刷新的目标"，每条探测都必须能追溯到一个真人动作——展开模型选择器、
  // 手动切目标、手选 agent、点开某个成员。一次动作放行一条完整链
  // （describe → options → context），链走完即出栈，不会自己续上。
  //
  // 去掉自动挡的原因：自动探测的触发条件挂在连接状态和消息流上，前端服务一挂、
  // 浏览器不停重连，它就变成轮询。2026-09-18 凌晨六个标签页三小时发出 1200 条，
  // 塞满 codex 的在站账，真人反而被 overloaded 挡在门外。限流能压住量，但只要
  // 还有自动触发，这条路就始终存在。手动挡直接把它焊死。
  const manualProbeRef = useRef(new Set()); // `${channelId}:${actorId}`
  const [manualAgentVersion, setManualAgentVersion] = useState(0);
  const [, setAgentActivityVersion] = useState(0);
  const agentActivityRef = useRef(null);
  if (agentActivityRef.current === null) {
    agentActivityRef.current = createAgentActivityTracker({
      onChange: () => setAgentActivityVersion((value) => value + 1),
    });
  }

  const obsRef = useRef(null);
  const wireRef = useRef(null);
  const rosterRef = useRef(null);
  // Callbacks owned by Wire/roster outlive an individual React render. Publish
  // their authority as one committed port: a suspended principal candidate
  // must not redirect a frame received by the still-painted session.
  const committedFeedOwnerRef = useRef(null);
  const accessRef = useRef(null);
  const activeChannelRef = useRef(initialRouteRef.current.channelId || '');
  const showSessionError = useCallback((error) => {
    diagnostic('error', 'session.failed', { error });
    setTopError(displayError(error));
  }, []);
  const { booting, principal: me, identity, accept: handleAuthed, clear: clearSession, logoutRemote } = useAtollSession({ onError: showSessionError });
  const principalId = me?.id || '';
  const feedProducerOwnerToken = useMemo(
    () => Object.freeze({ principalId }),
    [principalId],
  );
  const nodeUpdate = useNodeUpdate({ principalId: me?.id, wireState });

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
  const receiveRoster = useCallback((channelId, rows, producerOwnerToken) => {
    const owner = committedFeedOwnerRef.current;
    if (!owner || owner.producerOwnerToken !== producerOwnerToken) return;
    setRosters((current) => new Map(current).set(channelId, rows));
    const authority = rosterRef.current?.authority?.(channelId);
    const generation = Number(owner.generationFor(channelId) || 0);
    const currentPrincipal = owner.principalId;
    setRosterAuthorities((current) => {
      const next = new Map(current);
      if (authority?.principalId === currentPrincipal && generation > 0) {
        next.set(channelId, Object.freeze({
          principalId: currentPrincipal,
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
  const currentAttachmentOwnerFacts = useCallback((owner) => {
    const committed = committedFeedOwnerRef.current;
    const access = accessRef.current?.state?.(owner.channelId);
    return {
      principalId: committed?.principalId || '',
      principalEpoch: committed?.producerOwnerToken || null,
      channelId: owner.channelId,
      worldEpoch: serverWorldCommittedRef.current,
      attemptEpoch: attachmentWorldRevisionRef.current,
      access: {
        epoch: Number(access?.authorityEpoch || 0),
        relationship: String(access?.relationship || ''),
        existence: String(access?.existence || ''),
        runtime: String(access?.runtime || ''),
        unavailable: access?.unavailable === true,
      },
      transport: wireRef.current,
      transportEpoch: Number(committed?.generationFor?.(owner.channelId) || 0),
      transportOpen: wireStateCommittedRef.current === 'open' && Boolean(wireRef.current),
      draft: { epoch: Number(attachmentDraftEpochsRef.current.get(owner.channelId) || 0) },
    };
  }, []);
  const currentFileOwnerFacts = useCallback((owner) => {
    const current = currentAttachmentOwnerFacts(owner);
    return {
      ...current,
      // A painted file surface belongs to the committed workspace channel.
      // A late click/continuation from the old surface may not keep mutating
      // that channel after navigation has committed another owner.
      channelId: activeChannelRef.current || '',
    };
  }, [currentAttachmentOwnerFacts]);
  const assessFileOperation = useCallback((active, phase, { requireTransport = phase !== REQUEST_PHASE.settle } = {}) => {
    const current = currentFileOwnerFacts(active.owner);
    const base = assessRequestOwner(active.owner, current, phase, {
      requireAccess: false,
      requireTransport,
      requireDraft: active.requireDraft,
    });
    if (!base.current) return base;
    if (active.owner.access.epoch !== Number(current.access?.epoch || 0)) {
      return { current: false, code: 'access_changed', detail: '频道授权事实已变化' };
    }
    const relationship = String(current.access?.relationship || '');
    const allowed = active.access === 'read'
      ? relationship === 'member' || relationship === 'observer'
      : relationship === 'member';
    if (!allowed) return { current: false, code: 'forbidden', detail: '当前频道权限不允许这项文件操作' };
    if (current.access?.existence === 'retired') return { current: false, code: 'channel_not_found', detail: '频道已退役' };
    if (current.access?.unavailable || current.access?.runtime === 'closed') {
      return { current: false, code: 'channel_unavailable', detail: '频道暂不可用' };
    }
    return base;
  }, [currentFileOwnerFacts]);
  const runFileOperation = useCallback(async ({ channelId, access = 'read', requireDraft = false, signal: externalSignal } = {}, effect) => {
    if (!channelId || typeof effect !== 'function') throw new TypeError('文件操作上下文不完整');
    const committed = committedFeedOwnerRef.current;
    if (!committed?.producerOwnerToken) throw new TypeError('文件操作会话尚未提交');
    const owner = captureRequestOwner({
      principalId: committed.principalId,
      principalEpoch: committed.producerOwnerToken,
      channelId,
      worldEpoch: serverWorldCommittedRef.current,
      attemptEpoch: attachmentWorldRevisionRef.current,
      accessState: accessRef.current?.state?.(channelId),
      transport: wireRef.current,
      transportEpoch: Number(committed.generationFor?.(channelId) || 0),
      draft: { epoch: Number(attachmentDraftEpochsRef.current.get(channelId) || 0) },
    });
    const controller = new AbortController();
    const operationKey = `${channelId}:${newId()}`;
    const active = { owner, controller, access, requireDraft };
    fileActiveOperationsRef.current.set(operationKey, active);
    const abortFromCaller = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener?.('abort', abortFromCaller, { once: true });
    const authorize = (phase = REQUEST_PHASE.submit, options = {}) => {
      const assessment = assessFileOperation(active, phase, options);
      if (!assessment.current) throw requestAccessError(assessment);
      if (controller.signal.aborted) throw new DOMException('文件操作已取消', 'AbortError');
      return true;
    };
    const ownedAwait = async (phase, work, options) => {
      authorize(phase, options);
      const value = await work();
      authorize(phase, options);
      return value;
    };
    try {
      authorize(REQUEST_PHASE.acquire);
      const value = await effect(Object.freeze({
        owner,
        signal: controller.signal,
        authorize,
        resource: (payload) => ownedAwait(REQUEST_PHASE.submit, () => handleResource(payload)),
        fetch: (input, init = {}) => ownedAwait(
          REQUEST_PHASE.submit,
          () => fetch(input, { ...init, signal: controller.signal }),
          { requireTransport: false },
        ),
        persist: (work) => ownedAwait(REQUEST_PHASE.persist, work, { requireTransport: false }),
      }));
      authorize(REQUEST_PHASE.settle, { requireTransport: false });
      return value;
    } finally {
      externalSignal?.removeEventListener?.('abort', abortFromCaller);
      if (fileActiveOperationsRef.current.get(operationKey) === active) {
        fileActiveOperationsRef.current.delete(operationKey);
      }
    }
  }, [assessFileOperation, handleResource]);
  useEffect(() => {
    for (const [key, active] of attachmentActiveUploadsRef.current) {
      const assessment = assessRequestOwner(
        active.owner,
        currentAttachmentOwnerFacts(active.owner),
        REQUEST_PHASE.submit,
        { requireDraft: true },
      );
      if (assessment.current) continue;
      active.controller.abort();
      attachmentActiveUploadsRef.current.delete(key);
    }
  }, [currentAttachmentOwnerFacts, directory.version, serverWorld, wireState]);
  useEffect(() => {
    for (const [key, active] of fileActiveOperationsRef.current) {
      // HTTP transfer owns a server-minted ticket and may legitimately finish
      // while the realtime wire reconnects. Abort on identity/world/channel/
      // access/draft loss; each resource call independently requires the
      // current transport before it starts and again when it returns.
      const assessment = assessFileOperation(active, REQUEST_PHASE.submit, { requireTransport: false });
      if (assessment.current) continue;
      active.controller.abort();
      fileActiveOperationsRef.current.delete(key);
    }
  }, [activeChannelId, assessFileOperation, directory.version, serverWorld, wireState]);
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
    wireRef.current?.close();
    wireRef.current = null;
    clearFeed();
    clearDirectory();
    accessRef.current = null;
    // 参数面板态是会话私有的：换账号不得继承上一账号的手选/切换中/探测标记。
    manualAgentsRef.current.clear();
    contextProbedRef.current.clear();
    optionsProbedRef.current.clear();
    advanceAgentProbeGeneration(describeProbesRef.current);
    setPendingSelect(null);
    setComposerAgent({ channelId: '', actorId: '' });
    setRosters(new Map());
    setRosterAuthorities(new Map());
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
    attachmentWorldRevisionRef.current += 1;
    abortAttachmentUploads();
    abortFileOperations();
    attachmentDraftEpochsRef.current.clear();
    draftAttachmentLedgerRef.current.clear();
    attachmentUploadQueuesRef.current.clear();
    for (const obligation of editReleaseObligationsRef.current.values()) {
      if (obligation.retryTimer != null) clearTimeout(obligation.retryTimer);
    }
    editReleaseObligationsRef.current.clear();
    setDraftAttachments({});
    composerEditRef.current = null;
    setTaskCreateSource(undefined);
    setChannelCreateOpen(false);
    setGlobalSearchOpen(false);
    clearSession();
    setWireState('closed');
  }, [abortAttachmentUploads, abortFileOperations, clearDirectory, clearFeed, clearSession, clearSubmissions, clearTimers]);

  useEffect(() => {
    // Startup has three independent lanes: lightweight workspace/attach Meta,
    // realtime transport, and local Replica hydration. Neither storage nor
    // historical projection is allowed to hold the attached/live lane.
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
      setRosters(new Map(Object.entries(cachedBootstrap.rosters)));
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
    const refreshAccess = () => {
      if (versionBlocked) return Promise.resolve();
      if (refreshInFlight) {
        refreshQueued = true;
        return refreshInFlight;
      }
      // 成员身份不再走 obs 轮询：它是 attach 回执直接携带的一等事实
      // （网关资格账快照），这里只对齐频道树投影。
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
    const scheduleAccessRefresh = () => {
      if (!alive || versionBlocked || refreshTimer != null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshAccess();
      }, 250);
    };
    accessRefreshActionsRef.current.schedule = scheduleAccessRefresh;
    accessRefreshActionsRef.current.refresh = refreshAccess;
    refreshAccess();

    setWireState('connecting');
    void prepareLocalReplica(principalId, { focus: localFocus });
    const wireOptions = {
      label: describeClient(),
      // 手机上断线是常态,回来得快才是要紧的:退避压到 5 秒,并且一回到前台/网络
      // 恢复就立刻重连,恒不在退避表上干等。PC 维持原样。
      maxReconnectDelayMs: isMobileProfile() ? 5_000 : 30_000,
      wake: foregroundWake(),
      since: resumeLocalReplica,
      focus: () => activeChannelRef.current,
      onAttach: (detail) => {
        // The attach receipt is the fast Meta seam. World changes are applied
        // to in-memory control state synchronously, before Wire can deliver its
        // next frame. FeedCache cleanup itself remains asynchronous behind the
        // coordinator's epoch fence and never delays sessionAttached.
        const sameServerWorld = ensureServerBoot(detail?.boot);
        setServerWorld(String(detail?.boot || readServerBoot()));
        if (!sameServerWorld) {
          // A changed boot is a rebuilt ledger world, not a process restart.
          // Pure text drafts survive; file handles, outbox operations and
          // timers name objects in the old world.
          access.reset();
          roster.reset();
          resetSubmissionWorld();
          clearTimers();
          setRosters(new Map());
          setRosterAuthorities(new Map());
          setChannels(new Map());
          attachmentWorldRevisionRef.current += 1;
          abortAttachmentUploads();
          abortFileOperations();
          attachmentDraftEpochsRef.current.clear();
          draftAttachmentLedgerRef.current.clear();
          attachmentUploadQueuesRef.current.clear();
          for (const obligation of editReleaseObligationsRef.current.values()) {
            if (obligation.retryTimer != null) clearTimeout(obligation.retryTimer);
          }
          editReleaseObligationsRef.current.clear();
          setDraftAttachments({});
          setRecentFiles([]);
          // A settled preview is no longer represented by an active request,
          // so aborting requests alone cannot retire its object URL/body. Drop
          // every old-world file surface synchronously; unmounting
          // ArtifactContext owns the URL revocation.
          setFilePreviewStack([]);
          setAttachmentPickerOpen(false);
          setContextFocus(null);
          setRightPanel('');
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
          if (versionIncompatibleRef.current) return;
          versionBlocked = true;
          versionIncompatibleRef.current = detail || {};
          versionIncompatibleEpochRef.current += 1;
          if (refreshTimer != null) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
          }
          accessRefreshActionsRef.current = {};
          agentActivityRef.current.disconnect();
          roster.close();
          access.wire('disconnected');
          stopIncompatibleFeed(detail?.generation);
          setWireState('incompatible');
          setVersionIncompatible((current) => current || detail || {});
        } else if (state === 'attached') {
          // 这条连接自己的名字。服务端铸的 id 是寻址用的唯一依据;label 只给
          // 人看,因为选屏幕是人用话做的事。
          setUiSession({ id: detail?.session || '', label: detail?.session_label || '' });
          agentActivityRef.current.attach(detail);
          access.wire('attached', newId());
          // attach 回执携带的成员清单是权威来源：连上即得，重连即刷新。
          // memberships_complete=false 表示服务器这一轮没查成（清单不可信为
          // 全量），只做增量承认，恒不据此判谁被踢出。
          if (Array.isArray(detail?.memberships)) {
            const rows = detail.memberships
              .filter((entry) => entry?.channel_id)
              .map((entry) => ({ channel_id: entry.channel_id, status: 'active', actor_id: entry.actor_id || '' }));
            const memberedBefore = access.rows().filter((row) => row.accessState?.relationship === 'member').map((row) => row.id);
            access.membershipsObserved(rows, { complete: detail.memberships_complete === true, supported: true });
            writeWorkspaceBootstrap(principalId, access.snapshot());
            // 同一份清单也回答了"我在每个频道是谁"。fold 用它判断一条消息是不是
            // 发给我的,所以它到得晚,消息就被丢掉且不再捡回——把已经在手里的答案
            // 立刻交给 roster,并把此前折错的那些重折一遍。
            for (const entry of rows) {
              if (!roster.noteSelf(entry.channel_id, entry.actor_id)) continue;
              const state = channelStatesRef.current.get(entry.channel_id);
              if (state) reconcileApprovals(state, entry.actor_id);
            }
            bumpFeed();
            for (const channelId of memberedBefore) {
              if (access.state(channelId)?.relationship !== 'member') roster.clearSelf(channelId);
            }
          }
          setWireState('open');
          // 首次 attach 已有登录初始化 OBS；之后每次重连完成才重新对齐投影。
          if (attachedOnce) scheduleAccessRefresh();
          attachedOnce = true;
        } else if (state === 'disconnected') {
          agentActivityRef.current.disconnect();
          disconnectHistory(detail?.generation);
        } else if (state === 'reconnecting') {
          agentActivityRef.current.disconnect();
          access.wire('disconnected');
          setWireState('reconnecting');
        } else if (state === 'closed') {
          agentActivityRef.current.disconnect();
          access.wire('disconnected');
          setWireState('closed');
        }
        else if (state === 'open') setWireState((current) => current === 'open' ? current : 'connecting');
        bumpAccess();
      },
    };
    // React StrictMode mounts effects once speculatively, immediately cleans them
    // up, then mounts the durable tree. Defer the external connection by one
    // microtask so the speculative lifetime cannot open a throwaway socket.
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
  }, [abortAttachmentUploads, bumpAccess, cancelFeedTask, clearTimers, disconnectHistory, enqueueFeed, expireSession, finishHistoryPage, prepareLocalReplica, principalId, resetSubmissionWorld, resumeLocalReplica, setHistoryGrants, stopIncompatibleFeed]);

  const refreshRoster = useCallback(async (channelId, force = false) => {
    if (versionIncompatibleRef.current || !channelId || !rosterRef.current) return;
    const incompatibilityEpoch = versionIncompatibleEpochRef.current;
    const authorityOwner = committedFeedOwnerRef.current;
    if (!authorityOwner) return;
    const authorityPrincipal = authorityOwner.principalId;
    const authorityGeneration = Number(authorityOwner.generationFor(channelId) || 0);
    setRosterBusy(true);
    try {
      const rows = force
        ? await rosterRef.current.refresh(channelId)
        : await rosterRef.current.ensure(channelId);
      if (versionIncompatibleRef.current
        || incompatibilityEpoch !== versionIncompatibleEpochRef.current) return;
      // Object identity, rather than only the principal string, rejects a late
      // request after an A -> B -> A session cycle.
      if (committedFeedOwnerRef.current !== authorityOwner) return;
      setRosters((current) => new Map(current).set(channelId, rows));
      if (force) {
        const authority = rosterRef.current.authority?.(channelId);
        const generationStillCurrent = authorityGeneration > 0
          && Number(authorityOwner.generationFor(channelId) || 0) === authorityGeneration;
        setRosterAuthorities((current) => {
          const next = new Map(current);
          if (authority?.principalId === authorityPrincipal && generationStillCurrent) {
            next.set(channelId, Object.freeze({
              principalId: authorityPrincipal,
              channelId,
              generation: authorityGeneration,
              current: authority.complete === true,
            }));
          } else {
            next.delete(channelId);
          }
          return next;
        });
      }
      const selfId = rosterRef.current.self(channelId);
      const state = channelStatesRef.current.get(channelId);
      if (state && selfId) {
        reconcileApprovals(state, selfId);
        bumpFeed();
      }
    } catch (error) {
      if (!versionIncompatibleRef.current
        && incompatibilityEpoch === versionIncompatibleEpochRef.current
        && error?.status !== 401) setTopError(displayError(error));
    } finally {
      if (!versionIncompatibleRef.current
        && incompatibilityEpoch === versionIncompatibleEpochRef.current) setRosterBusy(false);
    }
  }, [bumpFeed]);

  const activeRosterGeneration = Number(generationFor(activeChannelId) || 0);
  const activeHistoryStatus = historyFor(activeChannelId);
  useEffect(() => {
    if (versionIncompatibleRef.current || !activeChannelId || !me) return;
    const access = channelList.find((channel) => channel.id === activeChannelId)?.access;
    if (!isMemberAccess(access)) {
      setRosters((current) => new Map(current).set(activeChannelId, []));
      setRosterAuthorities((current) => {
        if (!current.has(activeChannelId)) return current;
        const next = new Map(current);
        next.delete(activeChannelId);
        return next;
      });
      return;
    }
    const authority = rosterAuthorities.get(activeChannelId);
    const authorityAttempted = authority?.principalId === principalId
      && authority?.channelId === activeChannelId
      && authority?.generation === activeRosterGeneration;
    void refreshRoster(activeChannelId, activeRosterGeneration > 0 && !authorityAttempted);
  }, [activeChannelId, activeRosterGeneration, channelList, me, principalId, refreshRoster, rosterAuthorities]);

  useEffect(() => {
    const access = channelList.find((channel) => channel.id === activeChannelId)?.access;
    if (!access || canViewChannelContent(access)) return;
    abortAttachmentUploads(activeChannelId);
    abortFileOperations(activeChannelId);
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
  }, [abortAttachmentUploads, abortFileOperations, activeChannelId, channelList, contextFocus, rightPanel, workspaceView]);

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

  // 手动挡的唯一授权入口。真人动作调它，放行这个目标的一整轮探测；
  // 参数探测那个 effect 没有这张通行证就一条都不发。
  // 恒不在任何自动路径（连接状态、消息流、渲染）里调用它——那样就又成了自动挡。
  const authorizeProbe = useCallback((channelId, actorId) => {
    if (!channelId || !actorId) return;
    const probeKey = `${channelId}:${actorId}`;
    manualProbeRef.current.add(probeKey);
    // 四张表一起开闸：频次闸门、同代去重、describe 记录、两个词的已探记录。
    // 真人要求刷新时不该被任何一张挡住——包括同代去重。它是给自动探测防自激的，
    // 反过来管人就变成了「点了没反应」（2026-09-18 实测到第二下被吃）。
    clearProbeSlots(describeProbesRef.current, probeKey);
    releaseAgentProbe(describeProbesRef.current, probeKey);
    // 两个词的记录标记为 stale，而不是删掉：删掉等于在新回答到达前把值域和用量
    // 读数清空，selection view 变 null，面板刚开就被重置关掉。stale 的记录仍然
    // 供着上一份完成的证据，probeWord 看到 stale 才知道要再发一条。
    for (const registry of [contextProbedRef, optionsProbedRef]) {
      const record = registry.current.get(probeKey);
      if (record) record.stale = true;
    }
    setManualAgentVersion((current) => current + 1);
  }, []);

  const handlePickAgent = useCallback((actorId) => {
    if (!activeChannelId) return;
    manualAgentsRef.current.set(activeChannelId, actorId);
    // 手选目标是真人动作：顺带放行它的参数探测，否则选完面板是空的。
    authorizeProbe(activeChannelId, actorId);
    setManualAgentVersion((current) => current + 1);
  }, [activeChannelId, authorizeProbe]);

  // 手选清除恒以账本为准（§2.1.2"首条 agent.ask 成功入账后"）：当最近交互的
  // 推导结果已经等于手选目标时，手选让位——交接时值无缝，被拒的发送（账本无
  // 变化）恒不清手选。恒不在提交回执处清（回执 ≠ 入账，且提交层吞错）。
  useEffect(() => {
    const channelId = activeChannelRef.current;
    if (!channelId) return;
    const manual = manualAgentsRef.current.get(channelId);
    if (!manual) return;
    const state = channelStatesRef.current.get(channelId);
    if (!state) return;
    const agents = new Set((rosters.get(channelId) || []).filter((row) => row.kind === 'agent').map((row) => row.id));
    const selfActorId = rosterRef.current?.self(channelId) || '';
    if (latestInteractedAgentId(state, selfActorId, agents) === manual) {
      manualAgentsRef.current.delete(channelId);
      setManualAgentVersion((current) => current + 1);
    }
  }, [feedVersion, rosters]);

  useEffect(() => {
    // 任何连接状态边界都使旧 Promise 失效；进入 open 后才允许新代探测。
    advanceAgentProbeGeneration(describeProbesRef.current);
    if (wireState === 'open') {
      contextProbedRef.current.clear();
      optionsProbedRef.current.clear();
    }
  }, [wireState]);

  const handleComposerAgentChange = useCallback((actorId) => {
    setComposerAgent((current) => {
      const channelId = activeChannelRef.current || '';
      if (current.channelId === channelId && current.actorId === actorId) return current;
      return { channelId, actorId };
    });
  }, []);

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

  const describeActor = useCallback(async (actor, channelId = activeChannelId, { force = false } = {}) => {
    if (!actor || !channelId) return '';
    const probeKey = `${channelId}:${actor.id}`;
    const probe = beginAgentProbe(describeProbesRef.current, probeKey, { force });
    if (!probe) return '';
    try {
      const requestId = await handleSend({
        channelId,
        text: `读取 ${actor.name || actor.id} 的能力`,
        msgType: TYPES.describe,
        audience: [actor.id],
        targetLabel: actor.name || actor.id,
        payload: {},
        // 探测自带死线：目标卡死时账本这条 request 一分钟后过期，
        // 对端的在站账随即归还格子，不再由它把真人的话挤出去。
        expiresAtMs: Date.now() + PROBE_TIMEOUT_MS,
      });
      acceptAgentProbe(describeProbesRef.current, probe, requestId);
      setManualAgentVersion((current) => current + 1);
      return requestId || '';
    } catch (error) {
      failAgentProbe(describeProbesRef.current, probe);
      setManualAgentVersion((current) => current + 1);
      throw error;
    }
  }, [activeChannelId, handleSend]);

  // 参数目标的值域/当前值：**只在用户要求时**拉取（手动挡，见 manualProbeRef）。
  // 本 effect 自身恒不发起任何请求，它只做两件事：观察在途探测的结局，以及把
  // 一次已授权的手动刷新走完（describe 拿到后接着取 options / context）。
  // 用户没有动作时，这里一条消息都不会发出去。
  useEffect(() => {
    if (wireState !== 'open') return;
    const { channelId, actorId } = composerAgent;
    if (!channelId || !actorId || channelId !== activeChannelId) return;
    const channelAccess = accessRef.current?.state?.(channelId);
    if (channelAccess?.relationship !== 'member' || channelAccess?.unavailable) return;
    const actor = (rosters.get(channelId) || []).find((row) => row.id === actorId);
    if (!actor) return;
    const state = channelStatesRef.current.get(channelId);
    const capability = capabilityIndexFromState(state, liveDescribesRef.current).get(actorId);
    const probeKey = `${channelId}:${actorId}`;
    const describeProbe = describeProbesRef.current.entries.get(probeKey);
    const describeRejected = Boolean(describeProbe?.requestId && pending.some(
      (item) => item.messageId === describeProbe.requestId && item.state === 'rejected',
    ));
    observeAgentProbe(describeProbesRef.current, probeKey, capability, describeRejected);
    // 手动挡的唯一闸门：没有真人授权就到此为止，一条都不发。
    if (!manualProbeRef.current.has(probeKey)) return;
    // 这里恒不传 force：本 effect 的依赖里有 feedVersion / pending，消息一多
    // 就会每秒重跑，force 会绕过同代去重而变成新的风暴。闸门由手动入口在授权
    // 那一刻打开（clearProbeSlots + releaseAgentProbe），这里只负责发一条。
    if (!capability?.describe && !capability?.loading) {
      void describeActor(actor, channelId).catch(() => {});
      return;
    }
    if (!capability?.describe) return;
    // 值域与当前 context 是两个普通 actor word，属于这次手动刷新的后半程。
    const probeWord = (type, registry) => {
      if (!capability.describe.types?.has?.(type)) return;
      const probe = registry.current.get(probeKey);
      if (probe && !probe.stale) {
        if (!probe.failed && probe.requestId) {
          const failedRow = argsOf(state?.turns?.get?.(probe.requestId)?.terminal)?.status === 'failed';
          const rejected = pending.some((item) => item.messageId === probe.requestId && item.state === 'rejected');
          if (failedRow || rejected) probe.failed = true;
        }
        return;
      }
      // 与 describe 同一道频次闸门，按词分桶；registry 会在重连时被清空，
      // 闸门不会，所以断线重连不再等于解除限流。
      if (!reserveProbeSlot(describeProbesRef.current, `${probeKey}:${type}`)) return;
      // 手动刷新（stale）时，上一份完成的 requestId 作为 previousRequestId 随行：
      // 新的一条回来之前，读数继续从它取值。
      const entry = { requestId: '', previousRequestId: probe?.requestId || probe?.previousRequestId || '', failed: false, stale: false };
      registry.current.set(probeKey, entry);
      void handleSend({ channelId, text: '', msgType: type, audience: [actorId], targetLabel: actorId, payload: {}, expiresAtMs: Date.now() + PROBE_TIMEOUT_MS })
        .then((requestId) => {
          entry.requestId = requestId || '';
          entry.failed = !entry.requestId;
          setManualAgentVersion((current) => current + 1);
        })
        .catch(() => {
          entry.failed = true;
          setManualAgentVersion((current) => current + 1);
        });
    };
    probeWord(TYPES.agentOptions, optionsProbedRef);
    probeWord(TYPES.agentContext, contextProbedRef);
    // 授权用完即收：这一轮该发的都发了，链不会自己续上。下一条探测必须来自
    // 用户的下一个动作。
    const settled = (type, registry) => !capability.describe.types?.has?.(type) || registry.current.has(probeKey);
    if (settled(TYPES.agentOptions, optionsProbedRef) && settled(TYPES.agentContext, contextProbedRef)) {
      manualProbeRef.current.delete(probeKey);
    }
  }, [composerAgent, feedVersion, wireState, activeChannelId, rosters, pending, manualAgentVersion, describeActor, handleSend]);

  // 展开模型选择器（或点那个只显示角色名的按钮）= 手动刷新。
  const handleSelectorOpen = useCallback(() => {
    authorizeProbe(composerAgent.channelId, composerAgent.actorId);
  }, [composerAgent, authorizeProbe]);

  const handleSelectActor = useCallback((actor) => {
    setSelectedActor(actor);
    setRightPanel('roster-focus');
    const focus = { type: 'participant', key: actor.id };
    setContextFocus(focus);
    if (activeChannelId) writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView, focus }, { contextEntry: true });
    const state = channelStatesRef.current.get(activeChannelId);
    const capability = capabilityIndexFromState(state, liveDescribesRef.current).get(actor.id);
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
      const capabilityIndex = capabilityIndexFromState(state, liveDescribesRef.current);
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
  const activeChannel = activeRow || channels.get(activeChannelId);
  const activeAccess = activeRow?.access || CHANNEL_ACCESS.loading;
  const requestVersion = activeState._requestVersion ?? activeState.turns.size;
  const terminalVersion = activeState._terminalVersion ?? activeState.lastSeq;
  const capabilityIndex = derived(
    'activeCapabilities',
    [activeState, requestVersion, terminalVersion, liveDescribesRef.current.size, manualAgentVersion],
    () => capabilityIndexFromState(activeState, liveDescribesRef.current),
  );
  // 参数面板数据（协议 §4）：值域与当前值都是活状态读数，恒只认本连接证据
  // （describe = liveDescribesRef；options = generation 快照；usage = 本连接
  // context 探测起算）。
  // manualAgentVersion 只为触发重渲染（手选存 ref）。
  void manualAgentVersion;
  const composerAgentId = composerAgent.channelId === activeChannelId ? composerAgent.actorId : '';
  // 读数按"新在前"的一列探测 id 取第一份完成的：手动刷新期间新的还没回、旧的
  // 仍是当前真值。derived 按 Object.is 比较依赖，所以这里传拼接后的字符串键。
  const probeIdKey = (registry) => {
    if (!composerAgentId) return '';
    const record = registry.current.get(`${activeChannelId}:${composerAgentId}`);
    return [record?.requestId, record?.previousRequestId].filter(Boolean).join('|');
  };
  const composerProbeKey = probeIdKey(contextProbedRef);
  const composerOptionsProbeKey = probeIdKey(optionsProbedRef);
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
      ? agentSelectionView({ actorId: composerAgentId, describe: capabilityIndex.get(composerAgentId)?.describe, options: composerAgentOptions, usage: composerAgentUsage })
      : null,
  );
  const composerSupportedTypes = derived(
    'composerSupportedTypes',
    [composerAgentId, capabilityIndex],
    () => composerAgentId ? [...(capabilityIndex.get(composerAgentId)?.describe?.types?.keys?.() || [])] : [],
  );
  const selectPendingHere = pendingSelect && pendingSelect.channelId === activeChannelId ? pendingSelect : null;
  const manualAgentId = manualAgentsRef.current.get(activeChannelId) || '';
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

  const attachmentsInCurrentWorld = (rows, worldEpoch = serverWorldCommittedRef.current) => {
    // Older servers do not publish a boot identity and are explicitly a
    // single unversioned world. Preserve their legacy drafts; once a server
    // does publish a world, untagged rows are unknown and therefore hidden.
    return (rows || []).filter((row) => !worldEpoch || row?.[FILE_ATTACHMENT_WORLD_FIELD] === worldEpoch);
  };
  const tagAttachmentsForCurrentWorld = (rows) => (rows || []).map((row) => ({
    ...row,
    [FILE_ATTACHMENT_WORLD_FIELD]: serverWorldCommittedRef.current,
  }));
  const stripAttachmentWorld = (row) => {
    const { [FILE_ATTACHMENT_WORLD_FIELD]: _worldEpoch, ...attachment } = row;
    return attachment;
  };
  const currentDraftAttachments = (channelId, readDraft = draftFor) => attachmentsInCurrentWorld(
    draftAttachmentLedgerRef.current.has(channelId)
      ? draftAttachmentLedgerRef.current.get(channelId)
      : (readDraft(channelId).attachments || [])
  );
  // These projections are props of memoized Composer. Key them by the durable
  // record / committed attachment-array identities so unrelated App updates do
  // not manufacture fresh objects and pierce the input isolation boundary.
  const activeDraftRecord = drafts.get(activeChannelId);
  const activeDurableDraft = activeDraftRecord?.draft || activeDraftRecord;
  const activeAttachmentRows = draftAttachmentLedgerRef.current.has(activeChannelId)
    ? draftAttachmentLedgerRef.current.get(activeChannelId)
    : (activeDurableDraft?.attachments || []);
  const composerAttachmentProjection = derived(
    'composerAttachments',
    [activeChannelId, activeAttachmentRows, serverWorld],
    () => attachmentsInCurrentWorld(activeAttachmentRows, serverWorld).map(stripAttachmentWorld),
  );
  const composerDraftProjection = derived(
    'composerDraft',
    [activeChannelId, activeDraftRecord, serverWorld],
    () => {
      const draft = draftFor(activeChannelId);
      return { ...draft, attachments: attachmentsInCurrentWorld(draft.attachments, serverWorld).map(stripAttachmentWorld) };
    },
  );

  const commitDraftAttachments = (channelId, rows) => {
    const nextRows = attachmentsInCurrentWorld(rows);
    // Publish the command ledger before scheduling React. A second committed
    // action in the same turn must observe the first even if React batches the
    // presentation updates; the state updater itself remains pure/replayable.
    draftAttachmentLedgerRef.current.set(channelId, nextRows);
    setDraftAttachments((current) => ({ ...current, [channelId]: nextRows }));
    return nextRows;
  };

  const mutateDraftAttachments = (channelId, mutate, readDraft = draftFor) => (
    commitDraftAttachments(channelId, mutate([...currentDraftAttachments(channelId, readDraft)]))
  );

  const clearDraftAttachments = (channelId) => {
    abortAttachmentUploads(channelId);
    attachmentDraftEpochsRef.current.set(
      channelId,
      Number(attachmentDraftEpochsRef.current.get(channelId) || 0) + 1,
    );
    return commitDraftAttachments(channelId, []);
  };

  const attachToDraft = async (attachment, requestedChannelId = activeChannelRef.current) => {
    const channelId = String(requestedChannelId || '');
    if (composerEditRef.current) throw new TypeError('编辑已有消息时不能附加频道文件；请先完成或取消编辑');
    const capturedDraftRevision = Number(drafts.get(channelId)?.revision || 0);
    return runFileOperation({ channelId, access: 'write', requireDraft: true }, async (operation) => {
      const tagged = { ...attachment, [FILE_ATTACHMENT_WORLD_FIELD]: operation.owner.worldEpoch };
      const record = await operation.persist(() => persistDraftAttachments(channelId, [tagged], {
        expectedRevision: capturedDraftRevision,
        authorize: () => {
          operation.authorize(REQUEST_PHASE.persist, { requireTransport: false });
          return true;
        },
      }));
      operation.authorize(REQUEST_PHASE.persist, { requireTransport: false });
      commitDraftAttachments(channelId, record?.draft?.attachments || []);
      if (activeChannelRef.current === channelId) changeWorkspaceView('dynamic');
      return stripAttachmentWorld(tagged);
    });
  };

  const uploadComposerAttachments = async (files) => {
    if (composerEditRef.current) throw new TypeError('编辑已有消息时不能上传普通草稿附件；请先完成或取消编辑');
    const channel = activeChannel;
    if (!channel?.id) throw new TypeError('请先选择频道');
    const committedOwner = committedFeedOwnerRef.current;
    const producerOwnerToken = committedOwner?.producerOwnerToken;
    if (!producerOwnerToken) throw new TypeError('上传会话尚未提交');
    const draftEpoch = Number(attachmentDraftEpochsRef.current.get(channel.id) || 0);
    const capturedDraftRevision = Number(drafts.get(channel.id)?.revision || 0);
    const owner = captureRequestOwner({
      principalId: committedOwner.principalId,
      principalEpoch: producerOwnerToken,
      channelId: channel.id,
      worldEpoch: serverWorldCommittedRef.current,
      attemptEpoch: attachmentWorldRevisionRef.current,
      accessState: accessRef.current?.state?.(channel.id),
      transport: wireRef.current,
      transportEpoch: Number(committedOwner.generationFor?.(channel.id) || 0),
      draft: { epoch: draftEpoch },
    });
    const assessUpload = (phase, options = {}) => assessRequestOwner(
      owner,
      currentAttachmentOwnerFacts(owner),
      phase,
      { requireDraft: true, ...options },
    );
    // `draftFor` belongs to the committed callback installed in AppShell. It
    // is only a fallback until the first attachment command creates a ledger
    // entry; render candidates never publish into that ledger.
    const readDraft = draftFor;
    const previous = attachmentUploadQueuesRef.current.get(channel.id) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      // OPEN 只代表消息通道已就绪，daemon OBS 可能仍在路上。粘贴/拖入不应
      // 因这个短暂竞态失败，所以首次上传可就地等待一次 daemon observation。
      const acquire = await executeOwnedPhase({
        owner,
        current: () => currentAttachmentOwnerFacts(owner),
        phase: REQUEST_PHASE.acquire,
        options: { requireDraft: true },
        effect: () => channelDevices.length ? channelDevices : refreshChannelDeviceData(channel.id),
      });
      if (!acquire.started || !acquire.current) throw requestAccessError(acquire.invalidation);
      const devices = acquire.value;
      const daemonId = availableDefaultStorageDeviceId(channel, devices);
      const daemon = devices.find((row) => row.id === daemonId);
      if (!daemon) throw new TypeError('频道没有可用的默认文件存储设备');
      if (daemon.online === false) throw new TypeError(`频道默认文件存储设备 ${daemon.name || daemon.id} 当前离线`);
      const uploaded = [];
      let uploadFailure = null;
      const occupiedNames = new Set(currentDraftAttachments(channel.id, readDraft).map((row) => row.name));
      try {
        for (const file of files) {
          const uploadName = availableUploadName(file.name, occupiedNames);
          occupiedNames.add(uploadName);
          const controller = new AbortController();
          const uploadKey = `${channel.id}:${newId()}`;
          attachmentActiveUploadsRef.current.set(uploadKey, { owner, controller });
          try {
            const submitted = await executeOwnedPhase({
              owner,
              current: () => currentAttachmentOwnerFacts(owner),
              phase: REQUEST_PHASE.submit,
              options: { requireDraft: true },
              effect: () => uploadChannelFile({
                file,
                channel,
                deviceName: daemon.name,
                uploadName,
                onResource: handleResource,
                signal: controller.signal,
                authorize: (phase) => {
                  const assessment = assessUpload(
                    phase === 'settle' ? REQUEST_PHASE.submit : phase,
                  );
                  if (!assessment.current) throw requestAccessError(assessment);
                },
              }),
            });
            // A completed PUT is an immutable channel resource even when the
            // post-await authority check fails. Keep its identity so the
            // association attempt and any orphan report remain truthful.
            if (submitted.started && submitted.value) uploaded.push({
              ...submitted.value,
              [FILE_ATTACHMENT_WORLD_FIELD]: owner.worldEpoch,
            });
            if (!submitted.started || !submitted.current) throw requestAccessError(submitted.invalidation);
          } finally {
            attachmentActiveUploadsRef.current.delete(uploadKey);
          }
        }
      } catch (error) {
        if (error.completedAttachment
          && !uploaded.some((row) => row.resource_id === error.completedAttachment.resource_id)) {
          uploaded.push({ ...error.completedAttachment, [FILE_ATTACHMENT_WORLD_FIELD]: owner.worldEpoch });
        }
        uploadFailure = error;
      }
      if (uploaded.length) {
        const authorizeAssociation = () => assessUpload(
          REQUEST_PHASE.persist,
          { requireTransport: false },
        ).current;
        try {
          if (typeof persistDraftAttachments !== 'function') {
            throw new TypeError('当前客户端没有可用的持久草稿附件事务');
          }
          const record = await persistDraftAttachments(channel.id, uploaded, {
            expectedRevision: capturedDraftRevision,
            authorize: authorizeAssociation,
          });
          if (!authorizeAssociation()) {
            const stale = new Error('草稿在附件关联完成前已变化');
            stale.code = 'attachment_unassociated';
            throw stale;
          }
          commitDraftAttachments(channel.id, record?.draft?.attachments || []);
        } catch (error) {
          error.code ||= 'attachment_unassociated';
          error.attachments = uploaded.map(stripAttachmentWorld);
          const orphanDetail = `${error.message || '附件关联失败'}；已上传但未关联的资源：${uploaded.map((row) => row.resource_id).join('、')}`;
          error.detail = orphanDetail;
          error.message = orphanDetail;
          diagnostic('warn', 'attachment.resources_unassociated', {
            channelId: channel.id,
            resources: uploaded.map((row) => row.resource_id),
            error,
          });
          const invalidation = assessUpload(REQUEST_PHASE.persist, { requireTransport: false });
          if (!invalidation.current) {
            if (invalidation.code !== 'identity_changed') setChannelNotice(orphanDetail);
            return [];
          }
          throw error;
        }
      }
      if (uploadFailure) {
        uploadFailure.attachments = uploaded.map(stripAttachmentWorld);
        throw uploadFailure;
      }
      return uploaded.map(stripAttachmentWorld);
    });
    attachmentUploadQueuesRef.current.set(channel.id, task);
    try {
      return await task;
    } finally {
      if (attachmentUploadQueuesRef.current.get(channel.id) === task) attachmentUploadQueuesRef.current.delete(channel.id);
    }
  };

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
