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
      else if (Date.now() - started > timeoutMs) reject(new Error('timed out waiting for mock governance result'));
      else setTimeout(poll, 10);
    };
    poll();
  });
}

afterEach(async () => Promise.all([...servers].map(close)));

describe('mock system, core and registrar actors', () => {
  it('drives structured results and converges roster/channel OBS', async () => {
    const server = createMockServer({ rootPassword: 'test-root', scenario: 'multi-channel', seed: 5 });
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
    const envelopes = [];
    let attached = false;
    const wire = createWire({
      url: baseURL.replace(/^http/, 'ws') + '/ws',
      WebSocketImpl: SessionWebSocket,
      onState: (state) => { if (state === 'attached') attached = true; },
      onFeed: (_channelId, _seq, envelope) => envelopes.push(envelope),
    });
    await waitFor(() => attached);

    const listReceipt = await wire.submit({ channel_id: 'c0', msg_type: 'channel.list', kind: 'request', payload: {}, audience: ['registrar'] });
    const listTerminal = await waitFor(() => envelopes.find((entry) => entry.parent_id === listReceipt.message_id && entry.payload?.status === 'completed'));
    expect(listTerminal.payload.value.map((channel) => channel.id)).toEqual(expect.arrayContaining(['c0', 'c0.project', 'c0.public']));
    expect(listTerminal.payload.value.some((channel) => channel.id === 'c0.lobby')).toBe(false);

    const peerListReceipt = await wire.submit({ channel_id: 'c0.project', id: 'peer-list', msg_type: 'channel.list', kind: 'request', payload: {}, audience: ['coreactor'] });
    const peerListTerminal = await waitFor(() => envelopes.find((entry) => entry.parent_id === peerListReceipt.message_id && entry.payload?.status === 'completed'));
    expect(peerListTerminal.payload).toMatchObject({ word: 'channel.list', source: { channel_id: 'c0.project', request_id: 'peer-list' } });

    const introduceReceipt = await wire.submit({
      channel_id: 'c0',
      msg_type: 'channel.introduce_actor',
      kind: 'request',
      payload: { kind: 'agent', decl_id: 'mock:reviewer' },
      audience: ['system'],
    });
    const introduceTerminal = await waitFor(() => envelopes.find((entry) => entry.parent_id === introduceReceipt.message_id && entry.payload?.status === 'completed'));
    const roster = await fetchWithSession('/obs/channel/c0/actors').then((response) => response.json());
    expect(roster.items.map((entry) => entry.declared.id)).toContain(introduceTerminal.payload.value.instance_id);
    expect(roster.items.map((entry) => entry.declared.id)).not.toContain('coreactor');

    const restartReceipt = await wire.submit({ channel_id: 'c0', msg_type: 'channel.restart_actor', kind: 'request', payload: { instance_id: introduceTerminal.payload.value.instance_id }, audience: ['system'] });
    const restartTerminal = await waitFor(() => envelopes.find((entry) => entry.parent_id === restartReceipt.message_id && entry.payload?.status === 'completed'));
    expect(restartTerminal.payload.value).toEqual({ restarted: introduceTerminal.payload.value.instance_id });

    const invalidReceipt = await wire.submit({ channel_id: 'c0', msg_type: 'channel.restart_actor', kind: 'request', payload: { instance_id: introduceTerminal.payload.value.instance_id, actor_id: 'legacy' }, audience: ['system'] });
    const invalidTerminal = await waitFor(() => envelopes.find((entry) => entry.parent_id === invalidReceipt.message_id && entry.payload?.status === 'failed'));
    expect(invalidTerminal.payload).toMatchObject({ error_code: 'bad_payload' });

    const protectedReceipt = await wire.submit({ channel_id: 'c0', msg_type: 'channel.restart_actor', kind: 'request', payload: { instance_id: 'system' }, audience: ['system'] });
    const protectedTerminal = await waitFor(() => envelopes.find((entry) => entry.parent_id === protectedReceipt.message_id && entry.payload?.status === 'failed'));
    expect(protectedTerminal.payload).toMatchObject({ error_code: 'protected_actor' });

    const removeReceipt = await wire.submit({ channel_id: 'c0', msg_type: 'channel.remove_actor', kind: 'request', payload: { instance_id: introduceTerminal.payload.value.instance_id }, audience: ['system'] });
    const removeTerminal = await waitFor(() => envelopes.find((entry) => entry.parent_id === removeReceipt.message_id && entry.payload?.status === 'completed'));
    expect(removeTerminal.payload.value).toEqual({ removed: true });

    const createReceipt = await wire.submit({ channel_id: 'c0', msg_type: 'channel.create', kind: 'request', payload: { name: 'design' }, audience: ['registrar'] });
    const createTerminal = await waitFor(() => envelopes.find((entry) => entry.parent_id === createReceipt.message_id && entry.payload?.status === 'completed'));
    expect(createTerminal.payload.value).toMatchObject({ id: 'c0.design', parent_id: 'c0', status: 'present' });
    const children = await fetchWithSession('/obs/space/channels?parent_id=c0').then((response) => response.json());
    expect(children.items.map((entry) => entry.declared.id)).toContain('c0.design');

    wire.close();
    await close(server);
  });
});
