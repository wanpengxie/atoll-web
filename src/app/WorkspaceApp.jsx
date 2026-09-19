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

function canViewChannelContent(access) {
  return CONTENT_ACCESS.has(access);
}

function isMemberAccess(access) {
  return MEMBER_ACCESS.has(access);
}

function ChannelAccessPlaceholder({ access, label = '频道内容' }) {
  const loading = access === 'loading';
  const detail = ACCESS_NOTICE[access] || '当前频道不可访问。';
  return <section className="channel-private-empty dynamic-private-empty" role={loading ? 'status' : 'region'} aria-label={label}>
    <strong>{loading ? `正在准备${label}…` : `${label}不可访问`}</strong>
    <p>{detail}{!loading && access !== 'retired' ? '当前页面不会展示或搜索此前缓存的消息、产物、任务和成员。' : ''}</p>
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
  const [taskCreateSource, setTaskCreateSource] = useState(undefined);
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
    cancel: (...args) => callFeed('cancel', args),
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
    resetPersistent: (...args) => callFeed('resetPersistent', args),
    resumeLocalReplica: (...args) => callFeed('resumeLocalReplica', args),
    setHistoryGrants: (...args) => callFeed('setHistoryGrants', args),
    stopIncompatible: (...args) => callFeed('stopIncompatible', args),
  }), [callFeed]);
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
    agentSelection: { selectedAgentId: probes.composerAgent?.actorId || '' },
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
  const composerAttachmentPort = useMemo(() => Object.freeze({
    attach: attachments.attach,
    clear: attachments.clear,
    downloadFile: attachments.downloadFile,
    mutate: attachments.mutate,
    openFiles: (channelId) => {
      if (channelId !== navigation.activeChannelId) throw new TypeError('Composer 频道已切换');
      setPanel('');
      navigation.setActiveView('files');
      return attachments.refreshDirectory();
    },
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
    attachments.refreshDirectory,
    attachments.reset,
    attachments.setSelectedArtifact,
    attachments.uploadComposerAttachments,
    navigation.activeChannelId,
    navigation.setActiveView,
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
  }), [feed.version, selfId, state, submission.pending, taskActionFacts]);
  const waitingItems = useMemo(() => selectFeatureWaitingFacts({
    state,
    pending: submission.pending,
    actionFacts: taskActionFacts,
  }), [feed.version, state, submission.pending, taskActionFacts]);
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
    setPanel({ kind: 'task', key: item.key || item.id });
    return item;
  }, [taskItems]);
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
    onFocusAgentChange: (actorId) => {
      if (actorId && actorId !== composer.model.targetAgent?.id) {
        void composer.commands.selectAgent(actorId).catch(showError);
      }
    },
    onComposerEditChange: setComposerEditPort,
    onAcknowledgeAgentActivity: (agentId) => feed.acknowledgeAgentActivity(navigation.activeChannelId, agentId),
  };
  conversationPort.element = contentVisible && state && history
    ? <ConversationSurface {...conversationPort} />
    : !contentVisible && navigation.activeChannel
      ? <ChannelAccessPlaceholder access={activeAccess} />
      : <div className="boot-screen"><span className="brand-dot" />正在同步频道…</div>;
  const searchableChannels = useMemo(
    () => navigation.channels.filter((channel) => canViewChannelContent(channel.access)),
    [navigation.channels],
  );
  const searchableRosters = useMemo(() => new Map(
    searchableChannels
      .filter((channel) => isMemberAccess(channel.access))
      .map((channel) => [channel.id, roster.rosters.get(channel.id) || EMPTY_ARRAY]),
  ), [roster.rosters, searchableChannels]);
  const searchIndex = useMemo(() => selectFeatureSearchIndex({
    channels: searchableChannels,
    rosters: searchableRosters,
    tasks: new Map([[navigation.activeChannelId, contentVisible ? taskItems : EMPTY_ARRAY]]),
    files: new Map([[navigation.activeChannelId, contentVisible ? attachments.entries : EMPTY_ARRAY]]),
  }), [attachments.entries, contentVisible, navigation.activeChannelId, searchableChannels, searchableRosters, taskItems]);
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
      state: FEATURE_COMMAND_STATE.unsupported,
      reason: '当前 submission owner 未提供可靠的自动动作生命周期',
    },
    commandStates: taskCommandStates,
    commands: {
      open: (item) => { setPanel({ kind: 'task', key: item.key || item.id }); },
      createTask: (input) => {
        const provider = taskProviders.find((row) => row.actorId === input.providerId);
        if (!provider) return Promise.reject(new TypeError('任务执行者没有当前 task.create 能力事实'));
        return submission.send(createFeatureTaskSubmission({
          ...input,
          channelId: navigation.activeChannelId,
          providerId: provider.actorId,
          providerName: provider.name,
        }));
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
      invoke: ({ actor, type, payload }) => submission.send({
        channelId: selectedActorChannelId,
        text: '',
        msgType: type,
        audience: [actor.id],
        targetLabel: actor.name || actor.id,
        payload,
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
    if (action === 'create_child') return sendGovernanceCommand(channelId, TYPES.channel.create, {
      name: String(payload.name || '').trim(),
      recipe: {
        declarations: [],
        profile: {
          ...(attachments.deviceId ? { default_storage_device_id: attachments.deviceId } : {}),
          description: String(payload.purpose || ''),
        },
      },
      initial_actor_ids: [selfId].filter(Boolean),
    });
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
    commands: {
      after: ({ channelId, durationMs, msgType, payload }) => {
        const channelAccess = wire.accessRef.current?.state?.(channelId);
        const command = wire.wireRef.current?.after;
        if (!canWrite || channelAccess?.relationship !== 'member' || typeof command !== 'function') {
          return Promise.reject(unavailableError('timer.after'));
        }
        return command({ channel_id: channelId, duration_ms: durationMs, msg_type: msgType, payload });
      },
      cancel: ({ channelId, timerId }) => {
        const channelAccess = wire.accessRef.current?.state?.(channelId);
        const command = wire.wireRef.current?.cancelTimer;
        if (!canWrite || channelAccess?.relationship !== 'member' || typeof command !== 'function') {
          return Promise.reject(unavailableError('timer.cancel'));
        }
        return command({ channel_id: channelId, timer_id: timerId });
      },
    },
  };
  const searchOpen = panelKind === 'search';
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
      navigation.setActiveView('tasks');
      setPanel({ kind: 'task', key: item.key || item.id });
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
    setPanel('');
  };
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
    onClose={() => setPanel('')}
  /> : null;
  const overlays = <>
    <WorkspaceFeatureOverlays search={{
      open: searchOpen,
      index: searchIndex,
      commands: { close: () => setPanel(''), open: openSearchResult },
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
      openChannelAdministration: memberVisible ? () => setPanel('channel-administration') : undefined,
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
