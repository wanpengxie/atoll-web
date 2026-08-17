import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMockServer } from '../mock/server.mjs';
import { createIdentityClient } from '../src/net/identity.js';
import { createWire } from '../src/net/wire.js';

const servers = new Set();

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  servers.add(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!servers.delete(server)) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

function waitFor(predicate, detail, timeoutMs = 5_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = predicate();
      if (value) resolve(value);
      else if (Date.now() - started >= timeoutMs) reject(new Error(`timed out waiting for ${detail}`));
      else setTimeout(poll, 10);
    };
    poll();
  });
}

async function connect(scenario) {
  const server = createMockServer({ rootPassword: 'test-root', scenario });
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
  const feeds = [];
  let attached = false;
  const wire = createWire({
    url: baseURL.replace(/^http/, 'ws') + '/ws',
    WebSocketImpl: SessionWebSocket,
    onState: (state) => { if (state === 'attached') attached = true; },
    onFeed: (channelId, seq, envelope) => feeds.push({ channelId, seq, envelope }),
  });
  await waitFor(() => attached, 'attach');
  return { server, baseURL, fetchWithSession, wire, feeds };
}

function request(id, type, payload = {}, parentId = '') {
  return {
    channel_id: 'c0', id, msg_type: type, kind: 'request', payload,
    audience: ['steward'], visibility: 'public', ...(parentId ? { parent_id: parentId } : {}),
  };
}

function terminal(feeds, requestId) {
  return feeds.find((row) => row.envelope.kind === 'response'
    && row.envelope.parent_id === requestId
    && ['completed', 'failed'].includes(row.envelope.payload?.status))?.envelope;
}

afterEach(async () => Promise.all([...servers].map(close)));

describe('Phase C mock contract', () => {
  it('returns real Describe metadata and preserves typed capability payload/result', async () => {
    const { server, wire, feeds } = await connect('actor-capability');
    const describe = feeds.find((row) => row.envelope.id === 'c0-actor-describe-completed')?.envelope;
    expect(describe?.payload.value.types['mock.order.create']).toMatchObject({
      allowed_kinds: ['request'], max_pending_ms: 5_000,
      input_schema: { type: 'object', required: ['name', 'count'] },
    });

    await wire.submit(request('order-c', 'mock.order.create', { name: '保真订单', count: 4, priority: 'urgent', notify: true }));
    const result = await waitFor(() => terminal(feeds, 'order-c'), 'structured order terminal');
    expect(result.payload).toMatchObject({
      status: 'completed',
      value: { accepted: true, name: '保真订单', count: 4, priority: 'urgent', notify: true },
    });
    wire.close();
    await close(server);
  });

  it('separates cancel receipt from the original cancelled terminal and keeps stable errors', async () => {
    const { server, wire, feeds } = await connect('long-running');
    await wire.submit(request('long-cancel', 'human.text', { text: '持续运行' }));
    await waitFor(() => feeds.some((row) => row.envelope.parent_id === 'long-cancel' && row.envelope.payload?.turn_id), 'processing turn id');
    await expect(wire.cancel({ channel_id: 'c0', req_id: 'long-cancel' })).resolves.toEqual({ req_id: 'long-cancel' });
    expect(terminal(feeds, 'long-cancel')).toBeUndefined();
    const cancelled = await waitFor(() => terminal(feeds, 'long-cancel'), 'cancelled terminal');
    expect(cancelled.payload).toMatchObject({ status: 'failed', cancelled: true });
    await expect(wire.cancel({ channel_id: 'c0', req_id: 'long-cancel' })).rejects.toMatchObject({ code: 'already_closed' });
    await expect(wire.cancel({ channel_id: 'c0', req_id: 'missing' })).rejects.toMatchObject({ code: 'request_not_found' });
    wire.close();
    await close(server);

    const approvalSession = await connect('approval-schema');
    await expect(approvalSession.wire.cancel({ channel_id: 'c0', req_id: 'c0-approval-1' }))
      .rejects.toMatchObject({ code: 'unauthorized_sender' });
    approvalSession.wire.close();
    await close(approvalSession.server);
  });

  it('uses turn CAS for steer and returns independent control terminals', async () => {
    const { server, wire, feeds } = await connect('long-running');
    await wire.submit(request('long-steer', 'human.text', { text: '原任务' }));
    const processing = await waitFor(
      () => feeds.find((row) => row.envelope.parent_id === 'long-steer' && row.envelope.payload?.turn_id)?.envelope,
      'steerable processing',
    );
    const turnId = processing.payload.turn_id;
    await wire.submit(request('steer-bad', 'agent.steer', { text: '错误 CAS', expected_turn_id: 'stale-turn' }, 'long-steer'));
    expect((await waitFor(() => terminal(feeds, 'steer-bad'), 'CAS failure')).payload).toMatchObject({ status: 'failed', reason: 'cas_mismatch' });

    await wire.submit(request('steer-good', 'agent.steer', { text: '新的方向', expected_turn_id: turnId }, 'long-steer'));
    const control = await waitFor(() => terminal(feeds, 'steer-good'), 'steer terminal');
    expect(control.payload).toMatchObject({ status: 'completed', value: { merged_into: turnId, direction: '新的方向' } });
    expect((await waitFor(() => terminal(feeds, 'long-steer'), 'preempted original')).payload)
      .toMatchObject({ status: 'completed', value: { preempted_by: 'steer-good' } });
    wire.close();
    await close(server);
  });
});
