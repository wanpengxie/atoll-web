import { describe, expect, it } from 'vitest';
import { actorTemplateCommand, deviceCommand, isProtectedDeclaration, overlayCommand, parseJSONObject, profileCommand, safeDaemonRows, terminalValue } from '../src/model/space-administration.js';

const registrarRoster = [{ id: 'registrar', kind: 'tool', decl_id: 'atoll-internal:registrar-seat' }];
const channelRoster = [{ id: 'coreactor', kind: 'tool', decl_id: 'coreactor' }];

describe('space administration model', () => {
  it('builds registrar actor template commands and protects system declarations', () => {
    expect(actorTemplateCommand('register', { id: 'demo:agent', name: 'Demo', class: 'agent', visibility: 'private', config: { a: 1 } }, registrarRoster).payload).toEqual({ id: 'demo:agent', name: 'Demo', class: 'agent', visibility: 'private', config: { a: 1 } });
    expect(isProtectedDeclaration('atoll-internal:svcactor')).toBe(true);
    expect(() => actorTemplateCommand('revoke', { id: 'atoll-internal:svcactor' }, registrarRoster)).toThrow('受保护');
  });

  it('targets overlay/profile at the source channel coreactor', () => {
    expect(overlayCommand({ channelId: 'c0.work', declId: 'demo:agent', config: { model: 'x' }, roster: channelRoster })).toMatchObject({ channelId: 'c0.work', audience: ['coreactor'], payload: { channel_id: 'c0.work', decl_id: 'demo:agent', config: { model: 'x' } } });
    expect(profileCommand({ channelId: 'c0.work', description: 'Work', serving: 2, endpoints: {}, roster: channelRoster }).payload.serving).toBe(2);
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
    expect(deviceCommand('attach', { channelId: 'c0.work', deviceId: 'd1' }, registrarRoster).payload).toEqual({ channel_id: 'c0.work', device_id: 'd1' });
  });
});
