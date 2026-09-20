import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { WorkspaceLayout } from './WorkspaceLayout.jsx';
import {
  useChannelNavigation,
  useIdentitySession,
  useWireConnection,
  useWireSessionPort,
} from './hooks/useWireSession.js';
import { useChannelRoster } from './hooks/useChannelRoster.js';
import { useAgentProbes } from './hooks/useAgentProbes.js';
import { useAttachmentTransactions } from './hooks/useAttachmentTransactions.js';
import { createChannelFeedRuntime } from '../model/channel-feed-runtime.js';
import { createViewSessionStore } from '../model/view-session.js';
import { HISTORY_INTENT } from '../model/history-demand.js';
import { readServerWorld } from './hooks/useWireSession.js';
import { ptyClient } from '../net/pty.js';
import {
  createFeatureTaskSubmission,
  createFeatureWaitingControlSubmission,
  FEATURE_COMMAND_STATE,
  FEATURE_TASK_ACTION,
  FEATURE_WAITING_CONTROL,
  selectFeatureTaskFacts,
  selectFeatureTaskProviders,
  selectFeatureWaitingFacts,
} from '../model/feature-tasks.js';
import { selectFeatureSearchIndex } from '../model/feature-search.js';
import { terminalResultPayload, terminalResultState } from '../model/terminal-result.js';
import { argsOf } from '../protocol/envelope.js';
import { isManageableDeclaration } from '../model/actor-visibility.js';
import { SYSTEM_ACTOR_ID, TYPES } from '../protocol/vocab.js';
import { Auth } from '../ui/Auth.jsx';
import { VersionIncompatible } from '../ui/VersionIncompatible.jsx';
import { ConversationSurface } from '../ui/conversation/ConversationSurface.jsx';
import { Composer, useComposerCommands } from '../ui/composer/index.js';
import { TaskCreationDialog } from '../ui/features/tasks/TasksFeature.jsx';
import {
  WorkspaceFeatures,
  WorkspaceFeatureOverlays,
  WorkspaceRightPanel,
} from '../ui/features/index.js';

const EMPTY_ARRAY = Object.freeze([]);

const MEMBER_ACCESS = new Set(['member_active', 'member_stale', 'member_unavailable']);
const OBSERVER_ACCESS = new Set(['observer_active', 'observer_stale']);
const CONTENT_ACCESS = new Set([...MEMBER_ACCESS, ...OBSERVER_ACCESS]);
const ACCESS_NOTICE = Object.freeze({
  member_stale: '正在同步频道状态。',
  member_unavailable: '频道暂不可用，历史记录仍可查看。',
  observer_active: '正在只读旁观此频道。',
  observer_stale: '旁观连接已中断，当前显示本地缓存。',
  discoverable: '这是空间中的可发现频道，你当前没有成员访问关系。',
  access_denied: '你的频道访问权限已被撤销，缓存内容已隐藏。重新获得访问权限后才能查看。',
  retired: '频道已退役。',
  loading: '正在确认频道访问状态。',
});

const ACTIVITY_KIND_LABELS = Object.freeze({
  approval: '审批',
  agent_run: 'Agent 回合',
  task: '任务',
  recovery: '恢复事项',
  automation: '自动动作',
  operation: '操作',
});

const ACTIVITY_STATE_LABELS = Object.freeze({
  active: '进行中',
  waiting: '待处理',
  blocked: '已阻塞',
  uncertain: '待确认',
  failed: '失败',
  expired: '已过期',
  completed: '已完成',
  cancelled: '已取消',
  queued: '排队中',
  running: '运行中',
});

function canViewChannelContent(access) {
  return CONTENT_ACCESS.has(access);
}

function isMemberAccess(access) {
  return MEMBER_ACCESS.has(access);
}

function ChannelAccessPlaceholder({ access, label = '频道内容', composer = null }) {
  const loading = access === 'loading';
  const detail = ACCESS_NOTICE[access] || '当前频道不可访问。';
  return <section className="channel-private-empty dynamic-private-empty" role={loading ? 'status' : 'region'} aria-label={label}>
    <strong>{loading ? `正在准备${label}…` : `${label}不可访问`}</strong>
    <p>{detail}{!loading && access !== 'retired' ? '当前页面不会展示或搜索此前缓存的消息、产物、任务和成员。' : ''}</p>
    {composer && <div className="conversation-input-slot channel-access-composer">{composer}</div>}
  </section>;
}

function unavailableError(port) {
  return Object.assign(new Error(`${port} owner 尚未连接`), { code: 'owner_unavailable', port });
}

function governanceWorldResetError() {
  return Object.assign(new Error('服务端 world 已切换，治理请求已取消'), { code: 'governance_world_changed' });
}

function useFeedOwner({ refs, ownerToken, bindings }) {
  const runtimeRef = useRef(null);
  const bindingsRef = useRef(null);
  if (runtimeRef.current === null) {
    const forward = (name) => (...args) => {
      const owner = bindingsRef.current;
      if (typeof owner?.[name] !== 'function') throw unavailableError(`feed.${name}`);
      return owner[name](...args);
    };
    runtimeRef.current = createChannelFeedRuntime({
      ...refs,
      ownerToken,
      onError: forward('onError'),
      onChannelsDiscovered: forward('onChannelsDiscovered'),
      onDirectoryInvalidated: forward('onDirectoryInvalidated'),
      onSubmissionFeed: forward('onSubmissionFeed'),
      onAccessChanged: forward('onAccessChanged'),
    });
  }
  const runtime = runtimeRef.current;
  useLayoutEffect(() => {
    bindingsRef.current = bindings;
    const release = runtime.bind({ ...bindings, ownerToken });
    return () => {
      if (bindingsRef.current === bindings) bindingsRef.current = null;
      release?.();
    };
  }, [bindings, ownerToken, runtime]);
  useEffect(() => runtime.mount(), [runtime]);
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  return runtime.getOwnerSnapshot(ownerToken, snapshot);
}

function errorText(error) {
  return error?.detail || error?.message || String(error);
}

function isRetiredOwnerError(error) {
  return error?.code === 'cache_owner_changed';
}

