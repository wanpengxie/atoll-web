// @vitest-environment jsdom
// TC-0484 public successor: the Governance feature owns the visible member
// action, while WorkspaceApp owns the system/member wire mapping.  This test
// stays at the public typed channel port and does not recreate the removed
// channel-governance model or a second command owner.
import 'fake-indexeddb/auto';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_ACTOR_ID, TYPES } from '../src/protocol/vocab.js';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

// Keep the second case at the real composition boundary.  The visual shell,
// WorkspaceApp and WorkspaceRightPanel remain production code; only transport
// and session seams are deterministic here, so the assertion observes the
// frame emitted by the existing Composer submission owner rather than a
// hand-written governance helper.
const workspaceFixture = vi.hoisted(() => {
  const channelId = 'c0';
  const selfId = 'human:root:1';
  const workerId = 'agent:worker:1';
  const transportFrames = [];
  const submit = vi.fn(async (frame) => {
    transportFrames.push(frame);
    return { message_id: frame.id };
  });
  const accessState = {
    authorityEpoch: 1,
    relationship: 'member',
    existence: 'present',
    runtime: 'open',
    unavailable: false,
  };
  const access = {
    state: vi.fn(() => accessState),
    directory: vi.fn(() => ({
      principals: [], declarations: [], devices: [], channelTemplates: null, support: {},
    })),
  };
  const navigation = {
    activeChannelId: channelId,
    activeChannelRef: { current: channelId },
    activeChannel: { id: channelId, name: channelId, qualified_name: channelId, access: 'member_active', owner_principal: 'root' },
    channels: [{ id: channelId, name: channelId, qualified_name: channelId, access: 'member_active', owner_principal: 'root', open: true }],
    activeView: 'conversation',
    terminalVisible: false,
    revision: 0,
    focus: null,
    bump: vi.fn(),
    selfFor: vi.fn(() => selfId),
    select: vi.fn(() => true),
    setActiveView: vi.fn(),
    setActiveChannelId: vi.fn(),
    setChannels: vi.fn(),
    setTerminalVisible: vi.fn(),
    setFocus: vi.fn(),
  };
  const rosterRows = [
    { id: workerId, kind: 'agent', name: 'Worker', principal: 'worker', bound: true },
    { id: selfId, kind: 'human', name: 'Root', principal: 'root', bound: true },
  ];
  const roster = {
    rosters: new Map([[channelId, rosterRows]]),
    authorities: new Map([[channelId, {
      principalId: selfId, channelId, generation: 1, current: true,
    }]]),
    busy: false,
    refresh: vi.fn(async () => undefined),
    clearChannel: vi.fn(),
  };
  const probes = {
    capabilitiesFor: vi.fn(() => new Map()),
    requestCapability: vi.fn(async () => undefined),
    reset: vi.fn(),
    targetChanged: vi.fn(),
    pickAgent: vi.fn(),
    selectorOpened: vi.fn(),
    composerAgent: null,
    composerAgentSource: 'manual',
    requestKeys: vi.fn(() => []),
  };
  const submissionCorrelationPort = {
    markLanded: vi.fn(() => true),
    record: vi.fn(),
    reset: vi.fn(),
  };
  const feed = {
    version: 0,
    localReplicaReady: true,
    agentActivityPort: {},
    agentActivity: { connected: false, byChannel: {} },
    timerFirings: { events: [], overflow: null },
    stateFor: vi.fn(() => ({ timeline: [] })),
    stateEntries: vi.fn(() => []),
    historyFor: vi.fn(() => ({ status: 'ready', controlCurrent: true })),
    unreadFor: vi.fn(() => ({ related: 0, other: 0, pending: false, unknown: false })),
    agentActivityFor: vi.fn(() => ({ active: [], connected: false })),
    acknowledgeAgentActivity: vi.fn(),
    acknowledgeNotifications: vi.fn(),
    acknowledgeTimerFirings: vi.fn(),
    markRead: vi.fn(),
    bump: vi.fn(),
    cancel: vi.fn(() => true),
    disconnectHistory: vi.fn(() => false),
    enqueue: vi.fn(),
    focusHistory: vi.fn(),
    generationFor: vi.fn(() => 1),
    liveCheckpoint: vi.fn(),
    loadHistory: vi.fn(() => Promise.resolve()),
    pageEnd: vi.fn(),
    prepareLocalReplica: vi.fn(() => Promise.resolve()),
    reconcileIdentity: vi.fn(),
    refreshChannel: vi.fn(() => Promise.resolve()),
    requestBackgroundInterest: vi.fn(() => ({ release: vi.fn() })),
    resetPersistent: vi.fn(() => Promise.resolve()),
    resumeLocalReplica: vi.fn(() => Promise.resolve()),
    setHistoryGrants: vi.fn(),
    stopIncompatible: vi.fn(),
    reconcileFeed: vi.fn(),
    coldEntryDiagnosticsFor: vi.fn(() => ({})),
  };
  const feedSnapshot = {};
  const wire = {
    state: 'open',
    wireRef: { current: {
      submit,
      resolve: vi.fn(),
      cancel: vi.fn(),
      channelMeta: vi.fn(async () => ({ channel_id: channelId, head_seq: 0, has_rows: false })),
    } },
    rosterRef: { current: null },
    obsRef: { current: { channelActors: vi.fn(async () => ({ complete: true, items: [] })) } },
    accessRef: { current: access },
    incompatible: false,
    incompatibleEpochRef: { current: 0 },
    incompatibleRef: { current: false },
  };
  const identity = {
    booting: false,
    principal: { id: selfId, kind: 'human', name: 'Root' },
    identity: {},
    accept: vi.fn(),
    expire: vi.fn(),
    logout: vi.fn(),
  };
  const attachments = {
    devices: [], deviceId: '', directory: '', entries: [], selectedKey: '', selectedArtifact: null,
    artifactPreview: { status: 'idle' }, filesBusy: false, filesUploading: false, filesError: '', recentFiles: [],
    filesNext: null, filesScrollTop: 0, canGoBack: false, composerAttachments: [],
    attach: vi.fn(), clear: vi.fn(), downloadFile: vi.fn(() => Promise.resolve()), mutate: vi.fn(),
    directoryReceipt: { epoch: 0, channelId: '', deviceId: '', directory: '', phase: 'idle', error: '' },
    refreshDirectory: vi.fn(() => Promise.resolve()),
    refreshDirectoryReceipt: vi.fn(() => Promise.resolve({ epoch: 0, rows: [] })),
    previewArtifact: vi.fn(() => Promise.resolve()),
    reset: vi.fn(), setSelectedArtifact: vi.fn(), uploadComposerAttachments: vi.fn(() => Promise.resolve()),
    uploadChannelFiles: vi.fn(() => Promise.resolve()), backArtifactPreview: vi.fn(),
    createDirectory: vi.fn(() => Promise.resolve()), navigateFiles: vi.fn(), loadMoreDirectory: vi.fn(),
    rememberFilesScroll: vi.fn(), removeFile: vi.fn(() => Promise.resolve()), selectDevice: vi.fn(),
  };
  return {
    channelId, selfId, workerId, submit, transportFrames, access, navigation, roster, probes, feed, feedSnapshot,
    wire, identity, attachments, submissionCorrelationPort, layoutProps: null,
  };
});

