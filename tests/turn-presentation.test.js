import { describe, expect, it } from 'vitest';
import { latestHumanProgress, systemEventDetail, systemEventLabel, systemEventTier, turnProcessSummary, turnStatusLabel } from '../src/model/turn-presentation.js';

describe('F3 turn presentation', () => {
  it('summarizes business progress without flattening technical evidence into the main line', () => {
    const turn = {
      status: 'processing',
      latestStatus: 'processing',
      provisional: [{ status: 'processing', envelope: { payload: { detail: '正在整理报告' } } }],
      activity: [{ envelope: { type: 'agent.tool.started' } }, { envelope: { type: 'agent.tool.ended' } }],
      anomalies: [{ code: 'terminal_conflict' }],
    };
    expect(turnStatusLabel(turn)).toBe('处理中');
    expect(latestHumanProgress(turn)).toBe('正在整理报告');
    expect(turnProcessSummary(turn)).toBe('1 条进展 · 2 条技术活动 · 1 个异常');
  });

  it('prioritizes important system changes but keeps routine narration diagnostic', () => {
    expect(systemEventTier({ type: 'channel.membership.revoked', payload: {} })).toBe('important');
    expect(systemEventTier({ type: 'runtime.trace', payload: {} })).toBe('diagnostic');
    expect(systemEventTier({ type: 'runtime.trace', payload: { severity: 'warning' } })).toBe('important');
  });

  it('presents system narration as product language instead of protocol JSON', () => {
    const event = { type: 'system.member.created', payload: { actor_id: 'steward' } };
    expect(systemEventLabel(event)).toBe('成员已加入频道');
    expect(systemEventDetail(event)).toBe('steward');
    expect(systemEventLabel({ type: 'unknown.internal.event', payload: { raw: { secret: true } } })).toBe('后台状态已更新');
  });
});
