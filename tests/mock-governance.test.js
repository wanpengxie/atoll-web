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


describe('mock system actor governance', () => {
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

    // 所有治理词都发给本频道的 system actor；空间词由它转交 registrar。
    const call = async (channelId, msgType, payload = {}, id = undefined) => {
      const receipt = await wire.submit({ channel_id: channelId, ...(id ? { id } : {}), msg_type: msgType, kind: 'request', payload, audience: ['system'] });
      return waitFor(() => envelopes.find((entry) => entry.parent_id === receipt.message_id && ['completed', 'failed'].includes(entry.payload?.status)));
    };

    const list = await call('c0', 'system.channel.list');
    expect(list.payload.value.map((channel) => channel.id)).toEqual(expect.arrayContaining(['c0', 'c0.project', 'c0.public']));
    expect(list.payload.value.some((channel) => channel.id === 'c0.lobby')).toBe(false);

    // 子频道里同样只认识 system actor。
    const peerList = await call('c0.project', 'system.channel.list', {}, 'peer-list');
    expect(peerList.payload.status).toBe('completed');

    const created = await call('c0', 'system.member.create', { decl_id: 'mock:analyst' });
    const memberId = created.payload.member;
    expect(memberId).toBeTruthy();
    const roster = await fetchWithSession('/obs/channel/c0/actors').then((response) => response.json());
    expect(roster.items.map((entry) => entry.declared.id)).toContain(memberId);
    // system.member.list 不列自己，OBS 名册里也没有已退休的 coreactor。
    expect(roster.items.map((entry) => entry.declared.id)).not.toContain('coreactor');

    const restarted = await call('c0', 'system.member.restart', { member: memberId });
    expect(restarted.payload.member).toBe(memberId);

    const invalid = await call('c0', 'system.member.restart', { member: memberId, actor_id: 'legacy' });
    expect(invalid.payload).toMatchObject({ status: 'failed', error_code: 'bad_payload' });

    const guarded = await call('c0', 'system.member.restart', { member: 'system' });
    expect(guarded.payload).toMatchObject({ status: 'failed', error_code: 'protected_actor' });

    const removed = await call('c0', 'system.member.delete', { member: memberId });
    expect(removed.payload.removed).toEqual([memberId]);

    const design = await call('c0', 'system.channel.create', { name: 'design', recipe: { declarations: [] } });
    expect(design.payload.value).toMatchObject({ channel_id: 'c0.design' });
    const children = await fetchWithSession('/obs/space/channels?parent_id=c0').then((response) => response.json());
    expect(children.items.map((entry) => entry.declared.id)).toContain('c0.design');

    wire.close();
    await close(server);
  });
});
