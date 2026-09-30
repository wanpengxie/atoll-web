import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMockServer } from '../mock/server.mjs';
import { createIdentityClient } from '../src/net/identity.js';
import { createWire } from '../src/net/wire.js';

// actor-config 场景的 mock 契约：建好了没有（对外只有这一个状态）、member.get/set/config.set、构建记录、global/ 资源面、ui.form
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

async function system(h, msgType, payload, channelId = 'c0') {
  const receipt = await h.wire.submit({ channel_id: channelId, msg_type: msgType, kind: 'request', payload, audience: ['system'] });
  const terminal = await waitFor(() => h.envelopes.find((row) => row.parent_id === receipt.message_id && ['completed', 'failed'].includes(row.payload?.body?.status)));
  return terminal.payload.body;
}

// actor-config 场景的成员都在 c0.project：deepseek、search-tool、writer。
const PROJECT = 'c0.project';
const project = (h, msgType, payload) => system(h, msgType, payload, PROJECT);

// 成员 id 是 <kind>:<名字>:<届次>；名字是中间那段。
const memberName = (id) => String(id).split(':').slice(1, -1).join(':') || String(id);

async function projectRoster(h) {
  const roster = await h.fetchSession(`/obs/channel/${PROJECT}/actors`).then((response) => response.json());
  return roster.items;
}

afterEach(async () => Promise.all([...servers].map(close)));

