import { describe, expect, it } from 'vitest';
import { isStandardActorIdentity, isVisibleActor } from '../src/model/actor-visibility.js';
import { buildComposerModel, createComposerCommandRequest, parseComposerCommand } from '../src/ui/composer/composer-model.js';
import { SYSTEM_ACTOR_ID, SYSTEM_DECL_IDS, TYPES } from '../src/protocol/vocab.js';

const AGENT = { id: 'agent:steward:1', kind: 'agent', name: 'Steward' };

describe('current management actor ownership', () => {
  it('keeps the channel system actor and genesis declarations out of business roster rows', () => {
    const rows = [
      { id: 'human:root:1', kind: 'human' },
      AGENT,
      { id: SYSTEM_ACTOR_ID, kind: 'system' },
      { id: 'registrar', kind: 'tool', decl_id: 'atoll-internal:registrar-seat' },
      { id: 'svcactor', kind: 'tool', decl_id: 'atoll-internal:svcactor' },
    ];

    expect(rows.filter(isVisibleActor).map((row) => row.id)).toEqual(['human:root:1', AGENT.id]);
    expect(isStandardActorIdentity({ id: SYSTEM_ACTOR_ID })).toBe(true);
    expect(SYSTEM_DECL_IDS).toEqual(['registrar', 'svcactor']);
  });

  it('recognizes standard identity by id or declaration without hiding ordinary agents', () => {
    expect(isStandardActorIdentity({ id: 'registrar' })).toBe(true);
    expect(isStandardActorIdentity({ id: 'svcactor' })).toBe(true);
    expect(isStandardActorIdentity({ id: 'custom', declarationId: 'coreactor' })).toBe(true);
    expect(isStandardActorIdentity({ id: AGENT.id, declarationId: 'mock:steward' })).toBe(false);
    expect(isVisibleActor(AGENT)).toBe(true);
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
