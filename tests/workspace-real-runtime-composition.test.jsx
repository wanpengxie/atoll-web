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
    directory: vi.fn(() => ({ principals: [], actorDescriptions: [], devices: [], support: {} })),
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
    refreshDevices: vi.fn(() => Promise.resolve([])),
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
  async function openGovernance() {
    render(<WorkspaceApp />);
    await waitFor(() => expect(mocks.feedRuntime).toBeTruthy());
    const refresh = vi.fn().mockResolvedValue(undefined);
    mocks.connectionProps.accessActionsRef.current = { refresh, schedule: vi.fn() };
    act(() => mocks.layoutProps.navigation.openChannelAdministration('overview'));
    await waitFor(() => expect(mocks.layoutProps?.rightPanel?.props?.governance?.channel).toBeTruthy());
    return { refresh, props: mocks.layoutProps.rightPanel.props };
  }

  function submitted(msgType, predicate = () => true) {
    return mocks.transportSubmissions.filter((frame) => frame.msg_type === msgType && predicate(frame));
  }

  // 给一条已发出的请求补上请求行和终态行，让 Workspace 的治理追踪收到终态。
  async function answer(request, body, seq = 1) {
    await act(async () => {
      await mocks.feedRuntime.getSnapshot().setHistoryGrants([
        { channel_id: mocks.channelId, head_seq: seq + 1, has_rows: true },
      ], { generation: 1, boot: 'world-real', focus: mocks.channelId });
      enqueue(seq, requestEnvelope(request.id, request.msg_type));
      enqueue(seq + 1, responseEnvelope(`${request.id}-done`, request.id, request.msg_type, body));
    });
  }

  it('maps the three create starting points to system.channel.create, always bringing self', async () => {
    const { props } = await openGovernance();
    const governance = props.governance.channel;
    const create = async (payload) => {
      await act(async () => {
        await governance.commands.submit({ scope: 'channel', action: 'create_child', payload: { parentId: mocks.channelId, ...payload } });
      });
      return submitted(TYPES.channel.create, (frame) => frame.payload?.name === payload.name).at(-1)?.payload;
    };

    // 空白：没有说明就不带 description。
    expect(await create({ name: 'blank-room', purpose: '', humans: [] })).toEqual({
      name: 'blank-room', parent: mocks.channelId, humans: [mocks.principalId],
    });
    // 复制：只带 copy_from，说明随源频道的描述来；自己恒在 humans 里且不重复。
    expect(await create({ name: 'copy-room', copyFrom: 'c0.project', purpose: '会被忽略', humans: ['alice', mocks.principalId] })).toEqual({
      name: 'copy-room', parent: mocks.channelId, humans: [mocks.principalId, 'alice'], copy_from: 'c0.project',
    });
    // 挑成员：把挑出来的条目和说明写成新频道的描述。
    const entry = { name: 'writer', body: { actor: 'writer@1' }, params: { temperature: 0.3 } };
    expect(await create({ name: 'pick-room', purpose: '写作', members: [entry], humans: [] })).toEqual({
      name: 'pick-room', parent: mocks.channelId, humans: [mocks.principalId],
      description: { description: '写作', members: [entry] },
    });
    for (const frame of submitted(TYPES.channel.create)) {
      expect(frame.payload).not.toHaveProperty('recipe');
      expect(frame.payload).not.toHaveProperty('initial_actor_ids');
    }
  });

  it('maps channel governance actions to member entries, description fields and device attach', async () => {
    const { props, refresh } = await openGovernance();
    const governance = props.governance.channel;
    const run = (action, payload) => act(async () => {
      await governance.commands.submit({ scope: 'channel', action, payload: { channelId: mocks.channelId, ...payload } });
    });

    // 加成员等回复：回复里有新成员的配置 id，治理面板靠它认出名册里出现的新成员。
    let seq = 10;
    const introduce = async (payload, value) => {
      const before = submitted(TYPES.member.create).length;
      const pending = governance.commands.submit({ scope: 'channel', action: 'introduce_actor', payload: { channelId: mocks.channelId, ...payload } });
      await waitFor(() => expect(submitted(TYPES.member.create).length).toBe(before + 1));
      await answer(submitted(TYPES.member.create).at(-1), { status: 'completed', value }, seq);
      seq += 2;
      await expect(pending).resolves.toMatchObject({ config_id: value.config_id });
    };
    await introduce({ candidateType: 'description', candidateId: 'd-writer@2', name: ' writer ' }, { written: true, config_id: 'cfg-1' });
    // 名字只是显示、可以不给。
    await introduce({ candidateType: 'class', candidateId: 'codex', name: '' }, { written: true, config_id: 'cfg-2' });
    expect(submitted(TYPES.member.create).map((frame) => frame.payload)).toEqual([
      { name: 'writer', body: { actor: 'd-writer@2' } },
      { body: { class: 'codex' } },
    ]);
    await run('introduce_actor', { candidateType: 'principal', candidateId: 'alice' });
    expect(submitted(TYPES.member.admit).at(-1).payload).toEqual({ principal: 'alice' });

    // 频道设置和设备：以写成的回复为准——等终态回来才算完成。
    const settle = async (action, payload, msgType) => {
      const pending = governance.commands.submit({ scope: 'channel', action, payload: { channelId: mocks.channelId, ...payload } });
      const before = submitted(msgType).length;
      await waitFor(() => expect(submitted(msgType).length).toBeGreaterThanOrEqual(before));
      const request = submitted(msgType).at(-1);
      await answer(request, { status: 'completed', value: { written: true } }, seq);
      seq += 2;
      await expect(pending).resolves.toBeTruthy();
    };
    await settle('update_profile', { description: '新说明', serving: true }, TYPES.channel.set);
    await settle('update_profile', { serving: false }, TYPES.channel.set);
    expect(submitted(TYPES.channel.set).map((frame) => frame.payload)).toEqual([
      { channel_id: mocks.channelId, description: '新说明', serving: 1 },
      { channel_id: mocks.channelId, serving: 0 },
    ]);

    mocks.attachments.refreshDevices.mockClear();
    await settle('attach_device', { deviceId: 'laptop' }, TYPES.device.attach);
    // 挂载的终态回来后重读本频道分到的设备，治理页列表跟上。
    await waitFor(() => expect(mocks.attachments.refreshDevices).toHaveBeenCalledWith(mocks.channelId));
    mocks.attachments.refreshDevices.mockClear();
    await settle('detach_device', { deviceId: 'laptop' }, TYPES.device.detach);
    await waitFor(() => expect(mocks.attachments.refreshDevices).toHaveBeenCalledWith(mocks.channelId));
    expect(submitted(TYPES.device.attach).at(-1).payload).toEqual({ channel_id: mocks.channelId, device_id: 'laptop' });
    expect(submitted(TYPES.device.detach).at(-1).payload).toEqual({ channel_id: mocks.channelId, device_id: 'laptop' });
    // 命令自己不读目录：目录只随终态那一行刷新一次（见 channel-feed-runtime）。
    expect(refresh).not.toHaveBeenCalled();
    await expect(governance.commands.submit({ scope: 'channel', action: 'no_such_action', payload: {} })).rejects.toMatchObject({ code: 'owner_unavailable' });
  });

  it('maps space actions to actor description and device words and refreshes the directory after the terminal', async () => {
    const { props, refresh } = await openGovernance();
    const space = props.governance.space;
    expect(space.disabled).toBe(false);
    expect(space.unsupported).toBeUndefined();

    const pending = space.commands.submit({ scope: 'space', action: 'actor_description_create', payload: { name: ' reviewer ', class: 'claude ', description: ' ', params: {} } });
    await waitFor(() => expect(submitted(TYPES.actorDescription.create)).toHaveLength(1));
    const request = submitted(TYPES.actorDescription.create)[0];
    // 空的说明和参数不发。
    expect(request.payload).toEqual({ name: 'reviewer', class: 'claude' });
    refresh.mockClear();
    await answer(request, { status: 'completed', value: { ref: 'reviewer@1', version: 1 } });
    await expect(pending).resolves.toEqual({ ref: 'reviewer@1', version: 1 });
    // 命令自己不读目录，目录随终态那一行刷新。
    expect(refresh).not.toHaveBeenCalled();

    const others = [
      space.commands.submit({ scope: 'space', action: 'actor_description_create', payload: { name: 'r2', class: 'claude', description: '审稿', params: { a: 1 } } }),
      space.commands.submit({ scope: 'space', action: 'actor_description_create', payload: { id: 'd-reviewer', name: 'reviewer', class: 'claude', configurable: false } }),
      space.commands.submit({ scope: 'space', action: 'actor_description_retire', payload: { id: 'd-reviewer', version: '1' } }),
      space.commands.submit({ scope: 'space', action: 'create_device', payload: { name: ' laptop ' } }),
      space.commands.submit({ scope: 'space', action: 'retire_device', payload: { deviceId: 'device-9' } }),
    ];
    // 这几条不等终态；卸载时被拒，接住。
    for (const promise of others) promise.catch(() => {});
    await waitFor(() => expect(submitted(TYPES.device.remove)).toHaveLength(1));
    expect(submitted(TYPES.actorDescription.create).at(-2).payload).toEqual({ name: 'r2', class: 'claude', params: { a: 1 }, description: '审稿' });
    // 带 id 是给这条描述出新版本；退役按 id 和版本。
    expect(submitted(TYPES.actorDescription.create).at(-1).payload).toEqual({ id: 'd-reviewer', name: 'reviewer', class: 'claude', configurable: false });
    expect(submitted(TYPES.actorDescription.retire)[0].payload).toEqual({ id: 'd-reviewer', version: 1 });
    expect(submitted(TYPES.device.create)[0].payload).toEqual({ name: 'laptop' });
    expect(submitted(TYPES.device.remove)[0].payload).toEqual({ device_id: 'device-9' });
    await expect(space.commands.submit({ scope: 'space', action: 'channel_template_create', payload: {} })).rejects.toMatchObject({ code: 'owner_unavailable' });
  });

  it('maps the member entry and own-config editors to member.set and member.config.set', async () => {
    const { props } = await openGovernance();
    const commands = props.roster.commands;
    const actor = { id: 'agent:writer:1', kind: 'agent' };
    const pending = [
      commands.setMember({ actor, body: null, params: { temperature: null, effort: 'high' }, requires: null }),
      commands.setMember({ actor, body: { class: 'codex' }, params: {} }),
      commands.setMemberConfig({ actor, desiredHost: '', values: {} }),
      commands.setMemberConfig({ actor, values: { service: { api_key: '$global.k' } } }),
    ];
    for (const promise of pending) promise.catch(() => {});
    await waitFor(() => expect(submitted(TYPES.member.configSet)).toHaveLength(2));
    expect(submitted(TYPES.member.set).map((frame) => frame.payload)).toEqual([
      { member: 'agent:writer:1', params: { temperature: null, effort: 'high' }, requires: null },
      { member: 'agent:writer:1', body: { class: 'codex' } },
    ]);
    // desired_host 给了才发（'' = 回到 local-device）；空的 values 不发。
    expect(submitted(TYPES.member.configSet).map((frame) => frame.payload)).toEqual([
      { member: 'agent:writer:1', desired_host: '' },
      { member: 'agent:writer:1', values: { service: { api_key: '$global.k' } } },
    ]);
    for (const frame of [...submitted(TYPES.member.set), ...submitted(TYPES.member.configSet)]) {
      expect(frame.audience).toEqual(['system']);
    }
  });

  it('resolves member.config.set with its flat reply and rejects a failed one with its code', async () => {
    const { props } = await openGovernance();
    const actor = { id: 'agent:writer:1', kind: 'agent' };
    const first = props.roster.commands.setMemberConfig({ actor, values: { a: 1 } });
    await waitFor(() => expect(submitted(TYPES.member.configSet)).toHaveLength(1));
    await answer(submitted(TYPES.member.configSet)[0], { status: 'completed', member: 'writer', values: { a: 1 }, revision: 3 });
    await expect(first).resolves.toEqual({ member: 'writer', values: { a: 1 }, revision: 3 });

    const second = props.roster.commands.setMemberConfig({ actor, values: { a: 2 } });
    const secondRejection = expect(second).rejects.toMatchObject({ code: 'invalid_args', message: 'invalid_args：values must be a JSON object' });
    await waitFor(() => expect(submitted(TYPES.member.configSet)).toHaveLength(2));
    await answer(submitted(TYPES.member.configSet)[1], { status: 'failed', error_code: 'invalid_args', detail: 'values must be a JSON object' }, 3);
    await secondRejection;
  });

  // system.channel.get / system.channel.description.get 是 registrar 的空间词，
  // 终态形如 {status, value:{...}}；读出来的是 value 本身。
  it('resolves readChannel and readDescription with the registrar value, not its wrapper', async () => {
    const { props } = await openGovernance();
    const commands = props.governance.channel.commands;
    const view = { id: mocks.channelId, description: { body: { members: [], serving: 0 }, revision: 2 } };
    // 不给频道就读当前频道。
    const reading = commands.readChannel();
    await waitFor(() => expect(submitted(TYPES.channel.get)).toHaveLength(1));
    expect(submitted(TYPES.channel.get)[0].payload).toEqual({ channel_id: mocks.channelId });
    await answer(submitted(TYPES.channel.get)[0], { status: 'completed', value: view });
    await expect(reading).resolves.toEqual(view);

    // 读别的频道的描述也从当前频道的 system 发。
    const described = commands.readDescription('c0.project');
    await waitFor(() => expect(submitted(TYPES.channelDescription.get)).toHaveLength(1));
    expect(submitted(TYPES.channelDescription.get)[0].channel_id).toBe(mocks.channelId);
    expect(submitted(TYPES.channelDescription.get)[0].payload).toEqual({ channel: 'c0.project' });
    await answer(submitted(TYPES.channelDescription.get)[0], { status: 'completed', value: { body: { members: [] }, revision: 2 } }, 3);
    await expect(described).resolves.toEqual({ body: { members: [] }, revision: 2 });
  });

  it('rejects governance waiters and clears channel creation on a world reset', async () => {
    const { props } = await openGovernance();
    const governance = props.governance.channel;
    const pendingRead = governance.commands.readChannel();
    const pendingReadRejection = expect(pendingRead).rejects.toMatchObject({ code: 'governance_world_changed' });
    await waitFor(() => expect(mocks.transportSubmissions.some((frame) => frame.msg_type === TYPES.channel.get)).toBe(true));

    await act(async () => {
      await governance.commands.submit({
        scope: 'channel',
        action: 'create_child',
        payload: { name: 'reset-room', purpose: '', parentId: mocks.channelId },
      });
    });
    await waitFor(() => expect(mocks.layoutProps.rightPanel.props.governance.channel.creation).toMatchObject({
      accepted: true,
      parentId: mocks.channelId,
      name: 'reset-room',
    }));

    await act(async () => { await mocks.connectionProps.onWorldChanged(); });
    await pendingReadRejection;
    await waitFor(() => expect(mocks.layoutProps.rightPanel.props.governance.channel.creation).toBeNull());
  });

  it('binds a create result to the channel_id the reply names, never by name or parent', async () => {
    // 10-02 实体身份：新建的子频道只按回复里的 channel_id 认；名字、父频道不当判据。
    const previousChannels = mocks.navigation.channels;
    mocks.navigation.channels = [...previousChannels, {
      id: 'c0.other', name: 'requested', qualified_name: 'c0.other.requested',
      parent_id: 'c0.other', access: 'member_active', open: true,
    }];
    try {
      render(<WorkspaceApp />);
      await waitFor(() => expect(mocks.feedRuntime).toBeTruthy());
      mocks.connectionProps.accessActionsRef.current = {
        refresh: vi.fn().mockResolvedValue(undefined),
        schedule: vi.fn(),
      };
      act(() => mocks.layoutProps.navigation.openChannelAdministration('overview'));
      await waitFor(() => expect(mocks.layoutProps?.rightPanel?.props?.governance?.channel).toBeTruthy());

      const governance = mocks.layoutProps.rightPanel.props.governance.channel;
      await act(async () => {
        await governance.commands.submit({
          scope: 'channel',
          action: 'create_child',
          payload: { name: 'requested', purpose: '', parentId: mocks.channelId },
        });
      });
      await waitFor(() => expect(mocks.layoutProps.rightPanel.props.governance.channel.creation).toMatchObject({
        accepted: true,
        parentId: mocks.channelId,
        name: 'requested',
      }));
      await waitFor(() => expect(mocks.transportSubmissions.some((frame) => (
        frame.msg_type === TYPES.channel.create && frame.payload?.name === 'requested'
      ))).toBe(true));
      const request = mocks.transportSubmissions.find((frame) => (
        frame.msg_type === TYPES.channel.create && frame.payload?.name === 'requested'
      ));
      expect(request).toBeTruthy();

      await act(async () => {
        await mocks.feedRuntime.getSnapshot().setHistoryGrants([
          { channel_id: mocks.channelId, head_seq: 2, has_rows: true },
        ], { generation: 1, boot: 'world-real', focus: mocks.channelId });
        enqueue(1, requestEnvelope(request.id, TYPES.channel.create));
        enqueue(2, responseEnvelope(`${request.id}-done`, request.id, TYPES.channel.create, {
          status: 'completed',
          value: { channel_id: 'c0.other', parent_id: mocks.channelId, name: 'requested' },
        }));
      });
      await waitFor(() => expect(mocks.layoutProps.rightPanel.props.governance.channel.creation).toMatchObject({
        ledger: true,
        observable: true,
        targetId: 'c0.other',
        parentId: mocks.channelId,
        name: 'requested',
      }));
    } finally {
      mocks.navigation.channels = previousChannels;
    }
  });

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

  // Old notification contract (receipts/leases/identities); see read-position-unread.test.jsx.
  it.skip('routes an old conversation cleanup by its receipt channel after switching channels', async () => {
    const previousChannels = mocks.navigation.channels;
    const previousActiveChannelId = mocks.navigation.activeChannelId;
    const previousActiveChannel = mocks.navigation.activeChannel;
    const previousActiveRef = mocks.navigation.activeChannelRef.current;
    const nextChannel = { id: 'c1', name: 'c1', access: 'member_active' };
    const view = render(<WorkspaceApp />);
    try {
      await waitFor(() => expect(mocks.feedRuntime).toBeTruthy());
      const feed = mocks.feedRuntime.getSnapshot();
      await act(async () => {
        await feed.prepareLocalReplica(mocks.principalId, { focus: mocks.channelId });
        await feed.setHistoryGrants([
          { channel_id: mocks.channelId, head_seq: 1, has_rows: true },
        ], { generation: 1, boot: 'world-real', focus: mocks.channelId });
      });
      expect(feed.enqueue({
        channel_id: mocks.channelId,
        seq: 1,
        generation: 1,
        source: 'live',
        envelope: {
          id: 'old-surface-approval',
          channel_id: mocks.channelId,
          kind: 'request',
          type: TYPES.humanApprove,
          sender: { id: mocks.agentId, kind: 'agent' },
          audience: [mocks.humanId],
          visibility: 'public',
          payload: { body: { text: 'confirm?' } },
        },
      })).toBe(true);
      const status = feed.historyFor(mocks.channelId);
      const receipt = {
        channelId: mocks.channelId,
        authority: status.authority,
        owner: {
          channelId: mocks.channelId,
          viewKey: `${mocks.channelId}:conversation`,
          activationID: 'old-surface',
          generation: status.generation,
        },
        captured: {
          presentationRevision: status.presentationRevision,
          sourceRevision: status.presentationRevision,
          installedHighSeq: 1,
        },
        generation: status.generation,
        authorityRevision: status.notificationAuthorityRevision,
        caughtUp: true,
        atTail: true,
        following: true,
        surfaceVisible: true,
        cause: 'presented-follow',
        physicalSeq: 1,
        boundary: 1,
      };

      mocks.navigation.channels = [
        ...previousChannels,
        nextChannel,
      ];
      mocks.navigation.activeChannelId = nextChannel.id;
      mocks.navigation.activeChannel = nextChannel;
      mocks.navigation.activeChannelRef.current = nextChannel.id;
      act(() => view.rerender(<WorkspaceApp />));
      await waitFor(() => expect(mocks.layoutProps?.navigation?.activeChannelId).toBe(nextChannel.id));

      // This callback represents the old A surface unmounting after B has
      // committed. Its receipt remains the only valid channel identity.
      const beforeRejectedHighWater = feed.historyFor(mocks.channelId).notificationHighWater;
      let rejectedSettlement;
      act(() => {
        rejectedSettlement = mocks.layoutProps.conversation.onTailCaughtUp({
          ...receipt,
          authorityRevision: receipt.authorityRevision + 100,
        });
      });
      expect(rejectedSettlement).toBe(false);
      expect(feed.historyFor(mocks.channelId).notificationHighWater).toBe(beforeRejectedHighWater);

      let settlement;
      act(() => {
        settlement = mocks.layoutProps.conversation.onTailCaughtUp(receipt);
      });
      expect(settlement).toBe(1);
      expect(feed.historyFor(mocks.channelId).notificationHighWater).toBe(1);
    } finally {
      mocks.navigation.channels = previousChannels;
      mocks.navigation.activeChannelId = previousActiveChannelId;
      mocks.navigation.activeChannel = previousActiveChannel;
      mocks.navigation.activeChannelRef.current = previousActiveRef;
      view.unmount();
    }
  });

  // Old notification contract (receipts/leases/identities); see read-position-unread.test.jsx.
  it.skip('clamps a restored future cursor before Workspace exposes channel history', async () => {
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
    expect(mocks.layoutProps.navigation.unread[mocks.channelId]).toMatchObject({
      related: 0, other: 0, pending: false, unknown: false,
    });
    localStorage.removeItem(key);
  });

  it.skip('marks a probe control landed from Feed before its transport receipt, and keeps Waiting/Probe gates authoritative', async () => {
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

  it.skip('keeps a manual Composer target when ConversationSurface reports a filter fallback', async () => {
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
