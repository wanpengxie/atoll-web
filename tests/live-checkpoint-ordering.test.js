import { describe, expect, it } from 'vitest';
import { createFrameBatcher } from '../src/model/frame-batcher.js';

// 真实事故:移动端关掉浏览器再回来,一个已经完成的回合永远停在"处理中"。
//
// 原因是两条帧走不同的路:feed 行进合批缓冲,checkpoint 立刻执行。checkpoint 把
// "这段 seq 我扫过了"写进缓存 coverage,重连时这段就不再补;而它声称覆盖的那几行
// 还躺在缓冲里没落盘。页面一关,缓冲没了,coverage 却说"我有"——账上有那条终态,
// 这台设备永远看不到。
//
// 不变量:**记录 coverage 之前,缓冲必须先落地。**
describe('checkpoint 与合批缓冲的先后', () => {
  it('记 coverage 之前,缓冲里的行必须先落地', () => {
    const landed = [];
    const rafQueue = [];
    const batcher = createFrameBatcher((batch) => landed.push(...batch), {
      raf: (fn) => { rafQueue.push(fn); return rafQueue.length; },
      cancelRaf: () => {},
      timer: () => 0,
      cancelTimer: () => {},
      hidden: () => false,
    });

    const coverage = [];
    const recordCheckpoint = (highSeq) => {
      batcher.flushNow();
      coverage.push({ highSeq, landedAtThatMoment: landed.length });
    };

    batcher.push({ seq: 1 });
    batcher.push({ seq: 2 });
    // 动画帧还没来,行还在缓冲里;此刻 checkpoint 到了。
    recordCheckpoint(2);

    expect(landed.map((row) => row.seq)).toEqual([1, 2]);
    expect(coverage[0].landedAtThatMoment).toBe(2);
  });

  it('缓冲空时 checkpoint 不会凭空落一批', () => {
    let flushes = 0;
    const batcher = createFrameBatcher(() => { flushes += 1; }, {
      raf: (fn) => fn,
      cancelRaf: () => {},
      timer: () => 0,
      cancelTimer: () => {},
      hidden: () => false,
    });
    batcher.flushNow();
    batcher.flushNow();
    expect(flushes).toBe(0);
  });
});