vi.mock('../src/app/WorkspaceLayout.jsx', () => ({
  WorkspaceLayout: (props) => {
    workspaceFixture.layoutProps = props;
    return <div data-testid="workspace-composition">
      <button type="button" aria-label="打开频道成员管理" onClick={() => props.navigation.openChannelAdministration?.('members')}>成员管理</button>
      {props.rightPanel}
    </div>;
  },
}));
vi.mock('../src/app/hooks/useWireSession.js', () => ({
  useIdentitySession: vi.fn(() => workspaceFixture.identity),
  useWireSessionPort: vi.fn(() => workspaceFixture.wire),
  useChannelNavigation: vi.fn(() => workspaceFixture.navigation),
  useWireConnection: vi.fn(),
  readServerWorld: vi.fn(() => 'world-tc0484'),
}));
vi.mock('../src/app/hooks/useChannelRoster.js', () => ({ useChannelRoster: vi.fn(() => workspaceFixture.roster) }));
vi.mock('../src/app/hooks/useAgentProbes.js', () => ({ useAgentProbes: vi.fn(() => workspaceFixture.probes) }));
vi.mock('../src/app/hooks/useAttachmentTransactions.js', () => ({ useAttachmentTransactions: vi.fn(() => workspaceFixture.attachments) }));
vi.mock('../src/model/channel-feed-runtime.js', () => ({
  createChannelFeedRuntime: vi.fn(() => ({
    bind: () => () => {},
    mount: () => undefined,
    subscribe: () => () => {},
    getSnapshot: () => workspaceFixture.feedSnapshot,
    getOwnerSnapshot: () => workspaceFixture.feed,
  })),
}));
vi.mock('../src/model/view-session.js', () => ({ createViewSessionStore: vi.fn(() => ({})) }));
vi.mock('../src/net/pty.js', () => ({ ptyClient: vi.fn(() => ({ attach: vi.fn() })) }));
vi.mock('../src/ui/Auth.jsx', () => ({ Auth: () => null }));
vi.mock('../src/ui/VersionIncompatible.jsx', () => ({ VersionIncompatible: () => null }));
vi.mock('../src/ui/conversation/ConversationSurface.jsx', () => ({ ConversationSurface: () => null }));
vi.mock('../src/ui/composer/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, Composer: () => null };
});

