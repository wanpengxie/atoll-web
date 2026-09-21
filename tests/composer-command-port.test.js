import { describe, expect, it, vi } from 'vitest';
import {
  buildComposerModel,
  createComposerCommandRequest,
  editCASPayload,
  parseComposerCommand,
} from '../src/ui/composer/composer-model.js';
import { createComposerCommandPort } from '../src/ui/composer/command-port.js';
import { createControlCommand } from '../src/model/control-command.js';

const AGENT = { id: 'agent:steward:1', kind: 'agent', name: 'Steward' };
const HUMAN = { id: 'human:root:1', kind: 'human', name: 'Root' };

function model(text, extra = {}) {
  return buildComposerModel({
    activeChannelId: 'c0',
    draft: { text, recipients: [] },
    roster: [HUMAN, AGENT],
    access: 'member_active',
    agentSelection: { selectedAgentId: AGENT.id },
    ...extra,
  });
}

describe('current Composer command owner', () => {
  it('routes /restart to the channel system actor and names the selected Agent', () => {
    const parsed = parseComposerCommand('/restart');
    expect(model('/rest').commandMenu.rows.map((row) => row.command)).toContain('restart');
    expect(parsed).toMatchObject({
      kind: 'command', command: 'restart', type: 'system.member.restart', scope: 'system-target',
    });

    const request = createComposerCommandRequest(model('/restart'));
    expect(request).toEqual({
      channelId: 'c0',
      text: '',
      msgType: 'system.member.restart',
      audience: ['system'],
      targetLabel: 'system',
      payload: { member: AGENT.id },
    });
  });

  it('keeps the public restart candidate on the same canonical control port', () => {
    const request = createComposerCommandRequest(model('/restart'));
    const command = createControlCommand(request);
    expect(command).toEqual({
      channelId: 'c0',
      text: '',
      msgType: 'system.member.restart',
      audience: ['system'],
      targetLabel: 'system',
      payload: { member: AGENT.id },
    });
  });

  it('does not invent a target for restart, and preserves the explicit unavailable state', () => {
    const noTarget = buildComposerModel({
      activeChannelId: 'c0', draft: { text: '/restart' }, roster: [HUMAN], access: 'member_active',
    });
    expect(noTarget.controls.commands.restart).toMatchObject({ state: 'no-target', enabled: false });
    expect(() => createComposerCommandRequest(noTarget)).toThrowError(
      expect.objectContaining({ code: 'composer_command_no-target' }),
    );
  });

  it('does not expose restart while the current channel transport is unavailable', () => {
    const unavailable = model('/restart', {
      access: {
        relationship: 'member',
        existence: 'present',
        runtime: 'open',
        unavailable: true,
        canEditDraft: true,
        canDurablyAccept: true,
        canTransmit: false,
        reason: '频道暂不可用',
        transportOpen: false,
      },
    });
    expect(unavailable.controls.commands.restart).toMatchObject({ state: 'offline', enabled: false });
    expect(() => createComposerCommandRequest(unavailable)).toThrowError(
      expect.objectContaining({ code: 'composer_command_offline' }),
    );
  });

  it('preserves rejected and uncertain restart outcomes as retryable public facts', () => {
    const recovery = model('/restart', {
      pending: [
        {
          messageId: 'restart-rejected',
          channelId: 'c0',
          frame: {
            msg_type: 'system.member.restart',
            audience: ['system'],
            payload: { member: AGENT.id },
          },
          state: 'rejected',
          error: { code: 'protected_actor' },
        },
        {
          messageId: 'restart-uncertain',
          channelId: 'c0',
          frame: {
            msg_type: 'system.member.restart',
            audience: ['system'],
            payload: { member: AGENT.id },
          },
          state: 'uncertain',
          error: { code: 'closed' },
        },
      ],
    });
    expect(recovery.failures.map((row) => ({ id: row.messageId, state: row.state }))).toEqual([
      { id: 'restart-rejected', state: 'rejected' },
      { id: 'restart-uncertain', state: 'uncertain' },
    ]);
    expect(recovery.failures).toEqual([
      expect.objectContaining({
        frame: expect.objectContaining({
          msg_type: 'system.member.restart',
          audience: ['system'],
          payload: { member: AGENT.id },
        }),
      }),
      expect.objectContaining({
        frame: expect.objectContaining({
          msg_type: 'system.member.restart',
          audience: ['system'],
          payload: { member: AGENT.id },
        }),
      }),
    ]);
    expect(recovery.failure).toMatchObject({ messageId: 'restart-uncertain', state: 'uncertain' });
  });

  it('does not invent a channel-wide restart command', () => {
    expect(() => parseComposerCommand('/restart_all')).toThrowError(
      expect.objectContaining({ code: 'composer_command_unknown' }),
    );
  });

  it('keeps Agent commands capability-gated while system restart remains a separate route', () => {
    const cold = model('/compact');
    expect(cold.controls.commands.compact).toMatchObject({ state: 'unknown', enabled: false });
    expect(() => createComposerCommandRequest(cold)).toThrowError(
      expect.objectContaining({ code: 'composer_command_unknown' }),
    );

    const ready = model('/compact', {
      capabilityIndex: new Map([[AGENT.id, { describe: { types: new Set(['agent.compact']) } }]]),
    });
    expect(ready.controls.commands.compact).toMatchObject({ state: 'supported', enabled: true });
    expect(createComposerCommandRequest(ready)).toEqual({
      channelId: 'c0',
      text: '',
      msgType: 'agent.compact',
      audience: [AGENT.id],
      targetLabel: AGENT.name,
      payload: {},
    });
  });

  it('[TC0657/AD-363] projects request-allowed describe words into slash entries and typed payloads', () => {
    const capabilityIndex = new Map([[AGENT.id, {
      describe: { types: new Map([
        ['agent.custom-control', {
          description: '自定义控制',
          inputSchema: {
            type: 'object',
            properties: {
              count: { type: 'integer' },
              enabled: { type: 'boolean' },
              tags: { type: 'array', items: { type: 'string' } },
              level: { type: 'string', enum: ['low', 'high'] },
            },
            required: ['count'],
          },
        }],
      ]) },
    }]]);
    const menu = model('/', { capabilityIndex });
    expect(menu.commandMenu.rows.map((row) => row.command)).toContain('custom-control');

    const ready = model('/custom-control {"count":3,"enabled":true,"tags":["x"],"level":"high"}', { capabilityIndex });
    expect(createComposerCommandRequest(ready)).toEqual({
      channelId: 'c0',
      text: '',
      msgType: 'agent.custom-control',
      audience: [AGENT.id],
      targetLabel: AGENT.name,
      payload: { count: 3, enabled: true, tags: ['x'], level: 'high' },
    });

    for (const text of [
      '/custom-control {"enabled":true}',
      '/custom-control {"count":"3"}',
      '/custom-control {"count":3,"tags":[3]}',
      '/custom-control {"count":3,"level":"medium"}',
    ]) {
      expect(() => createComposerCommandRequest(model(text, { capabilityIndex }))).toThrowError(
        expect.objectContaining({ code: 'composer_command_payload_invalid' }),
      );
    }
  });

  it('fails closed for unknown, non-request, and schema-less describe words', () => {
    const capabilityIndex = new Map([[AGENT.id, {
      describe: { types: new Map([
        ['agent.response-only', {
          inputSchema: { type: 'object' },
          raw: { allowed_kinds: ['response'] },
        }],
        ['agent.empty-kinds', {
          inputSchema: { type: 'object' },
          raw: { allowed_kinds: [] },
        }],
        ['agent.no-schema', { raw: { allowed_kinds: ['request'] } }],
      ]) },
    }]]);
    const cases = ['/unknown {"ok":true}', '/response-only {}', '/empty-kinds {}', '/no-schema {}'];
    for (const text of cases) {
      const current = model(text, { capabilityIndex });
      expect(current.commandMenu).toBeNull();
      expect(() => createComposerCommandRequest(current)).toThrowError(
        expect.objectContaining({ code: 'composer_command_unknown' }),
      );
    }
  });

  it('rejects non-typed dynamic payloads without evaluating the schema', () => {
    const capabilityIndex = new Map([[AGENT.id, {
      describe: { types: new Map([['agent.custom-control', {
        inputSchema: {
          type: 'object',
          properties: { count: { type: 'integer' } },
          required: ['count'],
        },
      }]]) },
    }]]);
    expect(() => createComposerCommandRequest(model('/custom-control {"count":"3"}', { capabilityIndex }))).toThrowError(
      expect.objectContaining({ code: 'composer_command_payload_invalid' }),
    );
    expect(() => parseComposerCommand('/custom-control (() => true)', model('/', { capabilityIndex }).commandDefinitions)).toThrowError(
      expect.objectContaining({ code: 'composer_command_payload_invalid' }),
    );
  });

  it('does not register malformed dynamic schemas or treat missing type as any', () => {
    const cases = [
      ['replace', { properties: { expected_hold_id: { type: 'string' } } }, { expected_hold_id: 7 }],
      ['scalar', { type: 'string' }, { value: 'ok' }],
      ['bad-properties', { type: 'object', properties: [] }, {}],
      ['bad-required', { type: 'object', required: 'value', properties: { value: { type: 'number' } } }, {}],
      ['bad-child', { type: 'object', properties: { value: {} } }, { value: 'ok' }],
      ['unsupported-keyword', { type: 'object', properties: { value: { type: 'string', pattern: '^ok$' } } }, { value: 'ok' }],
      ['open-additional-properties', { type: 'object', additionalProperties: true }, {}],
      ['non-plain-schema', new Map([['type', 'object']]), {}],
    ];
    for (const [command, inputSchema, payload] of cases) {
      const capabilityIndex = new Map([[AGENT.id, { describe: { types: new Map([[`agent.${command}`, { inputSchema }]]) } }]]);
      const current = model(`/${command} ${JSON.stringify(payload)}`, { capabilityIndex });
      expect(current.commandDefinitions.some((row) => row.command === command), command).toBe(false);
      expect(current.commandMenu).toBeNull();
      expect(() => createComposerCommandRequest(current)).toThrowError(
        expect.objectContaining({ code: 'composer_command_unknown' }),
      );
    }
  });

  it('enforces nested object types, required fields, and closed extra-field contracts', () => {
    const inputSchema = {
      type: 'object',
      required: ['options'],
      additionalProperties: false,
      properties: {
        options: {
          type: 'object',
          required: ['count'],
          additionalProperties: false,
          properties: {
            count: { type: 'integer' },
            label: { type: 'string' },
          },
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    const capabilityIndex = new Map([[AGENT.id, {
      describe: { types: new Map([['agent.nested-control', { inputSchema }]]) },
    }]]);
    const valid = model('/nested-control {"options":{"count":3,"label":"ok"},"tags":["a"]}', { capabilityIndex });
    expect(createComposerCommandRequest(valid)).toMatchObject({
      msgType: 'agent.nested-control',
      payload: { options: { count: 3, label: 'ok' }, tags: ['a'] },
    });

    const invalidPayloads = [
      '/nested-control {"options":{}}',
      '/nested-control {"options":{"count":"3"}}',
      '/nested-control {"options":{"count":3,"extra":true}}',
      '/nested-control {"options":{"count":3},"extra":true}',
      '/nested-control {"options":{"count":3},"tags":[3]}',
    ];
    for (const text of invalidPayloads) {
      expect(() => createComposerCommandRequest(model(text, { capabilityIndex }))).toThrowError(
        expect.objectContaining({ code: 'composer_command_payload_invalid' }),
      );
    }
  });

  it('rejects command transport while reply or attachment ownership is active', () => {
    expect(() => createComposerCommandRequest(model('/restart', {
      draft: { text: '/restart', replyTarget: { sourceId: 'm1', senderId: AGENT.id } },
    }))).toThrowError(expect.objectContaining({ code: 'composer_command_reply' }));
    expect(() => createComposerCommandRequest(model('/restart', {
      draft: { text: '/restart', attachments: [{ resource_id: 'file:1' }] },
    }))).toThrowError(expect.objectContaining({ code: 'composer_command_attachments' }));
  });

  it('publishes edit CAS payload only with the current hold identity', () => {
    expect(editCASPayload({ targetId: 'message-1', oldText: 'old', holdId: 'hold-3' }, 'new')).toEqual({
      target: 'message-1', old_text: 'old', new_text: 'new', expected_hold_id: 'hold-3',
    });
    expect(editCASPayload({ target: 'message-1', oldText: 'old' }, 'new')).toEqual({
      target: 'message-1', old_text: 'old', new_text: 'new',
    });
    expect(() => editCASPayload({ targetId: 'message-1' }, '   ')).toThrow('编辑内容不能为空');
  });
});

describe('one committed Composer command port', () => {
  it('never lets stale cleanup retire the newer committed owner', async () => {
    const port = createComposerCommandPort();
    const sendA = vi.fn();
    const sendB = vi.fn(() => 'B');
    const releaseA = port.commit({ send: sendA });
    const releaseB = port.commit({ send: sendB });

    expect(releaseA()).toBe(false);
    await expect(port.commands.send('message')).resolves.toBe('B');
    expect(sendA).not.toHaveBeenCalled();
    expect(sendB).toHaveBeenCalledWith('message');
    expect(releaseB()).toBe(true);
    await expect(port.commands.send('late')).rejects.toMatchObject({ code: 'composer_owner_retired' });
  });

  it('retires all commands explicitly when the channel owner unmounts', async () => {
    const port = createComposerCommandPort();
    const operation = vi.fn();
    port.commit({ send: operation });
    port.retire();

    await expect(port.commands.send('message')).rejects.toMatchObject({ code: 'composer_owner_retired' });
    expect(operation).not.toHaveBeenCalled();
  });
});
