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
import { SYSTEM_ACTOR_ID, TYPES } from '../protocol/vocab.js';
import { Auth } from '../ui/Auth.jsx';
import { VersionIncompatible } from '../ui/VersionIncompatible.jsx';
import { ConversationSurface } from '../ui/conversation/ConversationSurface.jsx';
import { Composer, useComposerCommands } from '../ui/composer/index.js';
import {
  WorkspaceFeatures,
  WorkspaceFeatureOverlays,
  WorkspaceRightPanel,
} from '../ui/features/index.js';

const EMPTY_ARRAY = Object.freeze([]);

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
      onRoster: forward('onRoster'),
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
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [composerEditPort, setComposerEditPort] = useState(null);
  const showError = useCallback((error) => setTopError(errorText(error)), []);
  const wire = useWireSessionPort();
  const navigation = useChannelNavigation({
    accessRef: wire.accessRef,
    rosterRef: wire.rosterRef,
    onSelect: () => { setPanel(''); setTerminalVisible(false); },
    onNotice: setChannelNotice,
  });
  const ownerToken = useMemo(() => Object.freeze({ principalId }), [principalId]);
  const rosterSinkRef = useRef(null);
  const submissionSinkRef = useRef(null);
  const accessActionsRef = useRef({});
  const probePortRef = useRef(null);
  const attachmentPortRef = useRef(null);
  const submissionPortRef = useRef(null);

  const submissionProxy = useMemo(() => Object.freeze({
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
  }), []);

  const feedBindings = useMemo(() => ({
    ownerToken,
    onRoster: (...args) => {
      const sink = rosterSinkRef.current;
      if (typeof sink !== 'function') throw unavailableError('roster.receive');
      return sink(...args);
    },
    onError: (error) => { if (!isRetiredOwnerError(error)) showError(error); },
    onChannelsDiscovered: () => navigation.bump(),
    onDirectoryInvalidated: () => {
      const schedule = accessActionsRef.current?.schedule;
      if (typeof schedule !== 'function') throw unavailableError('directory.schedule');
      return schedule();
    },
    onSubmissionFeed: (...args) => {
      const sink = submissionSinkRef.current;
      if (typeof sink !== 'function') throw unavailableError('submission.reconcileFeed');
      return sink(...args);
    },
    onAccessChanged: navigation.bump,
  }), [navigation.bump, ownerToken, showError]);
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
    disconnectHistory: (...args) => callFeed('disconnectHistory', args),
    enqueue: (...args) => callFeed('enqueue', args),
    focusHistory: (...args) => callFeed('focusHistory', args),
    generationFor: (...args) => callFeed('generationFor', args),
    liveCheckpoint: (...args) => callFeed('liveCheckpoint', args),
    loadHistory: (...args) => callFeed('loadHistory', args),
    pageEnd: (...args) => callFeed('pageEnd', args),
    prepareLocalReplica: (...args) => callFeed('prepareLocalReplica', args),
    reconcileIdentity: (...args) => callFeed('reconcileIdentity', args),
    refreshChannel: (...args) => callFeed('refreshChannel', args),
    resumeLocalReplica: (...args) => callFeed('resumeLocalReplica', args),
    setHistoryGrants: (...args) => callFeed('setHistoryGrants', args),
    stopIncompatible: (...args) => callFeed('stopIncompatible', args),
  }), [callFeed]);
  const roster = useChannelRoster({
    generationFor: feedCommands.generationFor,
    onError: showError,
    ownerToken,
    principalId,
    reconcileIdentity: feedCommands.reconcileIdentity,
    rosterRef: wire.rosterRef,
    versionIncompatibleEpochRef: wire.incompatibleEpochRef,
    versionIncompatibleRef: wire.incompatibleRef,
  });
  useLayoutEffect(() => {
    rosterSinkRef.current = roster.receive;
    return () => { if (rosterSinkRef.current === roster.receive) rosterSinkRef.current = null; };
  }, [roster.receive]);

  const channelRoster = roster.rosters.get(navigation.activeChannelId) || EMPTY_ARRAY;
  const selfId = navigation.selfFor(navigation.activeChannelId);
  const access = wire.accessRef.current?.state?.(navigation.activeChannelId) || null;
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
    rosterRef: wire.rosterRef,
    producerOwnerToken: ownerToken,
    generationFor: feedCommands.generationFor,
    serverWorld,
    onError: showError,
    onNotice: setChannelNotice,
    onFeedChanged: feedCommands.bump,
    onAccessChanged: navigation.bump,
    roster: channelRoster,
    selfId,
    access: access ? { ...access, transportOpen: wire.state === 'open' } : access,
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
    if (channelAccess?.relationship !== 'member' || channelAccess.unavailable) {
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
  const composerAttachmentPort = useMemo(() => Object.freeze({
    attach: attachments.attach,
    clear: attachments.clear,
    downloadFile: attachments.downloadFile,
    mutate: attachments.mutate,
    reset: attachments.reset,
    setSelectedArtifact: attachments.setSelectedArtifact,
    upload: attachments.uploadComposerAttachments,
  }), [
    attachments.attach,
    attachments.clear,
    attachments.downloadFile,
    attachments.mutate,
    attachments.reset,
    attachments.setSelectedArtifact,
    attachments.uploadComposerAttachments,
  ]);
  useLayoutEffect(() => {
    probePortRef.current = probes;
    attachmentPortRef.current = composerAttachmentPort;
    submissionPortRef.current = submission;
    submissionSinkRef.current = submission.reconcileFeed;
    return () => {
      if (probePortRef.current === probes) probePortRef.current = null;
      if (attachmentPortRef.current === composerAttachmentPort) attachmentPortRef.current = null;
      if (submissionPortRef.current === submission) submissionPortRef.current = null;
      if (submissionSinkRef.current === submission.reconcileFeed) submissionSinkRef.current = null;
    };
  }, [composerAttachmentPort, probes, submission, submission.reconcileFeed]);

  const resetWorldOwners = useCallback(() => {
    const resetAttachments = attachmentPortRef.current?.reset;
    const resetProbes = probePortRef.current?.reset;
    if (typeof resetAttachments !== 'function') throw unavailableError('resources.reset');
    if (typeof resetProbes !== 'function') throw unavailableError('probes.reset');
    resetAttachments();
    resetProbes();
  }, []);

  useWireConnection({
    accessActionsRef,
    activeChannelRef: navigation.activeChannelRef,
    agentActivityRef: activityRef,
    bumpAccess: navigation.bump,
    cancelFeedTask: feedCommands.cancel,
    clearRoster: roster.clear,
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
    seedRoster: roster.seed,
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
    if (wire.state === 'open') {
      void feedCommands.loadHistory(navigation.activeChannelId, {
        intent: 'initial-view',
        urgency: 'blocking',
      });
    }
    void roster.refresh(navigation.activeChannelId).catch(showError);
  }, [feedCommands, navigation.activeChannelId, roster.refresh, showError, wire.state]);

  const timerNotice = useMemo(() => {
    const firings = feed.timerFirings;
    const count = firings.events.length + Number(firings.overflow?.count || 0);
    if (!count) return null;
    const channelIds = [...new Set(firings.events.map((event) => event.channelId).filter(Boolean))];
    const labels = channelIds.map((channelId) => {
      const channel = navigation.channels.find((row) => row.id === channelId);
      return channel?.qualified_name || channel?.name || channelId;
    });
    return Object.freeze({
      revision: firings.revision,
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
  const resourceEntry = useCallback((channelId, resource) => ({
    key: `resource:${channelId}:${resource?.resource_id || resource?.resourceId || resource?.path || ''}`,
    channelId,
    resourceId: resource?.resource_id || resource?.resourceId || resource?.path || '',
    name: resource?.name || String(resource?.path || resource?.resource_id || resource?.resourceId || '').split('/').filter(Boolean).at(-1) || '文件',
    mediaType: resource?.media_type || resource?.mediaType || 'application/octet-stream',
    size: Number(resource?.size || 0),
    ...(Number.isSafeInteger(Number(resource?.line)) ? { line: Number(resource.line) } : {}),
  }), []);
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
  const conversationPort = {
    state,
    history,
    viewSessions,
    roster: channelRoster,
    waitingRosterAuthority: roster.authorities.get(navigation.activeChannelId) || null,
    selfId,
    pending: submission.pending,
    approvalStates: submission.approvalStates || {},
    capabilityIndex: capabilities,
    agentActivity: feed.agentActivityFor(navigation.activeChannelId),
    access,
    surfaceVisible: navigation.activeView === 'conversation' || terminalVisible,
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
    onComposerEditChange: setComposerEditPort,
    onAcknowledgeAgentActivity: (agentId) => feed.acknowledgeAgentActivity(navigation.activeChannelId, agentId),
  };
  conversationPort.element = state && history
    ? <ConversationSurface {...conversationPort} />
    : <div className="boot-screen"><span className="brand-dot" />正在同步频道…</div>;

  const canWrite = access?.relationship === 'member' && !access.unavailable && wire.state === 'open';
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
  const searchIndex = useMemo(() => selectFeatureSearchIndex({
    // ConversationSurface currently exposes no Reading locator port. Omitting
    // message rows keeps Search's advertised scope truthful instead of merely
    // switching channels and pretending the target message was opened.
    channels: navigation.channels,
    rosters: roster.rosters,
    tasks: new Map([[navigation.activeChannelId, taskItems]]),
    files: new Map([[navigation.activeChannelId, attachments.entries]]),
  }), [attachments.entries, navigation.activeChannelId, navigation.channels, roster.rosters, taskItems]);
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
    selectedKey: attachments.selectedArtifact?.key || '',
    selectedArtifact: attachments.selectedArtifact,
    preview: attachments.artifactPreview,
    busy: attachments.filesBusy,
    error: attachments.filesError,
    disabled: access?.relationship !== 'member',
    attachments: attachments.composerAttachments,
    commands: {
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
      preview: (entry) => {
        const operation = attachments.previewArtifact(entry, navigation.activeChannelId);
        setPanel('artifact');
        return operation;
      },
      refresh: () => attachments.refreshDirectory(),
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
      ? { state: FEATURE_COMMAND_STATE.ready, providers: taskProviders }
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
      open: (item) => { setPanel({ kind: 'task', item }); },
      createTask: (input) => {
        const provider = taskProviders.find((row) => row.actorId === input.providerId);
        if (!provider) return Promise.reject(new TypeError('任务执行者没有当前 task.create 能力事实'));
        return submission.send(createFeatureTaskSubmission({
          channelId: navigation.activeChannelId,
          providerId: provider.actorId,
          providerName: provider.name,
          ...input,
        }));
      },
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
    identityPending: !selfId || !roster.authorities.get(navigation.activeChannelId)?.current,
    busy: roster.busy,
    selectedActor,
    actorDetail: selectedActorCapability?.describe ? {
      capabilities: [...selectedActorCapability.describe.types.values()],
    } : null,
    detailBusy: Boolean(selectedActorCapability?.loading),
    detailError: selectedActorCapability?.error?.detail || selectedActorCapability?.error?.code || '',
    disabled: access?.relationship !== 'member',
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
      disabled: access?.relationship !== 'member',
      children: navigation.channels.filter((channel) => channel.parent_id === navigation.activeChannelId),
      principals: directory.support?.principals
        ? directory.principals.filter((row) => row.id !== principalId && row.kind === 'human')
        : EMPTY_ARRAY,
      declarations: directory.support?.declarations
        ? directory.declarations.filter((row) => !['registrar', 'svcactor'].includes(row.id)
          && !String(row.id).startsWith('atoll-internal:') && !String(row.id).startsWith('peer:'))
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
      actorTemplates: directory.declarations,
      channelTemplates: EMPTY_ARRAY,
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
    if (source.kind === 'message') {
      setChannelNotice('当前 Reading owner 没有公开消息定位端口；搜索不会把切换频道冒充为定位成功。');
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
      setPanel({ kind: 'task', item });
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
    activeView={terminalVisible ? 'conversation' : navigation.activeView}
    channel={navigation.activeChannel}
    contentVisible={Boolean(navigation.activeChannel)}
    files={filesPort}
    tasks={tasksPort}
    terminal={{
      mounted: true,
      visible: terminalVisible,
      channelId: navigation.activeChannelId,
      devices: attachments.devices.filter((device) => device.online !== false),
      deviceId: attachments.deviceId,
      canWrite: access?.relationship === 'member',
      commands: {
        close: () => setTerminalVisible(false),
        connect: (options) => ptyClient().attach(options.channelId, options),
        selectDevice: attachments.selectDevice,
      },
    }}
  />;
  const rightPanel = panel && !searchOpen ? <WorkspaceRightPanel
    panel={panel}
    channel={navigation.activeChannel}
    files={filesPort}
    tasks={typeof panel === 'object' && panel.kind === 'task'
      ? { ...tasksPort, selectedItem: panel.item }
      : tasksPort}
    roster={rosterPort}
    governance={governancePort}
    automation={automationPort}
    onClose={() => setPanel('')}
  /> : null;
  const overlays = <WorkspaceFeatureOverlays search={{
    open: searchOpen,
    index: searchIndex,
    commands: { close: () => setPanel(''), open: openSearchResult },
  }} />;

  if (wire.incompatible) return <VersionIncompatible
    expectedVersion={wire.incompatible.expected_version ?? wire.incompatible.expected}
    receivedVersion={wire.incompatible.received_version ?? wire.incompatible.received}
    onRefresh={() => globalThis.location?.reload?.()}
  />;
  return <WorkspaceLayout
    session={{ wireState: wire.state, me: identity.principal, onLogout: identity.logout }}
    navigation={{
      channels: navigation.channels,
      activeChannelId: navigation.activeChannelId,
      activeView: navigation.activeView,
      terminalVisible,
      channel: navigation.activeChannel,
      unread: Object.fromEntries(navigation.channels.map((channel) => [channel.id, feed.unreadFor(channel.id, navigation.selfFor(channel.id))])),
      agentActivity: feed.agentActivity,
      acknowledgeAgentActivity: feed.acknowledgeAgentActivity,
      select: navigation.select,
      setActiveView: navigation.setActiveView,
      openTerminal: () => { setPanel(''); setTerminalVisible((value) => !value); },
      openAutomation: () => setPanel('automation'),
      openRoster: () => setPanel('roster'),
      openSearch: () => setPanel('search'),
      openChannelAdministration: () => setPanel('channel-administration'),
      openSpaceAdministration: () => setPanel('space-administration'),
    }}
    notices={{ error: topError, channel: channelNotice, dismissError: () => setTopError(''), dismissChannel: () => setChannelNotice('') }}
    conversation={conversationPort}
    features={featureElement}
    rightPanel={rightPanel}
    overlays={overlays}
  />;
}

export function WorkspaceApp() {
  return <IdentityBoundary />;
}
