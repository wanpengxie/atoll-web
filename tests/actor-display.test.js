import { describe, expect, it } from 'vitest';
import { actorDisplayName, actorIdLabel, actorNameFromMap, actorNameMap } from '../src/model/actor-display.js';

describe('actor display name', () => {
  it('优先使用后端 name', () => {
    expect(actorDisplayName({ id: 'human:root:1787128257816', name: '管理员' })).toBe('管理员');
  });

  it('name 缺失或等于完整 actor_id 时显示中间业务段', () => {
    expect(actorDisplayName({ id: 'human:root:1787128257816' })).toBe('root');
    expect(actorDisplayName({ id: 'human:root:1787128257816', name: 'human:root:1787128257816' })).toBe('root');
    expect(actorIdLabel('human::alice::1787128257816')).toBe('alice');
  });

  it('无法命中 roster 时也不会退回完整的三段 actor_id', () => {
    expect(actorNameFromMap('agent:steward:42', new Map())).toBe('steward');
    expect(actorNameFromMap('plain-actor', actorNameMap([]))).toBe('plain-actor');
  });
});