function timelineTurnForRequest(state, requestId) {
  const wanted = String(requestId || '');
  if (!wanted) return null;
  const visit = (entry) => {
    if (entry?.kind === 'turn' && String(entry.turn?.requestId || '') === wanted) return entry.turn;
    for (const child of entry?.thread || []) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  for (const entry of state?.timeline || []) {
    const found = visit(entry);
    if (found) return found;
  }
  return null;
}

function governanceRequestId(value) {
  if (typeof value === 'string') return value;
  return String(value?.message_id || value?.messageId || value?.id || '');
}

function governanceTerminalError(payload, fallback = '治理命令未完成') {
  const error = new Error(String(payload?.detail || payload?.error || payload?.reason || fallback));
  error.code = String(payload?.error_code || payload?.reason || 'governance_failed');
  return error;
}

function timelineTurns(timeline = []) {
  const rows = [];
  const visit = (entry) => {
    if (entry?.kind === 'turn' && entry.turn?.request?.id) rows.push(entry.turn);
    for (const child of entry?.thread || []) visit(child);
  };
  for (const entry of timeline) visit(entry);
  return rows;
}

function sourceView(source) {
  if (source?.workItemKey || source?.objectType === 'work_item') return 'tasks';
  if (source?.objectType === 'artifact' || source?.view === 'artifacts' || source?.view === 'files') return 'files';
  return source?.view === 'tasks' ? 'tasks' : 'conversation';
}

function sourceFocus(source) {
  const workItemKey = String(source?.workItemKey || '');
  if (workItemKey) return { type: 'work_item', key: workItemKey };
  if (source?.objectType === 'work_item') {
    const key = String(source.objectId || source.taskId || '');
    return key ? { type: 'work_item', key } : null;
  }
  if (source?.objectType === 'turn') {
    const key = String(source.requestId || source.objectId || '');
    return key ? { type: 'turn', key } : null;
  }
  if (source?.objectType === 'artifact') {
    const key = String(source.objectId || source.resourceId || source.fileId || '');
    return key ? { type: 'artifact', key } : null;
  }
  if (source?.objectType === 'participant') {
    const key = String(source.objectId || source.actorId || '');
    return key ? { type: 'participant', key } : null;
  }
  if (source?.objectType === 'channel') {
    const key = String(source.objectId || source.channelId || '');
    return key ? { type: 'channel', key } : null;
  }
  return null;
}

function channelCreationOperation(turn, channel) {
  const request = turn?.request;
  if (request?.type !== TYPES.channel.create) return null;
  const requestId = String(turn.requestId || request.id || '');
  if (!requestId || !channel?.id) return null;
  const body = argsOf(request);
  const resultState = terminalResultState(turn);
  const result = terminalResultPayload(turn) || {};
  const value = result.value && typeof result.value === 'object' && !Array.isArray(result.value)
    ? result.value
    : result;
  const status = String(result.status || '');
  const state = resultState.phase === 'unavailable'
    ? 'uncertain'
    : !turn.terminal
      ? 'active'
      : status === 'completed'
        ? 'completed'
        : status === 'cancelled'
          ? 'cancelled'
          : 'failed';
  const targetId = String(value.channel_id || value.channelId || '');
  const detail = !turn.terminal
    ? '等待账本确认'
    : resultState.phase === 'unavailable'
      ? resultState.error
      : status === 'completed' && targetId
        ? '账本已确认，等待频道目录投影'
        : String(result.detail || result.error || result.reason || status || '命令已完成');
  return Object.freeze({
    key: `operation:${channel.id}:${requestId}`,
    operationId: requestId,
    kind: 'operation',
    kindLabel: ACTIVITY_KIND_LABELS.operation,
    title: `创建频道 ${String(body.name || targetId || '未命名频道')}`,
    state,
    channelId: channel.id,
    channelName: channel.qualified_name || channel.name || channel.id,
    detail,
    updatedAt: turn.terminal?.ts || request.ts || turn.requestSeq || 0,
    source: Object.freeze({
      channelId: channel.id,
      view: 'conversation',
      objectType: 'turn',
      objectId: requestId,
      requestId,
      seq: turn.requestSeq,
    }),
  });
}

function IdentityBoundary() {
  const [error, setError] = useState('');
  const onError = useCallback((reason) => setError(reason?.detail || reason?.message || String(reason)), []);
  const identity = useIdentitySession({ onError });
  if (identity.booting) return <div className="boot-screen"><span className="brand-dot" />正在启动工作区…</div>;
  if (!identity.principal) return <><Auth identity={identity.identity} onAuthed={identity.accept} />{error && <div className="top-error" role="alert">{error}</div>}</>;
  return <AuthenticatedWorkspace key={identity.principal.id} identity={identity} initialError={error} />;
}

// Filled by the owner composition below; kept as a component boundary so a
// principal change retires every channel-bound command port in one React
// lifetime without inventing another lifecycle manager.
function AuthenticatedWorkspace({ identity, initialError = '' }) {
  const principalId = identity.principal.id;
  const [topError, setTopError] = useState(initialError);
  const [channelNotice, setChannelNotice] = useState('');
  const [serverWorld, setServerWorld] = useState(readServerWorld);
  const [panel, setPanel] = useState('');
  const [composerEditPort, setComposerEditPort] = useState(null);
  // The filter is a fallback-selection fact, not a second Agent-selection
  // owner. Keep its channel identity beside the selected id so a stale
  // ConversationSurface cannot lend its provenance to the next channel.
  const [filterAgentSelection, setFilterAgentSelection] = useState({ channelId: '', actorId: '' });
  const [taskCreateSource, setTaskCreateSource] = useState(undefined);
  const [automationRecords, setAutomationRecords] = useState(EMPTY_ARRAY);
  const showError = useCallback((error) => setTopError(errorText(error)), []);
  const wire = useWireSessionPort();
  const navigation = useChannelNavigation({
    accessRef: wire.accessRef,
    rosterRef: wire.rosterRef,
    onSelect: () => { setPanel(''); setTaskCreateSource(undefined); setChannelNotice(''); },
    onNotice: setChannelNotice,
  });
  const ownerToken = useMemo(() => Object.freeze({ principalId }), [principalId]);
  const accessActionsRef = useRef({});
  const probePortRef = useRef(null);
  const attachmentPortRef = useRef(null);
  const submissionPortRef = useRef(null);
  const filePickerRef = useRef(null);
  const filePickerIDRef = useRef(0);
  const [filePickerRequest, setFilePickerRequest] = useState(null);
  const governanceRequestsRef = useRef(new Map());
  const templateListRequestRef = useRef('');
  const templateGetRequestRef = useRef(new Map());
  const governanceEpochRef = useRef(0);
  const [governanceRequestRevision, setGovernanceRequestRevision] = useState(0);
  const [channelCreationRequest, setChannelCreationRequest] = useState(null);

  const resetGovernanceRequests = useCallback(() => {
    governanceEpochRef.current += 1;
    const failure = governanceWorldResetError();
    for (const record of governanceRequestsRef.current.values()) record.reject?.(failure);
    governanceRequestsRef.current.clear();
    templateListRequestRef.current = '';
    templateGetRequestRef.current.clear();
    setChannelCreationRequest(null);
    setGovernanceRequestRevision((current) => current + 1);
  }, []);

  const submissionProxy = useMemo(() => {
    const submissionCorrelationPort = Object.freeze({
      owns: (identity) => submissionPortRef.current?.submissionCorrelationPort?.owns?.(identity) === true,
      markLanded: (identity) => submissionPortRef.current?.submissionCorrelationPort?.markLanded?.(identity) === true,
    });
    return Object.freeze({
      send: (...args) => {
        const command = submissionPortRef.current?.send;
        return typeof command === 'function'
          ? command(...args)
          : Promise.reject(unavailableError('submission.send'));
      },
      control: (...args) => {
        const command = submissionPortRef.current?.control;
        return typeof command === 'function'
          ? command(...args)
          : Promise.reject(unavailableError('submission.control'));
      },
      resetWorld: (...args) => {
        const command = submissionPortRef.current?.resetWorld;
        if (typeof command !== 'function') throw unavailableError('submission.resetWorld');
        return command(...args);
      },
      reconcileFeed: (...args) => {
        const submission = submissionPortRef.current;
        if (typeof submission?.reconcileFeed !== 'function'
          || !submission.submissionCorrelationPort) {
          throw unavailableError('submission.reconcileFeed');
        }
        return submission.reconcileFeed(...args);
      },
      submissionCorrelationPort,
    });
  }, []);

  const feedBindings = useMemo(() => ({
    ownerToken,
    onError: (error) => { if (!isRetiredOwnerError(error)) showError(error); },
    onChannelsDiscovered: () => navigation.bump(),
    onDirectoryInvalidated: () => {
      const schedule = accessActionsRef.current?.schedule;
      if (typeof schedule !== 'function') throw unavailableError('directory.schedule');
      return schedule();
    },
    onSubmissionFeed: submissionProxy.reconcileFeed,
    submissionCorrelationPort: submissionProxy.submissionCorrelationPort,
    onAccessChanged: navigation.bump,
  }), [navigation.bump, ownerToken, showError, submissionProxy.reconcileFeed, submissionProxy.submissionCorrelationPort]);
  const feed = useFeedOwner({
    refs: {
      wireRef: wire.wireRef,
      rosterRef: wire.rosterRef,
      accessRef: wire.accessRef,
      activeChannelRef: navigation.activeChannelRef,
    },
    ownerToken,
    bindings: feedBindings,
  });
  const activityRef = useRef(feed.agentActivityPort);
  const feedRef = useRef(null);
  // The transport owner is the identity boundary for cleanup.  Numeric wire
  // generations are only unique within one wire instance, so a late cleanup
  // must also prove that it still owns the current wire before releasing the
  // Feed runtime.
  const wireOwnerRef = wire.wireRef;
  useLayoutEffect(() => {
    feedRef.current = feed;
    return () => {
      // Passive owner cleanup still needs the last committed feed command
      // port. Retire after that cleanup, while allowing StrictMode's immediate
      // re-commit to reclaim the same port.
      queueMicrotask(() => { if (feedRef.current === feed) feedRef.current = null; });
    };
  }, [feed]);
  const callFeed = useCallback((name, args) => {
    const command = feedRef.current?.[name];
    if (typeof command !== 'function') throw unavailableError(`feed.${name}`);
    return command(...args);
  }, []);
  const feedCommands = useMemo(() => Object.freeze({
    bump: (...args) => callFeed('bump', args),
    // Teardown is a release, not a foreground command.  React can retire the
    // Feed command port before useWireConnection's passive cleanup runs; an
    // unconnected owner is therefore a legal idempotent no-op.  When a port
    // is present, invoke it without catching errors so a real current-owner
    // failure remains observable.  The wire identity check prevents an old
    // effect whose generation number happens to repeat from releasing a new
    // session owner.
    cancel: (owner, generation) => {
      const feedOwner = feedRef.current;
      const requestGeneration = Number(generation);
      if (!feedOwner
        || !owner
        || wireOwnerRef.current !== owner
        || !Number.isSafeInteger(requestGeneration)
        || requestGeneration <= 0) return false;
      const command = feedOwner.cancel;
      if (typeof command !== 'function') throw unavailableError('feed.cancel');
      return command(requestGeneration);
    },
    // Disconnect is a release from the wire owner. During React owner handoff
    // there may be no committed feed command port; releasing that absence is
    // a legal no-op, while a committed runtime still enforces generation
    // matching and rejects stale releases.
    disconnectHistory: (...args) => {
      const command = feedRef.current?.disconnectHistory;
      return typeof command === 'function' ? command(...args) : false;
    },
    enqueue: (...args) => callFeed('enqueue', args),
    focusHistory: (...args) => callFeed('focusHistory', args),
    generationFor: (...args) => callFeed('generationFor', args),
    liveCheckpoint: (...args) => callFeed('liveCheckpoint', args),
    loadHistory: (...args) => callFeed('loadHistory', args),
    pageEnd: (...args) => callFeed('pageEnd', args),
    prepareLocalReplica: (...args) => callFeed('prepareLocalReplica', args),
    reconcileIdentity: (...args) => callFeed('reconcileIdentity', args),
    refreshChannel: (...args) => callFeed('refreshChannel', args),
    // Search may outlive one committed Feed owner during a React handoff. A
    // missing port is a transient admission state, not an application error;
    // the Search effect retries the same activation until this typed command
    // is available. Do not call through `callFeed` here because that helper's
    // throwing contract is correct for foreground commands but would turn a
    // lease handoff into an unhandled effect error.
    requestBackgroundInterest: (...args) => {
      const command = feedRef.current?.requestBackgroundInterest;
      return typeof command === 'function' ? command(...args) : null;
    },
    resetPersistent: (...args) => callFeed('resetPersistent', args),
    resumeLocalReplica: (...args) => callFeed('resumeLocalReplica', args),
    setHistoryGrants: (...args) => callFeed('setHistoryGrants', args),
    stopIncompatible: (...args) => callFeed('stopIncompatible', args),
  }), [callFeed, wireOwnerRef]);
  const roster = useChannelRoster({
    generationFor: feedCommands.generationFor,
    obsRef: wire.obsRef,
    onError: showError,
    ownerToken,
    principalId,
    reconcileIdentity: feedCommands.reconcileIdentity,
    rosterRef: wire.rosterRef,
    versionIncompatibleEpochRef: wire.incompatibleEpochRef,
    versionIncompatibleRef: wire.incompatibleRef,
  });

  const access = wire.accessRef.current?.state?.(navigation.activeChannelId) || null;
  const activeAccess = navigation.activeChannel?.access || 'loading';
  const contentVisible = canViewChannelContent(activeAccess);
  const memberVisible = isMemberAccess(activeAccess);
  const channelRoster = memberVisible
    ? roster.rosters.get(navigation.activeChannelId) || EMPTY_ARRAY
    : EMPTY_ARRAY;
  const selfId = memberVisible ? navigation.selfFor(navigation.activeChannelId) : '';
  const filterFallbackActorId = filterAgentSelection.channelId === navigation.activeChannelId
    && filterAgentSelection.actorId
    && channelRoster.some((row) => row.id === filterAgentSelection.actorId && row.kind === 'agent')
    ? filterAgentSelection.actorId
    : '';
  useEffect(() => {
    setFilterAgentSelection((current) => {
      if (!current.actorId) {
        return current.channelId === navigation.activeChannelId
          ? current
          : { channelId: navigation.activeChannelId, actorId: '' };
      }
      if (current.channelId !== navigation.activeChannelId
        || !channelRoster.some((row) => row.id === current.actorId && row.kind === 'agent')) {
        return { channelId: navigation.activeChannelId, actorId: '' };
      }
      return current;
    });
  }, [channelRoster, navigation.activeChannelId]);
  const probes = useAgentProbes({
    activeChannelId: navigation.activeChannelId,
    activeChannelRef: navigation.activeChannelRef,
    accessRef: wire.accessRef,
    stateFor: feed.stateFor,
    feedVersion: feed.version,
    handleSend: submissionProxy.send,
    handleControl: submissionProxy.control,
    pending: submissionPortRef.current?.pending,
    rosterRef: wire.rosterRef,
    rosters: roster.rosters,
    wireState: wire.state,
  });
  const capabilities = probes.capabilitiesFor(navigation.activeChannelId);
  const filterFallbackActive = Boolean(filterFallbackActorId && probes.composerAgentSource !== 'manual');
  const selectedComposerAgentId = filterFallbackActive
    ? filterFallbackActorId
    : probes.composerAgent?.actorId || '';
  const selectedComposerAgentSource = filterFallbackActive
    ? 'filter'
    : probes.composerAgentSource || '';
  const composer = useComposerCommands({
    activeChannelId: navigation.activeChannelId,
    principalId,
    wireState: wire.state,
    wireRef: wire.wireRef,
    accessRef: wire.accessRef,
    producerOwnerToken: ownerToken,
    generationFor: feedCommands.generationFor,
    serverWorld,
    onError: showError,
    onNotice: setChannelNotice,
    onFeedChanged: feedCommands.bump,
    onAccessChanged: navigation.bump,
    roster: channelRoster,
    selfId,
    access: access ? {
      ...access,
      canEditDraft: memberVisible,
      canDurablyAccept: memberVisible,
      canTransmit: activeAccess === 'member_active' && wire.state === 'open',
      reason: memberVisible ? '' : ACCESS_NOTICE[activeAccess] || '当前频道不可写',
      transportOpen: wire.state === 'open',
    } : access,
    agentSelection: {
      selectedAgentId: selectedComposerAgentId,
      ...(selectedComposerAgentSource ? { fallbackSource: selectedComposerAgentSource } : {}),
    },
    capabilityIndex: capabilities,
    onRequestCapability: probes.requestCapability,
    edit: composerEditPort,
    channelState: feed.stateFor(navigation.activeChannelId),
    probes,
    probesRef: probePortRef,
    attachmentRef: attachmentPortRef,
  });
  const submission = composer.submission;
  const sendSystemCommand = useCallback((channelId, msgType, payload) => {
    if (!channelId) return Promise.reject(new TypeError('请先选择频道'));
    const channelAccess = wire.accessRef.current?.state?.(channelId);
    if (channelAccess?.relationship !== 'member'
      || channelAccess.existence === 'retired'
      || channelAccess.runtime === 'closed'
      || channelAccess.unavailable) {
      return Promise.reject(new TypeError('当前身份不能治理该频道'));
    }
    return submission.send({
      channelId,
      text: '',
      msgType,
      audience: [SYSTEM_ACTOR_ID],
      targetLabel: SYSTEM_ACTOR_ID,
      payload,
    });
  }, [submission.send, wire.accessRef]);
  const refreshDirectoryFacts = useCallback(() => {
    const refresh = accessActionsRef.current.refresh;
    if (typeof refresh !== 'function') return Promise.reject(unavailableError('directory.refresh'));
    return refresh();
  }, []);
  const trackGovernanceRequest = useCallback((record) => {
    governanceRequestsRef.current.set(record.requestId, record);
    setGovernanceRequestRevision((current) => current + 1);
  }, []);
  const waitForGovernanceTerminal = useCallback((record) => new Promise((resolve, reject) => {
    trackGovernanceRequest({ ...record, epoch: governanceEpochRef.current, resolve, reject });
  }), [trackGovernanceRequest]);
  const requestChannelTemplateList = useCallback(async (channelId = navigation.activeChannelId) => {
    const epoch = governanceEpochRef.current;
    const requestId = governanceRequestId(await sendSystemCommand(channelId, TYPES.channelTemplate.list, {}));
    if (epoch !== governanceEpochRef.current) throw governanceWorldResetError();
    if (!requestId) throw new TypeError('频道模板列表请求没有返回可追踪的请求编号');
    templateListRequestRef.current = requestId;
    return waitForGovernanceTerminal({
      channelId,
      requestId,
      msgType: TYPES.channelTemplate.list,
      kind: 'template-list',
      epoch,
    });
  }, [navigation.activeChannelId, sendSystemCommand, waitForGovernanceTerminal]);
  const requestChannelTemplate = useCallback(async (channelId, templateId) => {
    const id = String(templateId || '').trim();
    if (!id) throw new TypeError('频道模板缺少稳定编号');
    const epoch = governanceEpochRef.current;
    const requestId = governanceRequestId(await sendSystemCommand(channelId, TYPES.channelTemplate.get, { id }));
    if (epoch !== governanceEpochRef.current) throw governanceWorldResetError();
    if (!requestId) throw new TypeError('频道模板详情请求没有返回可追踪的请求编号');
    templateGetRequestRef.current.set(id, requestId);
    return waitForGovernanceTerminal({
      channelId,
      requestId,
      msgType: TYPES.channelTemplate.get,
      kind: 'template-get',
      templateId: id,
      epoch,
    });
  }, [sendSystemCommand, waitForGovernanceTerminal]);
  const sendGovernanceCommand = useCallback(async (channelId, msgType, payload) => {
    const epoch = governanceEpochRef.current;
    const result = await sendSystemCommand(channelId, msgType, payload);
    if (epoch !== governanceEpochRef.current) throw governanceWorldResetError();
    const requestId = governanceRequestId(result);
    if (msgType === TYPES.channel.create) {
      if (!requestId) throw new TypeError('创建命令没有返回可追踪的请求编号');
      setChannelCreationRequest({
        requestId,
        parentId: channelId,
        name: String(payload?.name || '').trim(),
        accepted: true,
        ledger: false,
        targetId: '',
        failed: false,
        error: '',
      });
      trackGovernanceRequest({
        channelId,
        requestId,
        msgType,
        kind: 'channel-create',
        epoch,
        parentId: channelId,
        name: String(payload?.name || '').trim(),
      });
    }
    await refreshDirectoryFacts();
    if (epoch !== governanceEpochRef.current) throw governanceWorldResetError();
    return result;
  }, [refreshDirectoryFacts, sendSystemCommand, trackGovernanceRequest]);
  const refreshGovernanceDirectory = useCallback(async () => {
    await refreshDirectoryFacts();
    try {
      await requestChannelTemplateList(navigation.activeChannelId);
      return true;
    } catch (failure) {
      showError(failure);
      return false;
    }
  }, [navigation.activeChannelId, refreshDirectoryFacts, requestChannelTemplateList, showError]);
  useEffect(() => {
    for (const [requestId, record] of governanceRequestsRef.current) {
      const turn = timelineTurnForRequest(feed.stateFor(record.channelId), requestId);
      if (!turn?.terminal) continue;
      const resultState = terminalResultState(turn);
      const payload = terminalResultPayload(turn) || {};
      const finishFailure = (failure) => {
        governanceRequestsRef.current.delete(requestId);
        if (record.kind === 'channel-create') {
          setChannelCreationRequest((current) => current?.requestId === requestId
            ? { ...current, failed: true, error: errorText(failure) }
            : current);
        }
        record.reject?.(failure);
      };
      if (resultState.phase === 'unavailable') {
        finishFailure(Object.assign(new Error(resultState.error), { code: 'governance_terminal_unavailable' }));
        continue;
      }
      if (payload.status !== 'completed') {
        finishFailure(governanceTerminalError(payload));
        continue;
      }
      const value = payload.value;
      if (record.kind === 'template-list') {
        if (!Array.isArray(value)) {
          finishFailure(Object.assign(new TypeError('Registrar 模板列表结果格式无效'), { code: 'template_list_invalid' }));
          continue;
        }
        if (templateListRequestRef.current === requestId) {
          const observed = wire.accessRef.current?.channelTemplatesObserved?.(value);
          if (observed !== true) {
            finishFailure(unavailableError('session.directory.channelTemplates'));
            continue;
          }
          navigation.bump();
        }
        governanceRequestsRef.current.delete(requestId);
        record.resolve?.(value);
        continue;
      }
      if (record.kind === 'template-get') {
        const templateId = String(record.templateId || '');
        const returnedId = String(value?.id || '').trim();
        if (returnedId !== templateId) {
          finishFailure(Object.assign(new TypeError('Registrar 模板详情返回了错误的模板编号'), { code: 'template_id_mismatch' }));
          continue;
        }
        const validBody = value && typeof value === 'object' && !Array.isArray(value.body)
          && value.body && typeof value.body === 'object';
        if (!validBody) {
          finishFailure(Object.assign(new TypeError('Registrar 模板详情缺少 recipe body'), { code: 'template_body_invalid' }));
          continue;
        }
        if (templateGetRequestRef.current.get(templateId) === requestId) {
          const observed = wire.accessRef.current?.channelTemplateObserved?.(value);
          if (observed !== true) {
            finishFailure(unavailableError('session.directory.channelTemplates'));
            continue;
          }
          navigation.bump();
        }
        governanceRequestsRef.current.delete(requestId);
        record.resolve?.(value);
        continue;
      }
      if (record.kind === 'channel-create') {
        const targetId = String(value?.channel_id || value?.channelId || '');
        if (!targetId) {
          finishFailure(Object.assign(new TypeError('频道创建终态缺少 channel_id'), { code: 'channel_create_target_missing' }));
          continue;
        }
        const returnedParent = String(value?.parent_id || value?.parentId || '').trim();
        const returnedName = String(value?.name || '').trim();
        if ((returnedParent && returnedParent !== String(record.parentId || record.channelId))
          || (returnedName && returnedName !== String(record.name || ''))) {
          finishFailure(Object.assign(new TypeError('频道创建终态与原始父频道或名称不匹配'), { code: 'channel_create_target_mismatch' }));
          continue;
        }
        governanceRequestsRef.current.delete(requestId);
        setChannelCreationRequest((current) => current?.requestId === requestId
          ? { ...current, ledger: true, targetId, error: '', failed: false }
          : current);
      }
    }
  }, [feed, governanceRequestRevision, navigation, wire]);
  useEffect(() => () => resetGovernanceRequests(), [resetGovernanceRequests]);
  const attachments = useAttachmentTransactions({
    activeChannel: navigation.activeChannel,
    activeChannelId: navigation.activeChannelId,
    activeChannelRef: navigation.activeChannelRef,
    accessRef: wire.accessRef,
    directoryVersion: navigation.revision,
    draftFor: submission.draftFor,
    drafts: submission.drafts,
    updateDraft: submission.updateDraft,
    onNotice: setChannelNotice,
    onOpenDynamic: () => navigation.setActiveView('conversation'),
    obsRef: wire.obsRef,
    persistDraftAttachments: submission.persistDraftAttachments,
    principalId,
    producerOwnerToken: ownerToken,
    generationFor: feedCommands.generationFor,
    serverWorld,
    wireRef: wire.wireRef,
    wireState: wire.state,
  });
  const resourceEntry = useCallback((channelId, resource) => ({
    key: `resource:${channelId}:${resource?.resource_id || resource?.resourceId || resource?.path || ''}`,
    channelId,
    resourceId: resource?.resource_id || resource?.resourceId || resource?.path || '',
    name: resource?.name || String(resource?.path || resource?.resource_id || resource?.resourceId || '').split('/').filter(Boolean).at(-1) || '文件',
    mediaType: resource?.media_type || resource?.mediaType || 'application/octet-stream',
    size: Number(resource?.size || 0),
    ...(Number.isSafeInteger(Number(resource?.line)) ? { line: Number(resource.line) } : {}),
  }), []);
  const settleFilePicker = useCallback((value = null, { close = true, requestId = null } = {}) => {
    const request = filePickerRef.current;
    if (!request || request.settled || (requestId != null && request.id !== requestId)) return false;
    request.settled = true;
    request.resolve(value);
    if (close) {
      filePickerRef.current = null;
      setFilePickerRequest(null);
    }
    return true;
  }, []);
  const cancelFilePicker = useCallback(() => {
    const request = filePickerRef.current;
    if (!request) {
      setFilePickerRequest(null);
      return false;
    }
    if (!request.settled) {
      request.settled = true;
      request.resolve(null);
    }
    filePickerRef.current = null;
    setFilePickerRequest(null);
    return true;
  }, []);
  const pickChannelFile = useCallback((channelId = navigation.activeChannelId) => {
    const requestedChannelId = String(channelId || '');
    if (!requestedChannelId || requestedChannelId !== navigation.activeChannelId) {
      return Promise.reject(new TypeError('Composer 频道已切换'));
    }
    if (activeAccess !== 'member_active' || wire.state !== 'open') {
      return Promise.reject(new TypeError(ACCESS_NOTICE[activeAccess] || '当前频道不可附加文件'));
    }
    cancelFilePicker();
    return new Promise((resolve) => {
      const request = {
        id: ++filePickerIDRef.current,
        channelId: requestedChannelId,
        settled: false,
        resolve,
      };
      filePickerRef.current = request;
      setFilePickerRequest({ id: request.id, channelId: requestedChannelId });
    });
  }, [activeAccess, cancelFilePicker, navigation.activeChannelId, wire.state]);
  const chooseChannelFile = useCallback((entry) => {
    const request = filePickerRef.current;
    if (!request || request.channelId !== navigation.activeChannelId) {
      cancelFilePicker();
      return false;
    }
    if (request.settled) return false;
    const resourceId = String(entry?.resourceId || entry?.resource_id || '');
    if (!resourceId || entry?.kind !== 'file') {
      // Files owns the directory projection; an invalid row cannot be
      // attached and must settle the waiting Composer call without inventing
      // a resource or leaving its busy state pending forever. Keep the modal
      // open so a projected Files error/diagnostic remains visible.
      settleFilePicker(null, { close: false });
      return false;
    }
    settleFilePicker({
      resource_id: resourceId,
      address: resourceId,
      name: String(entry.name || resourceId),
      media_type: String(entry.mediaType || entry.media_type || 'application/octet-stream'),
      size: Number(entry.size || 0),
    });
    return true;
  }, [cancelFilePicker, navigation.activeChannelId, settleFilePicker]);
  useEffect(() => {
    const request = filePickerRef.current;
    if (request && request.channelId !== navigation.activeChannelId) cancelFilePicker();
  }, [cancelFilePicker, navigation.activeChannelId]);
  useEffect(() => () => {
    const request = filePickerRef.current;
    filePickerRef.current = null;
    if (request && !request.settled) {
      request.settled = true;
      request.resolve(null);
    }
  }, []);
  const composerAttachmentPort = useMemo(() => Object.freeze({
    attach: attachments.attach,
    clear: attachments.clear,
    downloadFile: attachments.downloadFile,
    mutate: attachments.mutate,
    pickChannelFile,
    preview: (resource, channelId) => {
      const artifact = resourceEntry(channelId, resource);
      if (!artifact.resourceId) throw new TypeError('文件资源标识为空');
      const operation = attachments.previewArtifact(artifact, channelId);
      setPanel('artifact');
      return operation;
    },
    reset: attachments.reset,
    setSelectedArtifact: attachments.setSelectedArtifact,
    upload: attachments.uploadComposerAttachments,
  }), [
    attachments.attach,
    attachments.clear,
    attachments.downloadFile,
    attachments.mutate,
    attachments.previewArtifact,
    attachments.reset,
    attachments.setSelectedArtifact,
    attachments.uploadComposerAttachments,
    pickChannelFile,
    resourceEntry,
  ]);
  useLayoutEffect(() => {
    probePortRef.current = probes;
    attachmentPortRef.current = composerAttachmentPort;
    submissionPortRef.current = submission;
    return () => {
      if (probePortRef.current === probes) probePortRef.current = null;
      if (attachmentPortRef.current === composerAttachmentPort) attachmentPortRef.current = null;
      if (submissionPortRef.current === submission) submissionPortRef.current = null;
    };
  }, [composerAttachmentPort, probes, submission]);

  const resetWorldOwners = useCallback(async () => {
    resetGovernanceRequests();
    const resetAttachments = attachmentPortRef.current?.reset;
    const resetProbes = probePortRef.current?.reset;
    if (typeof resetAttachments !== 'function') throw unavailableError('resources.reset');
    if (typeof resetProbes !== 'function') throw unavailableError('probes.reset');
    resetAttachments();
    resetProbes();
    setAutomationRecords(EMPTY_ARRAY);
    await feedCommands.resetPersistent();
  }, [feedCommands.resetPersistent, resetGovernanceRequests]);

  useWireConnection({
    accessActionsRef,
    activeChannelRef: navigation.activeChannelRef,
    agentActivityRef: activityRef,
    bumpAccess: navigation.bump,
    cancelFeedTask: feedCommands.cancel,
    disconnectHistory: feedCommands.disconnectHistory,
    displayError: errorText,
    enqueueFeed: feedCommands.enqueue,
    expireSession: identity.expire,
    finishHistoryPage: feedCommands.pageEnd,
    finishLiveCheckpoint: feedCommands.liveCheckpoint,
    onServerWorld: setServerWorld,
    onWorldChanged: resetWorldOwners,
    port: wire,
    prepareLocalReplica: feedCommands.prepareLocalReplica,
    refreshHistoryChannel: feedCommands.refreshChannel,
    principalId,
    reconcileIdentity: feedCommands.reconcileIdentity,
    resetSubmissionWorld: submissionProxy.resetWorld,
    resumeLocalReplica: feedCommands.resumeLocalReplica,
    setActiveChannelId: navigation.setActiveChannelId,
    setChannels: navigation.setChannels,
    setHistoryGrants: feedCommands.setHistoryGrants,
    setTopError,
    stopIncompatibleFeed: feedCommands.stopIncompatible,
  });

  useEffect(() => {
    if (!navigation.activeChannelId) return;
    feedCommands.focusHistory(navigation.activeChannelId);
    void feedCommands.refreshChannel(navigation.activeChannelId);
    if (contentVisible && wire.state === 'open') {
      void feedCommands.loadHistory(navigation.activeChannelId, {
        intent: 'initial-view',
        urgency: 'blocking',
      });
    }
    if (memberVisible) {
      const generation = Number(feedCommands.generationFor(navigation.activeChannelId) || 0);
      const authority = roster.authorities.get(navigation.activeChannelId);
      const attempted = authority?.principalId === principalId
        && authority?.channelId === navigation.activeChannelId
        && authority?.generation === generation;
      void roster.refresh(navigation.activeChannelId, generation > 0 && !attempted).catch(showError);
    } else roster.clearChannel(navigation.activeChannelId);
  }, [contentVisible, feedCommands, memberVisible, navigation.activeChannelId, principalId, roster.authorities, roster.clearChannel, roster.refresh, showError, wire.state]);

  useEffect(() => {
    if (contentVisible) return;
    navigation.setTerminalVisible(false);
    setComposerEditPort(null);
    setTaskCreateSource(undefined);
    setPanel((current) => {
      const kind = typeof current === 'string' ? current : current?.kind || '';
      return ['search', 'space-administration'].includes(kind) ? current : '';
    });
  }, [activeAccess, contentVisible, navigation.setTerminalVisible]);

  const timerNotice = useMemo(() => {
    const firings = feed.timerFirings;
    const readableChannels = new Set(navigation.channels
      .filter((channel) => canViewChannelContent(channel.access))
      .map((channel) => channel.id));
    const events = firings.events.filter((event) => readableChannels.has(event.channelId));
    const canExposeOverflow = navigation.channels.every((channel) => canViewChannelContent(channel.access));
    const overflowCount = canExposeOverflow ? Number(firings.overflow?.count || 0) : 0;
    const count = events.length + overflowCount;
    if (!count) return null;
    const channelIds = [...new Set(events.map((event) => event.channelId).filter(Boolean))];
    const labels = channelIds.map((channelId) => {
      const channel = navigation.channels.find((row) => row.id === channelId);
      return channel?.qualified_name || channel?.name || channelId;
    });
    return Object.freeze({
      revision: Math.max(
        ...events.map((event) => Number(event.revision || 0)),
        canExposeOverflow ? Number(firings.overflow?.throughRevision || 0) : 0,
      ),
      message: `${count} 个定时任务已触发${labels.length ? ` · ${labels.join('、')}` : ''}`,
    });
  }, [feed.timerFirings, navigation.channels]);
  useEffect(() => {
    if (timerNotice) setChannelNotice(timerNotice.message);
  }, [timerNotice]);
  useEffect(() => {
    if (!timerNotice || channelNotice !== timerNotice.message) return;
    feed.acknowledgeTimerFirings(timerNotice.revision);
  }, [channelNotice, feed, timerNotice]);

  const viewSessions = useMemo(() => createViewSessionStore({ principalID: principalId }), [principalId]);
  const state = feed.stateFor(navigation.activeChannelId);
  const historyStatus = feed.historyFor(navigation.activeChannelId);
  const history = historyStatus ? {
    status: { ...historyStatus, localReplicaReady: feed.localReplicaReady },
    request: (request) => feedCommands.loadHistory(navigation.activeChannelId, request),
    refreshLatest: () => feedCommands.refreshChannel(navigation.activeChannelId),
    debugSnapshot: () => feed.coldEntryDiagnosticsFor(navigation.activeChannelId),
  } : null;
  const rosterAuthority = roster.authorities.get(navigation.activeChannelId) || null;
  const waitingRosterAuthority = rosterAuthority ? Object.freeze({
    ...rosterAuthority,
    rosterCurrent: rosterAuthority.current === true,
    controlCurrent: historyStatus?.controlCurrent === true,
    current: rosterAuthority.current === true && historyStatus?.controlCurrent === true,
    actorIDs: new Set(channelRoster.map((row) => row.id)),
  }) : null;
  const previewResource = useCallback((channelId, resource) => {
    const artifact = resourceEntry(channelId, resource);
    if (!artifact.resourceId) throw new TypeError('文件资源标识为空');
    const operation = attachments.previewArtifact(artifact, channelId);
    setPanel('artifact');
    return operation;
  }, [attachments.previewArtifact, resourceEntry]);
  const downloadResource = useCallback((channelId, resource) => {
    const artifact = resourceEntry(channelId, resource);
    if (!artifact.resourceId) return Promise.reject(new TypeError('文件资源标识为空'));
    const command = attachmentPortRef.current?.downloadFile;
    return typeof command === 'function'
      ? command(artifact)
      : Promise.reject(unavailableError('resources.download'));
  }, [resourceEntry]);
  const beginReply = useCallback((target) => {
    const senderId = String(target?.sender?.id || '');
    const sender = channelRoster.find((row) => row.id === senderId);
    if (!target?.id || !sender || senderId === selfId || !['agent', 'human'].includes(sender.kind)) {
      setChannelNotice('该条消息的回复对象已不在当前成员事实中。');
      return null;
    }
    const excerpt = String(target.text || '').replace(/\s+/g, ' ').trim();
    return composer.commands.changeDraft({
      replyTarget: {
        sourceId: target.id,
        senderId,
        senderKind: sender.kind,
        senderName: sender.name || sender.label || sender.id,
        excerpt: excerpt.length > 96 ? `${excerpt.slice(0, 95)}…` : excerpt,
      },
    });
  }, [channelRoster, composer.commands, selfId]);
  const canWrite = activeAccess === 'member_active' && wire.state === 'open';
  const recordTimerReceipt = useCallback(({ channelId, durationMs, msgType, payload }, receipt) => {
    const timerId = String(receipt?.timer_id || receipt?.timerId || '');
    if (!timerId) return;
    const record = Object.freeze({
      timerId,
      channelId: String(channelId || ''),
      durationMs: Number(durationMs || 0),
      msgType: String(msgType || ''),
      payload: Object.freeze(payload && typeof payload === 'object' ? { ...payload } : {}),
      createdAt: Date.now(),
      state: 'scheduled',
      provenance: 'after_receipt',
    });
    setAutomationRecords((current) => Object.freeze([
      ...current.filter((row) => String(row?.timerId || row?.timer_id || row?.id || '') !== timerId
        || String(row?.channelId || row?.channel_id || '') !== String(channelId || '')),
      record,
    ]));
  }, []);
  const afterAutomation = useCallback(async ({ channelId, durationMs, msgType, payload }) => {
    const channelAccess = wire.accessRef.current?.state?.(channelId);
    const command = wire.wireRef.current?.after;
    if (!canWrite || channelAccess?.relationship !== 'member' || typeof command !== 'function') {
      throw unavailableError('timer.after');
    }
    const result = await command({ channel_id: channelId, duration_ms: durationMs, msg_type: msgType, payload });
    recordTimerReceipt({ channelId, durationMs, msgType, payload }, result);
    return result;
  }, [canWrite, recordTimerReceipt, wire.accessRef, wire.wireRef]);
  const cancelAutomation = useCallback(async ({ channelId, timerId }) => {
    const channelAccess = wire.accessRef.current?.state?.(channelId);
    const command = wire.wireRef.current?.cancelTimer;
    if (!canWrite || channelAccess?.relationship !== 'member' || typeof command !== 'function') {
      throw unavailableError('timer.cancel');
    }
    const result = await command({ channel_id: channelId, timer_id: timerId });
    setAutomationRecords((current) => current.map((row) => (
      String(row?.timerId || row?.timer_id || row?.id || '') === String(timerId)
      && String(row?.channelId || row?.channel_id || '') === String(channelId || '')
        ? { ...row, state: 'cancelled', cancelledAt: Date.now() }
        : row
    )));
    return result;
  }, [canWrite, wire.accessRef, wire.wireRef]);
  const automationAvailable = canWrite && typeof wire.wireRef.current?.after === 'function';
  useEffect(() => {
    if (!canWrite) setTaskCreateSource(undefined);
  }, [canWrite]);
  useEffect(() => {
    if (!canWrite) return;
    for (const actor of channelRoster) {
      if (actor.kind !== 'agent') continue;
      const fact = capabilities.get(actor.id);
      if (fact?.describe || fact?.loading || fact?.error) continue;
      void probes.requestCapability(actor.id, navigation.activeChannelId).catch(showError);
    }
  }, [canWrite, capabilities, channelRoster, navigation.activeChannelId, probes.requestCapability, showError]);
  const taskActionFacts = useCallback((context) => {
    if (context?.kind === 'approval'
      && context.state === 'waiting'
      && context.turn?.request?.audience?.includes(selfId)
      && canWrite
      && typeof submission.resolve === 'function') {
      return [FEATURE_TASK_ACTION.approve, FEATURE_TASK_ACTION.reject];
    }
    if (context?.kind === 'recovery'
      && context.row?.state === 'rejected'
      && typeof submission.retry === 'function') return [FEATURE_TASK_ACTION.retry];
    if (context?.kind === 'waiting'
      && context.frame?.status === 'queued'
      && context.turn?.request?.sender?.id === selfId
      && canWrite
      && typeof submission.cancel === 'function') return [FEATURE_TASK_ACTION.cancel];
    return EMPTY_ARRAY;
  }, [canWrite, selfId, submission.cancel, submission.resolve, submission.retry]);
  const taskItems = useMemo(() => selectFeatureTaskFacts({
    state,
    pending: submission.pending,
    selfId,
    now: Date.now(),
    actionFacts: taskActionFacts,
    automationRecords,
  }), [automationRecords, feed.version, selfId, state, submission.pending, taskActionFacts]);
  const openTaskItem = useCallback((item) => {
    const key = String(item?.key || item?.id || '');
    if (!key) return null;
    navigation.setActiveView('tasks');
    setPanel({ kind: 'task', key });
    if (typeof navigation.setFocus === 'function') navigation.setFocus({ type: 'work_item', key });
    return item;
  }, [navigation.setActiveView, navigation.setFocus]);
  useEffect(() => {
    const routeFocus = navigation.activeView === 'tasks'
      && navigation.focus?.type === 'work_item'
      && navigation.focus.key
      ? String(navigation.focus.key)
      : '';
    setPanel((current) => {
      const currentKind = typeof current === 'string' ? current : current?.kind || '';
      if (routeFocus) {
        const currentKey = typeof current === 'object' ? String(current.key || current.item?.key || '') : '';
        return currentKind === 'task' && currentKey === routeFocus
          ? current
          : { kind: 'task', key: routeFocus };
      }
      return currentKind === 'task' ? '' : current;
    });
  }, [navigation.activeView, navigation.focus]);
  const waitingItems = useMemo(() => selectFeatureWaitingFacts({
    state,
    pending: submission.pending,
    actionFacts: taskActionFacts,
    targetAuthority: waitingRosterAuthority,
  }), [feed.version, state, submission.pending, taskActionFacts, waitingRosterAuthority]);
  const taskProviders = useMemo(
    () => selectFeatureTaskProviders(capabilities, channelRoster),
    [capabilities, channelRoster],
  );
  const taskCommandStates = useMemo(() => {
    const result = new Map();
    for (const item of [...taskItems, ...waitingItems]) {
      for (const action of item.actions || []) {
        let commandState = canWrite
          ? { state: FEATURE_COMMAND_STATE.ready }
          : { state: FEATURE_COMMAND_STATE.disabled, reason: '当前频道不可写' };
        if ([FEATURE_TASK_ACTION.approve, FEATURE_TASK_ACTION.reject].includes(action)) {
          const approval = submission.approvalStates?.[item.id];
          if (approval === 'sending') commandState = { state: FEATURE_COMMAND_STATE.submitting };
          else if (approval === 'resolved') commandState = { state: FEATURE_COMMAND_STATE.disabled, reason: '决定已提交' };
          else if (approval?.error) commandState = { state: FEATURE_COMMAND_STATE.failed, error: errorText(approval.error) };
        } else if (action === FEATURE_TASK_ACTION.cancel) {
          const control = submission.controlStates?.[`${item.channelId}:${item.requestId || item.id}:cancel`];
          if (control?.state === 'sending') commandState = { state: FEATURE_COMMAND_STATE.submitting };
          else if (control?.state === 'accepted') commandState = { state: FEATURE_COMMAND_STATE.disabled, reason: '取消已提交' };
          else if (control?.error) commandState = { state: FEATURE_COMMAND_STATE.failed, error: errorText(control.error) };
        }
        result.set(`${item.key}:${action}`, Object.freeze(commandState));
      }
    }
    return result;
  }, [canWrite, submission.approvalStates, submission.controlStates, taskItems, waitingItems]);
  const beginTaskCreation = useCallback((envelope, turn) => {
    const objectId = String(envelope?.parent_id || envelope?.id || '');
    if (!objectId) {
      setChannelNotice('该条动态没有稳定来源编号，不能创建可追溯任务。');
      return null;
    }
    setTaskCreateSource(Object.freeze({
      channelId: navigation.activeChannelId,
      view: 'dynamic',
      objectType: envelope?.kind === 'request' ? 'turn' : 'message',
      objectId,
      requestId: objectId,
      ...(Number.isSafeInteger(Number(turn?.requestSeq ?? envelope?.seq))
        ? { seq: Number(turn?.requestSeq ?? envelope.seq) }
        : {}),
    }));
    return objectId;
  }, [navigation.activeChannelId]);
  const openTurnDetail = useCallback((turn) => {
    const requestId = String(turn?.requestId || turn?.request?.id || '');
    const item = taskItems.find((row) => row.kind === 'agent_run' && row.requestId === requestId);
    if (!item) {
      setChannelNotice('该回合已不在当前任务事实中。');
      return null;
    }
    return openTaskItem(item);
  }, [openTaskItem, taskItems]);
  const conversationPort = {
    state: contentVisible ? state : null,
    history: contentVisible ? history : null,
    viewSessions,
    roster: channelRoster,
    waitingRosterAuthority,
    selfId,
    pending: submission.pending,
    approvalStates: submission.approvalStates || {},
    capabilityIndex: capabilities,
    agentActivity: feed.agentActivityFor(navigation.activeChannelId),
    access: activeAccess,
    surfaceVisible: contentVisible && (navigation.activeView === 'conversation' || navigation.terminalVisible),
    composer: <Composer model={composer.model} commands={composer.commands} />,
    onTailCaughtUp: (receipt) => {
      // A surface cleanup can run after navigation has committed its next
      // channel.  The receipt is the cross-owner identity for that callback;
      // never borrow the mutable navigation selection for an old surface.
      const receiptChannelId = String(receipt?.channelId || receipt?.authority?.channelId || '');
      if (!receiptChannelId
        || (receipt?.authority?.channelId
          && String(receipt.authority.channelId) !== receiptChannelId)) return;
      feed.markRead(receiptChannelId, receipt);
      feed.acknowledgeNotifications(receiptChannelId, receipt);
    },
    onResolve: submission.resolve,
    onCancel: submission.cancel,
    onTaskControl: submission.control,
    onDownloadResource: downloadResource,
    onPreviewResource: previewResource,
    onRequestCapability: probes.requestCapability,
    onReply: composer.model.editSession ? undefined : beginReply,
    onCreateTask: canWrite && taskProviders.length ? beginTaskCreation : undefined,
    onOpenTurn: openTurnDetail,
    onFocusAgentChange: (actorId, source = '') => {
      const channelId = navigation.activeChannelId;
      const filterActorId = source === 'filter' ? actorId : '';
      setFilterAgentSelection((current) => (
        current.channelId === channelId && current.actorId === filterActorId
          ? current
          : { channelId, actorId: filterActorId }
      ));
      // This is only a typed filter fact. The Composer model already gives
      // explicit reply/@ delivery precedence; no filter event may mutate the
      // probe owner's manual selection or call selectAgent.
    },
    onComposerEditChange: setComposerEditPort,
    onAcknowledgeAgentActivity: (agentId) => feed.acknowledgeAgentActivity(navigation.activeChannelId, agentId),
  };
  conversationPort.element = contentVisible && state && history
    ? <ConversationSurface {...conversationPort} />
    : !contentVisible && navigation.activeChannel
      ? <ChannelAccessPlaceholder access={activeAccess} composer={conversationPort.composer} />
      : <div className="boot-screen"><span className="brand-dot" />正在同步频道…</div>;
  const searchableChannels = useMemo(
    () => navigation.channels.filter((channel) => canViewChannelContent(channel.access)),
    [navigation.channels],
  );
  const searchableChannelIds = useMemo(
    () => searchableChannels.map((channel) => channel.id),
    [searchableChannels],
  );
  const searchableChannelKey = searchableChannelIds.join('\u0000');
  const searchableStates = useMemo(() => {
    const readableChannelIds = new Set(searchableChannelIds);
    return feed.stateEntries().filter(([channelId]) => readableChannelIds.has(channelId));
  }, [feed, searchableChannelIds]);
  const searchableRosters = useMemo(() => new Map(
    searchableChannels
      .filter((channel) => isMemberAccess(channel.access))
      .map((channel) => [channel.id, roster.rosters.get(channel.id) || EMPTY_ARRAY]),
  ), [roster.rosters, searchableChannels]);
  const searchIndex = useMemo(() => selectFeatureSearchIndex({
    states: searchableStates,
    channels: searchableChannels,
    rosters: searchableRosters,
    tasks: new Map([[navigation.activeChannelId, contentVisible ? taskItems : EMPTY_ARRAY]]),
    files: new Map([[navigation.activeChannelId, contentVisible ? attachments.entries : EMPTY_ARRAY]]),
  }), [attachments.entries, contentVisible, navigation.activeChannelId, searchableChannels, searchableRosters, searchableStates, taskItems]);
  const panelKind = typeof panel === 'string' ? panel : panel?.kind || '';
  const selectedActor = panelKind === 'actor' ? panel.actor : null;
  const selectedActorChannelId = panelKind === 'actor' ? panel.channelId : navigation.activeChannelId;
  const selectedActorCapability = selectedActor
    ? probes.capabilitiesFor(selectedActorChannelId).get(selectedActor.id)
    : null;
  const directory = wire.accessRef.current?.directory?.() || {
    principals: EMPTY_ARRAY,
    declarations: EMPTY_ARRAY,
    devices: EMPTY_ARRAY,
    channelTemplates: null,
    support: {},
  };
  const filesPort = {
    devices: attachments.devices,
    deviceId: attachments.deviceId,
    directory: attachments.directory,
    entries: attachments.entries,
    refreshReceipt: attachments.directoryReceipt,
    selectedKey: attachments.selectedKey,
    selectedArtifact: attachments.selectedArtifact,
    preview: attachments.artifactPreview,
    busy: attachments.filesBusy,
    uploading: attachments.filesUploading,
    error: attachments.filesError,
    recent: attachments.recentFiles,
    next: attachments.filesNext,
    scrollTop: attachments.filesScrollTop,
    canGoBack: attachments.canGoBack,
    disabled: !canWrite,
    attachDisabled: Boolean(composer.model?.editSession),
    attachDisabledReason: composer.model?.editSession
      ? '编辑已有消息时不能附加频道文件；请先完成或取消编辑。'
      : '',
    attachments: attachments.composerAttachments,
    commands: {
      back: attachments.backArtifactPreview,
      open: (channelId = navigation.activeChannelId) => {
        if (channelId !== navigation.activeChannelId) throw new TypeError('文件频道已切换');
        setPanel('');
        navigation.setActiveView('files');
        return attachments.refreshDirectory();
      },
      upload: async ({ files, directory, deviceId }) => {
        await attachments.uploadChannelFiles(files, { directory, deviceId });
        await attachments.refreshDirectory({ targetDirectory: directory, targetDeviceId: deviceId });
      },
      attach: (entry) => attachments.attach({
        resource_id: entry.resourceId,
        address: entry.resourceId,
        name: entry.name,
        media_type: entry.mediaType || 'application/octet-stream',
        size: Number(entry.size || 0),
      }),
      createDirectory: attachments.createDirectory,
      download: attachments.downloadFile,
      navigate: attachments.navigateFiles,
      loadMore: attachments.loadMoreDirectory,
      preview: (entry) => {
        const operation = attachments.previewArtifact(entry, navigation.activeChannelId);
        setPanel('artifact');
        return operation;
      },
      refresh: () => attachments.refreshDirectoryReceipt(),
      rememberScroll: attachments.rememberFilesScroll,
      remove: attachments.removeFile,
      select: attachments.setSelectedArtifact,
      selectDevice: attachments.selectDevice,
    },
  };
  const taskCapabilityPending = [...capabilities.values()].some((entry) => entry?.loading);
  const tasksPort = {
    items: taskItems,
    waiting: waitingItems,
    waitingState: state ? FEATURE_COMMAND_STATE.ready : FEATURE_COMMAND_STATE.disabled,
    waitingReason: state ? '' : '频道事实仍在同步',
    supportedWaitingControls: new Set(Object.values(FEATURE_WAITING_CONTROL)),
    roster: channelRoster,
    selfId,
    creation: canWrite && taskProviders.length
      ? { state: FEATURE_COMMAND_STATE.ready, providers: taskProviders, source: taskCreateSource }
      : {
        state: taskCapabilityPending ? FEATURE_COMMAND_STATE.disabled : FEATURE_COMMAND_STATE.unsupported,
        reason: canWrite
          ? taskCapabilityPending ? '正在确认 Agent 的 task.create 能力' : '当前频道没有 Agent 公布 task.create 能力'
          : '当前频道不可写',
        providers: taskProviders,
      },
    automation: {
      state: automationAvailable ? FEATURE_COMMAND_STATE.ready : FEATURE_COMMAND_STATE.disabled,
      reason: automationAvailable ? '' : canWrite ? 'timer.after 命令端口尚未连接' : '当前频道不可写',
    },
    commandStates: taskCommandStates,
    commands: {
      open: openTaskItem,
      openSource: ({ source }) => {
        const channelId = String(source?.channelId || '');
        if (!channelId) return false;
        const sourceChannel = navigation.channels.find((channel) => channel.id === channelId);
        if (!sourceChannel || !canViewChannelContent(sourceChannel.access)) {
          setChannelNotice('来源频道当前不可访问，未打开缓存内容。');
          return false;
        }
        navigation.select(channelId);
        navigation.setActiveView(source?.view === 'tasks' ? 'tasks' : 'conversation');
        if (typeof navigation.setFocus === 'function') navigation.setFocus(null);
        setPanel('');
        return true;
      },
      createTask: async (input) => {
        const provider = taskProviders.find((row) => row.actorId === input.providerId);
        if (!provider) throw new TypeError('任务执行者没有当前 task.create 能力事实');
        const result = await submission.send(createFeatureTaskSubmission({
          ...input,
          channelId: navigation.activeChannelId,
          providerId: provider.actorId,
          providerName: provider.name,
        }));
        navigation.setActiveView('tasks');
        return result;
      },
      openAutomation: () => setPanel('automation'),
      resolveApproval: ({ item, decision }) => submission.resolve(item.channelId, item.id, decision, {}),
      retryRecovery: ({ submission: failedSubmission }) => submission.retry(failedSubmission),
      cancelRequest: ({ item }) => submission.cancel(item.channelId, item.requestId || item.id),
      controlWaiting: ({ item, type }) => {
        const provider = channelRoster.find((row) => row.id === item.actorId);
        return submission.control(createFeatureWaitingControlSubmission({
          item,
          type,
          targetLabel: provider?.name || provider?.label || item.actorId,
        }));
      },
    },
  };
  const rosterPort = {
    rows: channelRoster,
    selfId,
    targetAuthority: waitingRosterAuthority,
    identityPending: memberVisible && (!selfId || !roster.authorities.get(navigation.activeChannelId)?.current),
    busy: roster.busy,
    selectedActor,
    actorDetail: selectedActorCapability?.describe ? {
      capabilities: [...selectedActorCapability.describe.types.values()],
    } : null,
    detailBusy: Boolean(selectedActorCapability?.loading),
    detailError: selectedActorCapability?.error?.detail || selectedActorCapability?.error?.code || '',
    disabled: !canWrite,
    commands: {
      refresh: () => roster.refresh(navigation.activeChannelId, true),
      select: (actor) => setPanel({ kind: 'actor', actor, channelId: navigation.activeChannelId }),
      describe: (actor) => probes.requestCapability(actor.id, selectedActorChannelId),
      invoke: ({ actor, type, payload, targetAuthority = waitingRosterAuthority }) => submission.control({
        channelId: selectedActorChannelId,
        text: '',
        msgType: type,
        audience: [actor.id],
        targetLabel: actor.name || actor.id,
        payload,
        controlContext: {
          source: 'feature',
          targetAuthority: targetAuthority || null,
        },
      }),
    },
  };
  const channelCreation = useMemo(() => {
    const request = channelCreationRequest;
    if (!request) return null;
    const targetId = String(request.targetId || '');
    const channel = targetId
      ? navigation.channels.find((row) => String(row?.id || '') === targetId
        && String(row?.parent_id || row?.parentId || '') === String(request.parentId || '')
        && String(row?.name || '').trim() === String(request.name || '').trim()) || null
      : null;
    const accessState = targetId ? wire.accessRef.current?.state?.(targetId) : null;
    return Object.freeze({
      requestId: request.requestId,
      parentId: request.parentId,
      name: request.name,
      accepted: request.accepted === true,
      ledger: request.ledger === true,
      observable: Boolean(channel),
      membership: accessState?.relationship === 'member',
      serving: channel?.open === true
        || channel?.serving === true
        || accessState?.runtime === 'open',
      channel,
      failed: request.failed === true,
      error: String(request.error || ''),
    });
  }, [channelCreationRequest, navigation.channels, navigation.revision, wire.accessRef]);
  useEffect(() => {
    setChannelCreationRequest((current) => current && current.parentId !== navigation.activeChannelId ? null : current);
  }, [navigation.activeChannelId]);
  const submitGovernance = ({ scope, action, payload }) => {
    if (scope !== 'channel') return Promise.reject(unavailableError('governance.space'));
    const channelId = String(payload.channelId || navigation.activeChannelId || '');
    if (action === 'update_profile') return sendGovernanceCommand(channelId, TYPES.channel.set, {
      channel_id: channelId,
      description: String(payload.description || ''),
    });
    if (action === 'create_child') {
      const templateId = String(payload.templateId || '').trim();
      let template = null;
      return (async () => {
        if (templateId) template = await requestChannelTemplate(channelId, templateId);
        if (templateId && (!template?.body || typeof template.body !== 'object' || Array.isArray(template.body))) {
          throw unavailableError('governance.channel.template.body');
        }
        const body = template?.body || {};
        return sendGovernanceCommand(channelId, TYPES.channel.create, {
          name: String(payload.name || '').trim(),
          recipe: {
            ...body,
            declarations: Array.isArray(body.declarations) ? body.declarations : [],
            profile: {
              ...(body.profile && typeof body.profile === 'object' && !Array.isArray(body.profile) ? body.profile : {}),
              ...(attachments.deviceId ? { default_storage_device_id: attachments.deviceId } : {}),
              ...(String(payload.purpose || '').trim() ? { description: String(payload.purpose).trim() } : {}),
            },
          },
          initial_actor_ids: [selfId].filter(Boolean),
        });
      })();
    }
    if (action === 'introduce_actor') {
      const human = payload.candidateType === 'principal';
      return sendGovernanceCommand(channelId, human ? TYPES.member.admit : TYPES.member.create, human
        ? { principal: payload.candidateId }
        : { decl_id: payload.candidateId });
    }
    if (action === 'remove_actor') return sendGovernanceCommand(channelId, TYPES.member.remove, { member: payload.actorId });
    if (action === 'retire') return sendGovernanceCommand(channelId, TYPES.channel.remove, { channel_id: channelId });
    return Promise.reject(unavailableError(`governance.channel.${action}`));
  };
  const governancePort = {
    channel: {
      disabled: !canWrite,
      children: navigation.channels.filter((channel) => channel.parent_id === navigation.activeChannelId),
      creation: channelCreation,
      // Templates are a directory projection only when the session owner has
      // actually supplied them. `null` keeps the unavailable distinction; the
      // governance feature must not read the space owner or invent rows.
      channelTemplates: Array.isArray(directory.channelTemplates) ? directory.channelTemplates : null,
      principals: directory.support?.principals
        ? directory.principals.filter((row) => row.id !== principalId && row.kind === 'human')
        : EMPTY_ARRAY,
      declarations: directory.support?.declarations
        ? directory.declarations.filter(isManageableDeclaration)
        : EMPTY_ARRAY,
      candidatesUnavailable: !directory.support?.principals || !directory.support?.declarations,
      roster: channelRoster,
      selfId,
      commands: {
        refresh: (kind) => {
          if (kind === 'members') return roster.refresh(navigation.activeChannelId, true);
          if (kind === 'directory') return refreshGovernanceDirectory();
          return refreshDirectoryFacts();
        },
        selectActor: (actor) => setPanel({ kind: 'actor', actor, channelId: navigation.activeChannelId }),
        listTemplates: () => requestChannelTemplateList(navigation.activeChannelId),
        getTemplate: (templateId) => requestChannelTemplate(navigation.activeChannelId, templateId),
        enterChannel: ({ channelId, view = 'conversation' } = {}) => {
          const target = String(channelId || '');
          if (!target || !navigation.channels.some((row) => row.id === target)) return false;
          const selected = navigation.select(target);
          navigation.setActiveView(view);
          setPanel('');
          return selected || navigation.activeChannelId === target;
        },
        submit: submitGovernance,
      },
    },
    space: {
      disabled: true,
      unsupported: '当前 wire/session 没有空间治理结果投影；此版本仅展示 OBS 目录，不会伪造成功。',
      devices: directory.devices.map((device) => ({
        ...device,
        attached: attachments.devices.some((row) => row.id === device.id),
      })),
      commands: {
        submit: () => Promise.reject(unavailableError('governance.space')),
      },
    },
  };
  const automationPort = {
    disabled: !canWrite,
    records: automationRecords,
    commands: {
      after: afterAutomation,
      cancel: cancelAutomation,
    },
  };
  const searchOpen = panelKind === 'search';
  useEffect(() => {
    if (!searchOpen || wire.state !== 'open') return;
    let active = true;
    let retryTimer = null;
    const interests = [];
    const acquiredChannels = new Set();
    const release = () => interests.splice(0).forEach((interest) => interest?.release?.());
    const retry = () => {
      if (!active || retryTimer != null) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        acquire();
      }, 16);
    };
    const acquire = () => {
      if (!active) return;
      const unavailable = [];
      searchableChannelKey.split('\u0000')
        .filter((channelId) => channelId
          && channelId !== navigation.activeChannelId
          && !acquiredChannels.has(channelId))
        .forEach((channelId) => {
          if (!active) return;
          try {
            const interest = feedCommands.requestBackgroundInterest(channelId, {
              intent: HISTORY_INTENT.searchContext,
            });
            if (interest) {
              acquiredChannels.add(channelId);
              interests.push(interest);
            }
            else unavailable.push(channelId);
          } catch (error) {
            if (error?.code === 'owner_unavailable') unavailable.push(channelId);
            else showError(error);
          }
        });
      if (unavailable.length) retry();
    };
    acquire();
    return () => {
      active = false;
      if (retryTimer != null) clearTimeout(retryTimer);
      retryTimer = null;
      release();
    };
  }, [feedCommands, navigation.activeChannelId, searchOpen, searchableChannelKey, showError, wire.state]);
  const openWorkspaceSource = useCallback(({ source } = {}) => {
    if (!source?.channelId) return false;
    const sourceChannel = navigation.channels.find((row) => row.id === source.channelId);
    if (!sourceChannel || !canViewChannelContent(sourceChannel.access)) {
      setChannelNotice('来源频道当前不可访问，未打开缓存内容。');
      setPanel('');
      return false;
    }
    navigation.select(source.channelId);
    navigation.setActiveView(sourceView(source));
    const focus = sourceFocus(source);
    if (typeof navigation.setFocus === 'function') navigation.setFocus(focus);
    const turn = focus?.type === 'turn'
      ? timelineTurnForRequest(feed.stateFor(source.channelId), focus.key)
      : null;
    setPanel(turn ? { kind: 'turn', channelId: source.channelId, requestId: focus.key } : '');
    return true;
  }, [feed, navigation.channels, navigation.select, navigation.setActiveView, navigation.setFocus]);
  const activityPort = useMemo(() => {
    const visibleChannels = navigation.channels.filter((channel) => canViewChannelContent(channel.access));
    const channelById = new Map(visibleChannels.map((channel) => [channel.id, channel]));
    const activities = [];
    for (const channel of visibleChannels) {
      const facts = selectFeatureTaskFacts({
        state: feed.stateFor(channel.id),
        channelId: channel.id,
        selfId: navigation.selfFor(channel.id),
        now: Date.now(),
      });
      for (const fact of facts) {
        const source = fact.source && ['approval', 'agent_run', 'task'].includes(fact.kind)
          ? { ...fact.source, workItemKey: fact.key }
          : fact.source;
        activities.push({
          ...fact,
          key: `activity:${fact.key}`,
          kindLabel: ACTIVITY_KIND_LABELS[fact.kind] || fact.kind || '动态',
          channelName: channel.qualified_name || channel.name || channel.id,
          detail: ACTIVITY_STATE_LABELS[fact.state] || fact.state || '有更新',
          source,
        });
      }
    }
    const operations = [];
    for (const channel of visibleChannels) {
      for (const turn of timelineTurns(feed.stateFor(channel.id)?.timeline || [])) {
        const operation = channelCreationOperation(turn, channel);
        if (operation) operations.push(operation);
      }
    }
    for (const [channelId, snapshot] of Object.entries(feed.agentActivity?.byChannel || {})) {
      const channel = channelById.get(channelId);
      if (!channel) continue;
      for (const entry of snapshot.active || []) {
        operations.push({
          key: `operation:${channelId}:${entry.requestId}`,
          kind: 'operation',
          kindLabel: ACTIVITY_KIND_LABELS.operation,
          title: `${entry.agentId || 'Agent'} 正在运行`,
          state: 'active',
          channelId,
          channelName: channel.qualified_name || channel.name || channel.id,
          detail: entry.type || '实时操作快照',
          updatedAt: entry.updatedAt,
          source: {
            channelId,
            view: 'conversation',
            objectType: 'turn',
            objectId: entry.requestId,
            requestId: entry.requestId,
          },
        });
      }
    }
    const byLatest = (left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
      || String(left.key).localeCompare(String(right.key));
    activities.sort(byLatest);
    operations.sort(byLatest);
    return Object.freeze({
      activities: Object.freeze(activities),
      operations: Object.freeze(operations),
      operationsUnavailable: feed.agentActivity?.connected !== true,
      commands: Object.freeze({ open: openWorkspaceSource }),
    });
  }, [feed, navigation.channels, navigation.selfFor, openWorkspaceSource]);
  const featureElement = <WorkspaceFeatures
    activeView={navigation.terminalVisible ? 'conversation' : navigation.activeView}
    channel={navigation.activeChannel}
    contentVisible={contentVisible}
    files={filesPort}
    tasks={tasksPort}
    terminal={{
      mounted: true,
      visible: navigation.terminalVisible,
      channelId: navigation.activeChannelId,
      devices: attachments.devices.filter((device) => device.online !== false),
      deviceId: attachments.deviceId,
      canWrite,
      transportOpen: wire.state === 'open',
      available: contentVisible,
      unavailable: activeAccess === 'member_unavailable',
      status: activeAccess === 'member_unavailable' ? 'unavailable' : '',
      commands: {
        close: () => navigation.setTerminalVisible(false),
        connect: (options) => ptyClient().attach(options.channelId, options),
        selectDevice: attachments.selectDevice,
      },
    }}
  />;
  const selectedTaskItem = panelKind === 'task'
    ? taskItems.find((item) => (item.key || item.id) === (panel.key || panel.item?.key || panel.item?.id)) || null
    : null;
  const selectedTurn = panelKind === 'turn'
    ? timelineTurnForRequest(feed.stateFor(panel.channelId || navigation.activeChannelId), panel.requestId || panel.key)
    : null;
  const rightPanel = panel && !searchOpen && (panelKind !== 'task' || selectedTaskItem) ? <WorkspaceRightPanel
    panel={panel}
    channel={navigation.activeChannel}
    files={filesPort}
    tasks={typeof panel === 'object' && panel.kind === 'task'
      ? { ...tasksPort, selectedItem: selectedTaskItem }
      : tasksPort}
    roster={rosterPort}
    governance={governancePort}
    automation={automationPort}
    activity={activityPort}
    turn={selectedTurn}
    onClose={() => {
      setPanel('');
      if (typeof navigation.setFocus === 'function') navigation.setFocus(null);
    }}
  /> : null;
  const overlays = <>
    <WorkspaceFeatureOverlays search={{
      open: searchOpen,
      index: searchIndex,
      commands: {
        close: () => {
          setPanel('');
          if (typeof navigation.setFocus === 'function') navigation.setFocus(null);
        },
        open: openWorkspaceSource,
      },
    }} filePicker={{
      open: Boolean(filePickerRequest),
      channel: navigation.activeChannel,
      files: filesPort,
      requestId: filePickerRequest?.id,
      onChoose: chooseChannelFile,
      onClose: () => cancelFilePicker(),
      onRequestSettled: (value, requestId) => settleFilePicker(value, { close: false, requestId }),
    }} />
    {taskCreateSource && canWrite && <TaskCreationDialog
      port={tasksPort}
      onClose={() => setTaskCreateSource(undefined)}
    />}
  </>;

  if (wire.incompatible) return <VersionIncompatible
    expectedVersion={wire.incompatible.expected_version ?? wire.incompatible.expected}
    receivedVersion={wire.incompatible.received_version ?? wire.incompatible.received}
    onRefresh={() => globalThis.location?.reload?.()}
  />;
  const visibleAgentActivity = {
    ...feed.agentActivity,
    byChannel: Object.fromEntries(Object.entries(feed.agentActivity.byChannel || {}).filter(([channelId]) => {
      const channel = navigation.channels.find((row) => row.id === channelId);
      return channel && canViewChannelContent(channel.access);
    })),
  };
  return <WorkspaceLayout
    session={{ wireState: wire.state, me: identity.principal, onLogout: identity.logout }}
    navigation={{
      channels: navigation.channels,
      activeChannelId: navigation.activeChannelId,
      activeView: navigation.activeView,
      terminalVisible: navigation.terminalVisible,
      channel: navigation.activeChannel,
      unread: Object.fromEntries(navigation.channels.map((channel) => [
        channel.id,
        canViewChannelContent(channel.access)
          ? feed.unreadFor(channel.id, navigation.selfFor(channel.id))
          : { related: 0, total: 0 },
      ])),
      agentActivity: visibleAgentActivity,
      acknowledgeAgentActivity: feed.acknowledgeAgentActivity,
      select: navigation.select,
      setActiveView: navigation.setActiveView,
      openTerminal: () => {
        if (!navigation.terminalVisible && !contentVisible) {
          setChannelNotice(ACCESS_NOTICE[activeAccess] || '当前频道不可访问。');
          return;
        }
        setPanel('');
        navigation.setTerminalVisible((value) => !value);
      },
      openAutomation: contentVisible ? () => setPanel('automation') : undefined,
      openRoster: memberVisible ? () => setPanel('roster') : undefined,
      openSearch: () => setPanel('search'),
      openActivity: () => setPanel('activity'),
      openChannelAdministration: memberVisible
        ? (initialTab = 'members') => setPanel(initialTab === 'overview'
          ? { kind: 'channel-administration', initialTab: 'overview' }
          : 'channel-administration')
        : undefined,
      openSpaceAdministration: () => setPanel('space-administration'),
    }}
    notices={{
      error: topError,
      channel: channelNotice || ACCESS_NOTICE[activeAccess] || '',
      dismissError: () => setTopError(''),
      dismissChannel: () => { if (channelNotice) setChannelNotice(''); },
    }}
    conversation={conversationPort}
    features={featureElement}
    rightPanel={rightPanel}
    overlays={overlays}
  />;
}

export function WorkspaceApp() {
  return <IdentityBoundary />;
}
