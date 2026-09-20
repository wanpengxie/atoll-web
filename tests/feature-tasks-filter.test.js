import { describe, expect, it } from 'vitest';
import { featureTaskGroup, filterFeatureTasks } from '../src/model/feature-tasks.js';

describe('TC-1498 feature task filter public owner', () => {
  it('[TC-1498] 按责任、状态和类型筛选，并保持自动动作独立分组', () => {
    // 用户能力：任务中心默认展示需要我处理的项目；用户切换到全量已完成
    // 时仍能看到历史项，同时设备自动动作保留独立分组。
    // 不变量：筛选只消费当前公开任务事实，不改变 item 顺序之外的事实，也
    // 不把 automation 归入普通回合。
    // 公共 owner：filterFeatureTasks / featureTaskGroup。
    const items = [
      { key: 'a', kind: 'approval', state: 'waiting', assigneeActorIds: ['me'], actionableBySelf: true, priority: 'high', updatedAt: 1 },
      { key: 'b', kind: 'automation', state: 'waiting', assigneeActorIds: [], actionableBySelf: true, priority: 'normal', updatedAt: 2 },
      { key: 'c', kind: 'agent_run', state: 'completed', assigneeActorIds: ['agent'], actionableBySelf: false, priority: 'normal', updatedAt: 3 },
    ];

    expect(filterFeatureTasks(items, { selfId: 'me' }).map((item) => item.key)).toEqual(['a', 'b']);
    expect(filterFeatureTasks(items, { scope: 'all', status: 'completed', selfId: 'me' }).map((item) => item.key)).toEqual(['c']);
    expect(featureTaskGroup(items[1])).toBe('automation');
  });
});
