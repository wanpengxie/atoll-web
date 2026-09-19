// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WaitingLayer } from '../src/ui/timeline/useWaitingEditingController.jsx';

const mocks = vi.hoisted(() => {
  const CHANNEL_ID = 'c0';
  const HUMAN_ID = 'human:root:1';
  const AGENT_ID = 'agent:worker:1';
  const waitingTurn = {
    requestId: 'waiting-1',
    requestSeq: 1,
    request: {
      id: 'waiting-1',
      channel_id: CHANNEL_ID,
      kind: 'request',
      type: 'agent.ask',
      sender: { id: HUMAN_ID, kind: 'human' },
      audience: [AGENT_ID],
      ts: 1,
      payload: { body: { text: '继续工作' } },
    },
    provisional: [{
      seq: 2,
      envelope: {
        id: 'waiting-1-progress',
        channel_id: CHANNEL_ID,
        kind: 'response',
        type: 'agent.ask',
        parent_id: 'waiting-1',
        ts: 2,
        payload: { body: { status: 'queued', controls: [{ word: 'agent.steer' }] } },
      },
    }],
    terminal: null,
  };
  const state = { channelId: CHANNEL_ID, rows: new Map(), timeline: [{ kind: 'turn', turn: waitingTurn }] };
  const controlCurrent = { value: true };
  const noOp = vi.fn(() => undefined);
  const submission = {
    send: vi.fn(() => Promise.resolve('send-1')),
    control: vi.fn(() => Promise.resolve('control-1')),
    resetWorld: vi.fn(),
    reconcileFeed: vi.fn(),
    submissionCorrelationPort: { owns: vi.fn(() => false), markLanded: vi.fn(() => false) },
    pending: [],
    approvalStates: {},
    controlStates: {},
    draftFor: vi.fn(() => null),
    drafts: [],
    updateDraft: noOp,
    persistDraftAttachments: noOp,
    resolve: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
    retry: vi.fn(() => Promise.resolve()),
  };
  const composer = {
    model: { editSession: null, targetAgent: null },
    commands: {
      changeDraft: noOp,
      selectAgent: vi.fn(() => Promise.resolve()),
    },
    submission,
  };
  const actor = { id: AGENT_ID, kind: 'agent', name: 'worker', bound: false };
  const probes = {
    capabilitiesFor: vi.fn(() => new Map()),
    requestCapability: vi.fn(() => Promise.resolve()),
    reset: noOp,
    composerAgent: null,
    targetChanged: noOp,
    pickAgent: noOp,
  };
  const feed = {
    version: 0,
    localReplicaReady: true,
    stateFor: vi.fn(() => state),
    historyFor: vi.fn(() => ({ controlCurrent: controlCurrent.value })),
    agentActivityPort: {},
    agentActivity: { byChannel: {} },
    agentActivityFor: vi.fn(() => []),
    timerFirings: { events: [], overflow: { count: 0, throughRevision: 0 } },
    unreadFor: vi.fn(() => ({ related: 0, total: 0 })),
    coldEntryDiagnosticsFor: vi.fn(() => ({})),
    markRead: noOp,
    acknowledgeNotifications: noOp,
    acknowledgeAgentActivity: noOp,
    acknowledgeTimerFirings: noOp,
  };
  for (const name of [
    'bump', 'cancel', 'enqueue', 'focusHistory', 'liveCheckpoint', 'loadHistory',
    'pageEnd', 'prepareLocalReplica', 'reconcileIdentity', 'refreshChannel',
    'resetPersistent', 'resumeLocalReplica', 'setHistoryGrants', 'stopIncompatible',
  ]) feed[name] = vi.fn(() => Promise.resolve());
  feed.disconnectHistory = vi.fn(() => false);
  feed.generationFor = vi.fn(() => 1);

  const feedSnapshot = {};
  const feedRuntime = {
    bind: vi.fn(() => vi.fn()),
    mount: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => feedSnapshot),
    getOwnerSnapshot: vi.fn(() => feed),
  };
  const access = {
    state: vi.fn(() => ({ relationship: 'member', existence: 'present', runtime: 'open', unavailable: false })),
    directory: vi.fn(() => ({ principals: [], declarations: [], devices: [], support: {} })),
  };
  const wire = {
    state: 'open',
    wireRef: { current: {} },
    rosterRef: { current: {} },
    obsRef: { current: {} },
    accessRef: { current: access },
    incompatible: false,
    incompatibleEpochRef: { current: 0 },
    incompatibleRef: { current: false },
  };
  const navigation = {
    activeChannelId: CHANNEL_ID,
    activeChannelRef: { current: CHANNEL_ID },
    activeChannel: { id: CHANNEL_ID, name: CHANNEL_ID, access: 'member_active' },
    channels: [{ id: CHANNEL_ID, name: CHANNEL_ID, access: 'member_active' }],
    activeView: 'conversation',
    terminalVisible: false,
    revision: 0,
    bump: vi.fn(),
    selfFor: vi.fn(() => HUMAN_ID),
    select: vi.fn(),
    setActiveView: vi.fn(),
    setActiveChannelId: vi.fn(),
    setChannels: vi.fn(),
    setTerminalVisible: vi.fn(),
  };
  const roster = {
    rosters: new Map([[CHANNEL_ID, [actor]]]),
    authorities: new Map([[CHANNEL_ID, {
      principalId: 'principal-root', channelId: CHANNEL_ID, generation: 1, current: true,
    }]]),
    busy: false,
    refresh: vi.fn(() => Promise.resolve()),
    clearChannel: vi.fn(),
  };
  const attachments = {
    devices: [], deviceId: '', directory: null, entries: [], selectedKey: '', selectedArtifact: null,
    artifactPreview: null, filesBusy: false, filesUploading: false, filesError: '', recentFiles: [],
    filesNext: null, filesScrollTop: 0, canGoBack: false, composerAttachments: [],
    attach: noOp, clear: noOp, downloadFile: vi.fn(() => Promise.resolve()), mutate: noOp,
    refreshDirectory: vi.fn(() => Promise.resolve()), previewArtifact: vi.fn(() => Promise.resolve()),
    reset: noOp, setSelectedArtifact: noOp, uploadComposerAttachments: vi.fn(() => Promise.resolve()),
    uploadChannelFiles: vi.fn(() => Promise.resolve()), backArtifactPreview: noOp,
    createDirectory: vi.fn(() => Promise.resolve()), navigateFiles: noOp, loadMoreDirectory: noOp,
    rememberFilesScroll: noOp, removeFile: vi.fn(() => Promise.resolve()), selectDevice: noOp,
  };
  return {
    CHANNEL_ID,
    HUMAN_ID,
    AGENT_ID,
    actor,
    state,
    waitingTurn,
    controlCurrent,
    submission,
    composer,
    probes,
    feed,
    feedRuntime,
    wire,
    navigation,
    roster,
    attachments,
    identity: {
      booting: false,
      principal: { id: 'principal-root', kind: 'human', name: 'Root' },
      identity: {},
      accept: vi.fn(),
      expire: vi.fn(),
      logout: vi.fn(),
    },
    probeProps: null,
    composerConfig: null,
    layoutProps: null,
  };
});

