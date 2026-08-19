import { describe, expect, it } from 'vitest';
import { latestHumanProgress, turnProcessSummary, turnStatusLabel } from '../src/model/turn-presentation.js';

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

});
