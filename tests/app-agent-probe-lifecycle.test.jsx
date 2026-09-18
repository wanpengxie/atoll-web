// @vitest-environment jsdom
import React, { Suspense, startTransition } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const no = () => {};
  const asyncNo = async () => {};
  const feedState = { channelId: 'c1', rows: new Map(), turns: new Map(), narration: [], lastSeq: 0 };
  const state = {
    appShell: null,
    wireOptions: null,
    unauthorized: null,
    send: vi.fn(),
    clearSession: vi.fn(),
    principal: { id: 'principal-1', display_name: 'Test' },
    activeChannelId: 'c1',
    channelRows: [{ id: 'c1', name: 'Channel', open: true, access: 'member_active', selfActorId: 'human-1' }],
    channels: new Map(),
    feedState,
    statesRef: { current: new Map([['c1', feedState]]) },
    drafts: new Map(),
    generation: 1,
    rosterAuthorityComplete: true,
    rosterAuthorityCalls: 0,
    onRoster: null,
    onSubmissionFeed: null,
    reconciliations: [],
    suspendAppShell: null,
    renderedPrincipals: [],
    feedSetter: no,
    bumpFeed: null,
    setPending: no,
    uploadChannelFile: vi.fn(),
    stable: {
      no,
      asyncNo,
      emptyHistory: () => ({ loading: false, error: null, exhausted: false }),
      emptyUnread: () => 0,
      generationFor: () => state.generation,
      draftFor: (channelId) => state.drafts.get(channelId) || ({ text: '', attachments: [] }),
    },
  };
  state.bumpFeed = () => state.feedSetter((value) => value + 1);
  return state;
});

vi.mock('../src/app/AppShell.jsx', () => ({
  AppShell: (props) => {
    harness.appShell = props;
    harness.renderedPrincipals.push(harness.principal?.id || '');
    if (harness.suspendAppShell) throw harness.suspendAppShell;
    return <button type="button" onClick={props.session.onLogout}>logout</button>;
  },
}));

vi.mock('../src/app/hooks/useAtollSession.js', () => ({
  useAtollSession: () => ({
    booting: false,
    principal: harness.principal,
    identity: {},
    accept: harness.stable.no,
    clear: harness.clearSession,
    logoutRemote: harness.stable.asyncNo,
  }),
}));

vi.mock('../src/app/hooks/useNodeUpdate.js', () => ({ useNodeUpdate: () => ({ value: null, start: harness.stable.asyncNo }) }));
vi.mock('../src/app/hooks/useUiWords.js', () => ({ useUiWords: harness.stable.no }));
vi.mock('../src/app/hooks/useLocalAutomation.js', () => ({
  useLocalAutomation: () => ({ records: [], markFired: harness.stable.no, after: harness.stable.asyncNo, cancel: harness.stable.asyncNo, clear: harness.stable.no }),
}));

vi.mock('../src/app/hooks/useChannelFeed.js', async () => {
  const ReactModule = await import('react');
  return {
    useChannelFeed: (options) => {
      const [version, setVersion] = ReactModule.useState(0);
      harness.feedSetter = setVersion;
      ReactModule.useLayoutEffect(() => {
        const producerOwnerToken = options.ownerToken;
        harness.onRoster = (channelId, rows) => options.onRoster(channelId, rows, producerOwnerToken);
        harness.onSubmissionFeed = (landed, closed) => options.onSubmissionFeed(landed, closed, producerOwnerToken);
      }, [options.onRoster, options.onSubmissionFeed, options.ownerToken]);
      return {
        statesRef: harness.statesRef,
        version,
        indexVersion: version,
        bump: harness.bumpFeed,
        enqueue: harness.stable.no,
        cancel: harness.stable.no,
        clear: harness.stable.no,
        prepareLocalReplica: harness.stable.asyncNo,
        resumeLocalReplica: harness.stable.asyncNo,
        localReplicaReady: true,
        setHistoryGrants: harness.stable.no,
        pageEnd: harness.stable.no,
        liveCheckpoint: harness.stable.no,
        disconnectHistory: harness.stable.no,
        focusHistory: harness.stable.no,
        generationFor: harness.stable.generationFor,
        refreshChannel: harness.stable.asyncNo,
        historyFor: harness.stable.emptyHistory,
        loadHistory: harness.stable.asyncNo,
        markRead: harness.stable.no,
        unreadFor: harness.stable.emptyUnread,
      };
    },
  };
});