vi.mock('../src/app/WorkspaceLayout.jsx', () => ({
  WorkspaceLayout: (props) => {
    mocks.layoutProps = props;
    return null;
  },
}));
vi.mock('../src/app/hooks/useWireSession.js', () => ({
  useIdentitySession: vi.fn(() => mocks.identity),
  useWireSessionPort: vi.fn(() => mocks.wire),
  useChannelNavigation: vi.fn(() => mocks.navigation),
  useWireConnection: vi.fn(),
  readServerWorld: vi.fn(() => 'world-a'),
}));
vi.mock('../src/app/hooks/useChannelRoster.js', () => ({
  useChannelRoster: vi.fn(() => mocks.roster),
}));
vi.mock('../src/app/hooks/useAgentProbes.js', () => ({
  useAgentProbes: vi.fn((props) => {
    mocks.probeProps = props;
    return mocks.probes;
  }),
}));
vi.mock('../src/app/hooks/useAttachmentTransactions.js', () => ({
  useAttachmentTransactions: vi.fn(() => mocks.attachments),
}));
vi.mock('../src/model/channel-feed-runtime.js', () => ({
  createChannelFeedRuntime: vi.fn(() => mocks.feedRuntime),
}));
vi.mock('../src/model/view-session.js', () => ({
  createViewSessionStore: vi.fn(() => ({})),
}));
vi.mock('../src/net/pty.js', () => ({ ptyClient: vi.fn(() => ({ attach: vi.fn() })) }));
vi.mock('../src/ui/Auth.jsx', () => ({ Auth: () => null }));
vi.mock('../src/ui/VersionIncompatible.jsx', () => ({ VersionIncompatible: () => null }));
vi.mock('../src/ui/conversation/ConversationSurface.jsx', () => ({ ConversationSurface: () => null }));
vi.mock('../src/ui/composer/index.js', () => ({
  Composer: () => null,
  useComposerCommands: vi.fn((config) => {
    mocks.composerConfig = config;
    return mocks.composer;
  }),
}));
vi.mock('../src/ui/features/tasks/TasksFeature.jsx', () => ({ TaskCreationDialog: () => null }));
vi.mock('../src/ui/features/index.js', () => ({
  WorkspaceFeatures: () => null,
  WorkspaceFeatureOverlays: () => null,
  WorkspaceRightPanel: () => null,
}));

