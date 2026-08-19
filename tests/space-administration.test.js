import { describe, expect, it } from 'vitest';
import { actorTemplateCommand, deviceCommand, isProtectedDeclaration, overlayCommand, parseJSONObject, profileCommand, safeDaemonRows, terminalValue } from '../src/model/space-administration.js';

const roster = [{ id: 'system', kind: 'system', name: 'system' }];

describe('space administration model', () => {
  it('builds actor template commands and protects system declarations', () => {
    const command = actorTemplateCommand('register', { id: 'demo:agent', name: 'Demo', class: 'agent', visibility: 'private', config: { a: 1 } }, roster);
    expect(command.msgType).toBe('system.actor.template.create');
    expect(command.payload).toEqual({ id: 'demo:agent', name: 'Demo', class: 'agent', visibility: 'private', config: { a: 1 } });
    expect(isProtectedDeclaration('svcactor')).toBe(true);
    expect(() => actorTemplateCommand('revoke', { id: 'svcactor' }, roster)).toThrow('受保护');
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
