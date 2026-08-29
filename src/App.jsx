import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { capabilityIndexFromState } from './model/capabilities.js';
import { ensureServerBoot } from './model/server-boot.js';
import { artifactKindForMediaType, buildArtifactIndex, previewForMediaType } from './model/artifacts.js';
import { describeClient } from './model/client-label.js';
import { openFromPreview, snapshot as uiSnapshot } from './model/ui-words.js';
import { UiActivityOverlay } from './ui/UiActivityOverlay.jsx';
import { useUiWords } from './app/hooks/useUiWords.js';
import { fileTransferURL, uploadChannelFile } from './model/channel-file-transfer.js';
import { availableDefaultStorageDeviceId } from './model/channel-files.js';
import { unreadCounts } from './model/cursors.js';
import { canViewChannelContent, canWriteChannel, CHANNEL_ACCESS, createChannelAccessTracker, isMemberAccess } from './model/channel-access.js';
import { resumeSnapshot } from './model/feed-cache.js';
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
import { agentSelectionView, latestAgentUsage, latestInteractedAgentId, resolveParameterAgent } from './model/agent-selection.js';
import { createAgentActivityTracker } from './model/agent-activity.js';
import { createObsClient, ObsError } from './net/obs.js';
import { createWire } from './net/wire.js';
import { Auth } from './ui/Auth.jsx';
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
  const [channelDevices, setChannelDevices] = useState([]);
  const [draftAttachments, setDraftAttachments] = useState({});
  // 草稿是编辑器私有的临时状态，不是工作区渲染状态。这里仅用 ref 做跨频道、
  // 跨主视图的本地持久化；逐字输入不得触发 App/Timeline 重渲染。
  const draftTextsRef = useRef({});
  const [taskCreateSource, setTaskCreateSource] = useState(undefined);
  const [channelCreateOpen, setChannelCreateOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [mountedFilePreview, setMountedFilePreview] = useState(null);
  const [uiSession, setUiSession] = useState({ id: '', label: '' });
  // 频道对这块屏做过什么。只留最近几条:这是一条回执,不是审计日志——
  // 完整的记录本来就在账本里,这里只回答"刚才那一下是什么"。
  const [uiActivity, setUiActivity] = useState([]);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [mockAdvance, setMockAdvance] = useState({ available: false, busy: false });
  // 参数面板（协议 §2/§4）：目标 = Composer 回报的判据链结果；值域走 describe、
  // 当前值走账本 usage；select 的 pending/failed 三态由账本终态驱动。
  const [composerAgent, setComposerAgent] = useState({ channelId: '', actorId: '' });
  const [pendingSelect, setPendingSelect] = useState(null); // {channelId, actorId, requestId, value:{model,effort}}
  const manualAgentsRef = useRef(new Map()); // channelId -> 手选 agent id（首条 ask 入账即清）
  const contextProbedRef = useRef(new Map()); // `${channelId}:${actorId}` -> {requestId, failed}，重连时清
  // 本连接内发出的 describe requestId 集合。capability 是活状态读数，恒现场
  // 拉：只有这个集合里的响应才算数，账本历史帧恒不当缓存。集合易失——
  // 刷新/重连即清，活状态自然重新现问。
  const liveDescribesRef = useRef(new Set());
  const describeInFlightRef = useRef(new Set()); // `${channelId}:${actorId}`，回执前也必须防重
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
  const accessRef = useRef(null);
  const activeChannelRef = useRef('');
  const showSessionError = useCallback((error) => {
    diagnostic('error', 'session.failed', { error });
    setTopError(displayError(error));
  }, []);
  const { booting, principal: me, identity, accept: handleAuthed, clear: clearSession, logoutRemote } = useAtollSession({ onError: showSessionError });
  const nodeUpdate = useNodeUpdate({ principalId: me?.id, wireState });

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
  const receiveFeedError = useCallback((error) => {
    diagnostic('error', 'feed.failed', { error });
    setTopError(displayError(error));
  }, []);
  const forwardChannels = useCallback((channelIds) => directoryActionsRef.current.discover?.(channelIds), []);
  const forwardDirectoryInvalidated = useCallback(() => accessRefreshActionsRef.current.schedule?.(), []);
  const forwardSubmissionFeed = useCallback((landed, closed) => submissionActionsRef.current.reconcile?.(landed, closed), []);
  const forwardAccessChanged = useCallback(() => directoryActionsRef.current.bump?.(), []);
  const forwardAgentActivity = useCallback((payload, context) => agentActivityRef.current.observe(payload, context), []);
  const { statesRef: channelStatesRef, cursorsRef, version: feedVersion, bump: bumpFeed, enqueue: enqueueFeed, cancel: cancelFeedTask, clear: clearFeed, resetPersistent: resetFeedCache, setHistoryGrants, pageEnd: finishHistoryPage, liveCheckpoint: finishLiveCheckpoint, disconnectHistory, focusHistory, historyFor, loadHistory, markRead } = useChannelFeed({ wireRef, rosterRef, accessRef, activeChannelRef, onRoster: receiveRoster, onError: receiveFeedError, onChannelsDiscovered: forwardChannels, onDirectoryInvalidated: forwardDirectoryInvalidated, onTimerFired: markTimerFired, onSubmissionFeed: forwardSubmissionFeed, onAccessChanged: forwardAccessChanged, onAgentActivity: forwardAgentActivity });
  const channelChanged = useCallback(() => { setSelectedActor(null); setContextFocus(null); setMountedFilePreview(null); setRightPanel(''); setTaskCreateSource(undefined); setChannelCreateOpen(false); setGlobalSearchOpen(false); }, []);
  const directory = useChannelDirectory({ accessRef, rosterRef, onChannelChanged: channelChanged, onNotice: setChannelNotice });
  const { channels, setChannels, rows: channelList, bump: bumpAccess, activeChannelId, setActiveChannelId, select: selectChannel, clear: clearDirectory } = directory;

  useEffect(() => {
    focusHistory(activeChannelId);
  }, [activeChannelId, focusHistory]);

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
  const submissions = useSubmissions({ principalId: me?.id, activeChannelId, wireRef, rosterRef, accessRef, channelStatesRef, onError: (error) => {
    diagnostic('error', 'submission.failed', { error });
    setTopError(displayError(error));
  }, onNotice: setChannelNotice, onFeedChanged: bumpFeed, onAccessChanged: bumpAccess });
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

  const expireSession = useCallback(() => {
    wireRef.current?.close();
    wireRef.current = null;
    clearFeed();
    clearDirectory();
    accessRef.current = null;
    // 参数面板态是会话私有的：换账号不得继承上一账号的手选/切换中/探测标记。
    manualAgentsRef.current.clear();
    contextProbedRef.current.clear();
    describeInFlightRef.current.clear();
    setPendingSelect(null);
    setComposerAgent({ channelId: '', actorId: '' });
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
    setChannelDevices([]);
    clearTimers();
    agentActivityRef.current.clear();
    setDraftAttachments({});
    draftTextsRef.current = {};
    setTaskCreateSource(undefined);
    setChannelCreateOpen(false);
    setGlobalSearchOpen(false);
    clearSession();
    setWireState('closed');
  }, [clearDirectory, clearFeed, clearSession, clearSubmissions, clearTimers]);

  useEffect(() => {
	// Realtime is never gated by IndexedDB hydration. Cache metadata and body
	// batches may finish later; the v5 attach head gives the live stream its
	// atomic starting seam immediately.
    if (!me) return undefined;
    setTopError('');
    const obs = createObsClient({ onUnauthorized: expireSession });
    const roster = createRoster({ obs, me: me.id });
    const access = createChannelAccessTracker({ principalId: me.id });
    obsRef.current = obs;
    rosterRef.current = roster;
    accessRef.current = access;

    let alive = true;
    let refreshTimer = null;
    let refreshInFlight = null;
    let refreshQueued = false;
    let attachedOnce = false;
    const refreshAccess = () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return refreshInFlight;
      }
      // 成员身份不再走 obs 轮询：它是 attach 回执直接携带的一等事实
      // （网关资格账快照），这里只对齐频道树投影。
      refreshInFlight = loadChannelTree(obs).then((result) => {
      if (!alive) return;
      const profiles = [...result.channels.values()];
      access.channelsObserved(profiles, { complete: result.complete });
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
      label: describeClient(),
      since: () => resumeSnapshot(channelStatesRef.current),
      focus: () => activeChannelRef.current,
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
        if (state === 'attached') {
          // 服务器世代变了：本地缓存整体作废后重载一次，恒不要求用户手清。
          if (!ensureServerBoot(detail?.boot)) {
            // Stop this generation before clearing. Otherwise attach tail frames
            // can race the IndexedDB clear and repopulate it with the old boot.
            wire.close();
            resetFeedCache().finally(() => window.location.reload());
            return;
          }
          // 这条连接自己的名字。服务端铸的 id 是寻址用的唯一依据;label 只给
          // 人看,因为选屏幕是人用话做的事。
          setUiSession({ id: detail?.session || '', label: detail?.session_label || '' });
		  agentActivityRef.current.attach(detail);
		  setHistoryGrants(detail?.history_meta || [], { ...detail, focus: activeChannelRef.current });
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
  }, [bumpAccess, cancelFeedTask, disconnectHistory, enqueueFeed, expireSession, finishHistoryPage, me, resetFeedCache, setHistoryGrants]);

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
      const channelID = activeChannelRef.current;
      if (channelID) {
        const deviceObservation = await obsRef.current.channelDevices(channelID);
        if (activeChannelRef.current === channelID) setChannelDevices(safeChannelDeviceRows(deviceObservation));
      }
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

  const refreshChannelDeviceData = useCallback(async (channelID = activeChannelRef.current) => {
    if (!obsRef.current || !channelID) return [];
    try {
      const observation = await obsRef.current.channelDevices(channelID);
      const rows = safeChannelDeviceRows(observation);
      if (activeChannelRef.current === channelID) setChannelDevices(rows);
      return rows;
    } catch (error) {
      if (activeChannelRef.current === channelID) setChannelDevices([]);
      if (error?.status !== 401) setTopError(displayError(error));
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
        text: `切换模型：${model} · ${effort}`,
        msgType: TYPES.agentSelect,
        audience: [actorId],
        targetLabel: actorId,
        payload: { model, effort },
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
      const status = row.payload?.status;
      if (status === 'failed') {
        setTopError(`切换模型失败：${row.payload?.detail || row.payload?.error_code || row.payload?.reason || '未知原因'}`);
        setPendingSelect(null);
        return;
      }
      if (status === 'completed') {
        setPendingSelect(null);
        return;
      }
    }
  }, [pendingSelect, feedVersion, pending]);

  // 手选目标（判据链 §2.1.2）：per-channel 内存态。
  const handlePickAgent = useCallback((actorId) => {
    if (!activeChannelId) return;
    manualAgentsRef.current.set(activeChannelId, actorId);
    setManualAgentVersion((current) => current + 1);
  }, [activeChannelId]);

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
    if (wireState === 'open') {
      contextProbedRef.current.clear();
      liveDescribesRef.current.clear();
      describeInFlightRef.current.clear();
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
    version: feedVersion,
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
    if (!actor || !channelId) return '';
    const probeKey = `${channelId}:${actor.id}`;
    if (describeInFlightRef.current.has(probeKey)) return '';
    // handleSend 的 Promise 回执可能晚于请求本身进入 feed；若只在 await 后记录
    // requestId，feedVersion 会在这个窗口反复触发 effect，造成 describe 风暴。
    describeInFlightRef.current.add(probeKey);
    try {
      const requestId = await handleSend({
        channelId,
        text: `读取 ${actor.name || actor.id} 的能力`,
        msgType: TYPES.describe,
        audience: [actor.id],
        targetLabel: actor.name || actor.id,
        payload: {},
      });
      if (requestId) liveDescribesRef.current.add(requestId);
      return requestId || '';
    } finally {
      describeInFlightRef.current.delete(probeKey);
    }
  }, [activeChannelId, handleSend]);

  // 参数目标的值域/当前值冷启动：目标无 describe 缓存则描述一次；有值域、无账本
  // usage 且未探测过则静默发一次 agent.context。探测按三态管理（§4.1.2）：
  // in-flight（有 requestId 未见结局）/ failed（账本 failed 终态或 submission
  // 被拒——停止自动重发防循环，重连清空或用户展开参数区时重试）/ 成功（账本
  // usage 到位后此 effect 不再走到这里）。恒不做"每会话一次"死标记。
  useEffect(() => {
    if (wireState !== 'open') return;
    const { channelId, actorId } = composerAgent;
    if (!channelId || !actorId || channelId !== activeChannelId) return;
    const actor = (rosters.get(channelId) || []).find((row) => row.id === actorId);
    if (!actor) return;
    const state = channelStatesRef.current.get(channelId);
    const capability = capabilityIndexFromState(state, liveDescribesRef.current).get(actorId);
    const probeKey = `${channelId}:${actorId}`;
    if (!capability?.describe && !capability?.loading) {
      describeActor(actor, channelId);
      return;
    }
    if (!capability?.describe) return;
    // 当前配置与可切换值域是两条独立链路。即使 agent.select 没有 selections，
    // 只要声明了 agent.context，也必须读取当前 model/effort，状态栏按只读展示。
    if (!capability.describe.types?.has?.(TYPES.agentContext)) return;
    // 当前值恒来自本连接的 context 探测（历史 usage 是旧生命期读数，恒不挡
    // 探测）：每连接对每目标恒探测一次，probe 记录本身即防重。
    const probe = contextProbedRef.current.get(probeKey);
    if (probe) {
      if (!probe.failed && probe.requestId) {
        const failedRow = state ? [...state.rows.values()].some((row) => row.kind === 'response' && row.parent_id === probe.requestId && row.payload?.status === 'failed') : false;
        const rejected = pending.some((item) => item.messageId === probe.requestId && item.state === 'rejected');
        if (failedRow || rejected) probe.failed = true;
      }
      return;
    }
    const entry = { requestId: '', failed: false };
    contextProbedRef.current.set(probeKey, entry);
    handleSend({ channelId, text: '', msgType: TYPES.agentContext, audience: [actorId], targetLabel: actorId, payload: {} })
      .then((requestId) => {
        entry.requestId = requestId || '';
        // requestId 存在 ref 中，但它参与当前值推导；回执可能晚于 feed，也可能
        // 早于 feed，显式 bump 保证两种时序最终都会重算状态栏。
        setManualAgentVersion((current) => current + 1);
      })
      .catch(() => { entry.failed = true; });
  }, [composerAgent, feedVersion, wireState, activeChannelId, rosters, pending, manualAgentVersion, describeActor, handleSend]);

  // 用户展开参数区 = 显式重试通道：上次探测失败的目标清掉失败标记重新探测。
  const handleSelectorOpen = useCallback(() => {
    const { channelId, actorId } = composerAgent;
    if (!channelId || !actorId) return;
    const probeKey = `${channelId}:${actorId}`;
    let retry = false;
    if (contextProbedRef.current.get(probeKey)?.failed) {
      contextProbedRef.current.delete(probeKey);
      retry = true;
    }
    // describe 本连接已发但失败时，展开参数区 = 显式重试：把失败那次从
    // 本连接集合剔除，capability 归零后冷启动 effect 自动重新自省。
    const state = channelStatesRef.current.get(channelId);
    const capability = capabilityIndexFromState(state, liveDescribesRef.current).get(actorId);
    if (capability?.error && !capability?.loading && capability.requestId) {
      liveDescribesRef.current.delete(capability.requestId);
      retry = true;
    }
    if (retry) setManualAgentVersion((current) => current + 1);
  }, [composerAgent]);

  const handleSelectActor = useCallback((actor) => {
    setSelectedActor(actor);
    setRightPanel('roster-focus');
    const focus = { type: 'participant', key: actor.id };
    setContextFocus(focus);
    if (activeChannelId) writeWorkspaceRoute({ channelId: activeChannelId, view: workspaceView, focus }, { contextEntry: true });
    const state = channelStatesRef.current.get(activeChannelId);
    const capability = capabilityIndexFromState(state, liveDescribesRef.current).get(actor.id);
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
    const activities = [...buildActivityIndex({ channels: channelData, operations: rawOperations }).values()]
      .map((item) => ({ ...item, channelName: names.get(item.channelId), detail: item.summary }));
    const operations = activeOperations(buildOperationIndex({ channels: channelData, operations: rawOperations }))
      .map((item) => ({ ...item, channelName: names.get(item.channelId) }));
    return { channelData, activities, operations, searchIndex: buildGlobalSearchIndex({ channels: channelData, operations: rawOperations }) };
  }, [channelList, feedVersion, pending, rosters, timerRecords]);

  if (booting) return <div className="boot-screen"><span className="brand-dot" />正在恢复会话…</div>;
  if (!me) return <Auth identity={identity} onAuthed={handleAuthed} />;

  const activeState = channelStatesRef.current.get(activeChannelId) || createChannelState(activeChannelId);
  const agentActivity = agentActivityRef.current.snapshot();
  const acknowledgeAgentActivity = (channelId, agentId) => agentActivityRef.current.acknowledge(channelId, agentId);
  const activeHistory = {
    ...historyFor(activeChannelId),
    onReadLatest: (seq) => markRead(activeChannelId, seq),
    loadOlder: (options) => loadHistory(activeChannelId, options),
  };
  const activeRow = channelList.find((channel) => channel.id === activeChannelId);
  const activeRoster = isMemberAccess(activeRow?.access) ? rosters.get(activeChannelId) || [] : [];
  const selfId = activeRow?.selfActorId || rosterRef.current?.self(activeChannelId) || '';
  const unread = Object.fromEntries(channelList.map((channel) => {
    const loaded = unreadCounts(
      channelStatesRef.current.get(channel.id),
      cursorsRef.current.read(channel.id),
      channel.selfActorId || rosterRef.current?.self(channel.id) || '',
    );
    return [channel.id, loaded];
  }));
  const activeChannel = activeRow || channels.get(activeChannelId);
  const activeAccess = activeRow?.access || CHANNEL_ACCESS.loading;
  const capabilityIndex = capabilityIndexFromState(activeState, liveDescribesRef.current);
  // 参数面板数据（协议 §4）：值域与当前值都是活状态读数，恒只认本连接证据
  // （describe = liveDescribesRef；usage = 本连接 context 探测起算）。
  // manualAgentVersion 只为触发重渲染（手选存 ref）。
  void manualAgentVersion;
  const composerAgentId = composerAgent.channelId === activeChannelId ? composerAgent.actorId : '';
  const composerProbeId = composerAgentId ? (contextProbedRef.current.get(`${activeChannelId}:${composerAgentId}`)?.requestId || '') : '';
  const composerAgentUsage = composerAgentId ? latestAgentUsage(activeState, composerAgentId, composerProbeId) : null;
  const composerSelectionView = composerAgentId
    ? agentSelectionView({ actorId: composerAgentId, describe: capabilityIndex.get(composerAgentId)?.describe, usage: composerAgentUsage })
    : null;
  const composerSupportedTypes = composerAgentId
    ? [...(capabilityIndex.get(composerAgentId)?.describe?.types?.keys?.() || [])]
    : [];
  const selectPendingHere = pendingSelect && pendingSelect.channelId === activeChannelId ? pendingSelect : null;
  const manualAgentId = manualAgentsRef.current.get(activeChannelId) || '';
  // 无 @ 时的默认目标（判据链 §2.1 的 2-4 环：手选 > 最近交互 > 唯一 agent）。
  // mention 环在 Composer 判（它持有编辑框状态），终判结果经 onTargetChange 回报。
  const fallbackAgent = resolveParameterAgent({ mentions: [], manualAgentId, roster: activeRoster, state: activeState, selfId });
  const fallbackAgentId = fallbackAgent.kind === 'single' ? fallbackAgent.agent.id : '';
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
    const devices = channelDevices.length ? channelDevices : await refreshChannelDeviceData(channel.id);
    const daemonId = availableDefaultStorageDeviceId(channel, devices);
    const daemon = devices.find((row) => row.id === daemonId);
    if (!daemon) throw new TypeError('频道没有可用的默认文件存储设备');
    if (daemon.online === false) throw new TypeError(`频道默认文件存储设备 ${daemon.name || daemon.id} 当前离线`);
    const uploaded = [];
    for (const file of files) uploaded.push(await uploadChannelFile({ file, channel, deviceId: daemon.id, onResource: handleResource }));
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
    setSelectedActor(null);
    setContextFocus(null);
    setMountedFilePreview(artifact);
    setRightPanel('artifact-focus');
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
    governance: { principals: spacePrincipals, declarations: spaceDeclarations, daemons: spaceDaemons, channelDevices, registrarRoster: rosters.get('c0') || (activeChannelId === 'c0' ? activeRoster : []), rootState: channelStatesRef.current.get('c0'), version: feedVersion, onSubmit: handleSend, onRefresh: refreshGovernanceData },
    artifacts: { selected: previewArtifact || selectedArtifact, authorName: activeRoster.find((row) => row.id === (previewArtifact || selectedArtifact)?.authorActorId)?.name, onResource: handleResource, onDownload: (attachment) => handleDownloadResource(activeChannelId, attachment), onAttach: attachToDraft, onSource: openArtifactSource },
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
    session={{ me, wireState, update: nodeUpdate, onLogout: handleLogout }}
    navigation={{ channels: channelList, activeChannelId, unread, agentActivity, onSelect: selectWorkspaceChannel, onCreate: () => { setRightPanel(''); setContextFocus(null); setChannelCreateOpen(true); }, onSearch: () => { setRightPanel(''); setContextFocus(null); setGlobalSearchOpen(true); }, onActivity: () => openContext('activity'), onSpaceManage: () => openContext('space') }}
    workspace={{ channel: activeChannel, view: workspaceView, onViewChange: changeWorkspaceView, state: activeState, history: activeHistory, access: activeAccess, roster: activeRoster, selfId, agentActivity: agentActivity.byChannel[activeChannelId], onAcknowledgeAgentActivity: (agentId) => acknowledgeAgentActivity(activeChannelId, agentId), pending: pending.filter((item) => item.channelId === activeChannelId), approvalStates, controlStates, capabilityIndex, mockAdvance: { ...mockAdvance, onAdvance: advanceMockComputation }, agentSelection: { view: composerSelectionView, usage: composerAgentUsage, supportedTypes: composerSupportedTypes, pending: selectPendingHere, fallbackAgentId, onChange: handleAgentSelection, onPickAgent: handlePickAgent, onTargetChange: handleComposerAgentChange, onOpen: handleSelectorOpen }, onResolve: handleResolve, onRetry: handleRetry, onCancel: handleCancelAny, onTaskControl: handleTaskControl, onDownloadResource: handleDownloadResource, onPreviewResource: previewMessageAttachment, onOpenTurn: (turn) => openTurnDetail(turn.requestId), onCreateTask: createTaskFromSource, onSend: handleSend, onRestartChannel: handleRestartChannel, draft: draftTextsRef.current[activeChannelId] || '', onDraftChange: (value) => { draftTextsRef.current[activeChannelId] = value; }, attachments: draftAttachments[activeChannelId] || [], onPreviewAttachment: (attachment) => previewMessageAttachment(activeChannelId, attachment), onUploadAttachments: uploadComposerAttachments, onOpenChannelFiles: () => setAttachmentPickerOpen(true), onRemoveAttachment: (resourceId) => setDraftAttachments((current) => ({ ...current, [activeChannelId]: (current[activeChannelId] || []).filter((row) => row.resource_id !== resourceId) })), onClearAttachments: () => setDraftAttachments((current) => ({ ...current, [activeChannelId]: [] })), turnDetail: { selected: selectedTurn, capability: capabilityIndex.get(selectedTurnActorId), controlState: controlStates[selectedTurnControlKey], onCancel: () => handleCancel(activeChannelId, selectedTurn?.requestId), onControl: (type, payload) => handleTaskControl({ channelId: activeChannelId, turn: selectedTurn, actorId: selectedTurnActorId, type, payload }), onDownload: (attachment) => handleDownloadResource(activeChannelId, attachment), onSource: openDynamicSource, onCreateTask: createTaskFromSource, onClose: closeContext }, resources: { devices: channelDevices, disabled: wireState !== 'open' || !canWriteChannel(activeAccess), onResource: handleResource, onAttach: attachToDraft, onOpen: (artifact) => openContext('artifact-focus', { type: 'artifact', key: artifact.key }), onPreview: (artifact) => { setSelectedActor(null); setContextFocus(null); setMountedFilePreview(artifact); setRightPanel('artifact-focus'); } }, tasks: { items: [...workItemIndex.values()], providers, canWrite: wireState === 'open' && canWriteChannel(activeAccess), onNewTask: createTaskFromSource, onOpen: (item) => openContext('work-item-focus', { type: 'work_item', key: item.key }), onNewAutomation: () => openContext('automation') }, automation: { records: timerRecords, disabled: wireState !== 'open' || !canWriteChannel(activeAccess), onAfter: handleAfter, onCancel: handleCancelTimer } }}
    notices={{ error: topError, channel: channelNotice, dismissError: () => setTopError(''), dismissChannel: () => setChannelNotice('') }}
    panel={{ value: rightPanel, open: openContext, host }}
  />
  {taskCreateSource !== undefined && <TaskCreateModal providers={providers} source={taskCreateSource} onSubmit={submitTask} onClose={() => setTaskCreateSource(undefined)} />}
  {channelCreateOpen && activeChannel && <ChannelCreateModal channel={activeChannel} channels={channelList} roster={activeRoster} selfId={selfId} state={activeState} disabled={wireState !== 'open' || !canWriteChannel(activeAccess)} onSubmit={handleSend} onClose={() => setChannelCreateOpen(false)} onEnterChannel={(channel) => { setChannelCreateOpen(false); selectWorkspaceChannel(channel.id); }} />}
  {globalSearchOpen && <GlobalSearch index={globalData.searchIndex} onOpen={navigateToSource} onClose={() => setGlobalSearchOpen(false)} />}
  <UiActivityOverlay entries={uiActivity} />
  {attachmentPickerOpen && activeChannel && <ChannelFilePickerModal channel={activeChannel} devices={channelDevices} disabled={wireState !== 'open' || !canWriteChannel(activeAccess)} onResource={handleResource} onChoose={attachToDraft} onClose={() => setAttachmentPickerOpen(false)} />}
  </>;
}