const { WorkspaceApp } = await import('../src/app/WorkspaceApp.jsx');

afterEach(() => {
  cleanup();
  mocks.controlCurrent.value = true;
  mocks.layoutProps = null;
  mocks.probeProps = null;
  mocks.composerConfig = null;
  vi.clearAllMocks();
});

function waitingLayerProps(targetAuthority) {
  return {
    turns: [mocks.waitingTurn],
    state: mocks.state,
    handoffs: [],
    names: new Map([[mocks.AGENT_ID, 'worker']]),
    selfId: mocks.HUMAN_ID,
    access: 'member_active',
    targetAuthority,
    capabilityIndex: new Map(),
    editing: null,
    onCancel: vi.fn(),
    onControl: vi.fn(),
    onEdit: vi.fn(),
  };
}

describe('public WorkspaceApp control/authority composition', () => {
  it('uses one submission.control owner and gates Waiting on both current facts', async () => {
    const view = render(<WorkspaceApp />);
    const currentAuthority = mocks.layoutProps.conversation.waitingRosterAuthority;
    const waiting = mocks.layoutProps.features.props.tasks.waiting[0];

    expect(mocks.probeProps.handleControl).toBeTypeOf('function');
    await act(async () => {
      await mocks.probeProps.handleControl({ channelId: mocks.CHANNEL_ID, msgType: 'agent.options' });
    });
    expect(mocks.submission.control).toHaveBeenCalledWith({ channelId: mocks.CHANNEL_ID, msgType: 'agent.options' });
    expect(currentAuthority).toMatchObject({ rosterCurrent: true, controlCurrent: true, current: true });
    expect(waiting.targetAuthority).toBe(currentAuthority);

    const visible = render(<WaitingLayer {...waitingLayerProps(currentAuthority)} />);
    expect(document.querySelector('.agent-wait-layer')).toBeTruthy();
    visible.unmount();

    mocks.controlCurrent.value = false;
    view.rerender(<WorkspaceApp />);
    const staleAuthority = mocks.layoutProps.conversation.waitingRosterAuthority;
    expect(staleAuthority).toMatchObject({ rosterCurrent: true, controlCurrent: false, current: false });
    expect(mocks.layoutProps.features.props.tasks.waiting[0].targetAuthority).toBe(staleAuthority);

    render(<WaitingLayer {...waitingLayerProps(staleAuthority)} />);
    expect(document.querySelector('.agent-wait-layer')).toBeNull();
  });
});
