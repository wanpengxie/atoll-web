import { describe, expect, it } from 'vitest';
import { composerDelivery, deliverySourceLabel } from './composer-target.js';
import { resolveParameterAgent } from './agent-selection.js';

const HUMAN = { id: 'human:root:1', kind: 'human', name: 'root' };
const CLAUDE = { id: 'agent:claude:1', kind: 'agent', name: 'claude' };
const CODEX = { id: 'agent:codex:1', kind: 'agent', name: 'codex' };

describe('筛选决定默认收件人', () => {
  const roster = [HUMAN, CLAUDE, CODEX];

  it('过滤条只选中一个 agent 时，它就是默认目标', () => {
    const target = resolveParameterAgent({ filterAgentId: CODEX.id, roster });
    expect(target).toMatchObject({ kind: 'single', source: 'filter' });
    expect(target.agent.id).toBe(CODEX.id);
  });

  // 这一条是这次改动要治的病：手选是黏的（按频道存在 ref 里，恒不过期），
  // 筛选是刚点的且屏幕上看得见。屏幕上只剩「我和 codex」时回车发给 claude，
  // 就是本次报的那个错。
  it('筛选压过更早的手选', () => {
    const target = resolveParameterAgent({ filterAgentId: CODEX.id, manualAgentId: CLAUDE.id, roster });
    expect(target.agent.id).toBe(CODEX.id);
  });

  it('编辑框里的 @ 仍然压过筛选——它是当场写下的、最明确的一句话', () => {
    const target = resolveParameterAgent({ recipients: [CLAUDE], filterAgentId: CODEX.id, roster });
    expect(target).toMatchObject({ kind: 'single', source: 'mention' });
    expect(target.agent.id).toBe(CLAUDE.id);
  });

  it('筛选了但那个 id 已不在名册 → 判据链继续往下走，恒不空转', () => {
    const target = resolveParameterAgent({ filterAgentId: 'agent:gone:1', manualAgentId: CLAUDE.id, roster });
    expect(target).toMatchObject({ kind: 'single', source: 'manual' });
  });
});

describe('横幅报的收件人与 submit 同源', () => {
  it('无 @ 无回复 → 报默认目标，并说清凭什么是它', () => {
    const delivery = composerDelivery({ fallbackAgent: CODEX, fallbackSource: 'filter' });
    expect(delivery).toMatchObject({ kind: 'direct', source: 'filter' });
    expect(delivery.rows).toEqual([CODEX]);
    expect(deliverySourceLabel(delivery.source)).toBe('默认 · 跟随筛选');
  });

  // submit 对多个 @ 是逐个全发（含人类），横幅恒不能只报其中一个，
  // 也恒不能像参数面板那样把这一格收成"多目标"而不说是谁。
  it('@ 了多个成员 → 全部列出，人类也在内', () => {
    const delivery = composerDelivery({ recipients: [CLAUDE, HUMAN], fallbackAgent: CODEX, fallbackSource: 'recent' });
    expect(delivery.rows).toEqual([CLAUDE, HUMAN]);
    expect(delivery.source).toBe('mention');
  });

  it('只 @ 了人类 → 就是发给人类，恒不悄悄退回默认 agent', () => {
    const delivery = composerDelivery({ recipients: [HUMAN], fallbackAgent: CODEX, fallbackSource: 'recent' });
    expect(delivery.rows).toEqual([HUMAN]);
  });

  it('什么都没有 → 警告格；这一格按回车会被 submit 拒掉', () => {
    expect(composerDelivery({})).toMatchObject({ kind: 'none', rows: [], source: '' });
  });

  it('回复的人已不在频道 → 报失联，恒不退回默认目标假装发得出去', () => {
    const delivery = composerDelivery({ replyTarget: { senderName: 'kimi' }, replyRecipient: null, fallbackAgent: CODEX, fallbackSource: 'recent' });
    expect(delivery).toMatchObject({ kind: 'lost', lostName: 'kimi' });
    expect(delivery.rows).toEqual([]);
  });

  it('回复压过 @ 与默认目标', () => {
    const delivery = composerDelivery({ recipients: [CLAUDE], replyTarget: { senderName: 'root' }, replyRecipient: HUMAN, fallbackAgent: CODEX });
    expect(delivery.rows).toEqual([HUMAN]);
    expect(delivery.source).toBe('reply');
  });
});
