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
      return waitFor(() => envelopes.find((entry) => entry.parent_id === receipt.message_id && ['completed', 'failed'].includes(entry.payload?.body?.status)));
    };

    const list = await call('c0', 'system.channel.list');
    expect(list.payload.body.value.map((channel) => channel.id)).toEqual(expect.arrayContaining(['c0', 'c0.project', 'c0.public']));
    expect(list.payload.body.value.some((channel) => channel.id === 'c0.lobby')).toBe(false);

    // 子频道里同样只认识 system actor。
    const peerList = await call('c0.project', 'system.channel.list', {}, 'peer-list');
    expect(peerList.payload.body.status).toBe('completed');

    // c0 是平台搭的频道，没有频道描述：成员固定，加成员被拒绝。
    const fixed = await call('c0', 'system.member.create', { name: 'analyst', body: { actor: 'analyst@1' } });
    expect(fixed.payload.body).toMatchObject({ status: 'failed', error_code: 'reserved' });
    // 旧的 decl_id 形状不再被接受。
    const legacy = await call('c0.project', 'system.member.create', { decl_id: 'mock:analyst' });
    expect(legacy.payload.body).toMatchObject({ status: 'failed', error_code: 'invalid_args' });

    // 加成员 = 在频道描述里写一个条目；构建好后出现在名册上。
    const created = await call('c0.project', 'system.member.create', { name: 'analyst', body: { actor: 'analyst@1' } });
    // 描述由 c0 的 registrar 写，回复原样转回：{value}。
    expect(created.payload.body).toMatchObject({ status: 'completed', value: { written: true, entry: { name: 'analyst', body: { actor: 'analyst@1' } } } });
    const roster = await fetchWithSession('/obs/channel/c0.project/actors').then((response) => response.json());
    const analyst = roster.items.find((entry) => /^agent:analyst:/.test(entry.declared.id));
    expect(analyst.declared).toMatchObject({ kind: 'agent', body: 'actor analyst@1' });
    const memberId = analyst.declared.id;
    // 运行时生成的成员标着 generated，不是描述里的条目。
    expect(roster.items.find((entry) => entry.declared.id === 'svcactor').declared.body).toBe('generated');
    const built = await waitFor(() => envelopes.find((entry) => entry.channel_id === 'c0.project' && entry.type === 'system.build.finished' && entry.payload?.body?.object?.name === 'analyst'));
    expect(built.payload.body).toMatchObject({ result: 'ok', state: 'ready', description: { actor: 'analyst@1' } });

    const duplicate = await call('c0.project', 'system.member.create', { name: 'analyst', body: { class: 'codex' } });
    expect(duplicate.payload.body).toMatchObject({ status: 'failed', error_code: 'invalid_args' });

    const restarted = await call('c0.project', 'system.member.restart', { member: memberId });
    expect(restarted.payload.body.member).toBe(memberId);

    const invalid = await call('c0.project', 'system.member.restart', { member: memberId, actor_id: 'legacy' });
    expect(invalid.payload.body).toMatchObject({ status: 'failed', error_code: 'bad_payload' });

    const guarded = await call('c0', 'system.member.restart', { member: 'system' });
    expect(guarded.payload.body).toMatchObject({ status: 'failed', error_code: 'protected_actor' });

    const removed = await call('c0.project', 'system.member.delete', { member: memberId });
    expect(removed.payload.body).toMatchObject({ status: 'completed', value: { written: true } });
    const after = await fetchWithSession('/obs/channel/c0.project/actors').then((response) => response.json());
    expect(after.items.map((entry) => entry.declared.id)).not.toContain(memberId);

    const invalidAdmit = await call('c0', 'system.member.admit', { principal: 'steward' });
    expect(invalidAdmit.payload.body).toMatchObject({ status: 'failed' });

    // 新频道：空白起点，带进来的人列在 humans 里。
    const design = await call('c0', 'system.channel.create', { name: 'design', parent: 'c0', humans: ['root'] });
    expect(design.payload.body.value).toEqual({ channel_id: 'c0.design', revision: 1 });
    const children = await fetchWithSession('/obs/space/channels?parent_id=c0').then((response) => response.json());
    expect(children.items.map((entry) => entry.declared.id)).toContain('c0.design');
    const legacyCreate = await call('c0', 'system.channel.create', { name: 'old', recipe: { declarations: [] }, initial_actor_ids: ['root'] });
    expect(legacyCreate.payload.body).toMatchObject({ status: 'failed', error_code: 'bad_payload' });

    wire.close();
    await close(server);
  });
});
