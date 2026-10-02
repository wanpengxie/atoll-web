import { describe, expect, it } from 'vitest';
import { createMockDomain } from '../mock/domain.mjs';
import { loadScenario } from '../mock/scenarios.mjs';

// 领域层直接测：频道描述、Actor 描述、这一台的配置和构建记录。不起服务器。

function domain(scenario = 'actor-config') {
  return createMockDomain(loadScenario(scenario));
}

// 测试里按条目的显示名找到它的配置 id（只为写测试方便；产品代码只认 id）。
function configId(mock, channelId, name) {
  const entry = mock.entriesOf(channelId).find((row) => row.name === name);
  return entry ? mock.ensureConfig(channelId, entry.id).config_id : '';
}

function rosterNames(value, channelId) {
  return (value.rosters.get(channelId) || []).filter((row) => ['agent', 'tool'].includes(row.declared.kind)).map((row) => row.declared.name);
}

describe('mock domain: descriptions, member config and builds', () => {
  it('copies a channel description with copy_from and leaves the source members\' own config behind', () => {
    const mock = domain();
    mock.setMemberConfig('c0.project', { member: configId(mock, 'c0.project', 'writer'), values: { service: { api_key: 'sk-1' } } });
    const source = mock.channelDescription('c0.project');
    const created = mock.createChannel('c0', { name: 'copy', parent: 'c0', humans: ['root'], copy_from: 'c0.project' });
    expect(created).toEqual({ channel_id: 'c0.copy', revision: 1 });
    mock.finishBuilds();
    // 抄的是描述（条目 id 原样）；humans 里的 root 已在源频道的描述里，不重复。
    expect(mock.channelDescription('c0.copy')).toEqual({ body: source.body, revision: 1 });
    // 配置没跟过来：新频道给同一个条目建了一份新的空配置（新的配置 id），writer 的占位
    // 又缺了，构建失败，不在名册上。
    const copied = configId(mock, 'c0.copy', 'writer');
    expect(copied).not.toBe(configId(mock, 'c0.project', 'writer'));
    expect(mock.memberConfig('c0.copy', copied)).toMatchObject({ config_id: copied, desired_host: '', values: {}, revision: 1 });
    expect(mock.memberInfo('c0.copy', copied)).toMatchObject({ member: false, missing: [{ key: 'service.api_key' }], build: { result: 'failed' } });
    expect(rosterNames(mock, 'c0.copy')).not.toContain('writer');
    expect(rosterNames(mock, 'c0.project')).toContain('writer');
    // humans 里的人成了新频道的成员；自己是 owner。
    expect(mock.activeMembership('root', 'c0.copy')).toMatchObject({ role: 'owner' });
  });

  it('refuses create payloads that name both a description and copy_from, or copy a platform channel', () => {
    const mock = domain();
    expect(() => mock.createChannel('c0', { name: 'x', description: {}, copy_from: 'c0.project' })).toThrow(expect.objectContaining({ code: 'invalid_args' }));
    expect(() => mock.createChannel('c0', { name: 'y', copy_from: 'c0' })).toThrow(expect.objectContaining({ code: 'invalid_args' }));
    expect(() => mock.createChannel('c0', { name: 'z', copy_from: 'c0.nope' })).toThrow(expect.objectContaining({ code: 'not_found' }));
    expect(() => mock.createChannel('c0', { name: 'w', humans: ['stranger'] })).toThrow(expect.objectContaining({ code: 'not_found' }));
    expect(() => mock.createChannel('c0', { name: 'v', description: { members: [{ name: 'a', body: { class: 'codex', actor: 'x@1' } }] } })).toThrow(expect.objectContaining({ code: 'invalid_args' }));
    // 新频道的条目 id 由 registrar 铸：带了 id 就拒。
    expect(() => mock.createChannel('c0', { name: 'u', description: { members: [{ id: 'e-forged', name: 'a', body: { class: 'codex' } }] } })).toThrow(expect.objectContaining({ code: 'invalid_args' }));
    expect(mock.channel('c0.x')).toBeNull();
  });

  it('turns a failed build ok when member.config.set fills the placeholder', () => {
    const mock = domain();
    // 还没建起来的成员没有 actor id：按配置 id 问、按配置 id 改。
    const writer = configId(mock, 'c0.project', 'writer');
    expect(mock.memberInfo('c0.project', writer)).toMatchObject({ member: false, config_id: writer, build: { result: 'failed', state: 'stopped' } });
    mock.takeEvents();
    const reply = mock.setMemberConfig('c0.project', { member: writer, values: { service: { api_key: '$global.openai_prod' } } });
    expect(reply).toMatchObject({ config_id: writer, desired_host: '', values: { service: { api_key: '$global.openai_prod' } }, revision: 2 });
    // 和真节点一样，回复先到，构建之后才进行：此刻名册和构建记录都还是旧的。
    expect(rosterNames(mock, 'c0.project')).not.toContain('writer');
    expect(mock.memberInfo('c0.project', writer)).toMatchObject({ build: { result: 'failed' } });
    expect(mock.takeEvents()).toEqual([]);
    mock.finishBuilds();
    const info = mock.memberInfo('c0.project', writer);
    expect(info).toMatchObject({ member: true, present: true, build: { result: 'ok', state: 'ready', attempt: 1, config: { config_id: writer, revision: 2 } } });
    expect(info).not.toHaveProperty('missing');
    expect(info.effective.service).toEqual({ api_key: '$global.openai_prod', region: 'cn' });
    expect(rosterNames(mock, 'c0.project')).toContain('writer');
    expect(mock.takeEvents().map((event) => [event.channelId, event.type, event.payload.result])).toEqual([
      ['c0.project', 'system.build.started', undefined],
      ['c0.project', 'system.build.finished', 'ok'],
    ]);
    // values 是合并补丁：null 把键删掉，占位又露出来。
    mock.setMemberConfig('c0.project', { member: writer, values: { service: { api_key: null } } });
    mock.finishBuilds();
    expect(mock.memberInfo('c0.project', writer)).toMatchObject({ member: false, missing: [{ key: 'service.api_key' }], build: { result: 'failed', state: 'stopped' } });
  });

  it('refuses member.set and member.create in c0, whose members are fixed, but still edits their own config', () => {
    // c0 has no description: the registry answers reserved, as it does for
    // every description write on a channel the platform builds.
    const mock = domain();
    // c0 的 steward 是平台推导出来的成员（生成键），不在任何描述里，也没有配置。
    const steward = mock.rosters.get('c0').find((row) => row.declared.generated === 'steward').declared.id;
    expect(() => mock.setMemberEntry('c0', { member: steward, params: { model: 'x' } })).toThrow(expect.objectContaining({ code: 'invalid_args' }));
    expect(() => mock.createMemberEntry('c0', { name: 'helper', body: { class: 'codex' } })).toThrow(expect.objectContaining({ code: 'reserved' }));
    expect(() => mock.setChannel('c0', { description: 'x' })).toThrow(expect.objectContaining({ code: 'reserved' }));
    expect(() => mock.channelDescription('c0')).toThrow(expect.objectContaining({ code: 'reserved' }));
    expect(() => mock.setMemberConfig('c0', { member: steward, values: { effort: 'high' } })).toThrow(expect.objectContaining({ code: 'invalid_args' }));
    expect(mock.memberInfo('c0', steward)).toMatchObject({ actor_id: steward, generated: 'steward' });
  });

  it('changes a channel description only from that channel, or from c0 through its peer, like the registrar', () => {
    const mock = domain();
    expect(() => mock.setChannel('c0.project', { description: 'x' }, { from: 'c0.other' })).toThrow(expect.objectContaining({ code: 'permission_denied' }));
    expect(mock.setChannel('c0.project', { description: 'from itself' }, { from: 'c0.project' })).toMatchObject({ channel_id: 'c0.project' });
    expect(mock.setChannel('c0.project', { description: 'from c0' }, { from: 'c0' })).toMatchObject({ channel_id: 'c0.project' });
    expect(mock.channelDescription('c0.project').body.description).toBe('from c0');
    // 设备只挂到请求来的那个频道，c0 也不例外。
    const { device_id: device } = mock.mintDevice('laptop');
    expect(() => mock.bindDevice('c0.project', device, true, { from: 'c0' })).toThrow(expect.objectContaining({ code: 'permission_denied' }));
    expect(mock.bindDevice('c0.project', device, true, { from: 'c0.project' })).toMatchObject({ channel_id: 'c0.project' });
  });

  it('versions actor descriptions and points a member at a newer one', () => {
    const mock = domain();
    const writer = configId(mock, 'c0.project', 'writer');
    // 给 d-writer 出新版本：带它的 id。
    const next = mock.putActorDescription({ id: 'd-writer', name: 'writer', class: 'claude', params: { model: 'claude-opus', service: { api_key: 'k', region: 'us' } } });
    expect(next).toMatchObject({ id: 'd-writer', ref: 'd-writer@2', version: 2, status: 'present' });
    // 不带 id 是新的一条：同名也互不相干。
    const other = mock.putActorDescription({ name: 'writer', class: 'codex' });
    expect(other.id).not.toBe('d-writer');
    expect(other).toMatchObject({ version: 1, name: 'writer' });
    // 钉死 @1 的成员不跟新版本，只提示。
    expect(mock.memberInfo('c0.project', writer).note).toContain('d-writer@2');
    const set = mock.setMemberEntry('c0.project', { member: writer, body: { actor: 'd-writer@2' } });
    expect(set).toMatchObject({ written: true, entry: { name: 'writer', body: { actor: 'd-writer@2' }, params: { temperature: 0.3 } } });
    mock.finishBuilds();
    expect(mock.memberInfo('c0.project', writer)).toMatchObject({ member: true, build: { result: 'ok' }, effective: { service: { region: 'us' } } });
    mock.retireActorDescription('d-writer', 1);
    expect(mock.actorDescription('d-writer')).toMatchObject({ ref: 'd-writer@2' });
    expect(mock.actorDescriptionRows().find((row) => row.key === 'd-writer@1').declared.status).toBe('retired');
  });
});
