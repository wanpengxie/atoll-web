import { describe, expect, it, vi } from 'vitest';
import {
  buildComposerModel,
  createComposerCommandRequest,
  editCASPayload,
  parseComposerCommand,
} from '../src/ui/composer/composer-model.js';
import { createComposerCommandPort } from '../src/ui/composer/command-port.js';

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

  it('does not invent a target for restart, and preserves the explicit unavailable state', () => {
    const noTarget = buildComposerModel({
      activeChannelId: 'c0', draft: { text: '/restart' }, roster: [HUMAN], access: 'member_active',
    });
    expect(noTarget.controls.commands.restart).toMatchObject({ state: 'no-target', enabled: false });
    expect(() => createComposerCommandRequest(noTarget)).toThrowError(
      expect.objectContaining({ code: 'composer_command_no-target' }),
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
    expect(createComposerCommandRequest(ready)).toMatchObject({
      msgType: 'agent.compact', audience: [AGENT.id], targetLabel: AGENT.name, payload: {},
    });
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