vi.mock('../src/app/hooks/useChannelDirectory.js', () => ({
  useChannelDirectory: () => ({
    channels: harness.channels,
    setChannels: harness.stable.no,
    rows: harness.channelRows,
    version: 1,
    bump: harness.stable.no,
    activeChannelId: harness.activeChannelId,
    setActiveChannelId: harness.stable.no,
    select: harness.stable.no,
    clear: harness.stable.no,
  }),
}));

vi.mock('../src/model/channel-file-transfer.js', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadChannelFile: (options) => harness.uploadChannelFile(options),
}));

vi.mock('../src/app/hooks/useSubmissions.js', async () => {
  const ReactModule = await import('react');
  return {
    useSubmissions: () => {
      const [pending, setPending] = ReactModule.useState([]);
      const principalId = harness.principal?.id || '';
      const reconcileFeed = ReactModule.useMemo(
        () => (landed, closed) => harness.reconciliations.push({ principalId, landed, closed }),
        [principalId],
      );
      harness.setPending = setPending;
      return {
        pending,
        drafts: harness.drafts,
        draftFor: harness.stable.draftFor,
        updateDraft: harness.stable.no,
        approvalStates: {},
        controlStates: {},
        send: harness.send,
        retry: harness.stable.no,
        resolve: harness.stable.no,
        cancel: harness.stable.no,
        reconcileFeed,
        clear: harness.stable.no,
        resetWorld: harness.stable.no,
      };
    },
  };
});

vi.mock('../src/net/obs.js', () => ({
  ObsError: class ObsError extends Error {},
  createObsClient: (options = {}) => {
    if (options.onUnauthorized) harness.unauthorized = options.onUnauthorized;
    return {
      spaceChannels: async () => ({ items: [], complete: true }),
      channelDevices: async () => ({
        items: [{
          key: 'device-1',
          declared: { device_id: 'device-1', name: 'storage', default_storage: true },
          actual: { measures: [{ name: 'online', value: true }] },
        }],
      }),
      close: harness.stable.no,
    };
  },
}));

vi.mock('../src/net/wire.js', () => ({
  createWire: (options) => {
    harness.wireOptions = options;
    return { close: harness.stable.no, resolve: harness.stable.asyncNo };
  },
}));

vi.mock('../src/model/roster.js', () => ({
  createRoster: () => ({
    ensure: async () => [{ id: 'agent-1', kind: 'agent', name: 'Agent' }],
    refresh: async () => [{ id: 'agent-1', kind: 'agent', name: 'Agent' }],
    authority: () => {
      harness.rosterAuthorityCalls += 1;
      return { principalId: 'principal-1', channelId: 'c1', complete: harness.rosterAuthorityComplete };
    },
    self: () => 'human-1',
    noteSelf: () => false,
    clearSelf: harness.stable.no,
    seed: harness.stable.no,
    reset: harness.stable.no,
    close: harness.stable.no,
  }),
}));

vi.mock('../src/model/channel-access.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createChannelAccessTracker: () => ({
      state: () => ({ relationship: 'member', unavailable: false, existence: 'present' }),
      rows: () => [],
      snapshot: () => ({ memberships: [], profiles: [], rosters: {} }),
      channelsObserved: harness.stable.no,
      membershipsObserved: harness.stable.no,
      wire: harness.stable.no,
      retire: harness.stable.no,
      reset: harness.stable.no,
    }),
  };
});

