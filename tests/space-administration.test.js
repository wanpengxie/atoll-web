import { describe, expect, it } from 'vitest';
import { actorTemplateCommand, deviceCommand, isProtectedDeclaration, overlayCommand, parseJSONObject, profileCommand, safeDaemonRows, terminalValue } from '../src/model/space-administration.js';

const roster = [{ id: 'system', kind: 'system', name: 'system' }];

describe('space administration model', () => {
  it('builds actor template commands and protects system declarations', () => {
    const command = actorTemplateCommand('register', { id: 'demo:agent', name: 'demo', class: 'agent', visibility: 'private', config: { a: 1 } }, roster);
    expect(command.msgType).toBe('system.actor.template.create');
    expect(command.payload).toEqual({ id: 'demo:agent', name: 'demo', class: 'agent', visibility: 'private', config: { a: 1 } });
    expect(isProtectedDeclaration('svcactor')).toBe(true);
    expect(() => actorTemplateCommand('revoke', { id: 'svcactor' }, roster)).toThrow('受保护');
  });

  // 声明的 name 会成为它坐出来的成员 actor id 的中间段，所以它守的是名字的规矩，
  // 不是标题的规矩。这里当场拦住，而不是把 "Demo Agent" 送出去换一句远端拒绝。
  it('refuses a declaration name that could not be an actor id segment', () => {
    for (const name of ['Demo Agent', '评审助手', '-lead', 'lead-', 'a:b', '']) {
      expect(() => actorTemplateCommand('register', { id: 'demo', name, class: 'agent' }, roster)).toThrow('名称是成员的名字');
    }
    expect(actorTemplateCommand('register', { id: 'demo', name: 'demo-agent-1', class: 'agent' }, roster).payload.name).toBe('demo-agent-1');
    // 编辑也守同一条，否则改个名就能绕过去。
    expect(() => actorTemplateCommand('edit', { id: 'demo', name: 'Demo Agent' }, roster)).toThrow('名称是成员的名字');
    expect(actorTemplateCommand('edit', { id: 'demo', description: '随便写的说明' }, roster).payload).toEqual({ id: 'demo', description: '随便写的说明' });
  });

  it('targets overlay/profile at the source channel system actor', () => {
    expect(overlayCommand({ channelId: 'c0.work', declId: 'demo:agent', config: { model: 'x' }, roster }))
      .toMatchObject({ channelId: 'c0.work', audience: ['system'], msgType: 'system.actor.overlay.set', payload: { channel_id: 'c0.work', decl_id: 'demo:agent', config: { model: 'x' } } });
    // system.channel.set 的 serving 是 0/1 闭集，且不接受 endpoints。
    expect(profileCommand({ channelId: 'c0.work', description: 'Work', serving: 1, roster }).payload)
      .toEqual({ channel_id: 'c0.work', description: 'Work', serving: 1 });
    expect(() => profileCommand({ channelId: 'c0.work', serving: 2, roster })).toThrow('serving');
  });

  it('projects daemon observations without secret fields', () => {
    const rows = safeDaemonRows({ items: [{ key: 'd1', declared: { id: 'd1', name: 'Mac', key: 'secret' }, actual: { measures: [{ name: 'online', value: true, unknown: false }] } }] });
    expect(rows).toEqual([{ id: 'd1', name: 'Mac', status: 'present', online: true, description: '' }]);
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it('parses object JSON and reads authoritative terminal phase', () => {
    expect(parseJSONObject('{"x":1}')).toEqual({ x: 1 });
    expect(() => parseJSONObject('[]')).toThrow('JSON 对象');
    const state = { turns: new Map([['r', { terminal: { payload: { status: 'completed', value: { ok: true } } } }]]) };
    expect(terminalValue(state, 'r')).toEqual({ phase: 'completed', value: { ok: true }, error: '' });
  });

  it('builds device actions with closed real fields', () => {
    const attach = deviceCommand('attach', { channelId: 'c0.work', deviceId: 'd1' }, roster);
    expect(attach.msgType).toBe('system.device.attach');
    expect(attach.payload).toEqual({ channel_id: 'c0.work', device_id: 'd1' });
    // 后端没有 device.claim 这个词。
    expect(() => deviceCommand('claim', { deviceId: 'd1', name: 'x' }, roster)).toThrow('未知设备操作');
  });
});
