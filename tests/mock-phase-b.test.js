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

function waitFor(predicate, timeoutMs = 5_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = predicate();
      if (value) resolve(value);
      else if (Date.now() - started > timeoutMs) reject(new Error('timed out waiting for Phase B mock evidence'));
      else setTimeout(poll, 10);
    };
    poll();
  });
}

async function session(baseURL) {
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
  return { fetchWithSession, WebSocketImpl: class SessionWebSocket extends WebSocket {
    constructor(url) { super(url, { headers: { Cookie: cookie } }); }
  } };
}

afterEach(async () => Promise.all([...servers].map(close)));

describe('Phase B mock contract', () => {
  it('models the real backend membership/self gap instead of leaking mock-only fields', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'real-backend-shape' });
    const baseURL = await listen(server);
    const { fetchWithSession } = await session(baseURL);
    const memberships = await fetchWithSession('/obs/space/memberships');
    expect(memberships.status).toBe(404);
    const actors = await fetchWithSession('/obs/channel/c0/actors').then((response) => response.json());
    expect(actors.items.find((item) => item.declared.kind === 'human').declared).not.toHaveProperty('principal');
    await close(server);
  });

  it('accepts a same-semantics retry with the same client id and rejects a conflicting retry', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'message-flow' });
    const baseURL = await listen(server);
    const { WebSocketImpl } = await session(baseURL);
    const feeds = [];
    let attached = false;
    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws', WebSocketImpl,
      onState: (state) => { if (state === 'attached') attached = true; },
      onFeed: (_channelId, _seq, envelope) => feeds.push(envelope),
    });
    await waitFor(() => attached);
    const frame = { channel_id: 'c0', id: 'client-stable-id', msg_type: 'human.text', kind: 'request', payload: { text: 'same' }, audience: ['steward'], visibility: 'public' };
    await expect(wire.submit(frame)).resolves.toMatchObject({ message_id: 'client-stable-id' });
    await waitFor(() => feeds.some((envelope) => envelope.id === 'client-stable-id'));
    await expect(wire.submit(frame)).resolves.toMatchObject({ message_id: 'client-stable-id' });
    expect(feeds.filter((envelope) => envelope.id === 'client-stable-id')).toHaveLength(1);
    await expect(wire.submit({ ...frame, payload: { text: 'changed' } })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    wire.close();
    await close(server);
  });
});