describe('actor-config mock', () => {
  it('reports only built or not on the roster and on member.list/get, and answers member.get from the description', async () => {
    const h = await harness();
    const rows = await projectRoster(h);
    const row = (name) => rows.find((entry) => entry.declared.kind !== 'human' && memberName(entry.declared.id) === name);
    const bound = (entry) => entry.actual.measures.find((measure) => measure.name === 'bound').value;
    expect(row('deepseek').declared).toMatchObject({ kind: 'agent', body: 'actor deepseek@1' });
    // 起不来的成员对外只是"没建好"：没有两层、没有卡住或重试中。
    expect(bound(row('deepseek'))).toBe(false);
    expect(bound(row('search-tool'))).toBe(false);
    expect(bound(row('project-agent'))).toBe(true);
    for (const entry of rows) expect(entry.actual.measures.map((measure) => measure.name)).not.toEqual(expect.arrayContaining(['standard']));
    for (const entry of rows) expect(entry.actual.measures.map((measure) => measure.name)).not.toEqual(expect.arrayContaining(['business']));
    // writer 还有占位没填：构建失败，不在名册上。
    expect(row('writer')).toBeUndefined();
    // 运行时生成的成员 body 是 generated。
    expect(rows.find((entry) => entry.declared.id === 'svcactor').declared.body).toBe('generated');

    const list = await project(h, 'system.member.list', {});
    const deepseek = list.actors.find((entry) => memberName(entry.id) === 'deepseek');
    expect(deepseek).toMatchObject({ present: false, body: 'actor deepseek@1' });
    expect(deepseek).not.toHaveProperty('standard');
    expect(deepseek).not.toHaveProperty('business');
    expect(list.actors.find((entry) => memberName(entry.id) === 'project-agent')).toMatchObject({ present: true, body: 'class codex' });
    expect(list.actors.find((entry) => entry.id === 'svcactor')).toMatchObject({ body: 'generated' });

    const get = await project(h, 'system.member.get', { member: 'search-tool' });
    expect(get).toMatchObject({
      member: true, present: false, name: 'search-tool',
      class: 'mcp-tool', desired_host: 'local-device',
      body: { actor: 'search@1' },
      params: { endpoint: 'http://127.0.0.1:9000/mcp' },
      own_config: { values: {}, revision: 0 },
      effective: { endpoint: 'http://127.0.0.1:9000/mcp' },
      sources: { endpoint: 'member' },
      build: { object: { kind: 'member', channel: PROJECT, name: 'search-tool' } },
    });
    // 起不来的这次构建只有开始回执，没有结束（不补回执）。
    expect(get.build).not.toHaveProperty('result');
    expect(get).not.toHaveProperty('business');
    expect(memberName(get.actor_id)).toBe('search-tool');

    // 描述里有、没在跑的成员也答：还缺的占位和停下的构建。
    const writer = await project(h, 'system.member.get', { member: 'writer' });
    expect(writer).toMatchObject({
      actor_id: '', member: false, present: false,
      class: 'claude', body: { actor: 'writer@1' }, params: { temperature: 0.3 },
      missing: [{ key: 'service.api_key', hint: '写作服务的 API key' }],
      sources: { model: 'actor', 'service.api_key': 'actor', 'service.region': 'actor', temperature: 'member', effort: 'default' },
      build: { result: 'failed', state: 'stopped' },
    });
    expect(writer.build.reason).toContain('service.api_key is a placeholder still unfilled');

    // 运行时生成的成员没有描述条目。
    expect(await project(h, 'system.member.get', { member: 'svcactor' })).toMatchObject({ status: 'completed', generated: true });
    h.wire.close();
  });

  it('applies member.set to the description entry: body replaced, params merged, and refusals', async () => {
    const h = await harness();
    const before = (await project(h, 'system.channel.description.get', { channel: PROJECT })).value;
    // 没有 dry_run：它是个不认识的字段，被拒绝，什么都没写。
    const dry = await project(h, 'system.member.set', { member: 'search-tool', params: { endpoint: 'http://127.0.0.1:9100/mcp', extra: 1 }, dry_run: true });
    expect(dry).toMatchObject({ status: 'failed', error_code: 'invalid_args' });
    expect(dry.detail).toContain('dry_run');
    expect((await project(h, 'system.channel.description.get', { channel: PROJECT })).value.revision).toBe(before.revision);

    const badBody = await project(h, 'system.member.set', { member: 'search-tool', body: { actor: 'search' } });
    expect(badBody).toMatchObject({ status: 'failed', error_code: 'invalid_args' });
    expect(badBody.detail).toContain('name@version');

    // 人不在频道描述里，没有条目可改。
    const human = await project(h, 'system.member.set', { member: 'root-project', params: {} });
    expect(human).toMatchObject({ status: 'failed', error_code: 'invalid_args' });

    // 旧的 class/config 形状被拒绝。
    const legacy = await project(h, 'system.member.set', { member: 'search-tool', config: { endpoint: 'x' } });
    expect(legacy.status).toBe('failed');

    const fixed = await project(h, 'system.member.set', { member: 'search-tool', params: { endpoint: 'http://127.0.0.1:9100/mcp', extra: 1 } });
    expect(fixed).toMatchObject({ status: 'completed', value: { written: true, description_revision: before.revision + 1 } });
    // params 是合并补丁：null 删键，其余的键留着。
    const cleared = await project(h, 'system.member.set', { member: 'search-tool', params: { extra: null } });
    expect(cleared.value.entry.params).toEqual({ endpoint: 'http://127.0.0.1:9100/mcp' });
    expect(await project(h, 'system.member.get', { member: 'search-tool' })).toMatchObject({ present: true, build: { result: 'ok', state: 'ready' } });

    // body 换成另一个 class：成员按新 body 重建。
    await project(h, 'system.member.set', { member: 'search-tool', body: { class: 'mcp-tool' } });
    expect(await project(h, 'system.member.get', { member: 'search-tool' })).toMatchObject({ body: { class: 'mcp-tool' }, class: 'mcp-tool' });
    h.wire.close();
  });

  it('refuses member.set in c0, whose members are fixed, but still takes their own config', async () => {
    const h = await harness();
    const refused = await system(h, 'system.member.set', { member: 'steward', params: { model: 'x' } });
    expect(refused).toMatchObject({ status: 'failed', error_code: 'reserved' });
    expect(refused.detail).toContain('no description');
    const created = await system(h, 'system.member.create', { name: 'helper', body: { class: 'codex' } });
    expect(created).toMatchObject({ status: 'failed', error_code: 'reserved' });
    const own = await system(h, 'system.member.config.set', { member: 'steward', values: { effort: 'high' } });
    expect(own).toMatchObject({ status: 'completed', member: 'steward', values: { effort: 'high' }, revision: 1 });
    expect(await system(h, 'system.member.get', { member: 'steward' })).toMatchObject({ effective: { effort: 'high' }, sources: { effort: 'config' } });
    h.wire.close();
  });

  it('turns a failed build ok once member.config.set fills the placeholder, and narrates the build', async () => {
    const h = await harness();
    const dry = await project(h, 'system.member.config.set', { member: 'writer', values: { service: { api_key: 'sk-write' } }, dry_run: true });
    expect(dry).toMatchObject({ status: 'failed', error_code: 'bad_payload' });
    expect(dry.detail).toContain('dry_run');
    expect(await project(h, 'system.member.get', { member: 'writer' })).toMatchObject({ member: false, build: { state: 'stopped' } });

    // 前端填占位时发的就是 patchAtPath 算出来的那一小块补丁。
    const filled = await project(h, 'system.member.config.set', { member: 'writer', values: { service: { api_key: 'sk-write' } } });
    expect(filled).toMatchObject({ status: 'completed', member: 'writer', desired_host: '', values: { service: { api_key: 'sk-write' } }, revision: 1 });
    const writer = await project(h, 'system.member.get', { member: 'writer' });
    expect(writer).toMatchObject({
      member: true, present: true,
      own_config: { values: { service: { api_key: 'sk-write' } }, revision: 1 },
      sources: { 'service.api_key': 'config', 'service.region': 'actor' },
      build: { result: 'ok', state: 'ready', attempt: 1, config: { revision: 1 } },
    });
    expect(writer).not.toHaveProperty('missing');
    expect((await projectRoster(h)).some((entry) => memberName(entry.declared.id) === 'writer')).toBe(true);

    // 构建的开始和结束作为 system 事件进本频道账本。
    const finished = await waitFor(() => h.envelopes.find((row) => row.channel_id === PROJECT && row.type === 'system.build.finished' && row.payload?.body?.object?.name === 'writer'));
    expect(finished.payload.body).toMatchObject({ result: 'ok', state: 'ready' });
    expect(h.envelopes.some((row) => row.channel_id === PROJECT && row.type === 'system.build.started' && row.payload?.body?.object?.name === 'writer')).toBe(true);

    // 运行设备指到一台没挂到本频道的设备：构建失败并说清为什么。
    await project(h, 'system.member.config.set', { member: 'writer', desired_host: 'device-x' });
    const moved = await project(h, 'system.member.get', { member: 'writer' });
    expect(moved.build).toMatchObject({ result: 'failed', state: 'stopped' });
    expect(moved.build.reason).toContain('desired_host device-x');

    // 不在频道描述里的名字没有自己的配置。
    expect(await project(h, 'system.member.config.set', { member: 'nobody', values: { a: 1 } })).toMatchObject({ status: 'failed', error_code: 'invalid_args' });
    h.wire.close();
  });

  it('keeps global/ in one space-wide store reachable from any channel', async () => {
    const h = await harness();
    const resource = (channelId, payload) => h.wire.resource({ channel_id: channelId, ...payload });
    expect((await resource('c0', { op: 'list', query: { prefix: 'global/' } })).items.map((row) => row.id)).toEqual(['global/openai_prod']);
    await resource('c0', { op: 'create', resource_id: 'global/deepseek_prod', args: 'sk-deep-1234' });
    // 另一个频道的资源面看见的是同一份。
    expect(await resource('c0.project', { op: 'stat', resource_id: 'global/deepseek_prod' })).toMatchObject({ exists: true, meta: { kind: 'kv' } });
    // 和真后端的资源门一样：拒绝是一张 status:"rejected" 的回执，不是错误帧。
    expect(await resource('c0', { op: 'create', resource_id: 'global/deepseek_prod', args: 'again' })).toMatchObject({ status: 'rejected', detail: 'already_exists' });
    await expect(resource('c0', { op: 'create', resource_id: 'global/Bad Name', args: 'x' })).rejects.toMatchObject({ code: 'bad_payload' });
    await resource('c0.project', { op: 'write', resource_id: 'global/deepseek_prod', args: 'sk-deep-5678' });
    // 频道自己的 KV 列表里没有全局 key。
    expect((await resource('c0', { op: 'list' })).items.some((row) => String(row.id).startsWith('global/'))).toBe(false);
    const state = await h.fetchSession('/mock/control/state').then((response) => response.json());
    const digest = createHash('sha256').update(JSON.stringify('sk-deep-5678')).digest('hex');
    expect(state.globals.find((row) => row.id === 'global/deepseek_prod')).toMatchObject({ value_sha256: digest });
    expect(JSON.stringify(state)).not.toContain('sk-deep-5678');

    // 补上 key 再重启，卡住的成员起来。
    const deepseekId = (await projectRoster(h)).find((entry) => memberName(entry.declared.id) === 'deepseek').declared.id;
    await project(h, 'system.member.restart', { member: deepseekId });
    expect(await project(h, 'system.member.get', { member: 'deepseek' })).toMatchObject({ present: true });
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

  // 没建好的成员没有投递端点：请求留在账本里、不回复（actor.describe 也一样），
  // 由请求自己的过期收尾——和基线一样，没有 not_ready。
  it('delivers nothing to a member that is not built, and answers nothing', async () => {
    const h = await harness();
    const deepseekId = (await projectRoster(h)).find((entry) => memberName(entry.declared.id) === 'deepseek').declared.id;
    const asked = await h.wire.submit({ channel_id: PROJECT, msg_type: 'agent.ask', kind: 'request', payload: { text: 'hi' }, audience: [deepseekId] });
    const described = await h.wire.submit({ channel_id: PROJECT, msg_type: 'actor.describe', kind: 'request', payload: {}, audience: [deepseekId] });
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const receipt of [asked, described]) expect(h.envelopes.some((row) => row.parent_id === receipt.message_id)).toBe(false);
    h.wire.close();
  });
});
