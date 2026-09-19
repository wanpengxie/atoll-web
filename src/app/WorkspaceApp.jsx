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
import { diagnostic } from '../model/diagnostics.js';
import { selectFeatureTaskFacts } from '../model/feature-tasks.js';
import { Auth } from '../ui/Auth.jsx';
import { VersionIncompatible } from '../ui/VersionIncompatible.jsx';
import { ConversationSurface } from '../ui/conversation/ConversationSurface.jsx';
import { Composer, useComposerCommands } from '../ui/composer/index.js';
import {
  WorkspaceFeatures,
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
  const deviceActionsRef = useRef({ refresh: () => Promise.reject(unavailableError('resources.devices')) });
  const probePortRef = useRef(null);
  const attachmentPortRef = useRef(null);
  const submissionPortRef = useRef(null);
  const unavailableReportsRef = useRef(new Set());
  const reportUnavailable = useCallback((portName) => {
    if (unavailableReportsRef.current.has(portName)) return false;
    unavailableReportsRef.current.add(portName);
    diagnostic('warn', 'workspace.owner_unavailable', { port: portName, principalId });
    return false;
  }, [principalId]);
  const unavailableSessionObserver = useCallback(() => reportUnavailable('session.observer'), [reportUnavailable]);

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
    pending: submissionPortRef.current?.pending || EMPTY_ARRAY,
    rosterRef: wire.rosterRef,
    rosters: roster.rosters,
    wireState: wire.state,
  });
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
    channelState: feed.stateFor(navigation.activeChannelId),
    probesRef: probePortRef,
    attachmentRef: attachmentPortRef,
  });
  const submission = composer.submission;
  const attachments = useAttachmentTransactions({
    activeChannel: navigation.activeChannel,
    activeChannelId: navigation.activeChannelId,
    activeChannelRef: navigation.activeChannelRef,
    accessRef: wire.accessRef,
    deviceActionsRef,
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
    onSession: unavailableSessionObserver,
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
  const capabilities = probes.capabilitiesFor(navigation.activeChannelId);
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
    const command = attachmentPortRef.current?.setSelectedArtifact;
    if (typeof command !== 'function') throw unavailableError('resources.preview');
    command(artifact);
    setPanel('artifact');
  }, [resourceEntry]);
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
    pending: submission.pending || EMPTY_ARRAY,
    approvalStates: submission.approvalStates || {},
    controlStates: submission.controlStates || {},
    capabilityIndex: capabilities,
    agentActivity: feed.agentActivityFor(navigation.activeChannelId),
    access: navigation.activeChannel?.access || 'loading',
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
    onAcknowledgeAgentActivity: (agentId) => feed.acknowledgeAgentActivity(navigation.activeChannelId, agentId),
  };
  conversationPort.element = state && history
    ? <ConversationSurface {...conversationPort} />
    : <div className="boot-screen"><span className="brand-dot" />正在同步频道…</div>;

  const taskItems = useMemo(
    () => selectFeatureTaskFacts({ state, pending: submission.pending, selfId }),
    [feed.version, selfId, state, submission.pending],
  );
  const filesPort = {
    devices: attachments.devices,
    deviceId: attachments.deviceId,
    directory: attachments.directory,
    entries: attachments.entries,
    selectedKey: attachments.selectedArtifact?.key || '',
    selectedArtifact: attachments.selectedArtifact,
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
      preview: (entry) => { attachments.setSelectedArtifact(entry); setPanel('artifact'); },
      refresh: () => attachments.refreshDirectory(),
      remove: attachments.removeFile,
      select: attachments.setSelectedArtifact,
      selectDevice: attachments.selectDevice,
    },
  };
  const tasksPort = {
    available: true,
    items: taskItems,
    waitingAvailable: false,
    roster: channelRoster,
    selfId,
    canWrite: access?.relationship === 'member',
    commands: { open: (item) => { setPanel({ kind: 'task', item }); } },
  };
  const rosterPort = {
    rows: channelRoster,
    selfId,
    busy: roster.busy,
    commands: { refresh: () => roster.refresh(navigation.activeChannelId, true) },
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
  const rightPanel = panel ? <WorkspaceRightPanel
    panel={panel}
    channel={navigation.activeChannel}
    files={filesPort}
    tasks={typeof panel === 'object' && panel.kind === 'task'
      ? { ...tasksPort, selectedItem: panel.item }
      : tasksPort}
    roster={rosterPort}
    onClose={() => setPanel('')}
  /> : null;

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
      openRoster: () => setPanel('roster'),
    }}
    notices={{ error: topError, channel: channelNotice, dismissError: () => setTopError(''), dismissChannel: () => setChannelNotice('') }}
    conversation={conversationPort}
    features={featureElement}
    rightPanel={rightPanel}
  />;
}

export function WorkspaceApp() {
  return <IdentityBoundary />;
}
