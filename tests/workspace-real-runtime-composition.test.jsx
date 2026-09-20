// @vitest-environment jsdom
// This is a public Workspace composition harness.  The transport/session and
// visual shell are boundaries, but Feed, Roster, AgentProbes, and Composer
// submission owners below are the production implementations.
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TYPES } from '../src/protocol/vocab.js';
import { TasksFeature } from '../src/ui/features/tasks/TasksFeature.jsx';

const mocks = vi.hoisted(() => {
  const channelId = 'c0';
  const principalId = `workspace-real-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const humanId = 'human:root:1';
  const agentId = 'agent:worker:1';
  const noOp = vi.fn(() => undefined);
  const transportSubmissions = [];
  const deferredReceipts = new Map();
  let historyRequestNumber = 0;
  const submit = vi.fn((frame) => {
    transportSubmissions.push(frame);
    if (frame.msg_type === TYPES.agentOptions) {
      return new Promise((resolve) => deferredReceipts.set(frame.id, resolve));
    }
    return Promise.resolve({ message_id: frame.id });
  });
  const obs = {
    channelActors: vi.fn(async () => ({
      complete: true,
      items: [
        {
          declared: { id: humanId, kind: 'human', name: 'Root', principal: principalId },
          actual: { measures: [{ name: 'bound', value: true }, { name: 'device_online', value: true }] },
        },
        {
          declared: { id: agentId, kind: 'agent', name: 'worker', principal: '' },
          actual: { measures: [{ name: 'bound', value: false }, { name: 'device_online', value: false }] },
        },
      ],
    })),
  };
  const access = {
    state: vi.fn(() => ({
      authorityEpoch: 1,
      relationship: 'member',
      existence: 'present',
      runtime: 'open',
      unavailable: false,
    })),
    live: vi.fn(() => false),
    directory: vi.fn(() => ({ principals: [], declarations: [], devices: [], support: {} })),
  };
  const wire = {
    state: 'open',
    wireRef: {
      current: {
        submit,
        resolve: vi.fn(),
        cancel: vi.fn(),
        historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
          historyRequestNumber += 1;
          const accepted = Promise.resolve({
            accepted: true, generation: detail.generation, channel_id: channelId,
          });
          accepted.ref = `workspace-history-${historyRequestNumber}`;
          queueMicrotask(() => {
            mocks.feedRuntime?.getSnapshot().pageEnd({
              ref: accepted.ref, channel_id: channelId, generation: detail.generation,
              rows: 0, scan_low_seq: Math.max(0, beforeSeq - 1),
              scan_high_seq: Math.max(0, beforeSeq - 1), next_before_seq: 0, has_older: false,
            });
          });
          return accepted;
        }),
        cancelHistory: vi.fn(async () => undefined),
        channelMeta: vi.fn(async () => ({ channel_id: channelId, head_seq: 0, has_rows: false })),
      },
    },
    rosterRef: { current: null },
    obsRef: { current: obs },
    accessRef: { current: access },
    incompatible: false,
    incompatibleEpochRef: { current: 0 },
    incompatibleRef: { current: false },
  };
  const navigation = {
    activeChannelId: channelId,
    activeChannelRef: { current: channelId },
    activeChannel: { id: channelId, name: channelId, access: 'member_active' },
    channels: [{ id: channelId, name: channelId, access: 'member_active' }],
    activeView: 'conversation',
    terminalVisible: false,
    revision: 0,
    bump: vi.fn(),
    selfFor: vi.fn(() => humanId),
    select: vi.fn(),
    setActiveView: vi.fn(),
    setActiveChannelId: vi.fn(),
    setChannels: vi.fn(),
    setTerminalVisible: vi.fn(),
  };
  const identity = {
    booting: false,
    principal: { id: principalId, kind: 'human', name: 'Root' },
    identity: {},
    accept: vi.fn(),
    expire: vi.fn(),
    logout: vi.fn(),
  };
  const attachments = {
    devices: [], deviceId: '', directory: null, entries: [], selectedKey: '', selectedArtifact: null,
    artifactPreview: null, filesBusy: false, filesUploading: false, filesError: '', recentFiles: [],
    filesNext: null, filesScrollTop: 0, canGoBack: false, composerAttachments: [],
    attach: noOp, clear: noOp, downloadFile: vi.fn(() => Promise.resolve()), mutate: noOp,
    directoryReceipt: { epoch: 0, channelId: '', deviceId: '', directory: '', phase: 'idle', error: '' },
    refreshDirectory: vi.fn(() => Promise.resolve()),
    refreshDirectoryReceipt: vi.fn(() => Promise.resolve({ epoch: 0, rows: [] })),
    previewArtifact: vi.fn(() => Promise.resolve()),
    reset: noOp, setSelectedArtifact: noOp, uploadComposerAttachments: vi.fn(() => Promise.resolve()),
    uploadChannelFiles: vi.fn(() => Promise.resolve()), backArtifactPreview: noOp,
    createDirectory: vi.fn(() => Promise.resolve()), navigateFiles: noOp, loadMoreDirectory: noOp,
    rememberFilesScroll: noOp, removeFile: vi.fn(() => Promise.resolve()), selectDevice: noOp,
  };
  return {
    channelId,
    principalId,
    humanId,
    agentId,
    submit,
    transportSubmissions,
    deferredReceipts,
    obs,
    access,
    wire,
    navigation,
    identity,
    attachments,
    feedRuntime: null,
    rosterResult: null,
    probeProps: null,
    probeResult: null,
    composerResult: null,
    layoutProps: null,
    connectionProps: null,
  };
});

vi.mock('../src/app/WorkspaceLayout.jsx', () => ({
  WorkspaceLayout: (props) => {
    mocks.layoutProps = props;
    return props.overlays || null;
  },
}));
vi.mock('../src/app/hooks/useWireSession.js', () => ({
  useIdentitySession: vi.fn(() => mocks.identity),
  useWireSessionPort: vi.fn(() => mocks.wire),
  useChannelNavigation: vi.fn(() => mocks.navigation),
  useWireConnection: vi.fn((props) => { mocks.connectionProps = props; }),
  readServerWorld: vi.fn(() => 'world-real'),
}));
vi.mock('../src/app/hooks/useAttachmentTransactions.js', () => ({
  useAttachmentTransactions: vi.fn(() => mocks.attachments),
}));
vi.mock('../src/model/channel-feed-runtime.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createChannelFeedRuntime: vi.fn((options) => {
      const runtime = actual.createChannelFeedRuntime(options);
      mocks.feedRuntime = runtime;
      return runtime;
    }),
  };
});
vi.mock('../src/app/hooks/useChannelRoster.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useChannelRoster: (props) => {
      const result = actual.useChannelRoster(props);
      mocks.rosterResult = result;
      return result;
    },
  };
});
vi.mock('../src/app/hooks/useAgentProbes.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAgentProbes: (props) => {
      mocks.probeProps = props;
      const result = actual.useAgentProbes(props);
      mocks.probeResult = result;
      return result;
    },
  };
});
vi.mock('../src/ui/composer/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useComposerCommands: (config) => {
      const result = actual.useComposerCommands(config);
      mocks.composerResult = result;
      return result;
    },
    Composer: () => null,
  };
});
vi.mock('../src/model/view-session.js', () => ({ createViewSessionStore: vi.fn(() => ({})) }));
vi.mock('../src/net/pty.js', () => ({ ptyClient: vi.fn(() => ({ attach: vi.fn() })) }));
vi.mock('../src/ui/Auth.jsx', () => ({ Auth: () => null }));
vi.mock('../src/ui/VersionIncompatible.jsx', () => ({ VersionIncompatible: () => null }));
vi.mock('../src/ui/conversation/ConversationSurface.jsx', () => ({ ConversationSurface: () => null }));
vi.mock('../src/ui/features/tasks/TasksFeature.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, TaskCreationDialog: () => null };
});
vi.mock('../src/ui/features/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    WorkspaceFeatures: () => null,
    WorkspaceRightPanel: () => null,
  };
});

const { WorkspaceApp } = await import('../src/app/WorkspaceApp.jsx');

function requestEnvelope(id, type = TYPES.agentAsk, audience = [mocks.agentId], sender = mocks.humanId) {
  return {
    id,
    channel_id: mocks.channelId,
    kind: 'request',
    type,
    sender: { id: sender, kind: sender === mocks.humanId ? 'human' : 'agent' },
    audience,
    visibility: 'public',
    payload: { body: { text: type === TYPES.agentAsk ? '继续工作' : '' } },
  };
}

function responseEnvelope(id, parentId, type, body) {
  return {
    id,
    channel_id: mocks.channelId,
    kind: 'response',
    type,
    parent_id: parentId,
    sender: { id: mocks.agentId, kind: 'agent' },
    audience: [mocks.humanId],
    visibility: 'public',
    payload: { body },
  };
}

function enqueue(seq, envelope, source = 'live') {
  return mocks.feedRuntime.getSnapshot().enqueue({
    channel_id: mocks.channelId,
    seq,
    generation: 1,
    source,
    envelope,
  });
}

async function makeCurrentFeed() {
  await mocks.feedRuntime.getSnapshot().setHistoryGrants([
    { channel_id: mocks.channelId, head_seq: 2, has_rows: true },
  ], { generation: 1, boot: 'world-real', focus: mocks.channelId });
  enqueue(1, requestEnvelope('waiting-1'));
  enqueue(2, responseEnvelope('waiting-progress', 'waiting-1', TYPES.agentAsk, {
    status: 'processing',
    controls: [{ word: TYPES.agentSteer }, { word: TYPES.agentInterrupt }],
  }));
  await waitFor(() => expect(mocks.rosterResult).toBeTruthy());
  await act(async () => {
    await mocks.rosterResult.refresh(mocks.channelId, true);
  });
  await waitFor(() => expect(mocks.layoutProps?.conversation?.waitingRosterAuthority).toMatchObject({
    rosterCurrent: true,
    controlCurrent: true,
    current: true,
  }));
}

afterEach(async () => {
  cleanup();
  mocks.feedRuntime?.destroy?.();
  mocks.feedRuntime = null;
  mocks.rosterResult = null;
  mocks.probeProps = null;
  mocks.probeResult = null;
  mocks.composerResult = null;
  mocks.layoutProps = null;
  mocks.connectionProps = null;
  mocks.transportSubmissions.length = 0;
  mocks.deferredReceipts.clear();
  vi.clearAllMocks();
});

describe('真实 Workspace owner composition', () => {
  it('treats an unconnected or stale wire cleanup as an idempotent no-op', async () => {
    render(<WorkspaceApp />);
    await waitFor(() => expect(mocks.feedRuntime).toBeTruthy());
    const cancel = mocks.connectionProps?.cancelFeedTask;
    expect(cancel).toBeTypeOf('function');

    expect(cancel(null, 1)).toBe(false);
    expect(cancel({ id: 'retired-wire' }, 1)).toBe(false);

    // The current owner is still allowed to reach the canonical Feed release
    // command; generation fencing decides whether that release is current.
    expect(cancel(mocks.wire.wireRef.current, 1)).toBe(false);
  });

  it('keeps cold Workspace history pending until the grant head arrives, then exposes active rows', async () => {
    const requests = [];
    const previousHistoryBefore = mocks.wire.wireRef.current.historyBefore;
    const previousCancelHistory = mocks.wire.wireRef.current.cancelHistory;
    mocks.wire.wireRef.current.historyBefore = vi.fn((channelId, beforeSeq, limit, detail) => {
      const ref = `workspace-cold-history-${requests.length + 1}`;
      requests.push({ channelId, beforeSeq, limit, ref, ...detail });
      const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
      receipt.ref = ref;
      return receipt;
    });
    mocks.wire.wireRef.current.cancelHistory = vi.fn(async () => undefined);

    try {
      render(<WorkspaceApp />);
      await waitFor(() => expect(mocks.feedRuntime).toBeTruthy());
      expect(mocks.wire.wireRef.current.historyBefore).not.toHaveBeenCalled();

      await act(async () => {
        await mocks.feedRuntime.getSnapshot().setHistoryGrants([
          { channel_id: mocks.channelId, head_seq: 844, has_rows: true },
        ], { generation: 1, boot: 'workspace-cold-history-boot', focus: mocks.channelId });
      });
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]).toMatchObject({
        channelId: mocks.channelId, beforeSeq: 845, generation: 1,
      });

      expect(mocks.feedRuntime.getSnapshot().enqueue({
        ref: requests[0].ref, channel_id: mocks.channelId, seq: 844, generation: 1,
        envelope: {
          id: 'workspace-active-844', kind: 'event', type: 'human.note', visibility: 'public',
          sender: { id: mocks.agentId, kind: 'agent' }, audience: [mocks.humanId],
          payload: { body: { text: 'active' } },
        },
      })).toBe(true);
      expect(mocks.feedRuntime.getSnapshot().pageEnd({
        ref: requests[0].ref, channel_id: mocks.channelId, generation: 1,
        rows: 1, scan_low_seq: 1, scan_high_seq: 844,
        next_before_seq: 1, has_older: true,
      })).toBe(true);
      await waitFor(() => expect(mocks.layoutProps?.conversation?.state?.rows?.has(844)).toBe(true));
      expect(mocks.layoutProps.conversation.history.status).toMatchObject({
        attached: true, generation: 1, headSeq: 844,
      });
    } finally {
      mocks.wire.wireRef.current.historyBefore = previousHistoryBefore;
      mocks.wire.wireRef.current.cancelHistory = previousCancelHistory;
    }
  });

  it('routes the conversation refresh action through the current Feed grant', async () => {
    render(<WorkspaceApp />);
    await waitFor(() => expect(mocks.feedRuntime).toBeTruthy());
    await act(async () => {
      await mocks.feedRuntime.getSnapshot().setHistoryGrants([
        { channel_id: mocks.channelId, head_seq: 0, has_rows: false },
      ], { generation: 1, boot: 'world-real', focus: mocks.channelId });
      await mocks.feedRuntime.getSnapshot().setHistoryGrants([], {
        generation: 1, boot: 'world-real', focus: mocks.channelId,
      });
    });

    await act(async () => {
      await mocks.layoutProps.conversation.history.refreshLatest();
    });
    expect(mocks.wire.wireRef.current.channelMeta).not.toHaveBeenCalled();

    await act(async () => {
      await mocks.feedRuntime.getSnapshot().setHistoryGrants([
        { channel_id: mocks.channelId, head_seq: 0, has_rows: false },
      ], { generation: 2, boot: 'world-real-next', focus: mocks.channelId });
      await mocks.layoutProps.conversation.history.refreshLatest();
    });
    expect(mocks.wire.wireRef.current.channelMeta).toHaveBeenCalledOnce();
    expect(mocks.wire.wireRef.current.channelMeta).toHaveBeenCalledWith(mocks.channelId, 2);
  });

  it('keeps revoked cache rows out of the composed Workspace conversation', async () => {
    render(<WorkspaceApp />);
    await waitFor(() => expect(mocks.feedRuntime).toBeTruthy());
    await act(async () => {
      await mocks.feedRuntime.getSnapshot().setHistoryGrants([
        { channel_id: mocks.channelId, head_seq: 0, has_rows: false },
      ], { generation: 1, boot: 'world-real', focus: mocks.channelId });
      await mocks.feedRuntime.getSnapshot().setHistoryGrants([], {
        generation: 1, boot: 'world-real', focus: mocks.channelId,
      });
    });

    const revokedRow = {
      channel_id: mocks.channelId,
      seq: 7,
      generation: 1,
      source: 'cache',
      envelope: requestEnvelope('revoked-cache-row'),
    };
    expect(mocks.feedRuntime.getSnapshot().enqueue(revokedRow)).toBe(true);
    expect(mocks.feedRuntime.getSnapshot().stateFor(mocks.channelId)?.rows.has(7)).toBe(false);

    await act(async () => {
      await mocks.feedRuntime.getSnapshot().setHistoryGrants([
        { channel_id: mocks.channelId, head_seq: 0, has_rows: false },
      ], { generation: 2, boot: 'world-real-next', focus: mocks.channelId });
    });
    expect(mocks.feedRuntime.getSnapshot().enqueue({
      ...revokedRow,
      seq: 8,
      generation: 2,
    })).toBe(true);
    expect(mocks.feedRuntime.getSnapshot().stateFor(mocks.channelId)?.rows.has(8)).toBe(true);
  });

  it('clamps a restored future cursor before Workspace exposes channel history', async () => {
    const key = ['atoll.feed-cursors.v1.', mocks.principalId, '\u0000world-real'].join('');
    localStorage.setItem(key, JSON.stringify({
      reads: { [mocks.channelId]: 999 },
      notifications: { [mocks.channelId]: 999 },
    }));
    render(<WorkspaceApp />);
    await waitFor(() => expect(mocks.feedRuntime).toBeTruthy());
    await act(async () => {
      await mocks.feedRuntime.getSnapshot().prepareLocalReplica(mocks.principalId, {
        focus: mocks.channelId,
      });
      await mocks.feedRuntime.getSnapshot().setHistoryGrants([
        { channel_id: mocks.channelId, head_seq: 40, has_rows: true },
      ], { generation: 1, boot: 'world-real', focus: mocks.channelId });
    });

    expect(mocks.layoutProps.conversation.history.status.notificationHighWater).toBe(40);
    expect(mocks.layoutProps.navigation.unread[mocks.channelId].total).toBe(0);
    localStorage.removeItem(key);
  });

  it('marks a probe control landed from Feed before its transport receipt, and keeps Waiting/Probe gates authoritative', async () => {
    render(<WorkspaceApp />);
    await waitFor(() => expect(mocks.feedRuntime).toBeTruthy());
    await makeCurrentFeed();

    const currentAuthority = mocks.layoutProps.conversation.waitingRosterAuthority;
    const waiting = mocks.layoutProps.features.props.tasks.waiting[0];
    expect(waiting.targetAuthority).toBe(currentAuthority);
    expect(currentAuthority).toMatchObject({ rosterCurrent: true, controlCurrent: true, current: true });

    const user = userEvent.setup();
    const currentTasks = render(<TasksFeature port={mocks.layoutProps.features.props.tasks} />);
    await user.click(screen.getByRole('tab', { name: /等待区/ }));
    expect(screen.getByRole('button', { name: '插入指令' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: '停止' }).disabled).toBe(false);
    currentTasks.unmount();

    // A new uncovered head revokes only Workspace's composed authority. The
    // same feature owner keeps the waiting fact readable but removes actions.
    await act(async () => {
      await mocks.feedRuntime.getSnapshot().setHistoryGrants([
        { channel_id: mocks.channelId, head_seq: 5, has_rows: true },
      ], { generation: 1, boot: 'world-real', focus: mocks.channelId });
    });
    await waitFor(() => expect(mocks.layoutProps.conversation.waitingRosterAuthority).toMatchObject({
      rosterCurrent: true,
      controlCurrent: false,
      current: false,
    }));
    const staleTasks = render(<TasksFeature port={mocks.layoutProps.features.props.tasks} />);
    await user.click(screen.getByRole('tab', { name: /等待区/ }));
    expect(screen.queryByRole('button', { name: '插入指令' })).toBeNull();
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
    staleTasks.unmount();

    await mocks.feedRuntime.getSnapshot().setHistoryGrants([
      { channel_id: mocks.channelId, head_seq: 4, has_rows: true },
    ], { generation: 1, boot: 'world-real', focus: mocks.channelId });
    const handledDescribe = new Set();
    let nextProbeSeq = 3;
    await waitFor(() => {
      for (const frame of mocks.transportSubmissions.filter((item) => item.msg_type === TYPES.describe)) {
        if (handledDescribe.has(frame.id)) continue;
        const requestSeq = nextProbeSeq;
        nextProbeSeq = requestSeq === 3 ? 100 : requestSeq + 2;
        handledDescribe.add(frame.id);
        enqueue(requestSeq, requestEnvelope(frame.id, TYPES.describe));
        enqueue(requestSeq + 1, responseEnvelope(`${frame.id}-done`, frame.id, TYPES.describe, {
          status: 'completed',
          class: 'codex',
          interfaces: ['actor', 'agent'],
          capabilities: { steer: true },
          words: {
            [TYPES.agentOptions]: {},
            [TYPES.agentContext]: {},
          },
        }));
      }
      expect(mocks.probeResult?.capabilitiesFor(mocks.channelId).get(mocks.agentId)?.describe).toBeTruthy();
    });

    act(() => {
      mocks.probeResult.pickAgent(mocks.agentId);
      mocks.probeResult.targetChanged(mocks.agentId);
    });
    await waitFor(() => expect(mocks.transportSubmissions.some((frame) => frame.msg_type === TYPES.agentOptions)).toBe(true));

    const optionsFrame = mocks.transportSubmissions.find((frame) => frame.msg_type === TYPES.agentOptions);
    const submission = mocks.composerResult.submission;
    expect(submission.submissionCorrelationPort.owns({
      channelId: mocks.channelId,
      messageId: optionsFrame.id,
    })).toBe(true);

    // This canonical live row enters the real Feed runtime while the
    // transport receipt is still unresolved. Feed must mark the Composer
    // correlation identity landed before receipt settlement can continue.
    expect(enqueue(5, requestEnvelope(optionsFrame.id, TYPES.agentOptions))).toBeTruthy();
    expect(submission.submissionCorrelationPort.landed).toContainEqual({
      channelId: mocks.channelId,
      messageId: optionsFrame.id,
    });
    expect(submission.submissionCorrelationPort.pending).not.toContainEqual({
      channelId: mocks.channelId,
      messageId: optionsFrame.id,
    });
    expect(mocks.deferredReceipts.has(optionsFrame.id)).toBe(true);

    await act(async () => {
      mocks.deferredReceipts.get(optionsFrame.id)({ message_id: optionsFrame.id });
    });
    await waitFor(() => expect(submission.submissionCorrelationPort.owns({
      channelId: mocks.channelId,
      messageId: optionsFrame.id,
    })).toBe(true));
    expect(mocks.transportSubmissions.filter((frame) => frame.id === optionsFrame.id)).toHaveLength(1);
    expect(mocks.probeProps.handleControl).toBeTypeOf('function');
  });

  it('keeps a manual Composer target when ConversationSurface reports a filter fallback', async () => {
    const previousActors = mocks.obs.channelActors.getMockImplementation();
    mocks.obs.channelActors.mockImplementation(async () => ({
      complete: true,
      items: [
        {
          declared: { id: mocks.humanId, kind: 'human', name: 'Root', principal: mocks.principalId },
          actual: { measures: [{ name: 'bound', value: true }, { name: 'device_online', value: true }] },
        },
        {
          declared: { id: mocks.agentId, kind: 'agent', name: 'worker', principal: '' },
          actual: { measures: [{ name: 'bound', value: false }, { name: 'device_online', value: false }] },
        },
        {
          declared: { id: 'agent:filter:1', kind: 'agent', name: 'filtered', principal: '' },
          actual: { measures: [{ name: 'bound', value: false }, { name: 'device_online', value: false }] },
        },
      ],
    }));
    try {
      render(<WorkspaceApp />);
      await waitFor(() => expect(mocks.feedRuntime).toBeTruthy());
      await waitFor(() => expect(mocks.layoutProps?.conversation?.roster).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'agent:filter:1', kind: 'agent' }),
      ])));

      act(() => {
        mocks.probeResult.pickAgent(mocks.agentId);
        mocks.probeResult.targetChanged(mocks.agentId);
      });
      await waitFor(() => expect(mocks.probeResult.composerAgent).toMatchObject({ actorId: mocks.agentId }));

      act(() => {
        mocks.layoutProps.conversation.onFocusAgentChange('agent:filter:1', 'filter');
      });
      await waitFor(() => expect(mocks.probeResult.composerAgent).toMatchObject({ actorId: mocks.agentId }));
    } finally {
      mocks.obs.channelActors.mockImplementation(previousActors);
    }
  });

  it('settles an invalid Files row through the public Composer picker owner without closing the dialog', async () => {
    const previousDeviceId = mocks.attachments.deviceId;
    const previousDevices = mocks.attachments.devices;
    const previousEntries = mocks.attachments.entries;
    const invalidEntry = {
      key: 'invalid-file-row',
      kind: 'file',
      name: 'missing-resource.txt',
      resourceId: '',
      mediaType: 'text/plain',
      size: 1,
    };
    mocks.attachments.deviceId = 'local-device';
    mocks.attachments.devices = [{ id: 'local-device', name: 'local-device' }];
    mocks.attachments.entries = [invalidEntry];
    try {
      render(<WorkspaceApp />);
      await waitFor(() => expect(mocks.composerResult?.commands?.pickChannelFile).toBeTypeOf('function'));
      const pick = mocks.composerResult.commands.pickChannelFile();
      await waitFor(() => expect(screen.getByRole('dialog', { name: '从频道文件选择' })).toBeTruthy());
      await userEvent.setup().click(screen.getByRole('button', { name: /missing-resource\.txt/ }));
      await expect(pick).resolves.toBeNull();
      expect(screen.getByRole('dialog', { name: '从频道文件选择' })).toBeTruthy();
    } finally {
      mocks.attachments.deviceId = previousDeviceId;
      mocks.attachments.devices = previousDevices;
      mocks.attachments.entries = previousEntries;
    }
  });

  it('does not let a stale Files error settle a new picker request before its own refresh fails', async () => {
    const previousDeviceId = mocks.attachments.deviceId;
    const previousDevices = mocks.attachments.devices;
    const previousEntries = mocks.attachments.entries;
    const previousError = mocks.attachments.filesError;
    const previousReceipt = mocks.attachments.directoryReceipt;
    const previousRefresh = mocks.attachments.refreshDirectoryReceipt;
    const refreshRejectors = [];
    const refreshDirectory = vi.fn(() => new Promise((resolve, reject) => {
      refreshRejectors.push(reject);
    }));
    mocks.attachments.deviceId = 'local-device';
    mocks.attachments.devices = [{ id: 'local-device', name: 'local-device' }];
    mocks.attachments.entries = [];
    // This error belongs to the first request and remains in the shared Files
    // projection while the Composer opens a second request.
    mocks.attachments.filesError = '旧请求失败';
    mocks.attachments.directoryReceipt = {
      epoch: 4, channelId: 'c0', deviceId: 'local-device', directory: '', phase: 'settled', error: '旧请求失败',
    };
    mocks.attachments.refreshDirectoryReceipt = refreshDirectory;
    try {
      render(<WorkspaceApp />);
      await waitFor(() => expect(mocks.composerResult?.commands?.pickChannelFile).toBeTypeOf('function'));

      const first = mocks.composerResult.commands.pickChannelFile();
      await waitFor(() => expect(refreshDirectory).toHaveBeenCalledTimes(1));
      refreshRejectors[0](new Error('首个请求刷新失败'));
      await expect(first).resolves.toBeNull();
      expect(screen.getByRole('dialog', { name: '从频道文件选择' })).toBeTruthy();

      // Close the first public picker before issuing the next command. This
      // gives the next request a distinct modal mount and keeps the sequence
      // independent of React's same-turn state batching.
      await userEvent.setup().click(screen.getByRole('button', { name: '取消' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '从频道文件选择' })).toBeNull());

      let secondSettled = false;
      const second = mocks.composerResult.commands.pickChannelFile().then((value) => {
        secondSettled = true;
        return value;
      });
      await waitFor(() => expect(refreshDirectory).toHaveBeenCalledTimes(2));
      // A global error from request 1 must not settle request 2. Its refresh
      // rejection below is the only legal completion for this request.
      await Promise.resolve();
      expect(secondSettled).toBe(false);

      refreshRejectors[1](new Error('本次刷新失败'));
      await expect(second).resolves.toBeNull();
      expect(screen.getByRole('dialog', { name: '从频道文件选择' })).toBeTruthy();
    } finally {
      for (const reject of refreshRejectors) reject(new Error('picker test cleanup'));
      mocks.attachments.deviceId = previousDeviceId;
      mocks.attachments.devices = previousDevices;
      mocks.attachments.entries = previousEntries;
      mocks.attachments.filesError = previousError;
      mocks.attachments.directoryReceipt = previousReceipt;
      mocks.attachments.refreshDirectoryReceipt = previousRefresh;
    }
  });

  it('settles the current public picker when its own directory refresh rejects', async () => {
    const previousDeviceId = mocks.attachments.deviceId;
    const previousDevices = mocks.attachments.devices;
    const previousEntries = mocks.attachments.entries;
    const previousError = mocks.attachments.filesError;
    const previousRefresh = mocks.attachments.refreshDirectoryReceipt;
    const refreshDirectory = vi.fn().mockRejectedValue(new Error('本次刷新失败'));
    mocks.attachments.deviceId = 'local-device';
    mocks.attachments.devices = [{ id: 'local-device', name: 'local-device' }];
    mocks.attachments.entries = [];
    mocks.attachments.filesError = '';
    mocks.attachments.refreshDirectoryReceipt = refreshDirectory;
    try {
      render(<WorkspaceApp />);
      await waitFor(() => expect(mocks.composerResult?.commands?.pickChannelFile).toBeTypeOf('function'));
      const pick = mocks.composerResult.commands.pickChannelFile();
      await waitFor(() => expect(refreshDirectory).toHaveBeenCalledTimes(1));
      await expect(pick).resolves.toBeNull();
      expect(screen.getByRole('dialog', { name: '从频道文件选择' })).toBeTruthy();
    } finally {
      mocks.attachments.deviceId = previousDeviceId;
      mocks.attachments.devices = previousDevices;
      mocks.attachments.entries = previousEntries;
      mocks.attachments.filesError = previousError;
      mocks.attachments.refreshDirectoryReceipt = previousRefresh;
    }
  });
});
