import { describe, expect, it } from 'vitest';
import { systemEventPresentation } from '../src/model/system-event-presentation.js';
import { decodeSystemEvent } from '../src/protocol/system-events.js';

describe('system event protocol projection', () => {
  it('decodes the closed backend contract by event type', () => {
    expect(decodeSystemEvent({ type: 'system.member.created', payload: { member: 'steward', decl_id: 'mock:steward' } })).toEqual({
      kind: 'member_joined', type: 'system.member.created', valid: true, memberId: 'steward', declarationId: 'mock:steward', principalId: '', reason: '',
    });
    expect(decodeSystemEvent({ type: 'system.channel.inbound', payload: { from: 'c0.peer', type: 'agent.ask', local_request_id: 'req-1' } })).toMatchObject({
      kind: 'channel_inbound', valid: true, fromChannel: 'c0.peer', requestType: 'agent.ask', localRequestId: 'req-1',
    });
  });

  it('never guesses semantics from arbitrary JSON field names', () => {
    expect(decodeSystemEvent({ type: 'system.member.created', payload: { actor_id: 'steward' } })).toMatchObject({ kind: 'invalid', valid: false });
    expect(systemEventPresentation({ type: 'unknown.internal.event', payload: { actor_id: 'steward', text: '伪造标题', severity: 'critical' } })).toMatchObject({
      hidden: false, tier: 'diagnostic', title: '后台状态已更新', detail: '',
    });
  });

  it('maps canonical facts to product language and hides standard actors', () => {
    const names = new Map([['steward', 'Steward']]);
    expect(systemEventPresentation({ type: 'system.member.created', payload: { member: 'steward', decl_id: 'mock:steward' } }, names)).toMatchObject({
      hidden: false, tier: 'important', title: 'Steward 已加入频道',
    });
    expect(systemEventPresentation({ type: 'system.member.created', payload: { member: 'svcactor', decl_id: 'svcactor' } }, names)).toMatchObject({ hidden: true });
  });
});
