import { describe, expect, it, vi } from 'vitest';
import { createFrameBatcher } from '../src/model/frame-batcher.js';

function harness({ hidden = false } = {}) {
  const rafQueue = [];
  const timers = [];
  const flushed = [];
  const batcher = createFrameBatcher((batch) => flushed.push(batch), {
    raf: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    cancelRaf: () => {},
    timer: (fn) => { timers.push(fn); return timers.length; },
    cancelTimer: () => {},
    hidden: () => hidden,
  });
  return { batcher, flushed, tickFrame: () => rafQueue.splice(0).forEach((fn) => fn()), tickTimer: () => timers.splice(0).forEach((fn) => fn()) };
}

describe('一帧一批', () => {
  it('同一帧里的行合成一批,顺序不变', () => {
    const { batcher, flushed, tickFrame } = harness();
    batcher.push('a');
    batcher.push('b');
    batcher.push('c');
    expect(flushed).toEqual([]);
    tickFrame();
    expect(flushed).toEqual([['a', 'b', 'c']]);
  });

  it('下一帧重新开一批,恒不把上一批再落一次', () => {
    const { batcher, flushed, tickFrame } = harness();
    batcher.push('a');
    tickFrame();
    batcher.push('b');
    tickFrame();
    expect(flushed).toEqual([['a'], ['b']]);
    tickFrame();
    expect(flushed).toHaveLength(2);
  });

  // 后台标签页不会有动画帧。消息恒不能在缓冲区里无限期攒着。
  it('页面不可见时改走定时器', () => {
    const { batcher, flushed, tickFrame, tickTimer } = harness({ hidden: true });
    batcher.push('a');
    tickFrame();
    expect(flushed).toEqual([]);
    tickTimer();
    expect(flushed).toEqual([['a']]);
  });

  it('flushNow 立刻落地', () => {
    const { batcher, flushed } = harness();
    batcher.push('a');
    batcher.flushNow();
    expect(flushed).toEqual([['a']]);
    batcher.flushNow();
    expect(flushed).toHaveLength(1);
  });

  it('版本不兼容时丢弃尚未落地的一帧', () => {
    const { batcher, flushed, tickFrame } = harness();
    batcher.push('old-page-row');
    batcher.discard();
    tickFrame();
    expect(flushed).toEqual([]);
    expect(batcher.size).toBe(0);
  });
});
