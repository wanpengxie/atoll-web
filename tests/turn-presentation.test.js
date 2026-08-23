import { describe, expect, it } from 'vitest';
import { latestHumanProgress, turnProcessSummary, turnStatusLabel } from '../src/model/turn-presentation.js';

describe('F3 turn presentation', () => {
  it('summarizes business progress without flattening technical evidence into the main line', () => {
    const turn = {
      status: 'processing',
      latestStatus: 'processing',
      provisional: [
        { status: 'processing', envelope: { payload: { detail: '正在整理报告' } } },
        { status: 'processing', envelope: { payload: { status: 'processing', process: { kind: 'tool', phase: 'started' } } } },
        { status: 'processing', envelope: { payload: { status: 'processing', process: { kind: 'tool', phase: 'ended' } } } },
      ],
      anomalies: [{ code: 'terminal_conflict' }],
    };
    expect(turnStatusLabel(turn)).toBe('处理中');
    expect(latestHumanProgress(turn)).toBe('正在整理报告');
    expect(turnProcessSummary(turn)).toBe('3 条进展 · 1 个异常');
  });

});