vi.mock('../src/model/workspace-bootstrap-cache.js', () => ({
  readWorkspaceBootstrap: () => ({ memberships: [], profiles: [], rosters: {} }),
  writeWorkspaceBootstrap: harness.stable.no,
}));

import App from '../src/App.jsx';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function failedDescribe(requestId) {
  return {
    requestId,
    requestSeq: 1,
    lastSeq: 2,
    request: { id: requestId, type: 'actor.describe', audience: ['agent-1'], payload: {} },
    terminal: { id: `${requestId}-terminal`, type: 'actor.describe', payload: { status: 'failed', error_code: 'unavailable' } },
  };
}

async function mountOpenApp({ selectAgent = true, suspense = false } = {}) {
  window.history.replaceState({}, '', '#/channels/c1/dynamic');
  const app = <App />;
  const view = render(suspense
    ? <Suspense fallback={<p>candidate suspended</p>}>{app}</Suspense>
    : app);
  await waitFor(() => expect(harness.wireOptions).toBeTruthy());
  await act(async () => {
    harness.wireOptions.onState('attached', {
      session: 'session-1',
      memberships_complete: true,
      memberships: [{ channel_id: 'c1', actor_id: 'human-1' }],
      history_meta: [],
    });
  });
  await waitFor(() => expect(harness.appShell?.session.wireState).toBe('open'));
  await waitFor(() => expect(harness.appShell?.workspace.roster).toHaveLength(1));
  if (selectAgent) act(() => harness.appShell.workspace.agentSelection.onTargetChange('agent-1'));
  return view;
}

