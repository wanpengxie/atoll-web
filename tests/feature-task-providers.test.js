import { describe, expect, it } from 'vitest';
import { selectFeatureTaskProviders } from '../src/model/feature-tasks.js';

describe('TC-1496 feature task provider public owner', () => {
  it('[TC-1496] 只接受 Describe 明确声明 task.create 的 provider', () => {
    // 用户能力：任务中心只把确实声明 task.create 的 Agent 呈现为任务执行者。
    // 不变量：provider 列表只由公开 Describe 能力事实和当前 roster 交集产生，
    // 不能因 roster 存在、旧缓存或其他 command 猜测 task.create。
    // 公共 owner：selectFeatureTaskProviders。
    const capabilities = new Map([
      ['agent', {
        actorId: 'agent',
        describe: { types: new Map([['task.create', { allowedKinds: ['request'] }]]) },
      }],
      ['viewer', {
        actorId: 'viewer',
        describe: { types: new Map([['agent.ask', { allowedKinds: ['request'] }]]) },
      }],
    ]);
    const roster = [
      { id: 'agent', name: '执行者' },
      { id: 'viewer', name: '观察者' },
    ];

    expect(selectFeatureTaskProviders(capabilities, roster)).toEqual([
      { actorId: 'agent', name: '执行者' },
    ]);
  });
});
