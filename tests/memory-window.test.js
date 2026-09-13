import { describe, expect, it } from 'vitest';
import { apply } from '../src/model/fold.js';
import { createChannelState } from '../src/model/fold.js';
import { estimateRowBytes, MOBILE_WINDOW, trimChannelState } from '../src/model/memory-window.js';
import { relatedEnvelopeIds, relatedEnvelopeIdsIncremental } from '../src/model/timeline-scope.js';

const ME = 'human:me:1';

function ask(seq, id, { text = 'hi', open = false } = {}) {
  return { channel_id: 'c', seq, envelope: { id, kind: 'request', type: 'agent.ask', sender: { id: ME }, audience: ['agent:a:1'], payload: { text }, correlation_id: id } };
}
function answer(seq, id, parent) {
  return { channel_id: 'c', seq, envelope: { id, kind: 'response', type: 'agent.ask', parent_id: parent, sender: { id: 'agent:a:1' }, audience: [ME], payload: { status: 'completed', text: 'ok' }, correlation_id: parent } };
}

function channelWith(pairs, { openLast = false } = {}) {
  const state = createChannelState('c');
  let seq = 1;
  for (let index = 0; index < pairs; index += 1) {
    const id = `q-${index}`;
    apply(state, ask(seq++, id), ME);
    if (!(openLast && index === pairs - 1)) apply(state, answer(seq++, `a-${index}`, id), ME);
  }
  return state;
}

describe('内存窗口', () => {
  it('超过水位才动手,一次砍到八成,并且留下的是最近的', () => {
    const state = channelWith(40);
    expect(state.rows.size).toBe(80);
    expect(trimChannelState(state, { maxRows: 100, maxBytes: 1e9 })).toBe(0);

    const removed = trimChannelState(state, { maxRows: 40, maxBytes: 1e9 });
    expect(removed).toBeGreaterThan(0);
    expect(state.rows.size).toBeLessThanOrEqual(40);
    expect(Math.max(...state.rows.keys())).toBe(80);
    // 摘掉的行不能在任何一张索引里留下影子。
    for (const id of state._seenIds) expect(state._envelopesById.has(id)).toBe(true);
    expect(state._seenIds.size).toBe(state._envelopesById.size);
    expect(state._envelopesById.size).toBe(state.rows.size);
    expect(state._rowMaxSeq).toHaveLength(state._rowOrder.length);
    expect(state._rowMaxSeq.every((value, index) => index === 0 || value >= state._rowMaxSeq[index - 1])).toBe(true);
  });

  it('低水位只决定一次保留多少,不会让每条新消息都触发裁剪', () => {
    const state = channelWith(21);
    trimChannelState(state, { maxRows: 40, maxBytes: 1e9 });
    expect(state.rows.size).toBeLessThan(40);
    const next = Math.max(...state.rows.keys()) + 1;
    apply(state, { channel_id: 'c', seq: next, envelope: { id: 'tail', kind: 'event', type: 'human.note', payload: { text: 'tail' } } }, ME);
    expect(trimChannelState(state, { maxRows: 40, maxBytes: 1e9 })).toBe(0);
  });

  // 半段 turn 恒不能渲染:开着的那一段整段留住,哪怕它比水位老。
  it('还没闭合的 turn 整段留住', () => {
    const state = channelWith(40, { openLast: true });
    const openTurn = [...state.turns.values()].find((turn) => !turn.terminal);
    trimChannelState(state, { maxRows: 4, maxBytes: 1e9 });
    expect(state.turns.has(openTurn.requestId)).toBe(true);
    expect(state.rows.has(openTurn.requestSeq)).toBe(true);
  });

  it('闭合且整段在窗口外的 turn 连同它的相关索引一起摘掉', () => {
    const state = channelWith(40);
    trimChannelState(state, { maxRows: 10, maxBytes: 1e9 });
    expect(state.turns.size).toBeLessThan(40);
    for (const ids of state.correlations.values()) {
      for (const id of ids) expect(state.turns.has(id)).toBe(true);
    }
    for (const turn of state.turns.values()) expect(state.rows.has(turn.requestSeq)).toBe(true);
  });

  // 窗口一动,增量索引的基线就不成立了——必须能重建出与全量版一致的答案。
  it('裁剪之后「我的往来」索引仍与全量版相等', () => {
    const state = channelWith(30);
    relatedEnvelopeIdsIncremental(state, ME);
    trimChannelState(state, { maxRows: 10, maxBytes: 1e9 });
    expect([...relatedEnvelopeIdsIncremental(state, ME)].sort()).toEqual([...relatedEnvelopeIds(state, ME)].sort());
  });

  // 往回翻会把窗口外的行补回来。增量索引按 seq 单向前进,认不出"更早的行又回来了",
  // 所以它必须自己发现基线不成立并重建——否则刚读回来的历史在「我的往来」里是隐形的。
  it('历史回读之后,索引把补回来的行也算进「我的往来」', () => {
    const state = createChannelState('c');
    let seq = 1;
    const rows = [];
    for (let index = 0; index < 12; index += 1) {
      const id = `q-${index}`;
      rows.push(ask(seq++, id), answer(seq++, `a-${index}`, id));
    }
    for (const row of rows) apply(state, row, ME);
    relatedEnvelopeIdsIncremental(state, ME);
    trimChannelState(state, { maxRows: 8, maxBytes: 1e9 });
    const afterTrim = relatedEnvelopeIdsIncremental(state, ME);
    expect(afterTrim.has('q-0')).toBe(false);

    // 回读:把最早那一对补回来。
    apply(state, rows[0], ME);
    apply(state, rows[1], ME);
    const afterBackfill = relatedEnvelopeIdsIncremental(state, ME);
    expect(afterBackfill.has('q-0')).toBe(true);
    expect([...afterBackfill].sort()).toEqual([...relatedEnvelopeIds(state, ME)].sort());
  });

  it('字节水位只会让窗口更小,恒不让它更大', () => {
    const fat = createChannelState('c');
    let seq = 1;
    for (let index = 0; index < 20; index += 1) {
      apply(fat, ask(seq++, `q-${index}`, { text: 'x'.repeat(50_000) }), ME);
      apply(fat, answer(seq++, `a-${index}`, `q-${index}`), ME);
    }
    trimChannelState(fat, { maxRows: 40, maxBytes: 200_000 });
    expect(fat.rows.size).toBeLessThan(40);
  });

  it('水位记在 evictedThrough 上:窗口外的行恒不再被当成新行', () => {
    const state = channelWith(20);
    trimChannelState(state, { maxRows: 8, maxBytes: 1e9 });
    expect(state.evictedThrough).toBeGreaterThan(0);
    expect(Math.min(...state.rows.keys())).toBeGreaterThan(state.evictedThrough);
  });

  it('估字节只量顶层字符串,恒不整条序列化', () => {
    expect(estimateRowBytes({ payload: { text: 'x'.repeat(1000) } })).toBeGreaterThan(1000);
    expect(estimateRowBytes({})).toBeGreaterThan(0);
  });

  it('移动端水位是 500 行 / 8MB', () => {
    expect(MOBILE_WINDOW).toEqual({ maxRows: 500, maxBytes: 8 * 1024 * 1024 });
  });
});
