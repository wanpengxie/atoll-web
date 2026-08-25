import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMockServer } from '../mock/server.mjs';
import { createIdentityClient } from '../src/net/identity.js';
import { createWire } from '../src/net/wire.js';
import { apply, createChannelState, fold, orderedTimeline } from '../src/model/fold.js';

const runningServers = new Set();

function waitFor(predicate, detail, timeoutMs = 5_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      let value;
      try {
        value = predicate();
      } catch (error) {
        reject(error);
        return;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`timed out waiting for ${detail}`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  runningServers.add(server);
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function closeServer(server) {
  if (!runningServers.delete(server)) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

afterEach(async () => {
  await Promise.all([...runningServers].map(closeServer));
});

describe('local mock end-to-end', () => {
  it('bounds attach replay and serves ascending keyset history pages', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'multi-channel', seed: 17 });
    const baseURL = await listen(server);
    let cookie = '';
    const fetchWithSession = async (path, options = {}) => {
      const headers = new Headers(options.headers);
      if (cookie) headers.set('Cookie', cookie);
      const response = await fetch(`${baseURL}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      return response;
    };
    await createIdentityClient(fetchWithSession).login('root@atoll.local', 'test-root');
    class SessionWebSocket extends WebSocket {
      constructor(url) { super(url, { headers: { Cookie: cookie } }); }
    }
    let detail = null;
    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws', WebSocketImpl: SessionWebSocket,
      since: () => ({}),
      onState: (state, value) => { if (state === 'attached') detail = value; },
    });
    await waitFor(() => detail, 'history attach metadata');
    expect(detail.history.find((entry) => entry.channel_id === 'c0')).toMatchObject({ head_seq: expect.any(Number), oldest_seq: expect.any(Number) });

    const tail = await wire.historyBefore('c0', 0, 3);
    expect(tail.rows).toHaveLength(3);
    expect(tail.rows.map((row) => row.seq)).toEqual([...tail.rows.map((row) => row.seq)].sort((a, b) => a - b));
    expect(tail.has_older).toBe(true);
    const older = await wire.historyBefore('c0', tail.oldest_seq, 3);
    expect(older.rows.every((row) => row.seq < tail.oldest_seq)).toBe(true);
    wire.close();
    await closeServer(server);
  });

  it('selects, inspects and advances deterministic scenarios through the control plane', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'first-login', seed: 3 });
    const baseURL = await listen(server);

    const catalog = await fetch(`${baseURL}/mock/control/catalog`).then((response) => response.json());
    expect(catalog.scenarios).toEqual(expect.arrayContaining(['first-login', 'multi-channel', 'permission-revoked', 'channel-retired']));

    const initial = await fetch(`${baseURL}/mock/control/state`).then((response) => response.json());
    expect(initial).toMatchObject({ scenario: 'first-login', seed: 3, memberships: [] });
    expect(initial.channels.find((channel) => channel.id === 'c0.lobby')).toMatchObject({ internal: true });

    const reset = await fetch(`${baseURL}/mock/control/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'permission-revoked', seed: 11 }),
    }).then((response) => response.json());
    expect(reset.memberships.find((membership) => membership.channel_id === 'c0.project').status).toBe('active');

    await fetch(`${baseURL}/mock/control/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ms: 5_000 }),
    });
    const advanced = await fetch(`${baseURL}/mock/control/state`).then((response) => response.json());
    expect(advanced.memberships.find((membership) => membership.channel_id === 'c0.project').status).toBe('revoked');

    const faultResponse = await fetch(`${baseURL}/mock/control/fault`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'submit', mode: 'reject', code: 'unavailable', count: 1 }),
    });
    expect(faultResponse.status).toBe(200);
    const faultState = await fetch(`${baseURL}/mock/control/state`).then((response) => response.json());
    expect(faultState.faults).toEqual([{ target: 'submit', mode: 'reject', code: 'unavailable', count: 1, delay_ms: 0 }]);

    await closeServer(server);
  });

  it('manually advances long-running agent computation through progress, terminal, and FIFO resume', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'long-running', seed: 23 });
    const baseURL = await listen(server);
    let cookie = '';
    const fetchWithSession = async (path, options = {}) => {
      const headers = new Headers(options.headers);
      if (cookie) headers.set('Cookie', cookie);
      const response = await fetch(`${baseURL}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      return response;
    };
    await createIdentityClient(fetchWithSession).login('root@atoll.local', 'test-root');
    class SessionWebSocket extends WebSocket {
      constructor(url) { super(url, { headers: { Cookie: cookie } }); }
    }
    const rows = [];
    let attached = false;
    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws', WebSocketImpl: SessionWebSocket, since: () => ({}),
      onState: (state) => { if (state === 'attached') attached = true; },
      onFeed: (channelId, seq, value) => { if (channelId === 'c0') rows.push({ channel_id: channelId, seq, envelope: value }); },
    });
    await waitFor(() => attached, 'manual-advance attach');
    const first = await wire.submit({ channel_id: 'c0', msg_type: 'agent.ask', kind: 'request', payload: { text: 'first' }, audience: ['steward'] });
    await waitFor(() => fold(rows, 'root').turns.get(first.message_id)?.latestStatus === 'processing', 'first task processing');
    const second = await wire.submit({ channel_id: 'c0', msg_type: 'agent.ask', kind: 'request', payload: { text: 'second' }, audience: ['steward'] });
    const third = await wire.submit({ channel_id: 'c0', msg_type: 'agent.ask', kind: 'request', payload: { text: 'third' }, audience: ['steward'] });
    await waitFor(() => fold(rows, 'root').turns.get(first.message_id)?.latestStatus === 'processing' && fold(rows, 'root').turns.get(third.message_id)?.latestStatus === 'queued', 'active and buffered tasks');

    const advance = () => fetchWithSession('/mock/control/advance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ms: 0, compute: { channel_id: 'c0' } }) }).then((response) => response.json());
    await expect(advance()).resolves.toMatchObject({ computation: { status: 'processing', request_id: first.message_id, step: 1 } });
    await expect(advance()).resolves.toMatchObject({ computation: { status: 'processing', request_id: first.message_id, step: 2 } });
    // 组批 owner 恒是 tail（协议 §4.4.5 / loop.go:1009）：批 [second, third] 的
    // 代表是 third，second 合并进它。
    await expect(advance()).resolves.toMatchObject({ computation: { status: 'completed', request_id: first.message_id, resumed_request_id: third.message_id, merged_request_ids: [second.message_id] } });
    await waitFor(() => {
      const state = fold(rows, 'root');
      return state.turns.get(first.message_id)?.terminal?.payload?.status === 'completed'
        && state.turns.get(third.message_id)?.latestStatus === 'processing'
        && state.turns.get(second.message_id)?.terminal?.payload?.merged_into === third.message_id;
    }, 'manual terminal and FIFO resume');
    wire.close();
    await closeServer(server);
  });

  it('keeps A, B and D progress isolated while preserving the Agent request tree', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'agent-tree', seed: 31 });
    const baseURL = await listen(server);
    let cookie = '';
    const fetchWithSession = async (path, options = {}) => {
      const headers = new Headers(options.headers);
      if (cookie) headers.set('Cookie', cookie);
      const response = await fetch(`${baseURL}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      return response;
    };
    await createIdentityClient(fetchWithSession).login('root@atoll.local', 'test-root');
    class SessionWebSocket extends WebSocket {
      constructor(url) { super(url, { headers: { Cookie: cookie } }); }
    }
    const rows = [];
    let attached = false;
    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws', WebSocketImpl: SessionWebSocket, since: () => ({}),
      onState: (value) => { if (value === 'attached') attached = true; },
      onFeed: (channelId, seq, value) => { if (channelId === 'c0') rows.push({ channel_id: channelId, seq, envelope: value }); },
    });
    await waitFor(() => attached, 'agent-tree attach');
    const { message_id: rootId } = await wire.submit({ channel_id: 'c0', msg_type: 'agent.ask', kind: 'request', payload: { text: '协作完成任务' }, audience: ['steward'], visibility: 'public' });
    const state = await waitFor(() => {
      const next = fold(rows, 'root');
      return next.turns.get(rootId)?.terminal ? next : null;
    }, 'agent-tree terminal');

    const entry = orderedTimeline(state).find((item) => item.turn?.requestId === rootId);
    expect(entry.thread.map((item) => [item.turn.request.payload.text, item.depth])).toEqual([
      ['B 负责资料分析', 1],
      ['D 负责核验关键事实', 2],
      ['C 负责独立复核', 1],
    ]);
    const rootProcesses = entry.turn.provisional.map((item) => item.envelope.payload?.process).filter(Boolean);
    const childB = entry.thread[0].turn;
    const childD = entry.thread[1].turn;
    expect(rootProcesses.filter((process) => process.kind === 'tool').map((process) => process.tool_call_id)).toEqual([
      `${rootId}-call-b`, `${rootId}-call-b`, `${rootId}-call-c`, `${rootId}-call-c`,
    ]);
    expect(childB.provisional.map((item) => item.envelope.payload?.process?.kind).filter(Boolean)).toEqual(['turn', 'stage', 'tool', 'tool']);
    expect(childD.provisional.map((item) => item.envelope.payload?.process?.kind).filter(Boolean)).toEqual(['stage']);
    expect(JSON.stringify(rows)).not.toContain('progress_events');
    expect(childB.terminal.payload.text).toBe('B 汇总完成');
    expect(childD.terminal.payload.text).toBe('D 核验完成');

    wire.close();
    await closeServer(server);
  });

  it('resumes only the targeted message after editing and keeps later messages queued', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'long-running', seed: 24 });
    const baseURL = await listen(server);
    let cookie = '';
    const fetchWithSession = async (path, options = {}) => {
      const headers = new Headers(options.headers);
      if (cookie) headers.set('Cookie', cookie);
      const response = await fetch(`${baseURL}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      return response;
    };
    await createIdentityClient(fetchWithSession).login('root@atoll.local', 'test-root');
    class SessionWebSocket extends WebSocket {
      constructor(url) { super(url, { headers: { Cookie: cookie } }); }
    }
    const rows = [];
    let attached = false;
    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws', WebSocketImpl: SessionWebSocket, since: () => ({}),
      onState: (state) => { if (state === 'attached') attached = true; },
      onFeed: (channelId, seq, value) => { if (channelId === 'c0') rows.push({ channel_id: channelId, seq, envelope: value }); },
    });
    await waitFor(() => attached, 'targeted-edit attach');
    const submit = (msgType, payload) => wire.submit({ channel_id: 'c0', msg_type: msgType, kind: 'request', payload, audience: ['steward'] });
    const a = await submit('agent.ask', { text: 'A original' });
    await waitFor(() => fold(rows, 'root').turns.get(a.message_id)?.latestStatus === 'processing', 'A processing');
    const b = await submit('agent.ask', { text: 'B queued' });
    const c = await submit('agent.ask', { text: 'C queued' });
    await waitFor(() => fold(rows, 'root').turns.get(c.message_id)?.latestStatus === 'queued', 'B/C queued');

    const hold = await submit('agent.hold', { target: a.message_id });
    await waitFor(() => {
      const state = fold(rows, 'root');
      return state.turns.get(hold.message_id)?.terminal?.payload?.status === 'completed'
        && state.turns.get(a.message_id)?.latestStatus === 'queued';
    }, 'A held and resumed to queue');
    const replace = await submit('agent.replace', { target: a.message_id, old_text: 'A original', new_text: 'A edited' });
    await waitFor(() => {
      const state = fold(rows, 'root');
      return state.turns.get(a.message_id)?.terminal?.payload?.replaced_by === replace.message_id
        && state.turns.get(replace.message_id)?.latestStatus === 'queued';
    }, 'A replaced by the replacement row');
    const unhold = await submit('agent.unhold', {});
    await waitFor(() => {
      const state = fold(rows, 'root');
      return state.turns.get(unhold.message_id)?.terminal?.payload?.status === 'completed'
        && state.turns.get(replace.message_id)?.latestStatus === 'processing';
    }, 'replacement row resumed processing');

    const final = fold(rows, 'root');
    expect(final.turns.get(b.message_id)).toMatchObject({ latestStatus: 'queued', terminal: null });
    expect(final.turns.get(c.message_id)).toMatchObject({ latestStatus: 'queued', terminal: null });
    wire.close();
    await closeServer(server);
  });

  it('keeps receipt acceptance separate from delayed feed landing', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'projection-delay' });
    const baseURL = await listen(server);
    let cookie = '';
    const fetchWithSession = async (path, options = {}) => {
      const headers = new Headers(options.headers);
      if (cookie) headers.set('Cookie', cookie);
      const response = await fetch(`${baseURL}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      return response;
    };
    await createIdentityClient(fetchWithSession).login('root@atoll.local', 'test-root');
    class SessionWebSocket extends WebSocket {
      constructor(url) { super(url, { headers: { Cookie: cookie } }); }
    }
    const landed = [];
    let attached = false;
    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws',
      WebSocketImpl: SessionWebSocket,
      since: () => ({}),
      onState: (state) => { if (state === 'attached') attached = true; },
      onFeed: (_channelId, _seq, envelope) => landed.push(envelope.id),
    });
    await waitFor(() => attached, 'projection-delay attach');
    const receipt = await wire.submit({ channel_id: 'c0', msg_type: 'agent.ask', kind: 'request', payload: { text: 'delayed landing' }, audience: ['steward'] });
    expect(landed).not.toContain(receipt.message_id);
    await waitFor(() => landed.includes(receipt.message_id), 'delayed request feed', 2_000);
    wire.close();
    await closeServer(server);
  });

  it('emits isolated live demo events in both member channels when explicitly enabled', async () => {
    const server = createMockServer({ rootPassword: 'test-root', liveIntervalMs: 20 });
    const baseURL = await listen(server);
    let cookie = '';
    const fetchWithSession = async (path, options = {}) => {
      const headers = new Headers(options.headers);
      if (cookie) headers.set('Cookie', cookie);
      const response = await fetch(`${baseURL}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      return response;
    };
    const identity = createIdentityClient(fetchWithSession);
    await identity.login('root@atoll.local', 'test-root');

    class SessionWebSocket extends WebSocket {
      constructor(url) {
        super(url, { headers: { Cookie: cookie } });
      }
    }

    const pulses = [];
    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws',
      WebSocketImpl: SessionWebSocket,
      since: () => ({}),
      onFeed: (channelId, seq, value) => {
        if (value.type === 'mock.channel.pulse') pulses.push({ channelId, seq, value });
      },
    });

    await waitFor(
      () => new Set(pulses.map((item) => item.channelId)).size === 2,
      'live events in both channels',
    );
    expect(pulses.some((item) => item.value.payload.text.includes('steward 在线'))).toBe(true);
    expect(pulses.some((item) => item.value.payload.text.includes('project-agent 正在整理'))).toBe(true);
    expect(pulses.some((item) => item.channelId === 'c0.lobby')).toBe(false);

    wire.close();
    await closeServer(server);
  });

  it('logs in, folds replay and live turns, resolves approval, and resumes from since without duplicates', async () => {
    const server = createMockServer({ rootPassword: 'test-root' });
    const baseURL = await listen(server);
    let cookie = '';
    const fetchWithSession = async (path, options = {}) => {
      const headers = new Headers(options.headers);
      if (cookie) headers.set('Cookie', cookie);
      const response = await fetch(`${baseURL}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      return response;
    };

    const identity = createIdentityClient(fetchWithSession);
    await expect(identity.login('root@atoll.local', 'test-root')).resolves.toEqual({ id: 'root' });
    expect(cookie).toMatch(/^atoll_session=.+/);

    class SessionWebSocket extends WebSocket {
      constructor(url) {
        super(url, { headers: { Cookie: cookie } });
      }
    }

    const states = new Map();
    const rows = [];
    const cursors = {};
    const seenSeq = new Set();
    let duplicateSeq = 0;
    let attachCount = 0;
    const wireStates = [];
    const wireErrors = [];

    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws',
      WebSocketImpl: SessionWebSocket,
      since: () => ({ ...cursors }),
      onFeed: (channelId, seq, value) => {
        const seqKey = `${channelId}:${seq}`;
        if (seenSeq.has(seqKey)) duplicateSeq += 1;
        seenSeq.add(seqKey);
        const row = { channel_id: channelId, seq, envelope: value };
        rows.push(row);
        let state = states.get(channelId);
        if (!state) {
          state = createChannelState(channelId);
          states.set(channelId, state);
        }
        apply(state, row, 'root');
        cursors[channelId] = Math.max(cursors[channelId] || 0, seq);
      },
      onError: (error) => wireErrors.push(error),
      onState: (state) => {
        wireStates.push(state);
        if (state === 'attached') attachCount += 1;
      },
    });

    await waitFor(
      () => attachCount === 1 && states.get('c0')?.lastSeq === 25 && states.get('c0.project')?.lastSeq === 25,
      'attach and seeded replay',
    );

    const replay = fold(rows.filter((row) => row.channel_id === 'c0'), 'root');
    expect(replay.turns).toHaveLength(4);
    expect([...replay.turns.values()].filter((turn) => turn.request.type === 'agent.ask')).toHaveLength(3);
    expect([...replay.turns.values()].filter((turn) => turn.status === 'completed')).toHaveLength(3);
    // Production visible-log reads exclude visibility=system rows; the mock
    // attach path now follows the same contract.
    expect(replay.narration).toHaveLength(0);
    expect(replay.approvals).toHaveLength(1);
    expect(states.get('c0').standalone.at(-1).envelope.payload.text).toContain('c0 独立账本');
    expect(states.get('c0.project').standalone.at(-1).envelope.payload.text).toContain('c0.project 独立账本');
    expect(states.has('c0.lobby')).toBe(false);

    const accepted = await wire.submit({
      channel_id: 'c0',
      msg_type: 'agent.ask',
      kind: 'request',
      payload: { text: '@steward only reply PONG' },
      audience: ['steward'],
      visibility: 'public',
    });
    expect(accepted.message_id).toEqual(expect.any(String));

    const liveTurn = await waitFor(
      () => states.get('c0')?.turns.get(accepted.message_id)?.status === 'completed'
        && states.get('c0').turns.get(accepted.message_id),
      'live completed PONG turn',
    );
    expect(liveTurn.provisional.map((value) => value.status)).toEqual(['queued', 'processing', 'processing', 'processing', 'processing']);
    expect(liveTurn.provisional.filter((value) => value.envelope.payload?.process?.kind === 'tool')).toHaveLength(2);
    expect(liveTurn.text).toBe('PONG');

    const approvalId = [...states.get('c0').approvals.keys()][0];
    expect(approvalId).toBe('c0-approval-1');
    await expect(wire.resolve({ channel_id: 'c0', req_id: approvalId, decision: 'approve' }))
      .resolves.toEqual({ req_id: approvalId });
    await waitFor(() => !states.get('c0').approvals.has(approvalId), 'approval terminal response');
    expect(states.get('c0').turns.get(approvalId).terminal.payload).toMatchObject({
      status: 'completed',
      decision: 'approve',
    });

    const beforeDropRows = states.get('c0').rows.size;
    await fetchWithSession('/mock/drop');
    await waitFor(() => wireStates.includes('reconnecting'), 'wire reconnecting state');
    const approveResponse = await fetchWithSession('/mock/approve?channel=c0');
    const pushedApproval = await approveResponse.json();
    await waitFor(
      () => attachCount >= 2 && states.get('c0').rows.has(cursors.c0)
        && [...states.get('c0').rows.values()].some((value) => value.id === pushedApproval.id),
      'reconnect replay from current since cursor',
    );

    expect(states.get('c0').rows.size).toBe(beforeDropRows + 1);
    expect(duplicateSeq).toBe(0);
    expect(wireErrors).toEqual([]);

    wire.close();
    await closeServer(server);
  }, 10_000);

  it('模型参数协议全链：describe 值域、context 当前值、select 周期与 sticky、单收件人门', async () => {
    const server = createMockServer({ rootPassword: 'test-root' });
    const baseURL = await listen(server);
    let cookie = '';
    const fetchWithSession = async (path, options = {}) => {
      const headers = new Headers(options.headers);
      if (cookie) headers.set('Cookie', cookie);
      const response = await fetch(`${baseURL}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      return response;
    };
    const identity = createIdentityClient(fetchWithSession);
    await identity.login('root@atoll.local', 'test-root');
    class SessionWebSocket extends WebSocket {
      constructor(url) { super(url, { headers: { Cookie: cookie } }); }
    }
    const states = new Map();
    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws',
      WebSocketImpl: SessionWebSocket,
      since: () => ({}),
      onFeed: (channelId, seq, value) => {
        let state = states.get(channelId);
        if (!state) { state = createChannelState(channelId); states.set(channelId, state); }
        apply(state, { channel_id: channelId, seq, envelope: value }, 'root');
      },
      onError: () => {},
      onState: () => {},
    });
    await waitFor(() => states.get('c0')?.lastSeq >= 25, 'seeded replay');
    const terminalOf = (id) => [...(states.get('c0')?.rows.values() || [])]
      .find((row) => row.kind === 'response' && row.parent_id === id && ['completed', 'failed'].includes(row.payload?.status));

    // ① request 恒单收件人：多 audience 广播在 gate 整条被拒。
    await expect(wire.submit({ channel_id: 'c0', msg_type: 'agent.ask', kind: 'request', payload: { text: 'broadcast' }, audience: ['steward', 'claude'], visibility: 'public' }))
      .rejects.toMatchObject({ code: 'harness_request_audience_invalid' });

    // ② describe 值域：oneOf 组合对 + title；两个 agent 目录不串值。
    const describeOf = async (actorId) => {
      const { message_id: id } = await wire.submit({ channel_id: 'c0', msg_type: 'actor.describe', kind: 'request', payload: {}, audience: [actorId], visibility: 'public' });
      await waitFor(() => terminalOf(id), `describe ${actorId}`);
      return terminalOf(id).payload;
    };
    const stewardDescribe = await describeOf('steward');
    expect(stewardDescribe.words['agent.new']).toMatchObject({ description: '新建对话' });
    const stewardSchema = stewardDescribe.words['agent.select'].input_schema;
    expect(stewardSchema.oneOf.every((branch) => branch.required?.includes('model') && branch.required?.includes('effort'))).toBe(true);
    expect(stewardSchema.oneOf[0].properties.model).toMatchObject({ const: 'gpt-5.6-sol', title: '5.6 Sol' });
    const claudeDescribe = await describeOf('claude');
    expect(claudeDescribe.words['agent.select'].input_schema.oneOf[0].properties.model.const).toBe('claude-opus');

    // ③ context 当前值：默认 = 目录第一条，带上下文用量。
    const contextOf = async () => {
      const { message_id: id } = await wire.submit({ channel_id: 'c0', msg_type: 'agent.context', kind: 'request', payload: {}, audience: ['steward'], visibility: 'public' });
      await waitFor(() => terminalOf(id), 'context terminal');
      return terminalOf(id).payload;
    };
    expect(await contextOf()).toMatchObject({ status: 'completed', model: 'gpt-5.6-sol', effort: 'medium', context_window: 200_000 });

    // ④ new 是唯一的跨 Provider 语义；前端不提交 Claude 私有的 /clear。
    const { message_id: newId } = await wire.submit({ channel_id: 'c0', msg_type: 'agent.new', kind: 'request', payload: {}, audience: ['steward'], visibility: 'public' });
    await waitFor(() => terminalOf(newId), 'new terminal');
    expect(terminalOf(newId).payload).toMatchObject({ status: 'completed', value: { new: true } });

    // ⑤ select 完整周期：queued→processing→turn process→terminal(新 usage)，成功后 sticky。
    const { message_id: selectId } = await wire.submit({ channel_id: 'c0', msg_type: 'agent.select', kind: 'request', payload: { model: 'gpt-5.4', effort: 'light' }, audience: ['steward'], visibility: 'public' });
    await waitFor(() => terminalOf(selectId)?.payload?.status === 'completed', 'select terminal');
    const selectRows = [...states.get('c0').rows.values()].filter((row) => row.parent_id === selectId || row.correlation_id === selectId);
    expect(selectRows.filter((row) => row.kind === 'response').map((row) => row.payload.status)).toEqual(['queued', 'processing', 'processing', 'completed']);
    expect(selectRows.find((row) => row.payload?.process?.kind === 'turn')).toBeTruthy();
    expect(terminalOf(selectId).payload.usage).toMatchObject({ model: 'gpt-5.4', effort: 'light' });
    expect(await contextOf()).toMatchObject({ model: 'gpt-5.4', effort: 'light' });

    // ⑥ 非法组合：failed invalid_args（组合对不是笛卡尔积——gpt-5.4 名下没有 high）。
    const { message_id: badId } = await wire.submit({ channel_id: 'c0', msg_type: 'agent.select', kind: 'request', payload: { model: 'gpt-5.4', effort: 'high' }, audience: ['steward'], visibility: 'public' });
    await waitFor(() => terminalOf(badId), 'invalid select terminal');
    expect(terminalOf(badId).payload).toMatchObject({ status: 'failed', error_code: 'invalid_args' });
    expect(await contextOf()).toMatchObject({ model: 'gpt-5.4', effort: 'light' });

    // ⑦ 空对象同样非法（宽松形对齐 loop.go：{} 两字段全空 → 全不匹配 → invalid_args，
    // 恒不"沿用当前值成功"）。
    const { message_id: emptyId } = await wire.submit({ channel_id: 'c0', msg_type: 'agent.select', kind: 'request', payload: {}, audience: ['steward'], visibility: 'public' });
    await waitFor(() => terminalOf(emptyId), 'empty select terminal');
    expect(terminalOf(emptyId).payload).toMatchObject({ status: 'failed', error_code: 'invalid_args' });

    wire.close();
    await closeServer(server);
  }, 10_000);

  it('select 旁路独占槽：忙时挂起、新覆盖旧（superseded）、turn 收口后插队生效', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'long-running', seed: 77 });
    const baseURL = await listen(server);
    let cookie = '';
    const fetchWithSession = async (path, options = {}) => {
      const headers = new Headers(options.headers);
      if (cookie) headers.set('Cookie', cookie);
      const response = await fetch(`${baseURL}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      return response;
    };
    const identity = createIdentityClient(fetchWithSession);
    await identity.login('root@atoll.local', 'test-root');
    class SessionWebSocket extends WebSocket {
      constructor(url) { super(url, { headers: { Cookie: cookie } }); }
    }
    const rows = [];
    let attached = false;
    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws',
      WebSocketImpl: SessionWebSocket,
      since: () => ({}),
      onError: () => {},
      onState: (state) => { if (state === 'attached') attached = true; },
      onFeed: (channelId, seq, value) => { if (channelId === 'c0') rows.push({ channel_id: channelId, seq, envelope: value }); },
    });
    await waitFor(() => attached, 'slot test attach');
    const terminalOf = (id) => rows.map((row) => row.envelope)
      .find((value) => value.kind === 'response' && value.parent_id === id && ['completed', 'failed'].includes(value.payload?.status));

    const busy = await wire.submit({ channel_id: 'c0', msg_type: 'agent.ask', kind: 'request', payload: { text: 'long task' }, audience: ['steward'] });
    await waitFor(() => rows.some((row) => row.envelope.parent_id === busy.message_id && row.envelope.payload?.status === 'processing'), 'busy turn processing');

    const held = await wire.submit({ channel_id: 'c0', msg_type: 'agent.select', kind: 'request', payload: { model: 'gpt-5.4', effort: 'light' }, audience: ['steward'] });
    await waitFor(() => rows.some((row) => row.envelope.parent_id === held.message_id && row.envelope.payload?.status === 'queued'), 'slot registration receipt');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(terminalOf(held.message_id)).toBeUndefined(); // 忙时挂槽，恒不提前生效

    const winner = await wire.submit({ channel_id: 'c0', msg_type: 'agent.select', kind: 'request', payload: { model: 'gpt-5.6-terra', effort: 'medium' }, audience: ['steward'] });
    await waitFor(() => terminalOf(held.message_id), 'superseded terminal');
    expect(terminalOf(held.message_id).payload).toMatchObject({ status: 'failed', error_code: 'superseded' });

    const advance = () => fetchWithSession('/mock/control/advance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ms: 0, compute: { channel_id: 'c0' } }) }).then((response) => response.json());
    await advance();
    await advance();
    await advance(); // 第三次步进收口当前 turn → 槽插队执行
    await waitFor(() => terminalOf(winner.message_id)?.payload?.status === 'completed', 'slot ran after turn close');
    expect(terminalOf(winner.message_id).payload.usage).toMatchObject({ model: 'gpt-5.6-terra', effort: 'medium' });

    wire.close();
    await closeServer(server);
  }, 10_000);
});
