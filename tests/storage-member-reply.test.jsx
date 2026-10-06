// @vitest-environment jsdom
// The page reads a stored file (oss://) through the host channel's storage
// seat: WorkspaceApp finds the seat, asks it storage.get_url, and hands the
// signed URL to the preview owner. Composition as in the governance port test:
// production WorkspaceApp and Composer submission owner, deterministic wire.
import 'fake-indexeddb/auto';
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TYPES } from '../src/protocol/vocab.js';

const workspaceFixture = vi.hoisted(() => {
  const channelId = 'c0.dev';
  const selfId = 'human:root:1';
  const workerId = 'agent:worker:1';
  const transportFrames = [];
  // The ledger as the page sees it: each answered request is a turn with its
  // terminal. answer(frame) decides what the receiver replied.
  const replies = [];
  const answer = { current: () => null };
  const submit = vi.fn(async (frame) => {
    transportFrames.push(frame);
    const body = answer.current(frame);
    if (body) replies.push({ requestId: frame.id, terminalClosureOnly: false, terminal: { id: `${frame.id}:t`, type: frame.msg_type, payload: { body } } });
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
      principals: [], actorDescriptions: [], devices: [], support: {},
    })),
  };
  const navigation = {
    activeChannelId: channelId,
    activeChannelRef: { current: channelId },
    activeChannel: { id: channelId, name: channelId, qualified_name: channelId, access: 'member_active', owner_principal: 'root' },
    channels: [
      { id: channelId, name: channelId, qualified_name: channelId, access: 'member_active', owner_principal: 'root', open: true },
      { id: 'ch-storage-1', name: 'storage', qualified_name: 'c0.storage', access: 'discoverable', owner_principal: 'root', open: true },
    ],
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
    // What the node's roster says for a seat (platform/home View.Roster).
    { id: 'channel:seat:1', kind: 'channel', body: 'class channel-seat', name: 'storage', configId: 'cfg-1', entryId: 'e-1', bound: true },
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
    stateFor: vi.fn(() => ({ timeline: replies.map((reply) => ({ kind: 'turn', turn: reply })) })),
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
    channelId, selfId, workerId, submit, transportFrames, replies, answer, access, navigation, roster, probes, feed, feedSnapshot,
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
const { useAttachmentTransactions } = await import('../src/app/hooks/useAttachmentTransactions.js');

afterEach(cleanup);
beforeEach(() => {
  workspaceFixture.transportFrames.length = 0;
  workspaceFixture.replies.length = 0;
  workspaceFixture.submit.mockClear();
  useAttachmentTransactions.mockClear();
});

const SEAT_WORDS = { words: { 'storage.get_url': { description: 'Get a URL' }, 'storage.stat': { description: 'stat' } }, class: 'channel-seat', interfaces: ['actor', 'channel'] };

async function mountedResolver() {
  render(<WorkspaceApp />);
  await waitFor(() => expect(useAttachmentTransactions).toHaveBeenCalled());
  return (...args) => useAttachmentTransactions.mock.calls.at(-1)[0].resolveStorageURL(...args);
}

describe('stored file links read through the channel storage seat', () => {
  it('asks the seat that offers storage.get_url and returns the signed URL', async () => {
    workspaceFixture.answer.current = (frame) => {
      if (frame.msg_type === TYPES.describe) return { status: 'completed', ...SEAT_WORDS };
      if (frame.msg_type === TYPES.storageGetURL) {
        return { status: 'completed', url: 'https://bucket.example/c0.dev/reports/q3.pdf?sig=1', expires_at: '2026-10-06T12:05:00Z', size: 1234, media_type: 'application/pdf' };
      }
      return null;
    };
    const resolve = await mountedResolver();

    const ticket = await resolve('c0.dev', 'oss://c0.storage/c0.dev/reports/q3.pdf', { inline: true });
    expect(ticket).toEqual({
      url: 'https://bucket.example/c0.dev/reports/q3.pdf?sig=1',
      expiresAtMs: Date.parse('2026-10-06T12:05:00Z'),
      size: 1234,
      mediaType: 'application/pdf',
    });
    expect(workspaceFixture.transportFrames.map((frame) => [frame.msg_type, frame.audience, frame.payload])).toEqual([
      [TYPES.describe, ['channel:seat:1'], {}],
      [TYPES.storageGetURL, ['channel:seat:1'], { path: 'reports/q3.pdf', inline: true }],
    ]);

    // The seat is remembered: a second file only asks for its URL.
    await resolve('c0.dev', 'oss://c0.storage/c0.dev/%E6%8A%A5%E5%91%8A.md', { inline: false });
    expect(workspaceFixture.transportFrames.slice(2).map((frame) => [frame.msg_type, frame.payload])).toEqual([
      [TYPES.storageGetURL, { path: '报告.md', inline: false }],
    ]);
  });

  it('does not ask anything for a file that belongs to another channel', async () => {
    workspaceFixture.answer.current = () => ({ status: 'completed', ...SEAT_WORDS });
    const resolve = await mountedResolver();
    await expect(resolve('c0.dev', 'oss://c0.storage/c0.cvmax/reports/q3.pdf')).rejects.toMatchObject({
      code: 'storage_foreign_channel',
      message: '这个文件属于频道 c0.cvmax，不在当前频道 c0.dev 里；请到 c0.cvmax 打开它。',
    });
    expect(workspaceFixture.transportFrames).toHaveLength(0);
  });

  it('turns the storage failure into a reason the reader can act on', async () => {
    workspaceFixture.answer.current = (frame) => (frame.msg_type === TYPES.describe
      ? { status: 'completed', ...SEAT_WORDS }
      : { status: 'failed', reason: 'not_found', error_code: 'not_found', detail: 'no stored file at reports/gone.pdf' });
    const resolve = await mountedResolver();
    await expect(resolve('c0.dev', 'oss://c0.storage/c0.dev/reports/gone.pdf')).rejects.toMatchObject({
      code: 'not_found',
      message: '存储里没有这个文件：可能已被删除，或上传后还没有确认。（oss://c0.storage/c0.dev/reports/gone.pdf）',
    });
  });

  it('a submit the node rejects settles the request instead of waiting forever', async () => {
    workspaceFixture.answer.current = () => null;
    workspaceFixture.submit.mockImplementationOnce(async (frame) => {
      workspaceFixture.transportFrames.push(frame);
      throw Object.assign(new Error('principal is not an active channel member'), { code: 'forbidden', detail: 'principal is not an active channel member' });
    });
    const resolve = await mountedResolver();
    await expect(resolve('c0.dev', 'oss://c0.storage/c0.dev/reports/q3.pdf')).rejects.toMatchObject({
      code: 'storage_seat_unavailable',
    });
    expect(workspaceFixture.transportFrames.map((frame) => frame.msg_type)).toEqual([TYPES.describe]);
  });
});
