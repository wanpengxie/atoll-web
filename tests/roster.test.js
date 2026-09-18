import { describe, expect, it, vi } from 'vitest';
import { createRoster, invalidatesRoster } from '../src/model/roster.js';


const observation = {
  items: [{
    key: 'human:root',
    declared: { id: 'human:root', kind: 'human', name: 'Root' },
    actual: { measures: [
      { name: 'bound', value: true, unknown: false },
      { name: 'device_online', value: null, unknown: true },
    ] },
  }],
};

describe('roster self fallback', () => {
  it('seeds the cached roster and self mapping before OBS is available', () => {
    const roster = createRoster({ obs: {}, me: 'principal-root' });
    roster.seed({ c0: [
      { id: 'human:root', kind: 'human', principal: 'principal-root', name: 'Root' },
      { id: 'agent:a', kind: 'agent', name: 'A' },
    ] });
    expect(roster.get('c0')).toHaveLength(2);
    expect(roster.self('c0')).toBe('human:root');
    expect(roster.authority('c0')).toBeNull();
    roster.close();
  });

  it('marks only a complete network observation as authoritative for its principal and channel', async () => {
    const channelActors = vi.fn()
      .mockResolvedValueOnce({ ...observation, complete: false })
      .mockResolvedValueOnce({ ...observation, complete: true });
    const roster = createRoster({ obs: { channelActors }, me: 'principal-root' });

    await roster.refresh('c0');
    expect(roster.authority('c0')).toEqual({
      principalId: 'principal-root', channelId: 'c0', complete: false,
    });
    await roster.refresh('c0');
    expect(roster.authority('c0')).toEqual({
      principalId: 'principal-root', channelId: 'c0', complete: true,
    });
    roster.reset();
    expect(roster.authority('c0')).toBeNull();
  });

  it('does not mistake a missing principal field for the current human', async () => {
    const roster = createRoster({
      obs: { channelActors: async () => observation },
      me: '',

    });
    await roster.refresh('c0');
    expect(roster.self('c0')).toBe('');
    roster.close();
  });

  it('learns and persists self by matching receipt message id to feed sender', () => {
    const roster = createRoster({
      obs: { channelActors: async () => observation },
      me: 'principal-root',

    });
    roster.recordSubmission('c0', 'message-1');
    expect(roster.ownsSubmission('c0', 'message-1')).toBe(true);
    expect(roster.ownsSubmission('other', 'message-1')).toBe(false);
    expect(roster.forgetSubmission('other', 'message-1')).toBe(false);
    expect(roster.observeFeed('c0', {
      id: 'message-1',
      kind: 'request',
      sender: { kind: 'human', id: 'human:root' },
    })).toBe('human:root');
    expect(roster.ownsSubmission('c0', 'message-1')).toBe(false);
    expect(roster.observeFeed('c0', {
      id: 'message-1', kind: 'request', sender: { kind: 'human', id: 'human:root' },
    })).toBe('');
    roster.recordSubmission('c0', 'rejected-message');
    expect(roster.forgetSubmission('c0', 'rejected-message')).toBe(true);
    expect(roster.ownsSubmission('c0', 'rejected-message')).toBe(false);
    expect(roster.self('c0')).toBe('human:root');
    roster.close();
  });
});

describe('roster OBS invalidation', () => {
  it('用公开的成员治理成功终态刷新名册，不依赖网页不可见的 system 叙事', () => {
    expect(invalidatesRoster({ kind: 'request', type: 'system.member.create', payload: { body: { decl_id: 'claude' } } })).toBe(false);
    expect(invalidatesRoster({ kind: 'response', type: 'system.member.create', payload: { status: 'failed' } })).toBe(false);
    expect(invalidatesRoster({ kind: 'response', type: 'system.member.create', payload: { status: 'completed', member: 'agent:claude:1' } })).toBe(true);
    expect(invalidatesRoster({ kind: 'event', type: 'system.member.created', payload: { member: 'agent:claude:1' } })).toBe(true);
  });

  it('成功终态到达后防抖重取 Actor OBS 并回报新成员', async () => {
    vi.useFakeTimers();
    const channelActors = vi.fn().mockResolvedValue({
      items: [{ key: 'agent:claude:1', declared: { id: 'agent:claude:1', kind: 'agent', name: 'claude' }, actual: { measures: [] } }],
    });
    const roster = createRoster({ obs: { channelActors }, debounceMs: 20 });
    const refreshed = vi.fn();
    roster.handleEnvelope('c0', {
      kind: 'response', type: 'system.member.create', payload: { status: 'completed', member: 'agent:claude:1' },
    }, refreshed);
    await vi.advanceTimersByTimeAsync(20);
    expect(channelActors).toHaveBeenCalledWith('c0');
    expect(refreshed).toHaveBeenCalledWith([expect.objectContaining({ id: 'agent:claude:1', name: 'claude' })]);
    roster.close();
    vi.useRealTimers();
  });
});
