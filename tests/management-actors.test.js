import { describe, expect, it } from 'vitest';
import {
  actorDescriptionRef,
  isGeneratedMember,
  isVisibleActor,
  latestActorDescriptions,
} from '../src/model/actor-visibility.js';
import { rosterBodyLabel } from '../src/model/member-config.js';
import { buildComposerModel, createComposerCommandRequest, parseComposerCommand } from '../src/ui/composer/composer-model.js';
import { GENERATED_BODY, SYSTEM_ACTOR_ID, TYPES } from '../src/protocol/vocab.js';

const AGENT = { id: 'agent:steward:1', kind: 'agent', name: 'Steward' };

describe('current management actor ownership', () => {
  it('keeps the channel system actor and runtime-generated members out of business roster rows', () => {
    const rows = [
      { id: 'human:root:1', kind: 'human', body: 'human' },
      { ...AGENT, body: 'class codex' },
      { id: SYSTEM_ACTOR_ID, kind: 'system', body: GENERATED_BODY },
      { id: 'system:registrar:4', kind: 'system', body: GENERATED_BODY },
      { id: 'peer:svcactor:2', kind: 'peer', body: GENERATED_BODY },
      // 运行时生成的 handle：kind 看着像业务成员，body 说它不在描述里。
      { id: 'tool:c0-child:3', kind: 'tool', body: GENERATED_BODY },
      { id: 'tool:search:2', kind: 'tool', body: 'actor search@1' },
      // 手写在描述里的 peer 照常显示、能删。
      { id: 'peer:partner:5', kind: 'peer', body: 'class peeractor' },
    ];

    expect(rows.filter(isVisibleActor).map((row) => row.id)).toEqual(['human:root:1', AGENT.id, 'tool:search:2', 'peer:partner:5']);
    expect(GENERATED_BODY).toBe('generated');
  });

  it('knows the runtime\'s own members by body alone, never by kind or name', () => {
    expect(isGeneratedMember({ id: 'registrar', kind: 'system' })).toBe(false);
    expect(isGeneratedMember({ id: 'custom', kind: 'peer', body: 'class peeractor' })).toBe(false);
    expect(isGeneratedMember({ id: 'custom', kind: 'agent', body: GENERATED_BODY })).toBe(true);
    expect(isGeneratedMember({ id: 'human:registrar:1', kind: 'human', body: 'human' })).toBe(false);
    expect(isVisibleActor(AGENT)).toBe(true);
    // 名册行里人的 body 显示成"人"，其余照原话。
    expect(rosterBodyLabel('human')).toBe('人');
    expect(rosterBodyLabel('class codex')).toBe('class codex');
  });

  it('offers only the latest present version of each actor description when adding members', () => {
    // 按描述 id 分组；名字只显示，两条同名描述各算各的。
    const rows = [
      { id: 'd-w', name: 'writer', version: 1, class: 'claude', status: 'present' },
      { declared: { id: 'd-w', name: 'writer', version: 3, class: 'claude', status: 'retired' } },
      { id: 'd-w', name: 'writer', version: 2, class: 'claude', status: 'present' },
      { id: 'd-a', name: 'analyst', version: 1, class: 'codex-agent' },
      { id: 'd-w2', name: 'writer', version: 1, class: 'codex' },
      { id: '', name: 'orphan', version: 1 },
    ];
    expect(latestActorDescriptions(rows).map(actorDescriptionRef)).toEqual(['d-a@1', 'd-w@2', 'd-w2@1']);
    expect(latestActorDescriptions()).toEqual([]);
    expect(actorDescriptionRef({ ref: 'x@7', id: 'x', version: 1 })).toBe('x@7');
    expect(actorDescriptionRef({ id: 'x' })).toBe('');
  });

  it('parses /introduce into a member entry built from a class or an actor description', () => {
    expect(parseComposerCommand('/introduce actor:d-writer@2 writer')).toMatchObject({
      type: TYPES.member.create,
      payload: { name: 'writer', body: { actor: 'd-writer@2' } },
    });
    // 不带版本号就是最新版；名字可省。
    expect(parseComposerCommand('/introduce actor:d-writer').payload).toEqual({ body: { actor: 'd-writer' } });
    expect(parseComposerCommand('/introduce codex helper')).toMatchObject({
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
