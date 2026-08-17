import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMockServer } from '../mock/server.mjs';
import { createIdentityClient } from '../src/net/identity.js';
import { createWire } from '../src/net/wire.js';

const servers = new Set();
async function listen(server) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); servers.add(server); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { if (!servers.delete(server)) return; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
async function waitFor(predicate, timeout = 3000) { const start = Date.now(); while (Date.now() - start < timeout) { const value = predicate(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('timed out'); }

async function harness(scenario = 'space-administration') {
  const server = createMockServer({ rootPassword: 'test-root', scenario, liveIntervalMs: 0 });
  const baseURL = await listen(server); let cookie = '';
  const fetchSession = async (path, options = {}) => { const headers = new Headers(options.headers); if (cookie) headers.set('Cookie', cookie); const response = await fetch(`${baseURL}${path}`, { ...options, headers }); const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';', 1)[0]; return response; };
  await createIdentityClient(fetchSession).login('root@atoll.local', 'test-root');
  class SessionWebSocket extends WebSocket { constructor(url) { super(url, { headers: { Cookie: cookie } }); } }
  const envelopes = []; let attached = false;
  const wire = createWire({ url: `${baseURL.replace('http', 'ws')}/ws`, WebSocketImpl: SessionWebSocket, onState: (state) => { if (state === 'attached') attached = true; }, onFeed: (_channel, _seq, envelope) => envelopes.push(envelope) });
  await waitFor(() => attached);
  return { server, baseURL, fetchSession, wire, envelopes };
}

async function submitTerminal(h, msgType, payload, audience = ['registrar'], channelId = 'c0') {
  const receipt = await h.wire.submit({ channel_id: channelId, msg_type: msgType, kind: 'request', payload, audience });
  return waitFor(() => h.envelopes.find((row) => row.parent_id === receipt.message_id && ['completed', 'failed'].includes(row.payload?.status)));
}

afterEach(async () => Promise.all([...servers].map(close)));

describe('phase E stateful mock', () => {
  it('supports templates, channel configuration and secret-safe devices', async () => {
    const h = await harness();
    expect((await submitTerminal(h, 'actor.template.register', { id: 'demo:assistant', name: 'Demo', class: 'codex', config: { model: 'mock' }, visibility: 'private' })).payload.status).toBe('completed');
    const list = await submitTerminal(h, 'actor.template.list', {});
    expect(list.payload.value.map((row) => row.id)).toContain('demo:assistant');
    expect((await submitTerminal(h, 'channel.template.register', { id: 'demo:channel', name: 'Demo channel', visibility: 'private', body: { declarations: [{ decl_id: 'demo:assistant' }] } })).payload.status).toBe('completed');
    expect((await submitTerminal(h, 'actor.overlay.set', { channel_id: 'c0', decl_id: 'demo:assistant', config: { model: 'overlay' } })).payload.value.applied).toBe(true);
    expect((await submitTerminal(h, 'channel.profile.set', { channel_id: 'c0', description: 'Configured', serving: 1, endpoints: { chat: { description: 'Chat', receiver: 'steward' } } })).payload.status).toBe('completed');
    const minted = await submitTerminal(h, 'device.mint', { name: 'Laptop' });
    expect(minted.payload.value.key).toMatch(/^mock-key-/);
    const daemons = await h.fetchSession('/obs/space/daemons').then((response) => response.json());
    expect(daemons.items.map((row) => row.declared.id)).toContain(minted.payload.value.device_id);
    expect(JSON.stringify(daemons)).not.toContain(minted.payload.value.key);
    const snapshot = await h.fetchSession('/mock/control/state').then((response) => response.json());
    expect(JSON.stringify(snapshot)).not.toContain(minted.payload.value.key);
    h.wire.close(); await close(h.server);
  });

  it('runs KV and file ticket PUT/GET without requiring resource_id for list', async () => {
    const h = await harness('resource-workflow');
    expect(await h.wire.resource({ channel_id: 'c0', op: 'create', resource_id: 'kv:demo', args: { value: 1 } })).toMatchObject({ status: 'ok', resource_id: 'kv:demo' });
    expect(await h.wire.resource({ channel_id: 'c0', op: 'write', resource_id: 'kv:demo', args: { value: 2 } })).toMatchObject({ value: { value: 2 } });
    expect((await h.wire.resource({ channel_id: 'c0', op: 'list' })).items.map((row) => row.id)).toContain('kv:demo');
    expect(await h.wire.resource({ channel_id: 'c0', op: 'stat', resource_id: 'kv:demo' })).toMatchObject({ exists: true, meta: { kind: 'kv' } });
    const address = 'daemon://local-device/c0/report.txt';
    const create = await h.wire.resource({ channel_id: 'c0', op: 'create', address, with_content: true });
    const put = await h.fetchSession(`/files/${encodeURIComponent(address)}?t=${encodeURIComponent(create.ticket)}`, { method: 'PUT', body: 'hello', headers: { 'Content-Type': 'text/plain' } });
    expect(put.status).toBe(200);
    const read = await h.wire.resource({ channel_id: 'c0', op: 'read', resource_id: create.resource_id, with_content: true });
    const get = await h.fetchSession(`/files/${encodeURIComponent(address)}?t=${encodeURIComponent(read.ticket)}`);
    expect(await get.text()).toBe('hello');
    expect(await h.wire.resource({ channel_id: 'c0', op: 'delete', resource_id: 'kv:demo' })).toMatchObject({ deleted: true });
    h.wire.close(); await close(h.server);
  });

  it('expires file tickets and permits a fresh ticket without reusing the old PUT', async () => {
    const h = await harness('resource-ticket-expired');
    const address = 'daemon://local-device/c0/expired.txt';
    const first = await h.wire.resource({ channel_id: 'c0', op: 'create', address, with_content: true });
    await h.fetchSession('/mock/control/advance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ms: 60_000 }) });
    const expired = await h.fetchSession(`/files/${encodeURIComponent(address)}?t=${encodeURIComponent(first.ticket)}`, { method: 'PUT', body: 'old' });
    expect(expired.status).toBe(403);
    const fresh = await h.wire.resource({ channel_id: 'c0', op: 'create', address, with_content: true });
    const uploaded = await h.fetchSession(`/files/${encodeURIComponent(address)}?t=${encodeURIComponent(fresh.ticket)}`, { method: 'PUT', body: 'fresh' });
    expect(uploaded.status).toBe(200);
    const repeated = await h.fetchSession(`/files/${encodeURIComponent(address)}?t=${encodeURIComponent(fresh.ticket)}`, { method: 'PUT', body: 'duplicate' });
    expect(repeated.status).toBe(403);
    h.wire.close(); await close(h.server);
  });

  it('fires due timers into the original ledger and cancellation prevents firing', async () => {
    const h = await harness('scheduled-action');
    const scheduled = await h.wire.after({ channel_id: 'c0', duration_ms: 1000, msg_type: 'mock.timer.notice', payload: { text: 'due' } });
    const cancelled = await h.wire.after({ channel_id: 'c0', duration_ms: 1000, msg_type: 'mock.timer.cancelled', payload: { text: 'never' } });
    expect((await h.wire.cancelTimer({ channel_id: 'c0', timer_id: cancelled.timer_id })).timer_id).toBe(cancelled.timer_id);
    await h.fetchSession('/mock/control/advance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ms: 1000 }) });
    await waitFor(() => h.envelopes.find((row) => row.id === scheduled.timer_id));
    expect(h.envelopes.some((row) => row.id === cancelled.timer_id)).toBe(false);
    h.wire.close(); await close(h.server);
  });
});
