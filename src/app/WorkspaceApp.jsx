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
      selectedAgentId: probes.composerAgent?.actorId || '',
      ...(filterAgentSelection.channelId === navigation.activeChannelId
        && filterAgentSelection.actorId
        && filterAgentSelection.actorId === probes.composerAgent?.actorId
        ? { fallbackSource: 'filter' }
        : {}),
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
  const sendGovernanceCommand = useCallback(async (channelId, msgType, payload) => {
    const refresh = accessActionsRef.current.refresh;
    if (typeof refresh !== 'function') throw unavailableError('directory.refresh');
    const result = await sendSystemCommand(channelId, msgType, payload);
    await refresh();
    return result;
  }, [sendSystemCommand]);
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
  const cancelFilePicker = useCallback(() => {
    const request = filePickerRef.current;
    if (!request) return false;
    filePickerRef.current = null;
    setFilePickerRequest(null);
    // Closing the picker is a user cancellation, not a Composer failure. A
    // null result lets its typed caller leave the draft untouched without
    // turning an ordinary Escape/backdrop close into a red error rail.
    request.resolve(null);
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
    const resourceId = String(entry?.resourceId || entry?.resource_id || '');
    if (!resourceId || entry?.kind !== 'file') return false;
    filePickerRef.current = null;
    setFilePickerRequest(null);
    request.resolve({
      resource_id: resourceId,
      address: resourceId,
      name: String(entry.name || resourceId),
      media_type: String(entry.mediaType || entry.media_type || 'application/octet-stream'),
      size: Number(entry.size || 0),
    });
    return true;
  }, [cancelFilePicker, navigation.activeChannelId]);
  useEffect(() => {
    const request = filePickerRef.current;
    if (request && request.channelId !== navigation.activeChannelId) cancelFilePicker();
  }, [cancelFilePicker, navigation.activeChannelId]);
  useEffect(() => () => {
    const request = filePickerRef.current;
    filePickerRef.current = null;
    request?.resolve(null);
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
    const resetAttachments = attachmentPortRef.current?.reset;
    const resetProbes = probePortRef.current?.reset;
    if (typeof resetAttachments !== 'function') throw unavailableError('resources.reset');
    if (typeof resetProbes !== 'function') throw unavailableError('probes.reset');
    resetAttachments();
    resetProbes();
    setAutomationRecords(EMPTY_ARRAY);
    await feedCommands.resetPersistent();
  }, [feedCommands.resetPersistent]);

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
      feed.markRead(navigation.activeChannelId, receipt);
      feed.acknowledgeNotifications(navigation.activeChannelId, receipt);
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
      // A filter target is only a fallback. Once the draft has an explicit
      // @ recipient (or reply target), do not feed the fallback back through
      // the probe owner on every render; doing so would overwrite the draft
      // handoff and repeatedly re-authorize the same target.
      const explicitDraftTarget = composer.model.delivery?.source === 'mention'
        || composer.model.delivery?.source === 'reply';
      if (actorId && !explicitDraftTarget && actorId !== composer.model.targetAgent?.id) {
        void composer.commands.selectAgent(actorId).catch(showError);
      }
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
      refresh: () => attachments.refreshDirectory(),
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
  const submitGovernance = ({ scope, action, payload }) => {
    if (scope !== 'channel') return Promise.reject(unavailableError('governance.space'));
    const channelId = String(payload.channelId || navigation.activeChannelId || '');
    if (action === 'update_profile') return sendGovernanceCommand(channelId, TYPES.channel.set, {
      channel_id: channelId,
      description: String(payload.description || ''),
    });
    if (action === 'create_child') {
      const templateId = String(payload.templateId || '').trim();
      const template = templateId
        ? (Array.isArray(directory.channelTemplates)
          ? directory.channelTemplates.find((row) => String(row?.id || '') === templateId)
          : null)
        : null;
      if (templateId && (!template?.body || typeof template.body !== 'object' || Array.isArray(template.body))) {
        return Promise.reject(unavailableError('governance.channel.template.body'));
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
          const refresh = accessActionsRef.current.refresh;
          if (typeof refresh !== 'function') throw unavailableError('directory.refresh');
          return refresh();
        },
        selectActor: (actor) => setPanel({ kind: 'actor', actor, channelId: navigation.activeChannelId }),
        listTemplates: () => sendGovernanceCommand(navigation.activeChannelId, TYPES.channelTemplate.list, {}),
        getTemplate: (templateId) => sendGovernanceCommand(navigation.activeChannelId, TYPES.channelTemplate.get, {
          id: String(templateId || ''),
        }),
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
  const openSearchResult = (source) => {
    if (!source?.channelId) return;
    const sourceChannel = navigation.channels.find((row) => row.id === source.channelId);
    if (!sourceChannel || !canViewChannelContent(sourceChannel.access)) {
      setChannelNotice('来源频道当前不可访问，未打开缓存内容。');
      setPanel('');
      return;
    }
    if (source.kind === 'actor') {
      const actor = (roster.rosters.get(source.channelId) || EMPTY_ARRAY).find((row) => row.id === source.actorId);
      if (!actor) { setChannelNotice('该成员已不在当前名册快照中。'); return; }
      navigation.select(source.channelId);
      navigation.setActiveView('conversation');
      setPanel({ kind: 'actor', actor, channelId: source.channelId });
      return;
    }
    if (source.kind === 'task') {
      const item = taskItems.find((row) => (row.key || row.id) === source.taskId);
      if (!item) { setChannelNotice('该任务已不在当前任务事实中。'); return; }
      navigation.select(source.channelId);
      openTaskItem(item);
      return;
    }
    if (source.kind === 'file') {
      const entry = attachments.entries.find((row) => [row.resourceId, row.path, row.key].includes(source.fileId));
      if (!entry || source.channelId !== navigation.activeChannelId) {
        setChannelNotice('该文件不在当前 attachment owner 的目录快照中。');
        return;
      }
      navigation.setActiveView('files');
      void attachments.previewArtifact(entry, source.channelId);
      setPanel('artifact');
      return;
    }
    navigation.select(source.channelId);
    navigation.setActiveView('conversation');
    if (typeof navigation.setFocus === 'function') navigation.setFocus(null);
    setPanel('');
  };
  const openActivitySource = useCallback((source) => {
    if (!source?.channelId) return;
    const sourceChannel = navigation.channels.find((row) => row.id === source.channelId);
    if (!sourceChannel || !canViewChannelContent(sourceChannel.access)) {
      setChannelNotice('来源频道当前不可访问，未打开缓存内容。');
      setPanel('');
      return;
    }
    navigation.select(source.channelId);
    navigation.setActiveView(source.view === 'tasks' ? 'tasks' : 'conversation');
    if (typeof navigation.setFocus === 'function') navigation.setFocus(null);
    setPanel('');
  }, [navigation.channels, navigation.select, navigation.setActiveView, navigation.setFocus]);
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
        activities.push({
          ...fact,
          key: `activity:${fact.key}`,
          kindLabel: ACTIVITY_KIND_LABELS[fact.kind] || fact.kind || '动态',
          channelName: channel.qualified_name || channel.name || channel.id,
          detail: ACTIVITY_STATE_LABELS[fact.state] || fact.state || '有更新',
        });
      }
    }
    const operations = [];
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
            view: 'dynamic',
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
      commands: Object.freeze({ open: openActivitySource }),
    });
  }, [feed.agentActivity, feed.version, navigation.channels, navigation.selfFor, openActivitySource]);
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
        open: openSearchResult,
      },
    }} filePicker={{
      open: Boolean(filePickerRequest),
      channel: navigation.activeChannel,
      files: filesPort,
      onChoose: chooseChannelFile,
      onClose: () => cancelFilePicker(),
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
