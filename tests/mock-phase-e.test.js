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
  const envelopes = []; const states = [];
  const wire = createWire({ url: `${baseURL.replace('http', 'ws')}/ws`, WebSocketImpl: SessionWebSocket, onState: (state) => states.push(state), onFeed: (_channel, _seq, envelope) => envelopes.push(envelope) });
  await waitFor(() => states.includes('attached'));
  return { server, baseURL, fetchSession, wire, envelopes, states };
}

async function submitTerminal(h, msgType, payload, audience = ['system'], channelId = 'c0') {
  const receipt = await h.wire.submit({ channel_id: channelId, msg_type: msgType, kind: 'request', payload, audience });
  return waitFor(() => h.envelopes.find((row) => row.parent_id === receipt.message_id && ['completed', 'failed'].includes(row.payload?.body?.status)));
}

// channel.create 改了成员清单：网关推一份新清单（memberships 帧），连接不断。
async function createChannel(h, payload) {
  return submitTerminal(h, 'system.channel.create', payload);
}

afterEach(async () => Promise.all([...servers].map(close)));

describe('phase E stateful mock', () => {
  it('supports versioned actor descriptions: create, list, get the latest, retire', async () => {
    const h = await harness();
    const first = await submitTerminal(h, 'system.actor.description.create', { name: 'assistant', class: 'codex', params: { model: 'mock' }, description: '助手' });
    expect(first.payload.body.value).toMatchObject({ name: 'assistant', version: 1, ref: 'assistant@1', class: 'codex', params: { model: 'mock' }, status: 'present' });
    // 同名再建就是下一个版本；已有版本不变。
    const second = await submitTerminal(h, 'system.actor.description.create', { name: 'assistant', class: 'codex', params: { model: 'mock-2' } });
    expect(second.payload.body.value).toMatchObject({ ref: 'assistant@2', version: 2 });
    const list = await submitTerminal(h, 'system.actor.description.list', { name: 'assistant' });
    expect(list.payload.body.value.map((row) => [row.ref, row.params.model])).toEqual([['assistant@1', 'mock'], ['assistant@2', 'mock-2']]);

    const retired = await submitTerminal(h, 'system.actor.description.retire', { name: 'assistant', version: 2 });
    expect(retired.payload.body.value).toMatchObject({ ref: 'assistant@2', status: 'retired' });
    // 不给版本时 get 答最新的 present 版本。
    expect((await submitTerminal(h, 'system.actor.description.get', { name: 'assistant' })).payload.body.value).toMatchObject({ ref: 'assistant@1' });
    expect((await submitTerminal(h, 'system.actor.description.get', { name: 'assistant', version: 2 })).payload.body.value).toMatchObject({ status: 'retired' });

    // OBS 目录里 present 与 retired 的版本都在。
    const obs = await h.fetchSession('/obs/space/actor-descriptions').then((response) => response.json());
    const rows = obs.items.filter((row) => row.declared.name === 'assistant');
    expect(rows.map((row) => [row.key, row.declared.status])).toEqual([['assistant@1', 'present'], ['assistant@2', 'retired']]);

    const unknownClass = await submitTerminal(h, 'system.actor.description.create', { name: 'bad', class: 'no-such-class' });
    expect(unknownClass.payload.body).toMatchObject({ status: 'failed', error_code: 'invalid_args' });
    const legacy = await submitTerminal(h, 'system.actor.template.list', {});
    expect(legacy.payload.body.status).toBe('failed');
    h.wire.close(); await close(h.server);
  });

  it('edits a channel description with channel.set and copies it with copy_from, leaving member configs behind', async () => {
    const h = await harness();
    // c0 是平台搭的，没有描述可改。
    const platform = await submitTerminal(h, 'system.channel.set', { channel_id: 'c0', description: 'Configured', serving: 1 });
    expect(platform.payload.body).toMatchObject({ status: 'failed', error_code: 'reserved' });

    const set = await submitTerminal(h, 'system.channel.set', { channel_id: 'c0.project', description: 'Configured', serving: 1 });
    expect(set.payload.body.value).toEqual({ channel_id: 'c0.project', revision: 2 });
    const view = await submitTerminal(h, 'system.channel.get', { channel_id: 'c0.project' });
    expect(view.payload.body.value).toMatchObject({
      id: 'c0.project',
      description: { revision: 2, body: { description: 'Configured', serving: 1, members: [{ name: 'project-agent', body: { class: 'codex' } }] } },
    });
    // channel.get 只答注册库里的事实：没有健康，没有构建。
    for (const gone of ['health', 'health_reason', 'build', 'members']) expect(view.payload.body.value).not.toHaveProperty(gone);
    // 平台频道的 channel.get 没有描述。
    expect((await submitTerminal(h, 'system.channel.get', { channel_id: 'c0' })).payload.body.value).not.toHaveProperty('description');

    // 源频道成员这一台的配置不跟着复制。
    await submitTerminal(h, 'system.member.config.set', { member: 'project-agent', values: { effort: 'high' } }, ['system'], 'c0.project');
    const copied = await createChannel(h, { name: 'copy', parent: 'c0', humans: ['root'], copy_from: 'c0.project' });
    expect(copied.payload.body.value).toEqual({ channel_id: 'c0.copy', revision: 1 });
    const description = await submitTerminal(h, 'system.channel.description.get', { channel: 'c0.copy' });
    const sourceBody = view.payload.body.value.description.body;
    expect(description.payload.body.value).toEqual({ body: { ...sourceBody, members: [...sourceBody.members, { name: 'root', body: { human: true }, principal: 'root' }] }, revision: 1 });
    const state = await h.fetchSession('/mock/control/state').then((response) => response.json());
    expect(state.member_configs.filter((row) => row.member === 'project-agent').map((row) => row.channel_id)).toEqual(['c0.project']);
    expect(state.builds).toEqual(expect.arrayContaining([expect.objectContaining({ object: { kind: 'member', channel: 'c0.copy', name: 'project-agent' }, result: 'ok' })]));

    // description 和 copy_from 最多给一个；平台频道没有描述可复制。
    const both = await createChannel(h, { name: 'both', parent: 'c0', humans: [], description: {}, copy_from: 'c0.project' });
    expect(both.payload.body).toMatchObject({ status: 'failed', error_code: 'invalid_args' });
    const fromPlatform = await createChannel(h, { name: 'plat', parent: 'c0', humans: [], copy_from: 'c0' });
    expect(fromPlatform.payload.body).toMatchObject({ status: 'failed', error_code: 'invalid_args' });

    // 从本频道挑成员：新频道的描述里只有挑出来的条目。
    const picked = await createChannel(h, { name: 'picked', parent: 'c0', humans: ['root'], description: { description: '挑的', members: [{ name: 'helper', body: { actor: 'analyst@1' }, params: { effort: 'low' } }] } });
    expect(picked.payload.body.value).toEqual({ channel_id: 'c0.picked', revision: 1 });
    const pickedDescription = await submitTerminal(h, 'system.channel.description.get', { channel: 'c0.picked' });
    expect(pickedDescription.payload.body.value.body).toMatchObject({ description: '挑的', serving: 0, members: [{ name: 'helper', body: { actor: 'analyst@1' }, params: { effort: 'low' } }, { name: 'root', body: { human: true }, principal: 'root' }] });
    h.wire.close(); await close(h.server);
  });

  it('keeps device keys secret and attaches devices through the channel description', async () => {
    const h = await harness();
    const devices = await submitTerminal(h, 'system.channel.device.list', {});
    expect(devices.payload.body.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel_id: 'c0', device_id: 'local-device' }),
    ]));
    const minted = await submitTerminal(h, 'system.device.create', { name: 'Laptop' });
    expect(minted.payload.body.value.key).toMatch(/^mock-key-/);
    const deviceId = minted.payload.body.value.device_id;
    const daemons = await h.fetchSession('/obs/space/daemons').then((response) => response.json());
    expect(daemons.items.map((row) => row.declared.id)).toContain(deviceId);
    expect(JSON.stringify(daemons)).not.toContain(minted.payload.body.value.key);
    const snapshot = await h.fetchSession('/mock/control/state').then((response) => response.json());
    expect(JSON.stringify(snapshot)).not.toContain(minted.payload.body.value.key);

    // local-device 是每个频道的默认设备，不挂不卸。
    const local = await submitTerminal(h, 'system.device.attach', { channel_id: 'c0.project', device_id: 'local-device' });
    expect(local.payload.body).toMatchObject({ status: 'failed', error_code: 'reserved' });
    // 设备只挂到请求来的那个频道：从 c0 挂到 c0.project 被拒。
    const elsewhere = await submitTerminal(h, 'system.device.attach', { channel_id: 'c0.project', device_id: deviceId });
    expect(elsewhere.payload.body).toMatchObject({ status: 'failed', error_code: 'permission_denied' });
    const attached = await submitTerminal(h, 'system.device.attach', { channel_id: 'c0.project', device_id: deviceId }, ['system'], 'c0.project');
    expect(attached.payload.body.value).toMatchObject({ channel_id: 'c0.project', revision: 2 });
    const channelDevices = await h.fetchSession('/obs/channel/c0.project/devices').then((response) => response.json());
    expect(channelDevices.items.map((row) => [row.declared.device_id, row.declared.default])).toEqual([['local-device', true], [deviceId, false]]);
    expect((await submitTerminal(h, 'system.channel.description.get', { channel: 'c0.project' })).payload.body.value.body.devices).toEqual([deviceId]);
    await submitTerminal(h, 'system.device.detach', { channel_id: 'c0.project', device_id: deviceId }, ['system'], 'c0.project');
    const detached = await h.fetchSession('/obs/channel/c0.project/devices').then((response) => response.json());
    expect(detached.items.map((row) => row.declared.device_id)).toEqual(['local-device']);
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
    const put = await h.fetchSession(`/files?channel_id=c0&t=${encodeURIComponent(create.ticket)}`, { method: 'PUT', body: 'hello', headers: { 'Content-Type': 'text/plain' } });
    expect(put.status).toBe(200);
    const read = await h.wire.resource({ channel_id: 'c0', op: 'read', resource_id: create.resource_id, with_content: true });
    const get = await h.fetchSession(`/files?channel_id=c0&t=${encodeURIComponent(read.ticket)}`);
    expect(await get.text()).toBe('hello');
    expect(await h.wire.resource({ channel_id: 'c0', op: 'delete', resource_id: 'kv:demo' })).toMatchObject({ deleted: true });
    h.wire.close(); await close(h.server);
  });

  it('expires file tickets and permits a fresh ticket without reusing the old PUT', async () => {
    const h = await harness('resource-ticket-expired');
    const address = 'daemon://local-device/c0/expired.txt';
    const first = await h.wire.resource({ channel_id: 'c0', op: 'create', address, with_content: true });
    await h.fetchSession('/mock/control/advance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ms: 60_000 }) });
    const expired = await h.fetchSession(`/files?channel_id=c0&t=${encodeURIComponent(first.ticket)}`, { method: 'PUT', body: 'old' });
    expect(expired.status).toBe(403);
    const fresh = await h.wire.resource({ channel_id: 'c0', op: 'create', address, with_content: true });
    const uploaded = await h.fetchSession(`/files?channel_id=c0&t=${encodeURIComponent(fresh.ticket)}`, { method: 'PUT', body: 'fresh' });
    expect(uploaded.status).toBe(200);
    const repeated = await h.fetchSession(`/files?channel_id=c0&t=${encodeURIComponent(fresh.ticket)}`, { method: 'PUT', body: 'duplicate' });
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
