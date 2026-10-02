import { describe, expect, it } from 'vitest';
import { actorDisplayName, actorIdLabel, actorNameFromMap, actorNameMap } from '../src/model/actor-display.js';

describe('actor display name', () => {
  it('优先使用后端 name', () => {
    expect(actorDisplayName({ id: 'human:root:1787128257816', name: '管理员' })).toBe('管理员');
  });

  it('name 缺失时不拆 actor id：用 body，都没有就是"未命名成员"', () => {
    expect(actorDisplayName({ id: 'agent:x:1', body: 'class kimi' })).toBe('class kimi');
    expect(actorDisplayName({ id: 'human:root:1787128257816' })).toBe('未命名成员');
    expect(actorIdLabel('human:alice:1787128257816')).toBe('human:alice:1787128257816');
    // 频道自己的 system actor 是固定 id，照基线显示 system。
    expect(actorDisplayName({ id: 'system', body: 'generated' })).toBe('system');
    expect(actorNameFromMap('system', new Map())).toBe('system');
  });

  it('同名两个成员各自显示自己的名字，按完整 id 区分', () => {
    const names = actorNameMap([{ id: 'agent:a:1', name: 'helper' }, { id: 'agent:a:2', name: 'helper' }]);
    expect(names.get('agent:a:1')).toBe('helper');
    expect(names.get('agent:a:2')).toBe('helper');
  });

  it('名册里查不到时显示"未知成员"，不拆 id、也不露出完整 id', () => {
    expect(actorNameFromMap('agent:steward:42', new Map())).toBe('未知成员');
    expect(actorNameFromMap('plain-actor', actorNameMap([]))).toBe('未知成员');
  });
});
