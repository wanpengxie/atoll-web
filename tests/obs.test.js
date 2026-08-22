import { describe, expect, it } from 'vitest';
import { createObsClient, isUnsupportedMembershipObservation, ObsError } from '../src/net/obs.js';

describe('真实 Atoll 的可选 membership OBS', () => {
  it('兼容旧版 404 与当前 invalid_args/unknown kind 响应', () => {
    expect(isUnsupportedMembershipObservation(new ObsError(404, 'not_found', 'not found'))).toBe(true);
    expect(isUnsupportedMembershipObservation(new ObsError(400, 'invalid_args', 'unknown space observation kind'))).toBe(true);
  });

  it('不会吞掉其他 400 或服务故障', () => {
    expect(isUnsupportedMembershipObservation(new ObsError(400, 'invalid_args', 'missing parent_id'))).toBe(false);
    expect(isUnsupportedMembershipObservation(new ObsError(503, 'unavailable', 'temporarily unavailable'))).toBe(false);
  });
});

describe('Agent 模型选择观察面', () => {
  it('按频道读取临时 Model/Effort 契约', async () => {
    const fetchImpl = async (path) => ({ ok: true, json: async () => ({ path }) });
    const obs = createObsClient({ fetchImpl });
    await expect(obs.channelAgentSelection('c0.project')).resolves.toEqual({ path: '/obs/channel/c0.project/agent-selection' });
    await expect(obs.channelAgentSelection('c0', 'claude')).resolves.toEqual({ path: '/obs/channel/c0/agent-selection?actor_id=claude' });
  });
});
