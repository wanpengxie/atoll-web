import { describe, expect, it } from 'vitest';
import { relatedEnvelopeIds, relatedEnvelopeIdsIncremental } from '../src/model/timeline-scope.js';

// 增量索引唯一的正当性来源:它的输出与全量版逐个元素相等。这里按"一帧一帧地长"
// 喂给它,每喂一行就跟全量版对一次账——恒不只对最终态,因为中间态才是屏幕上的东西。
function stateOf(rows) {
  return { rows: new Map(rows.map((row) => [row.seq, row])), lastSeq: rows.at(-1)?.seq || 0 };
}

function envelope(seq, fields) {
  return { seq, id: `m-${seq}`, kind: 'request', type: 'agent.ask', ...fields };
}

function grow(rows) {
  const grown = [];
  const seen = [];
  for (const row of rows) {
    seen.push(row);
    grown.push(stateOf(seen));
  }
  return grown;
}

const ME = 'human:me:1';

describe('增量的「我的往来」索引与全量版等价', () => {
  it('逐帧生长时,每一帧都与全量版相等', () => {
    const rows = [
      envelope(1, { sender: { id: ME }, audience: ['agent:a:1'], correlation_id: 'c-1' }),
      envelope(2, { sender: { id: 'agent:a:1' }, audience: [ME], parent_id: 'm-1', kind: 'response', correlation_id: 'c-1' }),
      envelope(3, { sender: { id: 'human:other:1' }, audience: ['agent:b:1'], correlation_id: 'c-2' }),
      envelope(4, { sender: { id: 'agent:b:1' }, audience: ['human:other:1'], parent_id: 'm-3', kind: 'response', correlation_id: 'c-2' }),
      envelope(5, { sender: { id: 'agent:a:1' }, audience: ['tool:x:1'], parent_id: 'm-1', correlation_id: 'c-1' }),
    ];
    // 同一个 state 对象反复喂(索引挂在它身上),所以这里每一帧都新建一个 state,
    // 再用同一个对象追加行——两种用法都要成立。
    for (const state of grow(rows)) {
      expect([...relatedEnvelopeIdsIncremental(state, ME)].sort()).toEqual([...relatedEnvelopeIds(state, ME)].sort());
    }
  });

  it('同一个 state 对象上持续追加(索引真的走增量路径)', () => {
    const live = { rows: new Map(), lastSeq: 0 };
    const rows = [
      envelope(1, { sender: { id: 'agent:a:1' }, audience: ['agent:b:1'], correlation_id: 'c-9' }),
      envelope(2, { sender: { id: 'agent:b:1' }, audience: ['agent:a:1'], parent_id: 'm-1', correlation_id: 'c-9' }),
      // 这一条才让 c-9 成为"我的":上面两条要在此刻回溯变可见,这正是未决表兜的那一格。
      envelope(3, { sender: { id: ME }, audience: ['agent:a:1'], correlation_id: 'c-9' }),
      envelope(4, { sender: { id: 'agent:a:1' }, audience: [ME], parent_id: 'm-3', correlation_id: 'c-9' }),
    ];
    for (const row of rows) {
      live.rows.set(row.seq, row);
      live.lastSeq = row.seq;
      expect([...relatedEnvelopeIdsIncremental(live, ME)].sort()).toEqual([...relatedEnvelopeIds(live, ME)].sort());
    }
    expect(relatedEnvelopeIdsIncremental(live, ME).has('m-1')).toBe(true);
  });

  it('换了 selfId 就整张重建,恒不在别人的基线上继续加', () => {
    const state = stateOf([
      envelope(1, { sender: { id: ME }, audience: ['agent:a:1'], correlation_id: 'c-1' }),
      envelope(2, { sender: { id: 'human:other:1' }, audience: ['agent:a:1'], correlation_id: 'c-2' }),
    ]);
    relatedEnvelopeIdsIncremental(state, ME);
    const other = relatedEnvelopeIdsIncremental(state, 'human:other:1');
    expect([...other].sort()).toEqual([...relatedEnvelopeIds(state, 'human:other:1')].sort());
    expect(other.has('m-1')).toBe(false);
  });
});
