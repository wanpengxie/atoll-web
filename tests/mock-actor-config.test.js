import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMockServer } from '../mock/server.mjs';
import { createIdentityClient } from '../src/net/identity.js';
import { createWire } from '../src/net/wire.js';

// actor-config 场景的 mock 契约：两层状态、member.get/set、global/ 资源面、ui.form
// 的 resolve（result / error）。前端的真 wire 直接连 mock，走的就是浏览器那条路。

const servers = new Set();
async function listen(server) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); servers.add(server); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { if (!servers.delete(server)) return; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
async function waitFor(predicate, timeout = 3000) { const start = Date.now(); while (Date.now() - start < timeout) { const value = predicate(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('timed out'); }

async function harness(scenario = 'actor-config') {
  const server = createMockServer({ rootPassword: 'test-root', scenario, liveIntervalMs: 0 });
  const baseURL = await listen(server); let cookie = '';
  const fetchSession = async (path, options = {}) => { const headers = new Headers(options.headers); if (cookie) headers.set('Cookie', cookie); const response = await fetch(`${baseURL}${path}`, { ...options, headers }); const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';', 1)[0]; return response; };
  await createIdentityClient(fetchSession).login('root@atoll.local', 'test-root');
  class SessionWebSocket extends WebSocket { constructor(url) { super(url, { headers: { Cookie: cookie } }); } }
  const envelopes = []; let attached = false;
  const wire = createWire({ url: `${baseURL.replace('http', 'ws')}/ws`, WebSocketImpl: SessionWebSocket, label: 'vitest', onState: (state) => { if (state === 'attached') attached = true; }, onFeed: (_channel, _seq, envelope) => envelopes.push(envelope) });
  await waitFor(() => attached);
  return { server, fetchSession, wire, envelopes };
}

async function system(h, msgType, payload) {
  const receipt = await h.wire.submit({ channel_id: 'c0', msg_type: msgType, kind: 'request', payload, audience: ['system'] });
  const terminal = await waitFor(() => h.envelopes.find((row) => row.parent_id === receipt.message_id && ['completed', 'failed'].includes(row.payload?.body?.status)));
  return terminal.payload.body;
}

afterEach(async () => Promise.all([...servers].map(close)));

describe('actor-config mock', () => {
  it('reports both layers on the roster and on member.list/get', async () => {
    const h = await harness();
    const roster = await h.fetchSession('/obs/channel/c0/actors').then((response) => response.json());
    const measures = (id) => roster.items.find((entry) => entry.declared.id === id).actual.measures;
    expect(measures('deepseek')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'standard', value: 'ready', unknown: false }),
      expect.objectContaining({ name: 'business', value: 'stuck', reason: 'missing global resource global/deepseek_prod' }),
    ]));
    expect(measures('search-tool')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'business', value: 'retrying' })]));
    expect(measures('steward')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'business', value: 'ready' })]));

    const list = await system(h, 'system.member.list', {});
    const deepseek = list.actors.find((row) => row.id === 'deepseek');
    expect(deepseek).toMatchObject({ present: false, standard: { state: 'ready' }, business: { state: 'stuck', reason: 'missing global resource global/deepseek_prod' } });
    expect(list.actors.find((row) => row.id === 'steward')).toMatchObject({ present: true, business: { state: 'ready' } });

    const get = await system(h, 'system.member.get', { member: 'search-tool' });
    expect(get).toMatchObject({
      actor_id: 'search-tool', member: true, present: false,
      class: 'mcp-tool', config: { endpoint: 'http://127.0.0.1:9000/mcp' },
      source: { decl_id: 'mock:search' }, desired_host: 'local-device',
      business: { state: 'retrying' },
    });
    h.wire.close();
  });

  it('applies member.set as a top-level patch, with dry_run and refusals', async () => {
    const h = await harness();
    const dry = await system(h, 'system.member.set', { member: 'deepseek', config: { model: 'deepseek-reasoner', api_key: null }, dry_run: true });
    expect(dry).toMatchObject({ status: 'completed', member: 'deepseek', changed: true, class: 'deepseek-agent', config: { model: 'deepseek-reasoner' } });
    expect(dry.config).not.toHaveProperty('api_key');

    const refused = await system(h, 'system.member.set', { member: 'deepseek', config: { temperature: 9 } });
    expect(refused).toMatchObject({ status: 'failed', error_code: 'invalid_args' });
    expect(refused.detail).toContain('temperature');

    const missing = await system(h, 'system.member.set', { member: 'steward', config: { api_key: '$global.nope' } });
    expect(missing).toMatchObject({ status: 'failed', error_code: 'invalid_args', detail: 'missing global resource global/nope' });

    const kindChange = await system(h, 'system.member.set', { member: 'steward', class: 'mcp-tool' });
    expect(kindChange).toMatchObject({ status: 'failed', error_code: 'invalid_args' });

    const human = await system(h, 'system.member.set', { member: 'root', config: {} });
    expect(human.status).toBe('failed');

    const fixed = await system(h, 'system.member.set', { member: 'search-tool', config: { endpoint: 'http://127.0.0.1:9100/mcp' } });
    expect(fixed).toMatchObject({ status: 'completed', changed: true, rebuilt: true });
    expect(await system(h, 'system.member.get', { member: 'search-tool' })).toMatchObject({ present: true, business: { state: 'ready' } });
    h.wire.close();
  });

  it('keeps global/ in one space-wide store reachable from any channel', async () => {
    const h = await harness();
    const resource = (channelId, payload) => h.wire.resource({ channel_id: channelId, ...payload });
    expect((await resource('c0', { op: 'list', query: { prefix: 'global/' } })).items.map((row) => row.id)).toEqual(['global/openai_prod']);
    await resource('c0', { op: 'create', resource_id: 'global/deepseek_prod', args: 'sk-deep-1234' });
    // 另一个频道的资源面看见的是同一份。
    expect(await resource('c0.project', { op: 'stat', resource_id: 'global/deepseek_prod' })).toMatchObject({ exists: true, meta: { kind: 'kv' } });
    await expect(resource('c0', { op: 'create', resource_id: 'global/deepseek_prod', args: 'again' })).rejects.toMatchObject({ code: 'conflict_exists' });
    await expect(resource('c0', { op: 'create', resource_id: 'global/Bad Name', args: 'x' })).rejects.toMatchObject({ code: 'bad_payload' });
    await resource('c0.project', { op: 'write', resource_id: 'global/deepseek_prod', args: 'sk-deep-5678' });
    // 频道自己的 KV 列表里没有全局 key。
    expect((await resource('c0', { op: 'list' })).items.some((row) => String(row.id).startsWith('global/'))).toBe(false);
    const state = await h.fetchSession('/mock/control/state').then((response) => response.json());
    const digest = createHash('sha256').update(JSON.stringify('sk-deep-5678')).digest('hex');
    expect(state.globals.find((row) => row.id === 'global/deepseek_prod')).toMatchObject({ value_sha256: digest });
    expect(JSON.stringify(state)).not.toContain('sk-deep-5678');

    // 补上 key 再重启，卡住的成员起来。
    await system(h, 'system.member.restart', { member: 'deepseek' });
    expect(await system(h, 'system.member.get', { member: 'deepseek' })).toMatchObject({ present: true, business: { state: 'ready' } });
    await resource('c0', { op: 'delete', resource_id: 'global/deepseek_prod' });
    expect(await resource('c0', { op: 'stat', resource_id: 'global/deepseek_prod' })).toMatchObject({ exists: false });
    h.wire.close();
  });

  it('answers ui.form with result or error and refuses the wrong shapes', async () => {
    const h = await harness();
    const pushed = await h.fetchSession('/mock/control/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'ui_form', channel_id: 'c0' }) }).then((response) => response.json());
    expect(pushed.session).toMatch(/^s-mock-/);
    const request = await waitFor(() => h.envelopes.find((row) => row.id === pushed.id));
    expect(request).toMatchObject({ type: 'ui.form', kind: 'request', audience: ['root'] });
    expect(request.payload.body).toMatchObject({ session: pushed.session, secret: { api_key: 'global/deepseek_prod' } });

    await expect(h.wire.resolve({ channel_id: 'c0', req_id: pushed.id, text: 'no' })).rejects.toMatchObject({ code: 'bad_payload' });
    await expect(h.wire.resolve({ channel_id: 'c0', req_id: pushed.id, error: { message: 'no code' } })).rejects.toMatchObject({ code: 'bad_payload' });
    const result = { values: { model: 'deepseek-chat' }, secret: { api_key: { resource: 'global/deepseek_prod', masked: '****1234' } } };
    await h.wire.resolve({ channel_id: 'c0', req_id: pushed.id, result });
    const response = await waitFor(() => h.envelopes.find((row) => row.parent_id === pushed.id));
    expect(response.payload.body).toEqual({ status: 'completed', ...result });
    await expect(h.wire.resolve({ channel_id: 'c0', req_id: pushed.id, result })).rejects.toMatchObject({ code: 'already_closed' });

    const second = await h.fetchSession('/mock/control/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'ui_form', channel_id: 'c0' }) }).then((reply) => reply.json());
    await waitFor(() => h.envelopes.find((row) => row.id === second.id));
    await h.wire.resolve({ channel_id: 'c0', req_id: second.id, error: { code: 'cancelled', message: '用户取消了表单' } });
    const cancelled = await waitFor(() => h.envelopes.find((row) => row.parent_id === second.id));
    expect(cancelled.payload.body).toEqual({ status: 'failed', error_code: 'cancelled', detail: '用户取消了表单' });
    h.wire.close();
  });

  it('refuses to deliver work to a member whose business layer is not ready', async () => {
    const h = await harness();
    const receipt = await h.wire.submit({ channel_id: 'c0', msg_type: 'agent.ask', kind: 'request', payload: { text: 'hi' }, audience: ['deepseek'] });
    const terminal = await waitFor(() => h.envelopes.find((row) => row.parent_id === receipt.message_id && row.payload?.body?.status === 'failed'));
    expect(terminal.payload.body).toMatchObject({ error_code: 'not_ready' });
    expect(terminal.payload.body.detail).toContain('missing global resource global/deepseek_prod');
    h.wire.close();
  });
});
