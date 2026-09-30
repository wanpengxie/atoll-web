import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMockServer } from '../mock/server.mjs';
import { createIdentityClient } from '../src/net/identity.js';
import { createWire } from '../src/net/wire.js';

const servers = new Set();
async function listen(server) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); servers.add(server); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { if (!servers.delete(server)) return; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
async function waitFor(predicate, timeout = 3000) { const start = Date.now(); while (Date.now() - start < timeout) { const value = predicate(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('timed out'); }
afterEach(async () => Promise.all([...servers].map(close)));

// 成员关系变了，网关推一份整的新清单；连接不断、不重连。
describe('memberships push', () => {
  it('delivers the new memberships after a channel is created, without reconnecting', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'space-administration', liveIntervalMs: 0 });
    const baseURL = await listen(server); let cookie = '';
    const fetchSession = async (path, options = {}) => { const headers = new Headers(options.headers); if (cookie) headers.set('Cookie', cookie); const response = await fetch(`${baseURL}${path}`, { ...options, headers }); const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';', 1)[0]; return response; };
    await createIdentityClient(fetchSession).login('root@atoll.local', 'test-root');
    class SessionWebSocket extends WebSocket { constructor(url) { super(url, { headers: { Cookie: cookie } }); } }
    const states = []; const pushed = []; const envelopes = [];
    const wire = createWire({
      url: `${baseURL.replace('http', 'ws')}/ws`, WebSocketImpl: SessionWebSocket,
      onState: (state) => states.push(state),
      onFeed: (_channel, _seq, envelope) => envelopes.push(envelope),
      onMemberships: (detail) => pushed.push(detail.memberships),
    });
    await waitFor(() => states.includes('attached'));
    const receipt = await wire.submit({ channel_id: 'c0', msg_type: 'system.channel.create', kind: 'request', payload: { name: 'pushed', parent: 'c0', humans: ['root'] }, audience: ['system'] });
    await waitFor(() => envelopes.find((row) => row.parent_id === receipt.message_id && row.payload?.body?.status === 'completed'));
    const latest = await waitFor(() => pushed.at(-1));
    expect(latest.map((row) => row.channel_id)).toContain('c0.pushed');
    expect(states.filter((state) => state === 'attached')).toHaveLength(1);
    wire.close(); await close(server);
  });
});
