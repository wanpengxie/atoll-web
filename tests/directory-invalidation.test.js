import { describe, expect, it } from 'vitest';
import { invalidatesChannelDirectory } from '../src/model/directory-invalidation.js';

describe('directory OBS invalidation', () => {
  it('频道、成员和放置关系变化会使目录投影失效', () => {
    for (const type of [
      'system.channel.create', 'system.channel.set', 'system.channel.delete',
      'system.member.create', 'system.member.admit', 'system.member.delete',
      'system.device.attach', 'system.device.detach', 'system.device.delete',
      'system.member.created', 'system.member.deleted', 'system.channel.inbound',
    ]) expect(invalidatesChannelDirectory({ type })).toBe(true);
  });

  it('普通消息、过程和只读治理词不会刷新目录', () => {
    for (const type of ['agent.ask', 'human.message', 'system.channel.list', 'system.member.get', 'actor.describe']) {
      expect(invalidatesChannelDirectory({ type })).toBe(false);
    }
  });
});
