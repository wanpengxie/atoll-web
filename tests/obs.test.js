import { describe, expect, it } from 'vitest';
import { createObsClient } from '../src/net/obs.js';

describe('membership 读路径', () => {
  it('memberships 观察面已退役（成员清单随 attach 回执直接交付）', () => {
    const obs = createObsClient({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
    expect(obs.spaceMemberships).toBeUndefined();
  });
});

describe('Agent 模型选择观察面', () => {
  it('临时 agent-selection 端点已退役（值域走 describe，当前值走账本）', () => {
    const obs = createObsClient({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
    expect(obs.channelAgentSelection).toBeUndefined();
  });
});
