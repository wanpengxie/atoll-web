import { describe, expect, it } from 'vitest';
import { createMockDomain } from '../mock/domain.mjs';
import { loadScenario, scenarioIds } from '../mock/scenarios.mjs';

describe('mock scenario and domain layers', () => {
  it('contains every phase A and future-development scenario', () => {
    expect(scenarioIds()).toEqual(expect.arrayContaining([
      'first-login', 'multi-channel', 'message-flow', 'approval', 'network-drop',
      'permission-revoked', 'channel-retired', 'projection-delay', 'actor-capability',
      'channel-governance', 'space-governance', 'resource-workflow', 'scheduled-action',
      'message-structured-success', 'message-empty-success', 'message-failed',
      'business-provisional', 'provisional-after-terminal', 'terminal-conflict',
      'receipt-delayed', 'feed-delayed', 'receipt-lost-feed-landed', 'obs-partial',
      'real-backend-shape',
    ]));
  });

  it('provides Phase B behavior, availability and membership control', () => {
    const domain = createMockDomain(loadScenario('message-structured-success'));
    expect(domain.behavior.message).toBe('structured');
    expect(domain.setChannelOpen('c0.project', false).open).toBe(false);
    expect(domain.canWrite('root', 'c0.project')).toBe(false);
    domain.setChannelOpen('c0.project', true);
    domain.revokeMembership('root', 'c0.project');
    expect(domain.canRead('root', 'c0.project')).toBe(false);
    expect(domain.grantMembership('root', 'c0.project')).toMatchObject({ status: 'active' });
    expect(domain.canWrite('root', 'c0.project')).toBe(true);
  });

  it('never gives an authenticated principal lobby membership', () => {
    for (const id of scenarioIds()) {
      const domain = createMockDomain(loadScenario(id));
      expect(domain.activeMembership('root', 'c0.lobby')).toBeNull();
      expect(domain.canRead('root', 'c0.lobby')).toBe(false);
    }
  });

  it('separates space discovery from active membership', () => {
    const domain = createMockDomain(loadScenario('multi-channel'));
    expect(domain.channelRows('c0').map((item) => item.declared.id)).toEqual(['c0.project', 'c0.public']);
    expect(domain.membershipRows('root').map((item) => item.declared.channel_id)).toEqual(['c0', 'c0.project']);
    expect(domain.canRead('root', 'c0.public')).toBe(false);
    expect(domain.canWrite('root', 'c0.project')).toBe(true);
  });

  it('is deterministic for the same scenario, seed and clock actions', () => {
    const left = createMockDomain(loadScenario('permission-revoked', 9));
    const right = createMockDomain(loadScenario('permission-revoked', 9));
    expect(left.nextId('request')).toBe(right.nextId('request'));
    left.advance(5_000);
    right.advance(5_000);
    expect(left.snapshot()).toEqual(right.snapshot());
    expect(left.canWrite('root', 'c0.project')).toBe(false);
  });

  it('retires a channel when virtual time reaches its scheduled action', () => {
    const domain = createMockDomain(loadScenario('channel-retired'));
    domain.advance(4_999);
    expect(domain.channel('c0.project').status).toBe('present');
    domain.advance(1);
    expect(domain.channel('c0.project')).toMatchObject({ status: 'retired', open: false });
  });
});
