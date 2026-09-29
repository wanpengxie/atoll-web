import { describe, expect, it } from 'vitest';
import {
  actorDescriptionRef,
  actorMemberName,
  isStandardActorIdentity,
  isVisibleActor,
  latestActorDescriptions,
} from '../src/model/actor-visibility.js';
import { buildComposerModel, createComposerCommandRequest, parseComposerCommand } from '../src/ui/composer/composer-model.js';
import { GENERATED_BODY, SYSTEM_ACTOR_ID, SYSTEM_MEMBER_NAMES, TYPES } from '../src/protocol/vocab.js';

const AGENT = { id: 'agent:steward:1', kind: 'agent', name: 'Steward' };

describe('current management actor ownership', () => {
  it('keeps the channel system actor and runtime-generated members out of business roster rows', () => {
    const rows = [
      { id: 'human:root:1', kind: 'human' },
      AGENT,
      { id: SYSTEM_ACTOR_ID, kind: 'system' },
      { id: 'registrar', kind: 'system', body: GENERATED_BODY },
      { id: 'svcactor', kind: 'peer', body: GENERATED_BODY },
      // 运行时生成的 handle：kind 看着像业务成员，body 说它不在描述里。
      { id: 'agent:c0-child:3', kind: 'agent', body: GENERATED_BODY },
      { id: 'tool:search:2', kind: 'tool', body: 'actor search@1' },
    ];

    expect(rows.filter(isVisibleActor).map((row) => row.id)).toEqual(['human:root:1', AGENT.id, 'tool:search:2']);
    expect(isStandardActorIdentity({ id: SYSTEM_ACTOR_ID })).toBe(true);
    expect(SYSTEM_MEMBER_NAMES).toEqual(['registrar', 'svcactor']);
    expect(GENERATED_BODY).toBe('generated');
  });

  it('recognizes standard identity by kind, body or member name without hiding ordinary agents', () => {
    expect(isStandardActorIdentity({ id: 'registrar' })).toBe(true);
    expect(isStandardActorIdentity({ id: 'svcactor' })).toBe(true);
    // 老缓存里没有 body 的行按名字兜底：<kind>:<名字>:<届次> 的中间段。
    expect(isStandardActorIdentity({ id: 'system:registrar:4' })).toBe(true);
    expect(isStandardActorIdentity({ id: 'custom', kind: 'peer' })).toBe(true);
    expect(isStandardActorIdentity({ id: 'custom', kind: 'agent', body: GENERATED_BODY })).toBe(true);
    expect(isStandardActorIdentity({ id: AGENT.id, kind: 'agent', body: 'class codex' })).toBe(false);
    // 人恒可见，哪怕名字撞上系统名。
    expect(isStandardActorIdentity({ id: 'human:registrar:1', kind: 'human' })).toBe(false);
    expect(isVisibleActor(AGENT)).toBe(true);
    expect(actorMemberName('agent:c0-a:b:9')).toBe('c0-a:b');
    expect(actorMemberName('steward')).toBe('steward');
  });

  it('offers only the latest present version of each actor description when adding members', () => {
    const rows = [
      { name: 'writer', version: 1, class: 'claude', status: 'present' },
      { declared: { name: 'writer', version: 3, class: 'claude', status: 'retired' } },
      { name: 'writer', version: 2, class: 'claude', status: 'present' },
      { name: 'analyst', version: 1, class: 'codex-agent' },
      { name: '', version: 1 },
    ];
    expect(latestActorDescriptions(rows).map(actorDescriptionRef)).toEqual(['analyst@1', 'writer@2']);
    expect(latestActorDescriptions()).toEqual([]);
    expect(actorDescriptionRef({ ref: 'x@7', name: 'x', version: 1 })).toBe('x@7');
    expect(actorDescriptionRef({ name: 'x' })).toBe('');
  });

  it('parses /introduce into a member entry built from a class or an actor description', () => {
    expect(parseComposerCommand('/introduce writer writer@2')).toMatchObject({
      type: TYPES.member.create,
      payload: { name: 'writer', body: { actor: 'writer@2' } },
    });
    expect(parseComposerCommand('/introduce helper codex')).toMatchObject({
      type: TYPES.member.create,
      payload: { name: 'helper', body: { class: 'codex' } },
    });
  });

  it('routes channel governance commands to this channel system actor', () => {
    const model = buildComposerModel({
      activeChannelId: 'c0',
      draft: { text: '/members', recipients: [] },
      roster: [AGENT],
      access: 'member_active',
      agentSelection: { target: { kind: 'single', agent: AGENT } },
    });
    const parsed = parseComposerCommand('/members');
    const request = createComposerCommandRequest(model, parsed);
    expect(request).toMatchObject({
      channelId: 'c0', msgType: TYPES.member.list,
      audience: [SYSTEM_ACTOR_ID], targetLabel: SYSTEM_ACTOR_ID, payload: {},
    });
  });

  it('keeps targeted restart on the same system route while carrying the selected member', () => {
    const model = buildComposerModel({
      activeChannelId: 'c0',
      draft: { text: '/restart', recipients: [] },
      roster: [AGENT],
      access: 'member_active',
      agentSelection: { target: { kind: 'single', agent: AGENT } },
    });
    const request = createComposerCommandRequest(model, parseComposerCommand('/restart'));
    expect(request).toMatchObject({
      msgType: TYPES.member.restart,
      audience: [SYSTEM_ACTOR_ID],
      payload: { member: AGENT.id },
    });
  });
});
