import { describe, expect, it } from 'vitest';
import { finalEchoObservation, withoutFinalEcho } from '../src/model/turn-process.js';

const note = (text) => ({ seq: 1, envelope: { id: `m-${text.slice(0, 4)}` }, process: { kind: 'stage', stage: 'text', text } });

// claude 的最后一个 text 块与终稿同文,provider 是有意这么发的(它发那一块时还不知道
// 终稿长什么样,猜不了)。渲染时两份都在手上,就不用猜。
describe('末条过程文本就是答案本身时,不再画一遍', () => {
  it('末条与答案相同 → 丢掉末条,中间那些一个不少', () => {
    const rows = [note('先看一下文件'), note('改完了,结论是 A')];
    expect(withoutFinalEcho(rows, '改完了,结论是 A').map((r) => r.process.text)).toEqual(['先看一下文件']);
    expect(finalEchoObservation(rows, '改完了,结论是 A')).toBe(rows[1]);
  });

  // 过程记录在 provider 侧截断到 4096 字,所以"是答案本身"必须包含"是答案的前缀"。
  it('末条是被截断的前缀 → 同样丢掉', () => {
    const answer = 'x'.repeat(5000);
    const truncated = `${'x'.repeat(4000)}…[truncated]`;
    expect(withoutFinalEcho([note('过程'), note(truncated)], answer).map((r) => r.process.text)).toEqual(['过程']);
  });

  it('末条是真正的过程正文 → 一个都不能丢', () => {
    const rows = [note('我先读一下'), note('读完了,接下来改')];
    expect(withoutFinalEcho(rows, '最终答案在这里')).toHaveLength(2);
    expect(finalEchoObservation(rows, '最终答案在这里')).toBeNull();
  });

  // 只看末条:中间某条碰巧是答案的前缀,也不动它——它确实被说过一次。
  it('只看末条,中间的碰巧同文也不动', () => {
    const rows = [note('答案'), note('然后我又做了点别的')];
    expect(withoutFinalEcho(rows, '答案很长很长')).toHaveLength(2);
  });

  it('还没有终态 / 没有过程文本 → 原样返回', () => {
    const rows = [note('过程')];
    expect(withoutFinalEcho(rows, '')).toBe(rows);
    expect(withoutFinalEcho([], '答案')).toEqual([]);
  });
});