describe('App automatic describe wiring', () => {
  beforeEach(() => {
    harness.appShell = null;
    harness.wireOptions = null;
    harness.unauthorized = null;
    harness.send.mockReset();
    harness.clearSession.mockReset();
    harness.feedState.rows.clear();
    harness.feedState.turns.clear();
    harness.feedState.lastSeq = 0;
    harness.generation = 1;
    harness.rosterAuthorityComplete = true;
    harness.rosterAuthorityCalls = 0;
    harness.onRoster = null;
    harness.onSubmissionFeed = null;
    harness.reconciliations = [];
    harness.suspendAppShell = null;
    harness.renderedPrincipals = [];
    harness.principal = { id: 'principal-1', display_name: 'Test' };
    harness.activeChannelId = 'c1';
    harness.channelRows = [{ id: 'c1', name: 'Channel', open: true, access: 'member_active', selfActorId: 'human-1' }];
    harness.drafts.clear();
    harness.uploadChannelFile.mockReset();
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ agent_advance: false }) }));
  });

  afterEach(() => cleanup());

  // 手动挡（owner 2026-09-18）：挂载、重连、消息流都不再触发探测，一条都不发。
  // 每条探测都必须追溯到一个真人动作，这个 helper 就是"用户点开模型选择器"那一下。
  async function mountAndProbe(options) {
    const view = await mountOpenApp(options);
    expect(harness.send).toHaveBeenCalledTimes(0);
    await waitFor(() => expect(harness.appShell.workspace.agentSelection?.onOpen).toBeTypeOf('function'));
    act(() => harness.appShell.workspace.agentSelection.onOpen());
    await waitFor(() => expect(harness.send).toHaveBeenCalledTimes(1));
    return view;
  }

  // owner 2026-09-18：「手动永远不被管理」。频次闸门只拦自动探测；真人连点必须
  // 每一下都真的发出去，恒不因为限流被吃掉。
  it('never rate-limits the human: every explicit open sends again', async () => {
    harness.send.mockResolvedValue('describe-x');
    const view = await mountAndProbe();
    expect(harness.send).toHaveBeenCalledTimes(1);

    for (let i = 2; i <= 4; i += 1) {
      act(() => harness.appShell.workspace.agentSelection.onOpen());
      await waitFor(() => expect(harness.send).toHaveBeenCalledTimes(i));
    }
    view.unmount();
  });

  it('sends nothing until the user asks: no probe on mount, reconnect or feed traffic', async () => {
    const view = await mountOpenApp();
    expect(harness.send).toHaveBeenCalledTimes(0);

    // 断线重连二十次 + 消息流不断变化：旧实现每次都会重探，现在一条都不发。
    for (let i = 2; i <= 21; i += 1) {
      act(() => harness.wireOptions.onState('reconnecting', { generation: i }));
      act(() => harness.wireOptions.onState('attached', {
        session: `session-${i}`, memberships_complete: true,
        memberships: [{ channel_id: 'c1', actor_id: 'human-1' }], history_meta: [],
      }));
      act(() => harness.bumpFeed());
    }
    await act(async () => {});
    expect(harness.send).toHaveBeenCalledTimes(0);

    // 真人点一下才发，而且只发一条。
    await waitFor(() => expect(harness.appShell.workspace.agentSelection?.onOpen).toBeTypeOf('function'));
    act(() => harness.appShell.workspace.agentSelection.onOpen());
    await waitFor(() => expect(harness.send).toHaveBeenCalledTimes(1));
    act(() => harness.bumpFeed());
    await act(async () => {});
    expect(harness.send).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('routes feed reconciliation only through the last layout-committed principal owner', async () => {
    const view = await mountOpenApp({ selectAgent: false, suspense: true });
    expect(harness.onSubmissionFeed).toBeTypeOf('function');
    const oldProducerFeed = harness.onSubmissionFeed;
    const oldProducerRoster = harness.onRoster;

    const candidate = deferred();
    harness.principal = { id: 'principal-2', display_name: 'Candidate' };
    harness.suspendAppShell = candidate.promise;
    await act(async () => {
      startTransition(() => view.rerender(
        <Suspense fallback={<p>candidate suspended</p>}><App /></Suspense>,
      ));
    });
    expect(harness.renderedPrincipals).toContain('principal-2');
    expect(document.body.textContent).not.toContain('candidate suspended');

    const landed = new Set(['old-principal-message']);
    const closed = new Set();
    act(() => harness.onSubmissionFeed(landed, closed));
    expect(harness.reconciliations).toEqual([{ principalId: 'principal-1', landed, closed }]);

    // Once the candidate really commits, the very same stable ingress must
    // switch atomically to that owner's reconciliation function.
    harness.suspendAppShell = null;
    act(() => view.rerender(
      <Suspense fallback={<p>candidate suspended</p>}><App /></Suspense>,
    ));
    const nextLanded = new Set(['new-principal-message']);
    act(() => oldProducerFeed(new Set(['late-old-principal-message']), new Set()));
    expect(harness.reconciliations).toHaveLength(1);
    const authorityCallsBeforeLateRoster = harness.rosterAuthorityCalls;
    act(() => oldProducerRoster('c1', [{ id: 'stale-agent', kind: 'agent', name: 'Stale' }]));
    expect(harness.rosterAuthorityCalls).toBe(authorityCallsBeforeLateRoster);
    act(() => harness.onSubmissionFeed(nextLanded, new Set()));
    expect(harness.reconciliations.at(-1)).toMatchObject({ principalId: 'principal-2', landed: nextLanded });

    view.unmount();
    candidate.resolve();
  });

  it('merges an upload into the latest committed attachment ledger without overwriting a newer attachment action', async () => {
    harness.drafts.set('c1', {
      text: '',
      attachments: [{ resource_id: 'existing', name: 'report.txt' }],
    });
    const uploaded = deferred();
    harness.uploadChannelFile.mockReturnValueOnce(uploaded.promise);
    const view = await mountOpenApp({ selectAgent: false });

    const upload = harness.appShell.workspace.onUploadAttachments([
      new File(['upload'], 'report.txt', { type: 'text/plain' }),
    ]);
    await waitFor(() => expect(harness.uploadChannelFile).toHaveBeenCalledOnce());
    expect(harness.uploadChannelFile.mock.calls[0][0].uploadName).toBe('report-2.txt');

    act(() => harness.appShell.workspace.resources.onAttach({ resource_id: 'manual', name: 'manual.txt' }));
    await act(async () => uploaded.resolve({ resource_id: 'uploaded', name: 'report-2.txt' }));
    await expect(upload).resolves.toEqual([{ resource_id: 'uploaded', name: 'report-2.txt' }]);
    await waitFor(() => expect(harness.appShell.workspace.attachments.map((row) => row.resource_id)).toEqual([
      'existing', 'manual', 'uploaded',
    ]));
    view.unmount();
  });

  it('treats clear as cancellation authority so an older upload cannot resurrect attachments', async () => {
    const uploaded = deferred();
    harness.uploadChannelFile.mockReturnValueOnce(uploaded.promise);
    const view = await mountOpenApp({ selectAgent: false });

    const upload = harness.appShell.workspace.onUploadAttachments([
      new File(['upload'], 'cancelled.txt', { type: 'text/plain' }),
    ]);
    await waitFor(() => expect(harness.uploadChannelFile).toHaveBeenCalledOnce());
    act(() => harness.appShell.workspace.onClearAttachments());
    await act(async () => uploaded.resolve({ resource_id: 'cancelled', name: 'cancelled.txt' }));
    await expect(upload).resolves.toEqual([]);
    expect(harness.appShell.workspace.attachments).toEqual([]);
    view.unmount();
  });

  it('finishes a background channel upload only in its originating channel draft', async () => {
    harness.channelRows = [
      { id: 'c1', name: 'Channel 1', open: true, access: 'member_active', selfActorId: 'human-1' },
      { id: 'c2', name: 'Channel 2', open: true, access: 'member_active', selfActorId: 'human-2' },
    ];
    const uploaded = deferred();
    harness.uploadChannelFile.mockReturnValueOnce(uploaded.promise);
    const view = await mountOpenApp({ selectAgent: false });
    const upload = harness.appShell.workspace.onUploadAttachments([
      new File(['upload'], 'channel-a.txt', { type: 'text/plain' }),
    ]);
    await waitFor(() => expect(harness.uploadChannelFile).toHaveBeenCalledOnce());

    harness.activeChannelId = 'c2';
    act(() => view.rerender(<App />));
    await act(async () => uploaded.resolve({ resource_id: 'channel-a', name: 'channel-a.txt' }));
    await expect(upload).resolves.toHaveLength(1);
    expect(harness.appShell.workspace.channel.id).toBe('c2');
    expect(harness.appShell.workspace.attachments).toEqual([]);

    harness.activeChannelId = 'c1';
    act(() => view.rerender(<App />));
    expect(harness.appShell.workspace.attachments).toEqual([{ resource_id: 'channel-a', name: 'channel-a.txt' }]);
    view.unmount();
  });

  it('drops an old principal upload result after the new principal commits', async () => {
    const uploaded = deferred();
    harness.uploadChannelFile.mockReturnValueOnce(uploaded.promise);
    const view = await mountOpenApp({ selectAgent: false });
    const upload = harness.appShell.workspace.onUploadAttachments([
      new File(['upload'], 'old-principal.txt', { type: 'text/plain' }),
    ]);
    await waitFor(() => expect(harness.uploadChannelFile).toHaveBeenCalledOnce());

    harness.principal = { id: 'principal-2', display_name: 'Next' };
    act(() => view.rerender(<App />));
    act(() => uploaded.resolve({ resource_id: 'old-principal', name: 'old-principal.txt' }));
    await expect(upload).resolves.toEqual([]);
    expect(harness.appShell.workspace.attachments).not.toContainEqual(expect.objectContaining({ resource_id: 'old-principal' }));
    view.unmount();
  });

  it('publishes Waiting control authority only from the complete active-generation roster', async () => {
    const view = await mountOpenApp({ selectAgent: false });
    await waitFor(() => expect(harness.appShell.workspace.waitingRosterAuthority).toMatchObject({
      principalId: 'principal-1', channelId: 'c1', generation: 1, current: true,
    }));
    expect([...harness.appShell.workspace.waitingRosterAuthority.actorIDs]).toEqual(['agent-1']);
    view.unmount();

    cleanup();
    harness.appShell = null;
    harness.wireOptions = null;
    harness.rosterAuthorityComplete = false;
    const incomplete = await mountOpenApp({ selectAgent: false });
    await waitFor(() => expect(harness.appShell.workspace.waitingRosterAuthority.current).toBe(false));
    expect([...harness.appShell.workspace.waitingRosterAuthority.actorIDs]).toEqual(['agent-1']);
    incomplete.unmount();
  });

  it('holds receipt-before-feed and failed terminal, then retries exactly once on explicit open', async () => {
    const receipt = deferred();
    harness.send.mockImplementationOnce(() => receipt.promise).mockResolvedValueOnce('describe-2');
    const view = await mountAndProbe();

    act(() => harness.bumpFeed());
    expect(harness.send).toHaveBeenCalledTimes(1);
    await act(async () => receipt.resolve('describe-1'));
    await waitFor(() => expect(harness.send).toHaveBeenCalledTimes(1));

    harness.feedState.turns.set('describe-1', failedDescribe('describe-1'));
    harness.feedState.lastSeq = 2;
    act(() => harness.bumpFeed());
    await waitFor(() => expect(harness.appShell.workspace.agentSelection.onOpen).toBeTypeOf('function'));
    expect(harness.send).toHaveBeenCalledTimes(1);

    act(() => harness.appShell.workspace.agentSelection.onOpen());
    await waitFor(() => expect(harness.send).toHaveBeenCalledTimes(2));
    act(() => harness.bumpFeed());
    await waitFor(() => expect(harness.send).toHaveBeenCalledTimes(2));
    view.unmount();
  });

  it('ignores an old-generation receipt without unlocking the reconnect probe', async () => {
    const oldReceipt = deferred();
    const currentReceipt = deferred();
    harness.send.mockImplementationOnce(() => oldReceipt.promise).mockImplementationOnce(() => currentReceipt.promise);
    const view = await mountAndProbe();

    act(() => harness.wireOptions.onState('reconnecting', { generation: 2 }));
    act(() => harness.wireOptions.onState('attached', {
      session: 'session-2', memberships_complete: true,
      memberships: [{ channel_id: 'c1', actor_id: 'human-1' }], history_meta: [],
    }));
    // owner 2026-09-18 的硬闸门：重连本身不再放行探测。旧实现在这里发第二条，
    // 于是一次断线风暴就能刷满对端在站账。一分钟内无论重连多少次都只有第一条。
    await act(async () => {});
    expect(harness.send).toHaveBeenCalledTimes(1);

    await act(async () => oldReceipt.resolve('stale-describe'));
    act(() => harness.bumpFeed());
    expect(harness.send).toHaveBeenCalledTimes(1);

    // 真人展开参数区仍是逃生口，立刻放行一条。
    await waitFor(() => expect(harness.appShell.workspace.agentSelection.onOpen).toBeTypeOf('function'));
    act(() => harness.appShell.workspace.agentSelection.onOpen());
    await waitFor(() => expect(harness.send).toHaveBeenCalledTimes(2));
    await act(async () => currentReceipt.resolve('current-describe'));
    expect(harness.send).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('invalidates probe generation when authentication expiry calls expireSession', async () => {
    const receipt = deferred();
    harness.send.mockImplementationOnce(() => receipt.promise);
    const view = await mountAndProbe();
    expect(harness.unauthorized).toBeTypeOf('function');

    expect(() => act(() => harness.unauthorized())).not.toThrow();
    expect(harness.clearSession).toHaveBeenCalledTimes(1);
    await act(async () => receipt.resolve('stale-after-logout'));
    view.unmount();
  });
});
