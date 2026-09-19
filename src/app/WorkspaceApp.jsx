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
import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';
import { Auth } from '../ui/Auth.jsx';
import { VersionIncompatible } from '../ui/VersionIncompatible.jsx';
import { ConversationSurface } from '../ui/conversation/ConversationSurface.jsx';
import { Composer, useComposerCommands } from '../ui/composer/index.js';
import {
  WorkspaceFeatures,
  WorkspaceRightPanel,
} from '../ui/features/index.js';

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_MAP = new Map();
const NOOP = () => {};

function useFeedOwner({ refs, ownerToken, bindings }) {
  const runtimeRef = useRef(null);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  if (runtimeRef.current === null) {
    const forward = (name) => (...args) => bindingsRef.current[name]?.(...args);
    runtimeRef.current = createChannelFeedRuntime({
      ...refs,
      ownerToken,
      onRoster: forward('onRoster'),
      onError: forward('onError'),
      onChannelsDiscovered: forward('onChannelsDiscovered'),
      onDirectoryInvalidated: forward('onDirectoryInvalidated'),
      onTimerFired: forward('onTimerFired'),
      onSubmissionFeed: forward('onSubmissionFeed'),
      onAccessChanged: forward('onAccessChanged'),
      onAgentActivity: forward('onAgentActivity'),
    });
  }
  const runtime = runtimeRef.current;
  useLayoutEffect(() => runtime.bind({ ...bindings, ownerToken }), [bindings, ownerToken, runtime]);
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

function taskState(turn) {
  if (!turn?.terminal) return 'active';
  const status = String(argsOf(turn.terminal)?.status || 'completed');
  if (status === 'completed') return 'completed';
  return ['cancelled', 'interrupted'].includes(String(argsOf(turn.terminal)?.reason || '')) ? 'cancelled' : 'failed';
}

// Port adapter only: lifecycle truth remains in ChannelReplica and the durable
// submission owner. This projection deliberately exposes only formal tasks,
// human decisions, and failed/uncertain local submissions.
function taskFacts(state, pending, selfId) {
  const rows = [];
  for (const turn of state?.turns?.values?.() || []) {
    const request = turn.request || {};
    const payload = argsOf(request) || {};
    if (request.type === 'task.create') {
      const terminal = argsOf(turn.terminal) || {};
      const value = terminal?.value && typeof terminal.value === 'object' ? terminal.value : {};
      rows.push({
        key: `task:${turn.requestId}`,
        id: value.task_id || value.id || turn.requestId,
        channelId: state.channelId,
        kind: 'task',
        title: value.title || payload.title || payload.description || '未命名任务',
        description: payload.description || '',
        state: String(value.state || value.status || taskState(turn)),
        assigneeActorIds: [value.assignee || request.audience?.[0]].filter(Boolean),
        ownerId: request.sender?.id || '',
        createdAt: request.ts,
        updatedAt: turn.terminal?.ts || request.ts,
        actions: [],
      });
    } else if ([TYPES.humanApprove, TYPES.humanAsk].includes(request.type)) {
      const stateValue = taskState(turn);
      rows.push({
        key: `approval:${turn.requestId}`,
        id: turn.requestId,
        channelId: state.channelId,
        kind: 'approval',
        title: payload.title || payload.text || payload.detail || '待处理请求',
        state: stateValue === 'active' ? 'waiting' : stateValue,
        assigneeActorIds: request.audience || [],
        ownerId: request.sender?.id || '',
        needsYou: !turn.terminal && (request.audience || []).includes(selfId),
        createdAt: request.ts,
        updatedAt: turn.terminal?.ts || request.ts,
        actions: !turn.terminal && (request.audience || []).includes(selfId) ? ['approve', 'reject'] : [],
      });
    }
  }
  for (const item of pending || []) {
    if (item.channelId !== state?.channelId || !['uncertain', 'rejected'].includes(item.state)) continue;
    rows.push({
      key: `recovery:${item.messageId}`,
      id: item.messageId,
      channelId: item.channelId,
      kind: 'recovery',
      title: item.text || item.frame?.msg_type || '待确认的提交',
      state: item.state === 'uncertain' ? 'uncertain' : 'failed',
      ownerId: selfId,
      needsYou: true,
      waitingFor: item.error?.detail || (item.state === 'uncertain' ? '等待频道账本确认' : '等待安全重试'),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      actions: item.state === 'rejected' ? ['retry'] : [],
      submission: item,
    });
  }
  return rows;
}

function IdentityBoundary() {
  const [error, setError] = useState('');
  const onError = useCallback((reason) => setError(reason?.detail || reason?.message || String(reason)), []);
  const identity = useIdentitySession({ onError });
  if (identity.booting) return <div className="boot-screen"><span className="brand-dot" />正在启动工作区…</div>;
  if (!identity.principal) return <><Auth identity={identity.identity} onAuthed={identity.accept} />{error && <div className="top-error" role="alert">{error}</div>}</>;
  return <AuthenticatedWorkspace identity={identity} initialError={error} />;
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
  const [composerEdit, setComposerEdit] = useState(null);
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
  const deviceActionsRef = useRef({ refresh: async () => [] });
  const probePortRef = useRef({});
  const attachmentPortRef = useRef({});
  const submissionPortRef = useRef({});
  const activityRef = useRef({ attach() {}, disconnect() {}, observe() {} });

  const submissionProxy = useMemo(() => Object.freeze({
    send: (...args) => submissionPortRef.current.send?.(...args) || Promise.resolve(''),
    resetWorld: (...args) => submissionPortRef.current.resetWorld?.(...args),
  }), []);

  const feedBindings = useMemo(() => ({
    ownerToken,
    onRoster: (...args) => rosterSinkRef.current?.(...args),
    onError: (error) => { if (!isRetiredOwnerError(error)) showError(error); },
    onChannelsDiscovered: () => navigation.bump(),
    onDirectoryInvalidated: () => accessActionsRef.current.schedule?.(),
    onTimerFired: () => {},
    onSubmissionFeed: (...args) => submissionSinkRef.current?.(...args),
    onAccessChanged: navigation.bump,
    onAgentActivity: (...args) => activityRef.current.observe?.(...args),
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
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const feedCommands = useMemo(() => Object.freeze({
    bump: (...args) => feedRef.current.bump?.(...args),
    cancel: (...args) => feedRef.current.cancel?.(...args),
    disconnectHistory: (...args) => feedRef.current.disconnectHistory?.(...args),
    enqueue: (...args) => feedRef.current.enqueue?.(...args),
    focusHistory: (...args) => feedRef.current.focusHistory?.(...args),
    generationFor: (...args) => feedRef.current.generationFor?.(...args),
    liveCheckpoint: (...args) => feedRef.current.liveCheckpoint?.(...args),
    loadHistory: (...args) => feedRef.current.loadHistory?.(...args),
    pageEnd: (...args) => feedRef.current.pageEnd?.(...args),
    prepareLocalReplica: (...args) => feedRef.current.prepareLocalReplica?.(...args),
    reconcileIdentity: (...args) => feedRef.current.reconcileIdentity?.(...args),
    refreshChannel: (...args) => feedRef.current.refreshChannel?.(...args),
    resumeLocalReplica: (...args) => feedRef.current.resumeLocalReplica?.(...args),
    setHistoryGrants: (...args) => feedRef.current.setHistoryGrants?.(...args),
    stateFor: (...args) => feedRef.current.stateFor?.(...args),
    stopIncompatible: (...args) => feedRef.current.stopIncompatible?.(...args),
  }), []);
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
    stateFor: feedCommands.stateFor,
    feedVersion: feed.version,
    handleSend: submissionProxy.send,
    pending: submissionPortRef.current.pending || EMPTY_ARRAY,
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
    probes,
    channelState: feed.stateFor?.(navigation.activeChannelId),
    probesRef: probePortRef,
    attachmentRef: attachmentPortRef,
    edit: composerEdit?.channelId === navigation.activeChannelId ? composerEdit.value : null,
  });
  const submission = composer.submission || {};
  const attachments = useAttachmentTransactions({
    activeChannel: navigation.activeChannel,
    activeChannelId: navigation.activeChannelId,
    activeChannelRef: navigation.activeChannelRef,
    accessRef: wire.accessRef,
    channelDevices: EMPTY_ARRAY,
    deviceActionsRef,
    directoryVersion: navigation.revision,
    draftFor: submission.draftFor || (() => ({})),
    drafts: submission.drafts || EMPTY_MAP,
    updateDraft: submission.updateDraft || (() => {}),
    onNotice: setChannelNotice,
    onOpenDynamic: () => navigation.setActiveView('conversation'),
    obsRef: wire.obsRef,
    persistDraftAttachments: submission.persistDraftAttachments || (async () => {}),
    principalId,
    producerOwnerToken: ownerToken,
    generationFor: feedCommands.generationFor,
    serverWorld,
    wireRef: wire.wireRef,
    wireState: wire.state,
  });
  useLayoutEffect(() => {
    probePortRef.current = probes;
    attachmentPortRef.current = attachments;
    submissionPortRef.current = submission;
    submissionSinkRef.current = submission.reconcileFeed || null;
    return () => {
      if (probePortRef.current === probes) probePortRef.current = {};
      if (attachmentPortRef.current === attachments) attachmentPortRef.current = {};
      if (submissionPortRef.current === submission) submissionPortRef.current = {};
      if (submissionSinkRef.current === submission.reconcileFeed) submissionSinkRef.current = null;
    };
  }, [attachments, probes, submission.reconcileFeed]);

  const resetWorldOwners = useCallback(() => {
    attachmentPortRef.current.reset?.();
    probePortRef.current.reset?.();
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
    onSession: NOOP,
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
    void roster.refresh(navigation.activeChannelId).catch(() => {});
  }, [feedCommands, navigation.activeChannelId, roster.refresh, wire.state]);

  const viewSessions = useMemo(() => createViewSessionStore({ principalID: principalId }), [principalId]);
  const state = feed.stateFor?.(navigation.activeChannelId);
  const historyStatus = feed.historyFor?.(navigation.activeChannelId);
  const history = historyStatus ? {
    status: { ...historyStatus, localReplicaReady: feed.localReplicaReady },
    request: (request) => feedCommands.loadHistory(navigation.activeChannelId, request),
    refreshLatest: () => feedCommands.refreshChannel(navigation.activeChannelId),
    debugSnapshot: () => feed.coldEntryDiagnosticsFor?.(navigation.activeChannelId),
  } : null;
  const capabilities = probes.capabilitiesFor(navigation.activeChannelId);
  const commitComposerEdit = useCallback((value) => {
    setComposerEdit({ channelId: navigation.activeChannelId, value });
  }, [navigation.activeChannelId]);
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
    access: navigation.activeChannel?.access || 'loading',
    surfaceVisible: navigation.activeView === 'conversation' || terminalVisible,
    composer: <Composer model={composer.model} commands={composer.commands} />,
    onTailCaughtUp: (receipt) => {
      feed.markRead?.(navigation.activeChannelId, receipt);
      feed.acknowledgeNotifications?.(navigation.activeChannelId, receipt);
    },
    onResolve: submission.resolve,
    onCancel: submission.cancel,
    onTaskControl: submission.control,
    onRequestCapability: probes.requestCapability,
    onComposerEditChange: commitComposerEdit,
  };
  conversationPort.element = state && history
    ? <ConversationSurface {...conversationPort} />
    : <div className="boot-screen"><span className="brand-dot" />正在同步频道…</div>;

  const taskItems = useMemo(
    () => taskFacts(state, submission.pending || EMPTY_ARRAY, selfId),
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
        await attachments.upload(files, { directory, deviceId });
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
    items: taskItems,
    waiting: taskItems.filter((item) => item.state === 'waiting' && item.kind !== 'approval'),
    roster: channelRoster,
    selfId,
    canWrite: access?.relationship === 'member',
    commands: {
      control: ({ action, item }) => {
        if (action === 'approve' || action === 'reject') return submission.resolve?.(item.channelId, item.id, action, {});
        if (action === 'retry' && item.submission) return submission.retry?.(item.submission);
        if (action === 'cancel') return submission.cancel?.(item.channelId, item.id);
        return undefined;
      },
      open: (item) => { setPanel({ kind: 'task', item }); },
    },
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
      unread: Object.fromEntries(navigation.channels.map((channel) => [channel.id, feed.unreadFor?.(channel.id, navigation.selfFor(channel.id)) || {}])),
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
