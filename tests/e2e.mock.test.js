import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMockServer } from '../mock/server.mjs';
import { createIdentityClient } from '../src/net/identity.js';
import { createWire } from '../src/net/wire.js';
import { apply, createChannelState, fold } from '../src/model/fold.js';

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
    const receipt = await wire.submit({ channel_id: 'c0', msg_type: 'human.text', kind: 'request', payload: { text: 'delayed landing' }, audience: ['steward'] });
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
      () => attachCount === 1 && states.get('c0')?.lastSeq === 28 && states.get('c0.project')?.lastSeq === 28,
      'attach and seeded replay',
    );

    const replay = fold(rows.filter((row) => row.channel_id === 'c0'), 'root');
    expect(replay.turns).toHaveLength(4);
    expect([...replay.turns.values()].filter((turn) => turn.request.type === 'human.text')).toHaveLength(3);
    expect([...replay.turns.values()].filter((turn) => turn.status === 'completed')).toHaveLength(3);
    expect(replay.narration).toHaveLength(2);
    expect(replay.approvals).toHaveLength(1);
    expect(states.get('c0').standalone.at(-1).envelope.payload.text).toContain('c0 独立账本');
    expect(states.get('c0.project').standalone.at(-1).envelope.payload.text).toContain('c0.project 独立账本');
    expect(states.has('c0.lobby')).toBe(false);

    const accepted = await wire.submit({
      channel_id: 'c0',
      msg_type: 'human.text',
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
    expect(liveTurn.provisional.map((value) => value.status)).toEqual(['queued', 'processing']);
    expect(liveTurn.activity.map((value) => value.envelope.type)).toEqual(['activity.tool.started', 'activity.tool.ended']);
    expect(liveTurn.text).toBe('PONG');

    const approvalId = [...states.get('c0').approvals.keys()][0];
    expect(approvalId).toBe('c0-approval-1');
    await expect(wire.resolve({ channel_id: 'c0', req_id: approvalId, decision: 'approved' }))
      .resolves.toEqual({ req_id: approvalId });
    await waitFor(() => !states.get('c0').approvals.has(approvalId), 'approval terminal response');
    expect(states.get('c0').turns.get(approvalId).final.payload).toMatchObject({
      status: 'completed',
      decision: 'approved',
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
});