const { WorkspaceApp } = await import('../src/app/WorkspaceApp.jsx');

afterEach(cleanup);

describe('TC-0484 public governance member command port', () => {
  it('emits the selected member removal as a typed channel intent', async () => {
    const submit = vi.fn().mockResolvedValue('remove-request-1');
    const refresh = vi.fn().mockResolvedValue(undefined);

    render(<ChannelAdministrationPanel
      channel={{ id: 'c0', owner_principal: 'root' }}
      initialTab="members"
      port={{
        selfId: 'human:root:1',
        roster: [
          { id: 'agent:worker:1', kind: 'agent', name: 'Worker', principal: 'worker', bound: true },
          { id: 'human:root:1', kind: 'human', name: 'Root', principal: 'root', bound: true },
        ],
        commands: { submit, refresh },
      }}
      onClose={vi.fn()}
    />);

    const worker = screen.getByText('Worker').closest('.managed-actor');
    expect(worker).toBeTruthy();
    fireEvent.click(within(worker).getByRole('button', { name: '移除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认操作' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'channel',
      action: 'remove_actor',
      payload: { channelId: 'c0', actorId: 'agent:worker:1' },
    }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('TC-0484 real Workspace governance composition', () => {
  it('maps the public member action to the system delete frame', async () => {
    render(<WorkspaceApp />);

    await waitFor(() => expect(screen.getByRole('button', { name: '打开频道成员管理' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '打开频道成员管理' }));

    const panel = await screen.findByRole('complementary', { name: '频道治理' });
    const worker = within(panel).getByText('Worker').closest('.managed-actor');
    expect(worker).toBeTruthy();
    fireEvent.click(within(worker).getByRole('button', { name: '移除' }));
    fireEvent.click(within(panel).getByRole('button', { name: '确认操作' }));

    await waitFor(() => expect(workspaceFixture.transportFrames).toHaveLength(1));
    expect(workspaceFixture.transportFrames[0]).toMatchObject({
      channel_id: workspaceFixture.channelId,
      msg_type: TYPES.member.remove,
      kind: 'request',
      audience: [SYSTEM_ACTOR_ID],
      payload: { member: workspaceFixture.workerId },
    });
    expect(workspaceFixture.submit).toHaveBeenCalledTimes(1);
  });

  it('maps the public member restart action to the canonical system restart frame', async () => {
    workspaceFixture.transportFrames.length = 0;
    workspaceFixture.submit.mockClear();

    render(<WorkspaceApp />);

    await waitFor(() => expect(screen.getByRole('button', { name: '打开频道成员管理' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '打开频道成员管理' }));

    const panel = await screen.findByRole('complementary', { name: '频道治理' });
    const worker = within(panel).getByText('Worker').closest('.managed-actor');
    expect(worker).toBeTruthy();
    fireEvent.click(within(worker).getByRole('button', { name: '重启' }));
    fireEvent.click(within(panel).getByRole('button', { name: '确认操作' }));

    await waitFor(() => expect(workspaceFixture.transportFrames).toHaveLength(1));
    expect(workspaceFixture.transportFrames[0]).toMatchObject({
      channel_id: workspaceFixture.channelId,
      msg_type: TYPES.member.restart,
      kind: 'request',
      audience: [SYSTEM_ACTOR_ID],
      payload: { member: workspaceFixture.workerId },
    });
    expect(workspaceFixture.submit).toHaveBeenCalledTimes(1);
  });
});
