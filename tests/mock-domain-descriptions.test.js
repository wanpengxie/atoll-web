import { describe, expect, it } from 'vitest';
import { createMockDomain } from '../mock/domain.mjs';
import { loadScenario } from '../mock/scenarios.mjs';

// 领域层直接测：频道描述、Actor 描述、这一台的配置和构建记录。不起服务器。

const memberName = (id) => String(id).split(':').slice(1, -1).join(':') || String(id);

function domain(scenario = 'actor-config') {
  return createMockDomain(loadScenario(scenario));
}

function rosterNames(value, channelId) {
  return (value.rosters.get(channelId) || []).filter((row) => ['agent', 'tool'].includes(row.declared.kind)).map((row) => memberName(row.declared.id));
}

describe('mock domain: descriptions, member config and builds', () => {
  it('copies a channel description with copy_from and leaves the source members\' own config behind', () => {
    const mock = domain();
    mock.setMemberConfig('c0.project', { member: 'writer', values: { service: { api_key: 'sk-1' } } });
    const source = mock.channelDescription('c0.project');
    const created = mock.createChannel('c0', { name: 'copy', parent: 'c0', humans: ['root'], copy_from: 'c0.project' });
    expect(created).toEqual({ channel_id: 'c0.copy', revision: 1 });
    // humans 里的人成了新描述里的人的条目。
    expect(mock.channelDescription('c0.copy')).toEqual({ body: { ...source.body, members: [...source.body.members, { name: 'root', body: { human: true }, principal: 'root' }] }, revision: 1 });
    // 配置没跟过来：writer 的占位在新频道里又缺了，构建失败，不在名册上。
    expect(mock.memberConfig('c0.copy', 'writer')).toEqual({ member: 'writer', desired_host: '', values: {}, revision: 0 });
    expect(mock.memberInfo('c0.copy', 'writer')).toMatchObject({ member: false, missing: [{ key: 'service.api_key' }], build: { result: 'failed' } });
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
    expect(mock.channel('c0.x')).toBeNull();
  });

  it('turns a failed build ok when member.config.set fills the placeholder', () => {
    const mock = domain();
    expect(mock.memberInfo('c0.project', 'writer')).toMatchObject({ member: false, build: { result: 'failed', state: 'stopped' } });
    mock.takeEvents();
    const reply = mock.setMemberConfig('c0.project', { member: 'writer', values: { service: { api_key: '$global.openai_prod' } } });
    expect(reply).toEqual({ member: 'writer', desired_host: '', values: { service: { api_key: '$global.openai_prod' } }, revision: 1 });
    const info = mock.memberInfo('c0.project', 'writer');
    expect(info).toMatchObject({ member: true, present: true, build: { result: 'ok', state: 'ready', attempt: 1, config: { revision: 1 } } });
    expect(info).not.toHaveProperty('missing');
    expect(info.effective.service).toEqual({ api_key: '$global.openai_prod', region: 'cn' });
    expect(rosterNames(mock, 'c0.project')).toContain('writer');
    expect(mock.takeEvents().map((event) => [event.channelId, event.type, event.payload.result])).toEqual([
      ['c0.project', 'system.build.started', undefined],
      ['c0.project', 'system.build.finished', 'ok'],
    ]);
    // values 是合并补丁：null 把键删掉，占位又露出来。
    mock.setMemberConfig('c0.project', { member: 'writer', values: { service: { api_key: null } } });
    expect(mock.memberInfo('c0.project', 'writer')).toMatchObject({ member: false, missing: [{ key: 'service.api_key' }], build: { result: 'failed', state: 'stopped' } });
  });

  it('refuses member.set and member.create in c0, whose members are fixed, but still edits their own config', () => {
    // c0 has no description: the registry answers reserved, as it does for
    // every description write on a channel the platform builds.
    const mock = domain();
    expect(() => mock.setMemberEntry('c0', { member: 'steward', params: { model: 'x' } })).toThrow(expect.objectContaining({ code: 'reserved' }));
    expect(() => mock.createMemberEntry('c0', { name: 'helper', body: { class: 'codex' } })).toThrow(expect.objectContaining({ code: 'reserved' }));
    expect(() => mock.setChannel('c0', { description: 'x' })).toThrow(expect.objectContaining({ code: 'reserved' }));
    expect(() => mock.channelDescription('c0')).toThrow(expect.objectContaining({ code: 'reserved' }));
    expect(mock.setMemberConfig('c0', { member: 'steward', values: { effort: 'high' } })).toMatchObject({ revision: 1 });
    expect(mock.memberInfo('c0', 'steward')).toMatchObject({ body: { class: 'codex' }, sources: { effort: 'config', model: 'default' } });
  });

  it('versions actor descriptions and points a member at a newer one', () => {
    const mock = domain();
    const next = mock.putActorDescription({ name: 'writer', class: 'claude', params: { model: 'claude-opus', service: { api_key: 'k', region: 'us' } } });
    expect(next).toMatchObject({ ref: 'writer@2', version: 2, status: 'present' });
    expect(mock.memberInfo('c0.project', 'writer').note).toContain('writer@2');
    const set = mock.setMemberEntry('c0.project', { member: 'writer', body: { actor: 'writer@2' } });
    expect(set).toMatchObject({ written: true, entry: { name: 'writer', body: { actor: 'writer@2' }, params: { temperature: 0.3 } } });
    expect(mock.memberInfo('c0.project', 'writer')).toMatchObject({ member: true, build: { result: 'ok' }, effective: { service: { region: 'us' } } });
    mock.retireActorDescription('writer', 1);
    expect(mock.actorDescription('writer')).toMatchObject({ ref: 'writer@2' });
    expect(mock.actorDescriptionRows().find((row) => row.key === 'writer@1').declared.status).toBe('retired');
  });
});
